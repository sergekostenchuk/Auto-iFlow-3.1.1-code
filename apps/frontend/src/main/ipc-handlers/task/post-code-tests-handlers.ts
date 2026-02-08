import { ipcMain } from 'electron';
import { spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { IPC_CHANNELS, getSpecsDir } from '../../../shared/constants';
import type {
  IPCResult,
  PostCodeTestsRunResult,
  PostCodeTestsFixResult,
  PostCodeTestsReport,
  PostCodeTestsFixOptions
} from '../../../shared/types';
import { findTaskAndProject } from './shared';
import { parsePythonCommand } from '../../python-detector';
import { getConfiguredPythonPath, PythonEnvManager, pythonEnvManager as defaultPythonEnvManager } from '../../python-env-manager';
import { getBackendPath } from '../github/utils/subprocess-runner';
import { appendTaskLogEntry } from '../../task-log-writer';

const isWindows = process.platform === 'win32';

const buildPythonEnv = (
  backendPath: string,
  envManager: PythonEnvManager
): Record<string, string> => {
  const pythonEnv = envManager.getPythonEnv();
  const existing = pythonEnv.PYTHONPATH || '';
  const segments = existing ? [existing, backendPath] : [backendPath];
  return {
    ...pythonEnv,
    PYTHONPATH: segments.join(path.delimiter),
  };
};

const buildLogEntry = (
  type: 'phase_start' | 'phase_end' | 'info' | 'error' | 'success',
  content: string,
  detail?: string
) => ({
  timestamp: new Date().toISOString(),
  type,
  content,
  phase: 'validation' as const,
  subphase: 'POST-CODE TESTS',
  detail,
  collapsed: type !== 'error'
});

const resolveSpecDir = (specsPath: string | undefined, projectPath: string, autoBuildPath: string | undefined, specId: string): string => {
  if (specsPath) {
    return specsPath;
  }
  return path.join(projectPath, getSpecsDir(autoBuildPath), specId);
};

const deriveProjectDir = (specDir: string, projectPath: string, autoBuildPath: string | undefined, specId: string): string => {
  const specsBaseDir = getSpecsDir(autoBuildPath);
  const suffix = path.normalize(path.join(specsBaseDir, specId));
  const normalizedSpecDir = path.normalize(specDir);
  if (normalizedSpecDir.endsWith(suffix)) {
    const trimmed = normalizedSpecDir.slice(0, normalizedSpecDir.length - suffix.length);
    return trimmed.replace(/[\\/]$/, '');
  }
  return projectPath;
};

const hasBackendCli = (backendPath: string): boolean => {
  return (
    existsSync(path.join(backendPath, 'spec', 'post_code_tests.py')) &&
    existsSync(path.join(backendPath, 'spec', 'post_code_tests_cli.py'))
  );
};

const resolveTestRequirementsPath = (
  backendPath: string,
  projectDir: string,
  fallbackProjectDir?: string
): { path: string | null; source: 'backend' | 'project' | null; tried: string[] } => {
  const tried: string[] = [];
  const candidates: Array<{ path: string; source: 'backend' | 'project' }> = [
    { path: path.join(projectDir, 'tests', 'requirements-test.txt'), source: 'project' },
  ];

  if (fallbackProjectDir && fallbackProjectDir !== projectDir) {
    candidates.push({
      path: path.join(fallbackProjectDir, 'tests', 'requirements-test.txt'),
      source: 'project',
    });
  }

  candidates.push({ path: path.join(backendPath, 'tests', 'requirements-test.txt'), source: 'backend' });

  // If projectDir accidentally points at apps/backend, walk up to repo root.
  candidates.push({
    path: path.resolve(backendPath, '..', '..', 'tests', 'requirements-test.txt'),
    source: 'project',
  });

  for (const candidate of candidates) {
    tried.push(candidate.path);
    if (existsSync(candidate.path)) {
      return { path: candidate.path, source: candidate.source, tried };
    }
  }

  return { path: null, source: null, tried };
};

const resolveBackendPath = (projectDir: string, fallbackProjectPath: string): string | null => {
  const candidate = path.join(projectDir, 'apps', 'backend');
  if (hasBackendCli(candidate)) {
    return candidate;
  }
  const fallback = path.join(fallbackProjectPath, 'apps', 'backend');
  if (hasBackendCli(fallback)) {
    return fallback;
  }
  return getBackendPath({ path: fallbackProjectPath } as { path: string });
};

const resolveVenvPythonPath = (backendPath: string): string | null => {
  const candidate = path.join(
    backendPath,
    '.venv',
    isWindows ? 'Scripts' : 'bin',
    isWindows ? 'python.exe' : 'python'
  );
  return existsSync(candidate) ? candidate : null;
};

const syncTestBackendScript = (
  projectDir: string,
  fallbackProjectDir: string,
  specDir: string,
  specId: string
): void => {
  try {
    const source = path.join(fallbackProjectDir, 'scripts', 'test-backend.js');
    const target = path.join(projectDir, 'scripts', 'test-backend.js');
    if (!existsSync(source)) {
      return;
    }
    const sourceContent = readFileSync(source, 'utf-8');
    const targetContent = existsSync(target) ? readFileSync(target, 'utf-8') : null;
    if (targetContent !== sourceContent) {
      writeFileSync(target, sourceContent, 'utf-8');
      appendTaskLogEntry(
        specDir,
        specId,
        buildLogEntry('info', 'Synced test-backend.js from main project', source)
      );
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Failed to sync test-backend.js';
    appendTaskLogEntry(
      specDir,
      specId,
      buildLogEntry('error', 'Failed to sync test-backend.js', detail)
    );
  }
};

const runPostCodeTestsCli = async (
  backendPath: string,
  specDir: string,
  projectDir: string,
  envManager: PythonEnvManager,
  pythonPath: string,
  force?: boolean
): Promise<PostCodeTestsReport> => {
  const [pythonCommand, pythonArgs] = parsePythonCommand(pythonPath);
  const args = [
    ...pythonArgs,
    '-m',
    'spec.post_code_tests_cli',
    '--spec-dir',
    specDir,
    '--project-dir',
    projectDir
  ];
  if (force) {
    args.push('--force');
  }

  const env = buildPythonEnv(backendPath, envManager);

  return new Promise((resolve, reject) => {
    const proc = spawn(pythonCommand, args, {
      cwd: backendPath,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      reject(err);
    });

    proc.on('close', (code) => {
      const output = stdout.trim();
      if (code !== 0) {
        try {
          const parsed = JSON.parse(output) as PostCodeTestsReport;
          reject(new Error(parsed.error || stderr.trim() || 'Post-code tests runner failed'));
          return;
        } catch {
          reject(new Error(stderr.trim() || 'Post-code tests runner failed'));
          return;
        }
      }

      try {
        const parsed = JSON.parse(output) as PostCodeTestsReport;
        resolve(parsed);
      } catch {
        reject(new Error('Failed to parse post-code tests output'));
      }
    });
  });
};

const readPostCodeReport = (specDir: string): PostCodeTestsReport | null => {
  const reportPath = path.join(specDir, 'post_code_tests.json');
  if (!existsSync(reportPath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(reportPath, 'utf-8')) as PostCodeTestsReport;
  } catch {
    return null;
  }
};

const shouldInstallPytest = (report: PostCodeTestsReport | null): boolean => {
  if (!report) return false;
  const parts: string[] = [];
  if (report.reason) parts.push(report.reason);
  if (report.error) parts.push(report.error);
  if (report.results) {
    for (const result of report.results) {
      if (result.stderr) parts.push(result.stderr);
      if (result.stdout) parts.push(result.stdout);
    }
  }
  const combined = parts.join('\n').toLowerCase();
  return (
    combined.includes('pytest not found') ||
    combined.includes('requirements-test.txt') ||
    combined.includes('requirements-test') ||
    combined.includes('pytest is not installed')
  );
};

const formatPostCodeReportDetail = (report?: PostCodeTestsReport | null): string | undefined => {
  if (!report) return undefined;
  const parts: string[] = [];
  if (report.reason) parts.push(`Reason: ${report.reason}`);
  if (report.error) parts.push(`Error: ${report.error}`);
  if (report.results && report.results.length > 0) {
    for (const result of report.results) {
      const detail = result.stderr || result.stdout;
      parts.push(detail ? `${result.command} (${result.status})\n${detail}` : `${result.command} (${result.status})`);
    }
  }
  return parts.length > 0 ? parts.join('\n\n') : undefined;
};

const installPytestDeps = async (
  backendPath: string,
  requirementsPath: string,
  envManager: PythonEnvManager,
  pythonPath: string
): Promise<{ success: boolean; stdout: string; stderr: string }> => {
  const [pythonCommand, pythonArgs] = parsePythonCommand(pythonPath);
  const args = [
    ...pythonArgs,
    '-m',
    'pip',
    'install',
    '-r',
    requirementsPath
  ];
  const env = buildPythonEnv(backendPath, envManager);

  return new Promise((resolve) => {
    const proc = spawn(pythonCommand, args, {
      cwd: backendPath,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      resolve({
        success: code === 0,
        stdout,
        stderr
      });
    });
  });
};

const upgradePip = async (
  backendPath: string,
  envManager: PythonEnvManager,
  pythonPath: string
): Promise<{ success: boolean; stdout: string; stderr: string }> => {
  const [pythonCommand, pythonArgs] = parsePythonCommand(pythonPath);
  const args = [
    ...pythonArgs,
    '-m',
    'pip',
    'install',
    '--upgrade',
    'pip'
  ];
  const env = buildPythonEnv(backendPath, envManager);

  return new Promise((resolve) => {
    const proc = spawn(pythonCommand, args, {
      cwd: backendPath,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      resolve({
        success: code === 0,
        stdout,
        stderr
      });
    });
  });
};

export function registerTaskPostCodeTestsHandlers(
  envManager: PythonEnvManager = defaultPythonEnvManager
): void {
  ipcMain.handle(
    IPC_CHANNELS.TASK_POST_CODE_TESTS_RUN,
    async (
      _,
      taskId: string,
      options?: { force?: boolean }
    ): Promise<IPCResult<PostCodeTestsRunResult>> => {
      const { task, project } = findTaskAndProject(taskId);
      if (!task || !project) {
        return { success: false, error: 'Task or project not found' };
      }

      const specDir = resolveSpecDir(task.specsPath, project.path, project.autoBuildPath, task.specId);
      if (!existsSync(specDir)) {
        return { success: false, error: `Spec directory not found: ${specDir}` };
      }

      const projectDir = deriveProjectDir(specDir, project.path, project.autoBuildPath, task.specId);
      const backendPath = resolveBackendPath(projectDir, project.path);
      if (!backendPath) {
        return { success: false, error: 'Backend path not found for post-code tests' };
      }
      const backendPathNote =
        backendPath.startsWith(projectDir)
          ? `Backend path: ${backendPath}`
          : `Backend path (fallback): ${backendPath}`;

      syncTestBackendScript(projectDir, project.path, specDir, task.specId);

      const status = await envManager.initialize(backendPath);
      if (!status.ready) {
        return { success: false, error: status.error || 'Python environment not ready' };
      }
      const pythonPath = status.pythonPath ?? getConfiguredPythonPath();
      const venvPythonPath = resolveVenvPythonPath(backendPath);
      const effectivePythonPath = venvPythonPath ?? pythonPath;
      const venvNote = effectivePythonPath.includes('.venv') ? 'venv python detected' : 'WARNING: non-venv python detected';
      appendTaskLogEntry(
        specDir,
        task.specId,
        buildLogEntry('info', `Python used: ${effectivePythonPath}`, venvNote)
      );

      const requirementsProbe = resolveTestRequirementsPath(backendPath, projectDir, project.path);
      if (!requirementsProbe.path) {
        appendTaskLogEntry(
          specDir,
          task.specId,
          buildLogEntry(
            'error',
            'Preflight: test requirements missing',
            `Checked paths:\n${requirementsProbe.tried.join('\n')}`
          ),
          'validation'
        );
      } else {
        appendTaskLogEntry(
          specDir,
          task.specId,
          buildLogEntry(
            'info',
            'Preflight: test requirements found',
            requirementsProbe.path
          ),
          'validation'
        );
      }

      appendTaskLogEntry(
        specDir,
        task.specId,
        buildLogEntry('info', 'Re-running post-code tests', backendPathNote)
      );

      try {
        const report = await runPostCodeTestsCli(backendPath, specDir, projectDir, envManager, effectivePythonPath, options?.force);
        const reportDetail = formatPostCodeReportDetail(report);
        appendTaskLogEntry(
          specDir,
          task.specId,
          buildLogEntry(
            report.status === 'passed' ? 'success' : 'error',
            `Post-code tests ${report.status ?? 'completed'}`,
            reportDetail
          ),
          'validation'
        );
        return { success: true, data: { report } };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Post-code tests runner failed';
        appendTaskLogEntry(
          specDir,
          task.specId,
          buildLogEntry('error', 'Post-code tests failed to run', message),
          'validation'
        );
        return { success: false, error: message };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.TASK_POST_CODE_TESTS_FIX,
    async (
      _,
      taskId: string,
      options?: PostCodeTestsFixOptions
    ): Promise<IPCResult<PostCodeTestsFixResult>> => {
      const { task, project } = findTaskAndProject(taskId);
      if (!task || !project) {
        return { success: false, error: 'Task or project not found' };
      }

      const specDir = resolveSpecDir(task.specsPath, project.path, project.autoBuildPath, task.specId);
      if (!existsSync(specDir)) {
        return { success: false, error: `Spec directory not found: ${specDir}` };
      }

      const projectDir = deriveProjectDir(specDir, project.path, project.autoBuildPath, task.specId);
      const backendPath = resolveBackendPath(projectDir, project.path);
      if (!backendPath) {
        return { success: false, error: 'Backend path not found for post-code tests' };
      }
      const backendPathNote =
        backendPath.startsWith(projectDir)
          ? `Backend path: ${backendPath}`
          : `Backend path (fallback): ${backendPath}`;

      syncTestBackendScript(projectDir, project.path, specDir, task.specId);

      const status = await envManager.initialize(backendPath);
      if (!status.ready) {
        return { success: false, error: status.error || 'Python environment not ready' };
      }
      const pythonPath = status.pythonPath ?? getConfiguredPythonPath();
      const venvPythonPath = resolveVenvPythonPath(backendPath);
      const effectivePythonPath = venvPythonPath ?? pythonPath;

      const report = readPostCodeReport(specDir);
      if (!shouldInstallPytest(report)) {
        return {
          success: true,
          data: {
            applied: false,
            message: 'No known fix available for the current failure.'
          }
        };
      }

      let pipUpgradeNote: string | null = null;
      if (options?.upgradePip) {
        appendTaskLogEntry(
          specDir,
          task.specId,
          buildLogEntry('info', 'Upgrading pip in backend venv', backendPathNote),
          'validation'
        );
        const pipResult = await upgradePip(backendPath, envManager, effectivePythonPath);
        if (!pipResult.success) {
          const detail = [pipResult.stderr, pipResult.stdout]
            .filter(Boolean)
            .join('\n') || 'Failed to upgrade pip.';
          pipUpgradeNote = detail;
          appendTaskLogEntry(
            specDir,
            task.specId,
            buildLogEntry('error', 'Pip upgrade failed', detail),
            'validation'
          );
        } else {
          appendTaskLogEntry(
            specDir,
            task.specId,
            buildLogEntry('info', 'Pip upgraded successfully'),
            'validation'
          );
        }
      }

      appendTaskLogEntry(
        specDir,
        task.specId,
        buildLogEntry('info', 'Attempting to install backend test dependencies', backendPathNote)
      );

      const requirements = resolveTestRequirementsPath(backendPath, projectDir, project.path);
      if (!requirements.path) {
        const detail = [
          `Missing tests/requirements-test.txt in ${backendPath} and ${projectDir}.`,
          'Expected file in project root: tests/requirements-test.txt',
          `Checked paths:\n${requirements.tried.join('\n')}`
        ].join('\n');
        appendTaskLogEntry(
          specDir,
          task.specId,
          buildLogEntry('error', 'Failed to locate backend test requirements', detail),
          'validation'
        );
        return {
          success: true,
          data: {
            applied: false,
            message: detail
          }
        };
      }

      const requirementsNote =
        requirements.source === 'backend'
          ? `Using backend test requirements: ${requirements.path}`
          : `Using project test requirements: ${requirements.path}`;
      appendTaskLogEntry(
        specDir,
        task.specId,
        buildLogEntry('info', 'Resolved test requirements', requirementsNote),
        'validation'
      );

      const installResult = await installPytestDeps(
        backendPath,
        requirements.path,
        envManager,
        effectivePythonPath
      );
      if (!installResult.success) {
        const detail = [installResult.stderr, installResult.stdout]
          .filter(Boolean)
          .join('\n') || 'Failed to install test dependencies.';
        appendTaskLogEntry(
          specDir,
          task.specId,
          buildLogEntry('error', 'Failed to install backend test dependencies', detail),
          'validation'
        );
        return {
          success: true,
          data: {
            applied: false,
            message: detail
          }
        };
      }

      const backendRequirements = path.join(backendPath, 'requirements.txt');
      if (existsSync(backendRequirements)) {
        const depsResult = await installPytestDeps(
          backendPath,
          backendRequirements,
          envManager,
          effectivePythonPath
        );
        if (!depsResult.success) {
          const detail = [depsResult.stderr, depsResult.stdout]
            .filter(Boolean)
            .join('\n') || 'Failed to install backend requirements.';
          appendTaskLogEntry(
            specDir,
            task.specId,
            buildLogEntry('error', 'Failed to install backend requirements', detail),
            'validation'
          );
          return {
            success: true,
            data: {
              applied: false,
              message: detail
            }
          };
        }
      } else {
        appendTaskLogEntry(
          specDir,
          task.specId,
          buildLogEntry('error', 'Backend requirements missing', `Missing requirements.txt in ${backendPath}`),
          'validation'
        );
        return {
          success: true,
          data: {
            applied: false,
            message: `Missing requirements.txt in ${backendPath}`
          }
        };
      }

      appendTaskLogEntry(
        specDir,
        task.specId,
        buildLogEntry('info', 'Backend test dependencies installed, re-running tests')
      );

      try {
        const rerunReport = await runPostCodeTestsCli(backendPath, specDir, projectDir, envManager, effectivePythonPath, true);
        const reportDetail = formatPostCodeReportDetail(rerunReport);
        appendTaskLogEntry(
          specDir,
          task.specId,
          buildLogEntry(
            rerunReport.status === 'passed' ? 'success' : 'error',
            `Post-code tests ${rerunReport.status ?? 'completed'} after fix`,
            reportDetail
          ),
          'validation'
        );
        const messageBase = 'Applied fix and re-ran post-code tests.';
        return {
          success: true,
          data: {
            applied: true,
            message: pipUpgradeNote ? `${messageBase} Pip upgrade failed: ${pipUpgradeNote}` : messageBase,
            report: rerunReport
          }
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Post-code tests runner failed';
        appendTaskLogEntry(
          specDir,
          task.specId,
          buildLogEntry('error', 'Post-code tests failed after applying fix', message),
          'validation'
        );
        return {
          success: true,
          data: {
            applied: true,
            message
          }
        };
      }
    }
  );
}

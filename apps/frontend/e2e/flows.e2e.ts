/**
 * End-to-End tests for main user flows
 * Tests the complete user experience in the Electron app
 *
 * NOTE: These tests require the Electron app to be built first.
 * Run `npm run build` before running E2E tests.
 * The tests also require Playwright to be installed.
 *
 * To run: npx playwright test --config=e2e/playwright.config.ts
 */
import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import { execFileSync } from 'child_process';
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TaskLogService } from '../src/main/task-log-service';
import { getTaskWorktreePath } from '../src/main/worktree-paths';
import { DEFAULT_AUTO_BUILD_PATH, getSpecsDir } from '../src/shared/constants';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test data directory
const TEST_DATA_DIR = '/tmp/auto-iflow-ui-e2e';
const TEST_PROJECT_DIR = path.join(TEST_DATA_DIR, 'test-project');
const TEST_SANDBOX_ROOT = path.join(TEST_DATA_DIR, 'sandboxes');
const TEST_PLAN_PATH = path.join(TEST_DATA_DIR, 'task-plan.md');
const TEST_PLAN_AUTOSTART_PATH = path.join(TEST_DATA_DIR, 'task-plan-autostart.md');

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Auto-iFlow',
  GIT_AUTHOR_EMAIL: 'auto@iflow.local',
  GIT_COMMITTER_NAME: 'Auto-iFlow',
  GIT_COMMITTER_EMAIL: 'auto@iflow.local'
};

const resolveGitBinary = (): string | null => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return 'git';
  } catch {
    return null;
  }
};

const GIT_BINARY = resolveGitBinary();

const runGit = (args: string[], cwd: string): void => {
  if (!GIT_BINARY) {
    throw new Error('Git binary not available');
  }
  execFileSync(GIT_BINARY, args, {
    cwd,
    env: GIT_ENV,
    stdio: 'ignore'
  });
};

const createSandboxRepo = (name: string): string => {
  const repoPath = path.join(TEST_SANDBOX_ROOT, name);
  mkdirSync(repoPath, { recursive: true });
  writeFileSync(path.join(repoPath, 'README.md'), '# Sandbox\n');
  writeFileSync(path.join(repoPath, '.gitignore'), '.auto-iflow/\n');
  runGit(['init'], repoPath);
  runGit(['add', '.'], repoPath);
  runGit(['commit', '-m', 'Initial commit', '--allow-empty'], repoPath);
  runGit(['branch', '-M', 'main'], repoPath);
  return repoPath;
};

const createSandboxSpec = (repoPath: string, specId: string): string => {
  const specsDir = path.join(repoPath, getSpecsDir(DEFAULT_AUTO_BUILD_PATH));
  const specDir = path.join(specsDir, specId);
  mkdirSync(specDir, { recursive: true });
  writeFileSync(path.join(specDir, 'spec.md'), `# ${specId}\n`);
  return specDir;
};

// Setup test environment
function setupTestEnvironment(): void {
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
  mkdirSync(TEST_DATA_DIR, { recursive: true });
  mkdirSync(TEST_PROJECT_DIR, { recursive: true });
  mkdirSync(path.join(TEST_PROJECT_DIR, '.auto-iflow', 'specs'), { recursive: true });
  mkdirSync(TEST_SANDBOX_ROOT, { recursive: true });
}

// Cleanup test environment
function cleanupTestEnvironment(): void {
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
}

// Helper to create a test spec
function createTestSpec(specId: string, status: 'pending' | 'in_progress' | 'completed' = 'pending'): void {
  const specDir = path.join(TEST_PROJECT_DIR, '.auto-iflow', 'specs', specId);
  mkdirSync(specDir, { recursive: true });

  const chunkStatus = status === 'completed' ? 'completed' : status === 'in_progress' ? 'in_progress' : 'pending';

  writeFileSync(
    path.join(specDir, 'implementation_plan.json'),
    JSON.stringify({
      feature: `Test Feature ${specId}`,
      workflow_type: 'feature',
      services_involved: [],
      phases: [
        {
          phase: 1,
          name: 'Implementation',
          type: 'implementation',
          chunks: [
            { id: 'chunk-1', description: 'Implement feature', status: chunkStatus }
          ]
        }
      ],
      final_acceptance: ['Tests pass'],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      spec_file: 'spec.md'
    })
  );

  writeFileSync(
    path.join(specDir, 'spec.md'),
    `# ${specId}\n\n## Overview\n\nThis is a test feature.\n`
  );
}

function createPlanFile(filePath: string, content: string): void {
  writeFileSync(filePath, content);
}

test.describe('Add Project Flow', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    setupTestEnvironment();
  });

  test.afterAll(async () => {
    if (app) {
      await app.close();
    }
    cleanupTestEnvironment();
  });

  test.skip('should open app and display empty state', async () => {
    // Skip test if electron is not available (CI environment)
    test.skip(!process.env.ELECTRON_PATH, 'Electron not available in CI');

    const appPath = path.join(__dirname, '..');
    app = await electron.launch({ args: [appPath] });
    page = await app.firstWindow();

    await page.waitForLoadState('domcontentloaded');

    // Verify app launched
    expect(await page.title()).toBeDefined();
  });

  test.skip('should show project sidebar', async () => {
    test.skip(!app, 'App not launched');

    // Look for sidebar component
    const sidebar = await page.locator('[data-testid="sidebar"], aside, .sidebar').first();
    await expect(sidebar).toBeVisible({ timeout: 10000 });
  });

  test.skip('should have add project button', async () => {
    test.skip(!app, 'App not launched');

    // Look for add project button
    const addButton = await page.locator(
      'button:has-text("Add"), button:has-text("New Project"), [data-testid="add-project"]'
    ).first();
    await expect(addButton).toBeVisible({ timeout: 5000 });
  });

  test.skip('should open directory picker on add project click', async () => {
    test.skip(!app, 'App not launched');

    // Mock the dialog to return test project path
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: ['/tmp/auto-iflow-ui-e2e/test-project']
      });
    });

    // Click add project
    const addButton = await page.locator(
      'button:has-text("Add"), button:has-text("New Project"), [data-testid="add-project"]'
    ).first();
    await addButton.click();

    // Wait for project to appear in sidebar
    await page.waitForTimeout(1000);

    // Verify project appears
    const projectItem = await page.locator('text=test-project').first();
    await expect(projectItem).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Create Task Flow', () => {
  test.skip('should display task creation wizard', async () => {
    // This test requires the app to be running with a project selected
    // Skip in headless CI environments
    test.skip(true, 'Requires interactive Electron session');
  });

  test.skip('should create task with title and description', async () => {
    test.skip(true, 'Requires interactive Electron session');
  });

  test.skip('should show task card in backlog after creation', async () => {
    test.skip(true, 'Requires interactive Electron session');
  });
});

test.describe('Sandbox Task Flow', () => {
  test('should write logs under sandbox spec dir', () => {
    test.skip(!GIT_BINARY, 'Git not available');
    if (!GIT_BINARY) {
      return;
    }
    setupTestEnvironment();

    const sandboxRepo = createSandboxRepo('sandbox-logs');
    const specId = '001-sandbox-logs';
    const specDir = createSandboxSpec(sandboxRepo, specId);

    const logsPath = path.join(specDir, 'task_logs.json');
    const logPayload = {
      spec_id: specId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      phases: {
        planning: { status: 'completed', entries: [] },
        coding: { status: 'pending', entries: [] },
        validation: { status: 'pending', entries: [] }
      }
    };

    writeFileSync(logsPath, JSON.stringify(logPayload, null, 2));

    const logService = new TaskLogService();
    const logs = logService.loadLogsFromPath(specDir);

    expect(existsSync(logsPath)).toBe(true);
    expect(logs?.spec_id).toBe(specId);

    cleanupTestEnvironment();
  });

  test('should preserve error detail in task logs payload', () => {
    test.skip(!GIT_BINARY, 'Git not available');
    if (!GIT_BINARY) {
      return;
    }
    setupTestEnvironment();

    const sandboxRepo = createSandboxRepo('sandbox-error-detail');
    const specId = '001-sandbox-error-detail';
    const specDir = createSandboxSpec(sandboxRepo, specId);

    const logsPath = path.join(specDir, 'task_logs.json');
    const logPayload = {
      spec_id: specId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      phases: {
        planning: {
          status: 'failed',
          entries: [
            {
              timestamp: new Date().toISOString(),
              type: 'error',
              content: 'Scope preflight failed',
              detail: 'Missing allowed_paths in scope_contract.json'
            }
          ]
        },
        coding: { status: 'pending', entries: [] },
        validation: { status: 'pending', entries: [] }
      }
    };

    writeFileSync(logsPath, JSON.stringify(logPayload, null, 2));

    const logService = new TaskLogService();
    const logs = logService.loadLogsFromPath(specDir);

    expect(existsSync(logsPath)).toBe(true);
    expect(logs?.spec_id).toBe(specId);
    expect(logs?.phases.planning.entries[0].detail).toBe(
      'Missing allowed_paths in scope_contract.json'
    );

    cleanupTestEnvironment();
  });

  test('should retain build-progress notes in spec directory', () => {
    test.skip(!GIT_BINARY, 'Git not available');
    if (!GIT_BINARY) {
      return;
    }
    setupTestEnvironment();

    const sandboxRepo = createSandboxRepo('sandbox-progress-notes');
    const specId = '001-sandbox-progress';
    const specDir = createSandboxSpec(sandboxRepo, specId);

    const progressPath = path.join(specDir, 'build-progress.txt');
    const payload = [
      '# Build Progress',
      '2026-01-01T00:00:00Z | subtask subtask-1-1 status=completed new_commits=1'
    ].join('\n');
    writeFileSync(progressPath, payload);

    expect(existsSync(progressPath)).toBe(true);
    const readBack = readFileSync(progressPath, 'utf-8');
    expect(readBack).toContain('subtask-1-1');

    cleanupTestEnvironment();
  });

  test('should merge worktree changes into sandbox main branch', () => {
    test.skip(!GIT_BINARY, 'Git not available');
    if (!GIT_BINARY) {
      return;
    }
    setupTestEnvironment();

    const sandboxRepo = createSandboxRepo('sandbox-merge');
    const specId = '001-sandbox-merge';
    createSandboxSpec(sandboxRepo, specId);

    const worktreePath = getTaskWorktreePath(sandboxRepo, specId);
    mkdirSync(path.dirname(worktreePath), { recursive: true });
    const branchName = `auto-iflow/${specId}`;

    runGit(['worktree', 'add', '-b', branchName, worktreePath], sandboxRepo);
    writeFileSync(path.join(worktreePath, 'feature.txt'), 'Sandbox change\n');
    runGit(['add', 'feature.txt'], worktreePath);
    runGit(['commit', '-m', 'Add sandbox change'], worktreePath);

    runGit(['checkout', 'main'], sandboxRepo);
    runGit(['merge', '--no-ff', branchName], sandboxRepo);

    const status = execFileSync(GIT_BINARY, ['status', '--porcelain'], {
      cwd: sandboxRepo,
      env: GIT_ENV
    }).toString();

    expect(existsSync(path.join(sandboxRepo, 'feature.txt'))).toBe(true);
    expect(status.trim()).toBe('');

    cleanupTestEnvironment();
  });
});

test.describe('Task Plan Import Flow', () => {
  let app: ElectronApplication;
  let page: Page;

  const ensureProjectAvailable = async () => {
    await page.evaluate(async (projectPath) => {
      const result = await window.electronAPI.addProject(projectPath);
      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to add project');
      }
    }, TEST_PROJECT_DIR);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
  };

  const getProjectId = async (): Promise<string> => {
    const projectId = await page.evaluate(async () => {
      const result = await window.electronAPI.getProjects();
      if (!result.success || !result.data) {
        return null;
      }
      const project = result.data.find((item) => item.name === 'test-project');
      return project?.id ?? null;
    });
    if (!projectId) {
      throw new Error('Project ID not found');
    }
    return projectId;
  };

  test.beforeAll(async () => {
    setupTestEnvironment();
    createPlanFile(
      TEST_PLAN_PATH,
      `# Demo Plan\n\n- [ ] Task Alpha\n- [ ] Task Beta\n`
    );
    createPlanFile(
      TEST_PLAN_AUTOSTART_PATH,
      `# Demo Plan Autostart\n\n- [ ] Task Gamma\n`
    );

    test.skip(!process.env.ELECTRON_PATH, 'Electron not available in CI');
    const appPath = path.join(__dirname, '..');
    app = await electron.launch({ args: [appPath] });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await ensureProjectAvailable();
  });

  test.afterAll(async () => {
    if (app) {
      await app.close();
    }
    cleanupTestEnvironment();
  });

  test('should import a task plan from settings', async () => {
    test.skip(!process.env.ELECTRON_PATH, 'Electron not available in CI');

    const settingsHeading = page.getByRole('heading', { name: 'Settings', exact: true });
    if (!(await settingsHeading.isVisible().catch(() => false))) {
      await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
      await expect(settingsHeading).toBeVisible({ timeout: 10000 });
    }
    await page.getByRole('button', { name: /Import Task Plan/i }).click();

    const planInput = page.getByPlaceholder('Select a plan file (.md)');
    await planInput.fill(TEST_PLAN_PATH);

    await page.getByRole('button', { name: /Import plan/i }).click();
    await expect(page.getByText('Import summary')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Total tasks: 2')).toBeVisible();
  });

  test('should open import task detail with logs', async () => {
    test.skip(!process.env.ELECTRON_PATH, 'Electron not available in CI');

    const settingsHeading = page.getByRole('heading', { name: 'Settings', exact: true });
    if (!(await settingsHeading.isVisible().catch(() => false))) {
      await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
      await expect(settingsHeading).toBeVisible({ timeout: 10000 });
    }
    await page.getByRole('button', { name: /Import Task Plan/i }).click();

    const planInput = page.getByPlaceholder('Select a plan file (.md)');
    await planInput.fill(TEST_PLAN_PATH);
    await page.getByRole('button', { name: /Import plan/i }).click();
    await expect(page.getByText('Import summary')).toBeVisible({ timeout: 15000 });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await page.getByRole('button', { name: /Kanban Board/i }).click();
    const importCard = page.locator('.task-card-enhanced', { hasText: 'Import Task Plan' }).first();
    await expect(importCard).toBeVisible({ timeout: 15000 });
    await importCard.click();

    const modal = page.locator('[role="dialog"]').first();
    await expect(modal.getByText('Import Task Plan')).toBeVisible({ timeout: 10000 });
    await modal.getByText('Logs').click();
    await expect(modal.getByText('Starting import pipeline')).toBeVisible({ timeout: 10000 });
  });

  test('should import and autostart tasks when enabled', async () => {
    test.skip(!process.env.ELECTRON_PATH, 'Electron not available in CI');

    const settingsHeading = page.getByRole('heading', { name: 'Settings', exact: true });
    if (!(await settingsHeading.isVisible().catch(() => false))) {
      await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
      await expect(settingsHeading).toBeVisible({ timeout: 10000 });
    }
    await page.getByRole('button', { name: /Import Task Plan/i }).click();

    const autoStartContainer = page.getByText('Auto-start after import').locator('..').locator('..');
    await autoStartContainer.locator('[role="switch"]').click();

    const planInput = page.getByPlaceholder('Select a plan file (.md)');
    await planInput.fill(TEST_PLAN_AUTOSTART_PATH);

    await page.getByRole('button', { name: /Import plan/i }).click();
    await expect(page.getByText('Import summary')).toBeVisible({ timeout: 15000 });

    const projectId = await getProjectId();
    await page.waitForFunction(async (id) => {
      const result = await window.electronAPI.getTasks(id);
      if (!result.success || !result.data) {
        return false;
      }
      return result.data.some((task) => task.status === 'in_progress');
    }, projectId, { timeout: 20000 });
  });
});

test.describe('Start Task Flow', () => {
  test.skip('should move task to In Progress when started', async () => {
    test.skip(true, 'Requires interactive Electron session');
  });

  test.skip('should show progress updates during execution', async () => {
    test.skip(true, 'Requires interactive Electron session');
  });

  test.skip('should display logs in detail panel', async () => {
    test.skip(true, 'Requires interactive Electron session');
  });
});

test.describe('Complete Review Flow', () => {
  test.skip('should display review interface for completed tasks', async () => {
    test.skip(true, 'Requires interactive Electron session');
  });

  test.skip('should move task to Done on approval', async () => {
    test.skip(true, 'Requires interactive Electron session');
  });

  test.skip('should restart task on rejection with feedback', async () => {
    test.skip(true, 'Requires interactive Electron session');
  });
});

// Simpler unit-style E2E tests that don't require full app launch
test.describe('E2E Test Infrastructure', () => {
  test('should have test environment setup correctly', () => {
    setupTestEnvironment();
    expect(existsSync(TEST_DATA_DIR)).toBe(true);
    expect(existsSync(TEST_PROJECT_DIR)).toBe(true);
    cleanupTestEnvironment();
  });

  test('should create test specs correctly', () => {
    setupTestEnvironment();
    createTestSpec('001-test-spec');

    const specDir = path.join(TEST_PROJECT_DIR, '.auto-iflow', 'specs', '001-test-spec');
    expect(existsSync(specDir)).toBe(true);
    expect(existsSync(path.join(specDir, 'implementation_plan.json'))).toBe(true);
    expect(existsSync(path.join(specDir, 'spec.md'))).toBe(true);

    cleanupTestEnvironment();
  });

  test('should create specs with different statuses', () => {
    setupTestEnvironment();

    createTestSpec('001-pending', 'pending');
    createTestSpec('002-in-progress', 'in_progress');
    createTestSpec('003-completed', 'completed');

    const specsDir = path.join(TEST_PROJECT_DIR, '.auto-iflow', 'specs');
    expect(existsSync(path.join(specsDir, '001-pending'))).toBe(true);
    expect(existsSync(path.join(specsDir, '002-in-progress'))).toBe(true);
    expect(existsSync(path.join(specsDir, '003-completed'))).toBe(true);

    cleanupTestEnvironment();
  });
});

// Mock-based E2E tests that can run without launching Electron
test.describe('E2E Flow Verification (Mock-based)', () => {
  test('Add Project flow should validate project path', async () => {
    setupTestEnvironment();

    // Simulate the validation that would happen in the app
    const projectPath = TEST_PROJECT_DIR;
    expect(existsSync(projectPath)).toBe(true);

    // Check for auto-iflow directory detection
    const autoBuildPath = path.join(projectPath, '.auto-iflow');
    expect(existsSync(autoBuildPath)).toBe(true);

    cleanupTestEnvironment();
  });

  test('Create Task flow should generate spec structure', async () => {
    setupTestEnvironment();

    // Simulate what would happen when creating a task
    const specId = '001-new-task';
    const specDir = path.join(TEST_PROJECT_DIR, '.auto-iflow', 'specs', specId);
    mkdirSync(specDir, { recursive: true });

    // Write spec file
    writeFileSync(path.join(specDir, 'spec.md'), '# New Task Spec\n');

    expect(existsSync(specDir)).toBe(true);
    expect(existsSync(path.join(specDir, 'spec.md'))).toBe(true);

    cleanupTestEnvironment();
  });

  test('Start Task flow should update implementation plan status', async () => {
    setupTestEnvironment();
    createTestSpec('001-task', 'pending');

    // Simulate status update when task starts
    const planPath = path.join(
      TEST_PROJECT_DIR,
      '.auto-iflow',
      'specs',
      '001-task',
      'implementation_plan.json'
    );

    const plan = JSON.parse(readFileSync(planPath, 'utf-8'));
    plan.phases[0].chunks[0].status = 'in_progress';

    writeFileSync(planPath, JSON.stringify(plan, null, 2));

    // Verify update
    const updatedPlan = JSON.parse(readFileSync(planPath, 'utf-8'));
    expect(updatedPlan.phases[0].chunks[0].status).toBe('in_progress');

    cleanupTestEnvironment();
  });

  test('Complete Review flow should write QA report', async () => {
    setupTestEnvironment();
    createTestSpec('001-review', 'completed');

    // Simulate approval
    const qaReportPath = path.join(
      TEST_PROJECT_DIR,
      '.auto-iflow',
      'specs',
      '001-review',
      'qa_report.md'
    );

    writeFileSync(qaReportPath, `# QA Review\n\nStatus: APPROVED\n\nReviewed at: ${new Date().toISOString()}\n`);

    expect(existsSync(qaReportPath)).toBe(true);

    const content = readFileSync(qaReportPath, 'utf-8');
    expect(content).toContain('APPROVED');

    cleanupTestEnvironment();
  });

  test('Rejection flow should write fix request', async () => {
    setupTestEnvironment();
    createTestSpec('001-reject', 'completed');

    // Simulate rejection
    const fixRequestPath = path.join(
      TEST_PROJECT_DIR,
      '.auto-iflow',
      'specs',
      '001-reject',
      'QA_FIX_REQUEST.md'
    );

    writeFileSync(
      fixRequestPath,
      `# QA Fix Request\n\nStatus: REJECTED\n\n## Feedback\n\nNeeds more tests\n`
    );

    expect(existsSync(fixRequestPath)).toBe(true);

    const content = readFileSync(fixRequestPath, 'utf-8');
    expect(content).toContain('REJECTED');
    expect(content).toContain('Needs more tests');

    cleanupTestEnvironment();
  });
});

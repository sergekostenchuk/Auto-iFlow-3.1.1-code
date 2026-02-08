import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, readdirSync } from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { getToolPath } from './cli-tool-manager';
import { DEFAULT_AUTO_BUILD_PATH } from '../shared/constants';

/**
 * Debug logging - only logs when DEBUG=true or in development mode
 */
const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

function debug(message: string, data?: Record<string, unknown>): void {
  if (DEBUG) {
    if (data) {
      console.warn(`[ProjectInitializer] ${message}`, JSON.stringify(data, null, 2));
    } else {
      console.warn(`[ProjectInitializer] ${message}`);
    }
  }
}

/**
 * Git status information for a project
 */
export interface GitStatus {
  isGitRepo: boolean;
  hasCommits: boolean;
  currentBranch: string | null;
  error?: string;
}

/**
 * Check if a directory is a git repository and has at least one commit
 */
export function checkGitStatus(projectPath: string): GitStatus {
  const git = getToolPath('git');

  try {
    // Check if it's a git repository
    execFileSync(git, ['rev-parse', '--git-dir'], {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
  } catch {
    return {
      isGitRepo: false,
      hasCommits: false,
      currentBranch: null,
      error: 'Not a git repository. Please run "git init" to initialize git.'
    };
  }

  // Check if there are any commits
  let hasCommits = false;
  try {
    execFileSync(git, ['rev-parse', 'HEAD'], {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    hasCommits = true;
  } catch {
    // No commits yet
    hasCommits = false;
  }

  // Get current branch
  let currentBranch: string | null = null;
  try {
    currentBranch = execFileSync(git, ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch {
    // Branch detection failed
  }

  if (!hasCommits) {
    return {
      isGitRepo: true,
      hasCommits: false,
      currentBranch,
      error: 'Git repository has no commits. Please make an initial commit first.'
    };
  }

  return {
    isGitRepo: true,
    hasCommits: true,
    currentBranch
  };
}

/**
 * Initialize git in a project directory and create an initial commit.
 * This is a user-friendly way to set up git for non-technical users.
 */
export function initializeGit(projectPath: string): InitializationResult {
  debug('initializeGit called', { projectPath });

  // Check current git status
  const status = checkGitStatus(projectPath);
  const git = getToolPath('git');

  try {
    // Step 1: Initialize git if needed
    if (!status.isGitRepo) {
      debug('Initializing git repository');
      execFileSync(git, ['init'], {
        cwd: projectPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
    }

    // Step 2: Check if there are files to commit
    const statusOutput = execFileSync(git, ['status', '--porcelain'], {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    // Step 3: If there are untracked/modified files, add and commit them
    if (statusOutput || !status.hasCommits) {
      debug('Adding files and creating initial commit');

      // Add all files
      execFileSync(git, ['add', '-A'], {
        cwd: projectPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Create initial commit
      execFileSync(git, ['commit', '-m', 'Initial commit', '--allow-empty'], {
        cwd: projectPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
    }

    debug('Git initialization complete');
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error during git initialization';
    debug('Git initialization failed', { error: errorMessage });
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Entries to add to .gitignore when initializing a project
 */
const GITIGNORE_ENTRIES = [
  `${DEFAULT_AUTO_BUILD_PATH}/`,
  '.auto-iflow-security.json',
  '.auto-iflow-allowlist',
  '.auto-iflow-status',
  '.claude_settings.json',
  '.worktrees/',
  '.security-key',
  'logs/security/'
];

/**
 * Ensure entries exist in the project's .gitignore file.
 * Creates .gitignore if it doesn't exist.
 */
function ensureGitignoreEntries(projectPath: string, entries: string[]): void {
  const gitignorePath = path.join(projectPath, '.gitignore');

  let content = '';
  let existingLines: string[] = [];

  if (existsSync(gitignorePath)) {
    content = readFileSync(gitignorePath, 'utf-8');
    existingLines = content.split('\n').map(line => line.trim());
  }

  // Find entries that need to be added
  const entriesToAdd: string[] = [];
  for (const entry of entries) {
    const entryNormalized = entry.replace(/\/$/, ''); // Remove trailing slash for comparison
    const alreadyExists = existingLines.some(line => {
      const lineNormalized = line.replace(/\/$/, '');
      return lineNormalized === entry || lineNormalized === entryNormalized;
    });

    if (!alreadyExists) {
      entriesToAdd.push(entry);
    }
  }

  if (entriesToAdd.length === 0) {
    debug('All gitignore entries already exist');
    return;
  }

  // Build the content to append
  let appendContent = '';

  // Ensure file ends with newline before adding our entries
  if (content && !content.endsWith('\n')) {
    appendContent += '\n';
  }

  appendContent += '\n# Auto-iFlow data directories\n';
  for (const entry of entriesToAdd) {
    appendContent += entry + '\n';
  }

  if (existsSync(gitignorePath)) {
    appendFileSync(gitignorePath, appendContent);
  } else {
    writeFileSync(gitignorePath, '# Auto-iFlow data directories\n' + entriesToAdd.join('\n') + '\n');
  }

  debug('Added entries to .gitignore', { entries: entriesToAdd });
}

/**
 * Data directories created in the project data dir for each project
 */
const DATA_DIRECTORIES = [
  'specs',
  'ideation',
  'insights',
  'roadmap'
];

/**
 * Result of initialization operation
 */
export interface InitializationResult {
  success: boolean;
  error?: string;
}

/**
 * Copy tracked files from a source git repository into a target directory.
 * Uses git index to export a clean snapshot (tracked files only).
 */
export function copyProjectSnapshot(sourceProjectPath: string, targetPath: string): InitializationResult {
  debug('copyProjectSnapshot called', { sourceProjectPath, targetPath });

  if (!existsSync(sourceProjectPath)) {
    return {
      success: false,
      error: `Source project directory not found: ${sourceProjectPath}`
    };
  }

  if (!existsSync(targetPath)) {
    return {
      success: false,
      error: `Target directory not found: ${targetPath}`
    };
  }

  const targetContents = readdirSync(targetPath).filter(entry => entry !== '.' && entry !== '..');
  if (targetContents.length > 0) {
    return {
      success: false,
      error: `Target directory is not empty: ${targetPath}`
    };
  }

  const gitStatus = checkGitStatus(sourceProjectPath);
  if (!gitStatus.isGitRepo || !gitStatus.hasCommits) {
    return {
      success: false,
      error: gitStatus.error || 'Source project must be a git repo with at least one commit.'
    };
  }

  const git = getToolPath('git');

  try {
    const prefixPath = path.resolve(targetPath) + path.sep;
    const gitPrefix = process.platform === 'win32' ? prefixPath.replace(/\\/g, '/') : prefixPath;

    execFileSync(git, ['checkout-index', '-a', '-f', `--prefix=${gitPrefix}`], {
      cwd: sourceProjectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    debug('Project snapshot copied successfully');
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error during snapshot copy';
    debug('Project snapshot copy failed', { error: errorMessage });
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Check if the project has a local backend source directory
 * This indicates it's the development project itself
 */
export function hasLocalSource(projectPath: string): boolean {
  const localSourcePath = path.join(projectPath, 'apps', 'backend');
  // Use runners/spec_runner.py as marker - ensures valid backend
  const markerFile = path.join(localSourcePath, 'runners', 'spec_runner.py');
  return existsSync(localSourcePath) && existsSync(markerFile);
}

/**
 * Get the local source path for a project (if it exists)
 */
export function getLocalSourcePath(projectPath: string): string | null {
  const localSourcePath = path.join(projectPath, 'apps', 'backend');
  if (hasLocalSource(projectPath)) {
    return localSourcePath;
  }
  return null;
}

/**
 * Check if project is initialized (has data directory)
 */
export function isInitialized(projectPath: string): boolean {
  const defaultPath = path.join(projectPath, DEFAULT_AUTO_BUILD_PATH);
  return existsSync(defaultPath);
}

/**
 * Initialize auto-iflow data directory in a project.
 *
 * Creates .auto-iflow/ with data directories (specs, ideation, insights, roadmap).
 * The framework code runs from the source repo - only data is stored here.
 *
 * Requires:
 * - Project directory must exist
 * - Project must be a git repository with at least one commit
 */
export function initializeProject(projectPath: string): InitializationResult {
  debug('initializeProject called', { projectPath });

  // Validate project path exists
  if (!existsSync(projectPath)) {
    debug('Project path does not exist', { projectPath });
    return {
      success: false,
      error: `Project directory not found: ${projectPath}`
    };
  }

  // Check git status - Auto-iFlow requires git for worktree-based builds
  const gitStatus = checkGitStatus(projectPath);
  if (!gitStatus.isGitRepo || !gitStatus.hasCommits) {
    debug('Git check failed', { gitStatus });
    return {
      success: false,
      error: gitStatus.error || 'Git repository required. Auto-iFlow uses git worktrees for isolated builds.'
    };
  }

  // Check if already initialized
  const defaultPath = path.join(projectPath, DEFAULT_AUTO_BUILD_PATH);

  if (existsSync(defaultPath)) {
    debug('Already initialized - data directory exists');
    return {
      success: false,
      error: 'Project already has data directory initialized'
    };
  }

  try {
    debug('Creating data directory', { dotAutoBuildPath: defaultPath });

    // Create the data directory
    mkdirSync(defaultPath, { recursive: true });

    // Create data directories
    for (const dataDir of DATA_DIRECTORIES) {
      const dirPath = path.join(defaultPath, dataDir);
      debug('Creating data directory', { dataDir, dirPath });
      mkdirSync(dirPath, { recursive: true });
      writeFileSync(path.join(dirPath, '.gitkeep'), '');
    }

    // Update .gitignore to exclude data directories
    ensureGitignoreEntries(projectPath, GITIGNORE_ENTRIES);

    debug('Initialization complete');
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error during initialization';
    debug('Initialization failed', { error: errorMessage });
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Ensure all data directories exist in the project data dir.
 * Useful if new directories are added in future versions.
 */
export function ensureDataDirectories(projectPath: string): InitializationResult {
  const autoBuildPath = getAutoBuildPath(projectPath);
  const dotAutoBuildPath = path.join(projectPath, autoBuildPath || DEFAULT_AUTO_BUILD_PATH);

  if (!existsSync(dotAutoBuildPath)) {
    return {
      success: false,
      error: 'Project not initialized. Run initialize first.'
    };
  }

  try {
    for (const dataDir of DATA_DIRECTORIES) {
      const dirPath = path.join(dotAutoBuildPath, dataDir);
      if (!existsSync(dirPath)) {
        debug('Creating missing data directory', { dataDir, dirPath });
        mkdirSync(dirPath, { recursive: true });
        writeFileSync(path.join(dirPath, '.gitkeep'), '');
      }
    }
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Get the data directory path for a project.
 *
 * IMPORTANT: Only .auto-iflow/ is a valid data dir.
 */
export function getAutoBuildPath(projectPath: string): string | null {
  const defaultPath = path.join(projectPath, DEFAULT_AUTO_BUILD_PATH);

  debug('getAutoBuildPath called', { projectPath, defaultPath });

  if (existsSync(defaultPath)) {
    debug('Returning default data directory', { path: DEFAULT_AUTO_BUILD_PATH });
    return DEFAULT_AUTO_BUILD_PATH;
  }

  debug('No data directory found - project not initialized');
  return null;
}

/**
 * Unit tests for IPC handlers
 * Tests all IPC communication patterns between main and renderer processes
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import path from 'path';
import { DEFAULT_AUTO_BUILD_PATH, getSpecsDir } from '../../shared/constants';

// Test data directory
const TEST_DIR = mkdtempSync(path.join(tmpdir(), 'ipc-handlers-test-'));
const TEST_PROJECT_PATH = path.join(TEST_DIR, 'test-project');

// Mock electron-updater before importing
vi.mock('electron-updater', () => ({
  autoUpdater: {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    on: vi.fn(),
    checkForUpdates: vi.fn(() => Promise.resolve(null)),
    downloadUpdate: vi.fn(() => Promise.resolve()),
    quitAndInstall: vi.fn()
  }
}));

// Mock @electron-toolkit/utils before importing
vi.mock('@electron-toolkit/utils', () => ({
  is: {
    dev: true,
    windows: process.platform === 'win32',
    macos: process.platform === 'darwin',
    linux: process.platform === 'linux'
  },
  electronApp: {
    setAppUserModelId: vi.fn()
  },
  optimizer: {
    watchWindowShortcuts: vi.fn()
  }
}));

// Mock version-manager to return a predictable version
vi.mock('../updater/version-manager', () => ({
  getEffectiveVersion: vi.fn(() => '0.1.0'),
  getBundledVersion: vi.fn(() => '0.1.0'),
  parseVersionFromTag: vi.fn((tag: string) => tag.replace('v', '')),
  compareVersions: vi.fn(() => 0)
}));

vi.mock('../notification-service', () => ({
  notificationService: {
    initialize: vi.fn(),
    notifyReviewNeeded: vi.fn(),
    notifyTaskFailed: vi.fn()
  }
}));

// Mock electron-log to prevent Electron binary dependency
vi.mock('electron-log/main.js', () => ({
  default: {
    initialize: vi.fn(),
    transports: {
      file: {
        maxSize: 10 * 1024 * 1024,
        format: '',
        fileName: 'main.log',
        level: 'info',
        getFile: vi.fn(() => ({ path: '/tmp/test.log' }))
      },
      console: {
        level: 'warn',
        format: ''
      }
    },
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

// Mock modules before importing
vi.mock('electron', () => {
  const mockIpcMain = new (class extends EventEmitter {
    private handlers: Map<string, Function> = new Map();

    handle(channel: string, handler: Function): void {
      this.handlers.set(channel, handler);
    }

    removeHandler(channel: string): void {
      this.handlers.delete(channel);
    }

    async invokeHandler(channel: string, event: unknown, ...args: unknown[]): Promise<unknown> {
      const handler = this.handlers.get(channel);
      if (handler) {
        return handler(event, ...args);
      }
      throw new Error(`No handler for channel: ${channel}`);
    }

    getHandler(channel: string): Function | undefined {
      return this.handlers.get(channel);
    }
  })();

  return {
    app: {
      getPath: vi.fn((name: string) => {
        if (name === 'userData') return path.join(TEST_DIR, 'userData');
        return TEST_DIR;
      }),
      getAppPath: vi.fn(() => TEST_DIR),
      getVersion: vi.fn(() => '0.1.0'),
      isPackaged: false
    },
    ipcMain: mockIpcMain,
    dialog: {
      showOpenDialog: vi.fn(() => Promise.resolve({ canceled: false, filePaths: [TEST_PROJECT_PATH] }))
    },
    BrowserWindow: class {
      webContents = { send: vi.fn() };
    }
  };
});

// Setup test project structure
function setupTestProject(): void {
  mkdirSync(TEST_PROJECT_PATH, { recursive: true });
  mkdirSync(path.join(TEST_PROJECT_PATH, '.auto-iflow', 'specs'), { recursive: true });
}

// Cleanup test directories
function cleanupTestDirs(): void {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

// Increase timeout for all tests in this file due to dynamic imports and setup overhead
describe('IPC Handlers', { timeout: 15000 }, () => {
  let ipcMain: EventEmitter & {
    handlers: Map<string, Function>;
    invokeHandler: (channel: string, event: unknown, ...args: unknown[]) => Promise<unknown>;
    getHandler: (channel: string) => Function | undefined;
  };
  let mockMainWindow: { webContents: { send: ReturnType<typeof vi.fn> } };
  let mockAgentManager: EventEmitter & {
    startSpecCreation: ReturnType<typeof vi.fn>;
    startTaskExecution: ReturnType<typeof vi.fn>;
    startQAProcess: ReturnType<typeof vi.fn>;
    killTask: ReturnType<typeof vi.fn>;
    configure: ReturnType<typeof vi.fn>;
  };
  let mockTerminalManager: {
    create: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    invokeClaude: ReturnType<typeof vi.fn>;
    killAll: ReturnType<typeof vi.fn>;
  };
  let mockPythonEnvManager: {
    on: ReturnType<typeof vi.fn>;
    initialize: ReturnType<typeof vi.fn>;
    getStatus: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    cleanupTestDirs();
    setupTestProject();
    mkdirSync(path.join(TEST_DIR, 'userData', 'store'), { recursive: true });

    // Get mocked ipcMain
    const electron = await import('electron');
    ipcMain = electron.ipcMain as unknown as typeof ipcMain;

    // Create mock window
    mockMainWindow = {
      webContents: { send: vi.fn() }
    };

    // Create mock agent manager
    mockAgentManager = Object.assign(new EventEmitter(), {
      startSpecCreation: vi.fn(),
      startTaskExecution: vi.fn(),
      startQAProcess: vi.fn(),
      killTask: vi.fn(),
      configure: vi.fn()
    });

    // Create mock terminal manager
    mockTerminalManager = {
      create: vi.fn(() => Promise.resolve({ success: true })),
      destroy: vi.fn(() => Promise.resolve({ success: true })),
      write: vi.fn(),
      resize: vi.fn(),
      invokeClaude: vi.fn(),
      killAll: vi.fn(() => Promise.resolve())
    };

    mockPythonEnvManager = {
      on: vi.fn(),
      initialize: vi.fn(() => Promise.resolve({ ready: true, pythonPath: '/usr/bin/python3', venvExists: true, depsInstalled: true })),
      getStatus: vi.fn(() => Promise.resolve({ ready: true, pythonPath: '/usr/bin/python3', venvExists: true, depsInstalled: true }))
    };

    // Need to reset modules to re-register handlers
    vi.resetModules();
  });

  afterEach(() => {
    cleanupTestDirs();
    vi.clearAllMocks();
  });

  describe('project:add handler', () => {
    it('should return error for non-existent path', async () => {
      const { setupIpcHandlers } = await import('../ipc-handlers');
      setupIpcHandlers(mockAgentManager as never, mockTerminalManager as never, () => mockMainWindow as never, mockPythonEnvManager as never);

      const result = await ipcMain.invokeHandler('project:add', {}, '/nonexistent/path');

      expect(result).toEqual({
        success: false,
        error: 'Directory does not exist'
      });
    });

    it('should successfully add an existing project', async () => {
      const { setupIpcHandlers } = await import('../ipc-handlers');
      setupIpcHandlers(mockAgentManager as never, mockTerminalManager as never, () => mockMainWindow as never, mockPythonEnvManager as never);

      const result = await ipcMain.invokeHandler('project:add', {}, TEST_PROJECT_PATH);

      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('data');
      const data = (result as { data: { path: string; name: string } }).data;
      expect(data.path).toBe(TEST_PROJECT_PATH);
      expect(data.name).toBe('test-project');
    });

    it('should return existing project if already added', async () => {
      const { setupIpcHandlers } = await import('../ipc-handlers');
      setupIpcHandlers(mockAgentManager as never, mockTerminalManager as never, () => mockMainWindow as never, mockPythonEnvManager as never);

      // Add project twice
      const result1 = await ipcMain.invokeHandler('project:add', {}, TEST_PROJECT_PATH);
      const result2 = await ipcMain.invokeHandler('project:add', {}, TEST_PROJECT_PATH);

      const data1 = (result1 as { data: { id: string } }).data;
      const data2 = (result2 as { data: { id: string } }).data;
      expect(data1.id).toBe(data2.id);
    });
  });

  describe('project:list handler', () => {
    it('should return empty array when no projects', async () => {
      const { setupIpcHandlers } = await import('../ipc-handlers');
      setupIpcHandlers(mockAgentManager as never, mockTerminalManager as never, () => mockMainWindow as never, mockPythonEnvManager as never);

      const result = await ipcMain.invokeHandler('project:list', {});

      expect(result).toEqual({
        success: true,
        data: []
      });
    });

    it('should return all added projects', async () => {
      const { setupIpcHandlers } = await import('../ipc-handlers');
      setupIpcHandlers(mockAgentManager as never, mockTerminalManager as never, () => mockMainWindow as never, mockPythonEnvManager as never);

      // Add a project
      await ipcMain.invokeHandler('project:add', {}, TEST_PROJECT_PATH);

      const result = await ipcMain.invokeHandler('project:list', {});

      expect(result).toHaveProperty('success', true);
      const data = (result as { data: unknown[] }).data;
      expect(data).toHaveLength(1);
    });
  });

  describe('project:remove handler', () => {
    it('should return false for non-existent project', async () => {
      const { setupIpcHandlers } = await import('../ipc-handlers');
      setupIpcHandlers(mockAgentManager as never, mockTerminalManager as never, () => mockMainWindow as never, mockPythonEnvManager as never);

      const result = await ipcMain.invokeHandler('project:remove', {}, 'nonexistent-id');

      expect(result).toEqual({ success: false });
    });

    it('should successfully remove an existing project', async () => {
      const { setupIpcHandlers } = await import('../ipc-handlers');
      setupIpcHandlers(mockAgentManager as never, mockTerminalManager as never, () => mockMainWindow as never, mockPythonEnvManager as never);

      // Add a project first
      const addResult = await ipcMain.invokeHandler('project:add', {}, TEST_PROJECT_PATH);
      const projectId = (addResult as { data: { id: string } }).data.id;

      // Remove it
      const removeResult = await ipcMain.invokeHandler('project:remove', {}, projectId);

      expect(removeResult).toEqual({ success: true });

      // Verify it's gone
      const listResult = await ipcMain.invokeHandler('project:list', {});
      const data = (listResult as { data: unknown[] }).data;
      expect(data).toHaveLength(0);
    });
  });

  describe('project:updateSettings handler', () => {
    it('should return error for non-existent project', async () => {
      const { setupIpcHandlers } = await import('../ipc-handlers');
      setupIpcHandlers(mockAgentManager as never, mockTerminalManager as never, () => mockMainWindow as never, mockPythonEnvManager as never);

      const result = await ipcMain.invokeHandler(
        'project:updateSettings',
        {},
        'nonexistent-id',
        { model: 'sonnet' }
      );

      expect(result).toEqual({
        success: false,
        error: 'Project not found'
      });
    });

    it('should successfully update project settings', async () => {
      const { setupIpcHandlers } = await import('../ipc-handlers');
      setupIpcHandlers(mockAgentManager as never, mockTerminalManager as never, () => mockMainWindow as never, mockPythonEnvManager as never);

      // Add a project first
      const addResult = await ipcMain.invokeHandler('project:add', {}, TEST_PROJECT_PATH);
      const projectId = (addResult as { data: { id: string } }).data.id;

      // Update settings
      const result = await ipcMain.invokeHandler(
        'project:updateSettings',
        {},
        projectId,
        { model: 'sonnet', linearSync: true }
      );

      expect(result).toEqual({ success: true });
    });
  });

  describe('task:list handler', () => {
    it('should return empty array for project with no specs', async () => {
      const { setupIpcHandlers } = await import('../ipc-handlers');
      setupIpcHandlers(mockAgentManager as never, mockTerminalManager as never, () => mockMainWindow as never, mockPythonEnvManager as never);

      // Add a project first
      const addResult = await ipcMain.invokeHandler('project:add', {}, TEST_PROJECT_PATH);
      const projectId = (addResult as { data: { id: string } }).data.id;

      const result = await ipcMain.invokeHandler('task:list', {}, projectId);

      expect(result).toEqual({
        success: true,
        data: []
      });
    });

    it('should return tasks when specs exist', async () => {
      const { setupIpcHandlers } = await import('../ipc-handlers');
      setupIpcHandlers(mockAgentManager as never, mockTerminalManager as never, () => mockMainWindow as never, mockPythonEnvManager as never);

      // Create .auto-iflow directory first (before adding project so it gets detected)
      mkdirSync(path.join(TEST_PROJECT_PATH, '.auto-iflow', 'specs'), { recursive: true });

      // Add a project - it will detect .auto-iflow
      const addResult = await ipcMain.invokeHandler('project:add', {}, TEST_PROJECT_PATH);
      const projectId = (addResult as { data: { id: string } }).data.id;

      // Create a spec directory with implementation plan in .auto-iflow/specs
      const specDir = path.join(TEST_PROJECT_PATH, '.auto-iflow', 'specs', '001-test-feature');
      mkdirSync(specDir, { recursive: true });
      writeFileSync(path.join(specDir, 'implementation_plan.json'), JSON.stringify({
        feature: 'Test Feature',
        workflow_type: 'feature',
        services_involved: [],
        phases: [{
          phase: 1,
          name: 'Test Phase',
          type: 'implementation',
          subtasks: [{ id: 'subtask-1', description: 'Test subtask', status: 'pending' }]
        }],
        final_acceptance: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        spec_file: ''
      }));

      const result = await ipcMain.invokeHandler('task:list', {}, projectId);

      expect(result).toHaveProperty('success', true);
      const data = (result as { data: unknown[] }).data;
      expect(data).toHaveLength(1);
    });
  });

  describe('task:create handler', () => {
    it('should return error for non-existent project', async () => {
      const { setupIpcHandlers } = await import('../ipc-handlers');
      setupIpcHandlers(mockAgentManager as never, mockTerminalManager as never, () => mockMainWindow as never, mockPythonEnvManager as never);

      const result = await ipcMain.invokeHandler(
        'task:create',
        {},
        'nonexistent-id',
        'Test Task',
        'Test description'
      );

      expect(result).toEqual({
        success: false,
        error: 'Project not found'
      });
    });

    it('should create task in backlog status', async () => {
      const { setupIpcHandlers } = await import('../ipc-handlers');
      setupIpcHandlers(mockAgentManager as never, mockTerminalManager as never, () => mockMainWindow as never, mockPythonEnvManager as never);

      // Create .auto-iflow directory first (before adding project so it gets detected)
      mkdirSync(path.join(TEST_PROJECT_PATH, '.auto-iflow', 'specs'), { recursive: true });

      // Add a project first
      const addResult = await ipcMain.invokeHandler('project:add', {}, TEST_PROJECT_PATH);
      const projectId = (addResult as { data: { id: string } }).data.id;

      const result = await ipcMain.invokeHandler(
        'task:create',
        {},
        projectId,
        'Test Task',
        'Test description'
      );

      expect(result).toHaveProperty('success', true);
      // Task is created in backlog status, spec creation starts when task:start is called
      const task = (result as { data: { status: string } }).data;
      expect(task.status).toBe('backlog');
    });
  });

  describe('task:createSandbox handler', () => {
    it('should register sandbox project and task in store', async () => {
      const { setupIpcHandlers } = await import('../ipc-handlers');
      setupIpcHandlers(mockAgentManager as never, mockTerminalManager as never, () => mockMainWindow as never, mockPythonEnvManager as never);

      process.env.GIT_AUTHOR_NAME = 'Auto-iFlow';
      process.env.GIT_AUTHOR_EMAIL = 'auto@iflow.local';
      process.env.GIT_COMMITTER_NAME = 'Auto-iFlow';
      process.env.GIT_COMMITTER_EMAIL = 'auto@iflow.local';

      const result = await ipcMain.invokeHandler(
        'task:createSandbox',
        {},
        'Sandbox Task',
        'Sandbox description',
        { sandbox: true }
      );

      expect(result).toHaveProperty('success', true);
      const data = (result as { data: { task: { id: string; metadata?: { sandbox?: boolean } }; project: { id: string; path: string; isSandbox?: boolean } } }).data;
      expect(data.project.isSandbox).toBe(true);
      expect(data.task.metadata?.sandbox).toBe(true);

      const { projectStore } = await import('../project-store');
      const storedProject = projectStore.getProject(data.project.id);
      expect(storedProject?.path).toBe(data.project.path);
      expect(storedProject?.isSandbox).toBe(true);

      const tasks = projectStore.getTasks(data.project.id);
      expect(tasks.some(task => task.id === data.task.id)).toBe(true);

      const { findTaskAndProject } = await import('../ipc-handlers/task/shared');
      const found = findTaskAndProject(data.task.id);
      expect(found.task?.id).toBe(data.task.id);
      expect(found.project?.id).toBe(data.project.id);

      const { sandboxRegistry } = await import('../sandbox-registry');
      const registryEntry = sandboxRegistry.getByTaskId(data.task.id);
      expect(registryEntry?.projectId).toBe(data.project.id);
      expect(registryEntry?.projectPath).toBe(data.project.path);
    });

    it('should copy tracked files from source project into sandbox', async () => {
      const { setupIpcHandlers } = await import('../ipc-handlers');
      setupIpcHandlers(mockAgentManager as never, mockTerminalManager as never, () => mockMainWindow as never, mockPythonEnvManager as never);

      process.env.GIT_AUTHOR_NAME = 'Auto-iFlow';
      process.env.GIT_AUTHOR_EMAIL = 'auto@iflow.local';
      process.env.GIT_COMMITTER_NAME = 'Auto-iFlow';
      process.env.GIT_COMMITTER_EMAIL = 'auto@iflow.local';

      // Initialize a git repo with a tracked file
      writeFileSync(path.join(TEST_PROJECT_PATH, '.gitignore'), '.auto-iflow/\n');
      writeFileSync(path.join(TEST_PROJECT_PATH, 'README.md'), 'sandbox copy test');
      execFileSync('git', ['init'], { cwd: TEST_PROJECT_PATH, stdio: 'ignore' });
      execFileSync('git', ['add', '-A'], { cwd: TEST_PROJECT_PATH, stdio: 'ignore' });
      execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd: TEST_PROJECT_PATH, stdio: 'ignore' });

      const addResult = await ipcMain.invokeHandler('project:add', {}, TEST_PROJECT_PATH);
      const sourceProjectId = (addResult as { data: { id: string } }).data.id;

      const result = await ipcMain.invokeHandler(
        'task:createSandbox',
        {},
        'Sandbox Task',
        'Sandbox description',
        { sandbox: true },
        sourceProjectId
      );

      expect(result).toHaveProperty('success', true);
      const data = (result as { data: { project: { path: string } } }).data;
      const copiedFile = path.join(data.project.path, 'README.md');
      expect(existsSync(copiedFile)).toBe(true);
    });
  });

  describe('task:importPlan handler', () => {
    it('should import tasks from a markdown plan file', async () => {
      const { setupIpcHandlers } = await import('../ipc-handlers');
      setupIpcHandlers(mockAgentManager as never, mockTerminalManager as never, () => mockMainWindow as never, mockPythonEnvManager as never);

      mkdirSync(path.join(TEST_PROJECT_PATH, '.auto-iflow', 'specs'), { recursive: true });
      const addResult = await ipcMain.invokeHandler('project:add', {}, TEST_PROJECT_PATH);
      const projectId = (addResult as { data: { id: string } }).data.id;

      const planPath = path.join(TEST_PROJECT_PATH, 'TASK-PLAN.md');
      writeFileSync(planPath, [
        '# Section Alpha',
        '- [ ] First task (parallel: true)',
        '- [ ] Second task (parallel: true)',
        '',
        '# Section Beta',
        '- [ ] Third task (parallel: true)'
      ].join('\n'));

      const emitSpy = vi.spyOn(ipcMain, 'emit');
      const result = await ipcMain.invokeHandler(
        'task:importPlan',
        {},
        projectId,
        planPath,
        { maxConcurrency: 2, autoStart: true }
      );

      expect(result).toHaveProperty('success', true);
      const data = (result as { data: { createdTaskIds: string[]; totalTasks: number } }).data;
      expect(data.totalTasks).toBe(3);
      expect(data.createdTaskIds).toHaveLength(3);

      const { projectStore } = await import('../project-store');
      const tasks = projectStore.getTasks(projectId);
      expect(tasks).toHaveLength(4);

      const startCalls = emitSpy.mock.calls.filter((call) => call[0] === 'task:start');
      expect(startCalls.length).toBeGreaterThanOrEqual(2);

      mockAgentManager.emit('exit', data.createdTaskIds[0], 0);
      mockAgentManager.emit('exit', data.createdTaskIds[1], 0);

      const updatedStartCalls = emitSpy.mock.calls.filter((call) => call[0] === 'task:start');
      expect(updatedStartCalls.length).toBeGreaterThanOrEqual(3);
    });

    it('should create an import task with log entries', async () => {
      const { setupIpcHandlers } = await import('../ipc-handlers');
      setupIpcHandlers(mockAgentManager as never, mockTerminalManager as never, () => mockMainWindow as never, mockPythonEnvManager as never);

      mkdirSync(path.join(TEST_PROJECT_PATH, '.auto-iflow', 'specs'), { recursive: true });
      const addResult = await ipcMain.invokeHandler('project:add', {}, TEST_PROJECT_PATH);
      const projectId = (addResult as { data: { id: string } }).data.id;

      const planPath = path.join(TEST_PROJECT_PATH, 'TASK-PLAN-LOGS.md');
      writeFileSync(planPath, [
        '# Section Alpha',
        '- [ ] First task',
        '- [ ] Second task'
      ].join('\n'));

      const result = await ipcMain.invokeHandler('task:importPlan', {}, projectId, planPath, { maxConcurrency: 2 });
      expect(result).toHaveProperty('success', true);

      const { projectStore } = await import('../project-store');
      const tasks = projectStore.getTasks(projectId);
      const importTask = tasks.find((task) => task.title === 'Import Task Plan');
      expect(importTask).toBeTruthy();

      const specsDir = path.join(TEST_PROJECT_PATH, getSpecsDir(DEFAULT_AUTO_BUILD_PATH));
      const importSpecDir = path.join(specsDir, importTask!.id);
      const logsPath = path.join(importSpecDir, 'task_logs.json');
      expect(existsSync(logsPath)).toBe(true);

      const logs = JSON.parse(readFileSync(logsPath, 'utf-8')) as {
        phases?: { planning?: { entries?: Array<{ content: string }> } };
      };
      const entries = logs?.phases?.planning?.entries ?? [];
      expect(entries.length).toBeGreaterThan(0);
      const combined = entries.map((entry) => entry.content).join(' ');
      expect(combined).toMatch(/Starting task plan import/);
    });

    it('should surface parse errors for malformed plans', async () => {
      const { setupIpcHandlers } = await import('../ipc-handlers');
      setupIpcHandlers(mockAgentManager as never, mockTerminalManager as never, () => mockMainWindow as never, mockPythonEnvManager as never);

      mkdirSync(path.join(TEST_PROJECT_PATH, '.auto-iflow', 'specs'), { recursive: true });
      const addResult = await ipcMain.invokeHandler('project:add', {}, TEST_PROJECT_PATH);
      const projectId = (addResult as { data: { id: string } }).data.id;

      const planPath = path.join(TEST_PROJECT_PATH, 'TASK-PLAN-EMPTY.md');
      writeFileSync(planPath, [
        '# Empty Plan',
        '',
        'This file has no checklist tasks.'
      ].join('\n'));

      const result = await ipcMain.invokeHandler(
        'task:importPlan',
        {},
        projectId,
        planPath,
        { maxConcurrency: 2, autoStart: false }
      );

      expect(result).toHaveProperty('success', false);
      expect((result as { error?: string }).error).toMatch(/No tasks found/i);
    });

    it('should persist agent pipeline metadata when enabled', async () => {
      const { setupIpcHandlers } = await import('../ipc-handlers');
      setupIpcHandlers(mockAgentManager as never, mockTerminalManager as never, () => mockMainWindow as never, mockPythonEnvManager as never);

      mkdirSync(path.join(TEST_PROJECT_PATH, '.auto-iflow', 'specs'), { recursive: true });
      const addResult = await ipcMain.invokeHandler('project:add', {}, TEST_PROJECT_PATH);
      const projectId = (addResult as { data: { id: string } }).data.id;

      const planPath = path.join(TEST_PROJECT_PATH, 'TASK-PLAN-AGENT.md');
      writeFileSync(planPath, [
        '# Section',
        '- [ ] Task with pipeline'
      ].join('\n'));

      const result = await ipcMain.invokeHandler(
        'task:importPlan',
        {},
        projectId,
        planPath,
        {
          autoStart: false,
          agentPipeline: {
            enabled: true,
            agents: {
              parserProfileId: 'auto',
              decomposerProfileId: 'balanced',
              normalizerProfileId: 'quick',
              schedulerProfileId: 'complex'
            }
          }
        }
      );

      expect(result).toHaveProperty('success', true);

      const { projectStore } = await import('../project-store');
      const tasks = projectStore.getTasks(projectId);
      expect(tasks).toHaveLength(2);
      const importedTask = tasks.find((task) => task.metadata?.planImportPipeline?.enabled);
      expect(importedTask?.metadata?.planImportPipeline?.enabled).toBe(true);
      expect(importedTask?.metadata?.planImportPipeline?.agents).toMatchObject({
        parserProfileId: 'auto',
        decomposerProfileId: 'balanced',
        normalizerProfileId: 'quick',
        schedulerProfileId: 'complex'
      });
    });

    it('should report skipped tasks when titles are missing', async () => {
      const { setupIpcHandlers } = await import('../ipc-handlers');
      setupIpcHandlers(mockAgentManager as never, mockTerminalManager as never, () => mockMainWindow as never, mockPythonEnvManager as never);

      mkdirSync(path.join(TEST_PROJECT_PATH, '.auto-iflow', 'specs'), { recursive: true });
      const addResult = await ipcMain.invokeHandler('project:add', {}, TEST_PROJECT_PATH);
      const projectId = (addResult as { data: { id: string } }).data.id;

      const planPath = path.join(TEST_PROJECT_PATH, 'TASK-PLAN-SKIP.md');
      writeFileSync(planPath, [
        '# Section',
        '- [ ] (parallel: true)',
        '- [ ] Valid task'
      ].join('\n'));

      const result = await ipcMain.invokeHandler(
        'task:importPlan',
        {},
        projectId,
        planPath,
        { autoStart: false }
      );

      expect(result).toHaveProperty('success', true);
      const data = (result as { data: { createdTaskIds: string[]; skipped: Array<{ title: string }>; totalTasks: number } }).data;
      expect(data.totalTasks).toBe(2);
      expect(data.createdTaskIds).toHaveLength(1);
      expect(data.skipped).toHaveLength(1);
      expect(data.skipped[0].title).toMatch(/Untitled/i);
    });
  });

  describe('settings:get handler', () => {
    it('should return default settings when no settings file exists', async () => {
      const { setupIpcHandlers } = await import('../ipc-handlers');
      setupIpcHandlers(mockAgentManager as never, mockTerminalManager as never, () => mockMainWindow as never, mockPythonEnvManager as never);

      const result = await ipcMain.invokeHandler('settings:get', {});

      expect(result).toHaveProperty('success', true);
      const data = (result as { data: { theme: string } }).data;
      expect(data).toHaveProperty('theme', 'system');
    });
  });

  describe('settings:save handler', () => {
    it('should save settings successfully', async () => {
      const { setupIpcHandlers } = await import('../ipc-handlers');
      setupIpcHandlers(mockAgentManager as never, mockTerminalManager as never, () => mockMainWindow as never, mockPythonEnvManager as never);

      const result = await ipcMain.invokeHandler(
        'settings:save',
        {},
        { theme: 'dark', selectedAgentProfile: 'quick' }
      );

      expect(result).toEqual({ success: true });

      // Verify settings were saved
      const getResult = await ipcMain.invokeHandler('settings:get', {});
      const data = (getResult as { data: { theme: string; defaultModel: string; selectedAgentProfile: string } }).data;
      const { DEFAULT_AGENT_PROFILES } = await import('../../shared/constants/models');
      const profile = DEFAULT_AGENT_PROFILES.find((entry) => entry.id === data.selectedAgentProfile);
      expect(data.theme).toBe('dark');
      expect(data.selectedAgentProfile).toBe('quick');
      expect(data.defaultModel).toBe(profile?.model);
    });

    it('should configure agent manager when paths change', async () => {
      const { setupIpcHandlers } = await import('../ipc-handlers');
      setupIpcHandlers(mockAgentManager as never, mockTerminalManager as never, () => mockMainWindow as never, mockPythonEnvManager as never);

      await ipcMain.invokeHandler(
        'settings:save',
        {},
        { pythonPath: '/usr/bin/python3' }
      );

      expect(mockAgentManager.configure).toHaveBeenCalledWith('/usr/bin/python3', undefined);
    });
  });

  describe('app:version handler', () => {
    it('should return app version', async () => {
      const { setupIpcHandlers } = await import('../ipc-handlers');
      setupIpcHandlers(mockAgentManager as never, mockTerminalManager as never, () => mockMainWindow as never, mockPythonEnvManager as never);

      const result = await ipcMain.invokeHandler('app:version', {});

      expect(result).toBe('0.1.0');
    });
  });

  describe('Agent Manager event forwarding', () => {
    it('should forward log events to renderer', async () => {
      const { setupIpcHandlers } = await import('../ipc-handlers');
      setupIpcHandlers(mockAgentManager as never, mockTerminalManager as never, () => mockMainWindow as never, mockPythonEnvManager as never);

      mockAgentManager.emit('log', 'task-1', 'Test log message');

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'task:log',
        'task-1',
        'Test log message',
        undefined // projectId is undefined when task not found
      );
    });

    it('should forward error events to renderer', async () => {
      const { setupIpcHandlers } = await import('../ipc-handlers');
      setupIpcHandlers(mockAgentManager as never, mockTerminalManager as never, () => mockMainWindow as never, mockPythonEnvManager as never);

      mockAgentManager.emit('error', 'task-1', 'Test error message');

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'task:error',
        'task-1',
        'Test error message',
        undefined // projectId is undefined when task not found
      );
    });

    it('should forward exit events with status change on failure', async () => {
      const { setupIpcHandlers } = await import('../ipc-handlers');
      setupIpcHandlers(mockAgentManager as never, mockTerminalManager as never, () => mockMainWindow as never, mockPythonEnvManager as never);

      // Add project first
      await ipcMain.invokeHandler('project:add', {}, TEST_PROJECT_PATH);

      // Create a spec/task directory with implementation_plan.json
      const specDir = path.join(TEST_PROJECT_PATH, '.auto-iflow', 'specs', 'task-1');
      mkdirSync(specDir, { recursive: true });
      writeFileSync(
        path.join(specDir, 'implementation_plan.json'),
        JSON.stringify({ feature: 'Test Task', status: 'in_progress' })
      );

      mockAgentManager.emit('exit', 'task-1', 1, 'task-execution');

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'task:error',
        'task-1',
        'Process exited with code 1',
        expect.any(String)
      );
      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'task:statusChange',
        'task-1',
        'failed',
        expect.any(String) // projectId for multi-project filtering
      );
      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'task:executionProgress',
        'task-1',
        expect.objectContaining({ phase: 'failed' }),
        expect.any(String)
      );
    });
  });
});

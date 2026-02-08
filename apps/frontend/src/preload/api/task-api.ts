import { ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type {
  Task,
  IPCResult,
  TaskStartOptions,
  TaskStatus,
  TaskRecoveryResult,
  ImplementationPlan,
  TaskMetadata,
  TaskLogs,
  TaskLogStreamChunk,
  TaskPlanImportOptions,
  PostCodeTestsRunResult,
  PostCodeTestsFixResult,
  PostCodeTestsFixOptions,
  ModelRoutingSettings,
  SupportedIDE,
  SupportedTerminal,
  SandboxTaskCreateResult
} from '../../shared/types';

export interface TaskAPI {
  // Task Operations
  getTasks: (projectId: string) => Promise<IPCResult<Task[]>>;
  createTask: (
    projectId: string,
    title: string,
    description: string,
    metadata?: TaskMetadata
  ) => Promise<IPCResult<Task>>;
  createSandboxTask: (
    title: string,
    description: string,
    metadata?: TaskMetadata,
    sourceProjectId?: string
  ) => Promise<IPCResult<SandboxTaskCreateResult>>;
  importTaskPlan: (
    projectId: string,
    planPath: string,
    options?: TaskPlanImportOptions
  ) => Promise<IPCResult<import('../../shared/types').TaskPlanImportResult>>;
  resumeTaskPlanImport: (taskId: string) => Promise<IPCResult<import('../../shared/types').TaskPlanImportResumeResult>>;
  runIntakeAnalysis: (
    projectId: string,
    description: string,
    model: string,
    attachments?: string[],
    requestId?: string,
    iteration?: number
  ) => Promise<IPCResult<import('../../shared/types').IntakeResult>>;
  runIntakeReanalyze: (
    projectId: string,
    description: string,
    model: string,
    answers: import('../../shared/types').ClarifyAnswers,
    attachments?: string[],
    requestId?: string,
    iteration?: number
  ) => Promise<IPCResult<import('../../shared/types').IntakeResult>>;
  getIntakeMetrics: () => Promise<IPCResult<import('../../shared/types').IntakeMetricsSummary>>;
  runPostCodeTests: (taskId: string, options?: { force?: boolean }) => Promise<IPCResult<PostCodeTestsRunResult>>;
  fixPostCodeTests: (taskId: string, options?: PostCodeTestsFixOptions) => Promise<IPCResult<PostCodeTestsFixResult>>;
  deleteTask: (taskId: string) => Promise<IPCResult<{ removedProjectId?: string }>>;
  updateTask: (
    taskId: string,
    updates: { title?: string; description?: string }
  ) => Promise<IPCResult<Task>>;
  startTask: (taskId: string, options?: TaskStartOptions) => void;
  stopTask: (taskId: string) => void;
  submitReview: (
    taskId: string,
    approved: boolean,
    feedback?: string
  ) => Promise<IPCResult>;
  updateTaskStatus: (
    taskId: string,
    status: TaskStatus
  ) => Promise<IPCResult>;
  recoverStuckTask: (
    taskId: string,
    options?: import('../../shared/types').TaskRecoveryOptions
  ) => Promise<IPCResult<TaskRecoveryResult>>;
  checkTaskRunning: (taskId: string) => Promise<IPCResult<boolean>>;
  getTaskModelRouting: (taskId: string) => Promise<IPCResult<ModelRoutingSettings | null>>;
  setTaskModelRouting: (taskId: string, modelRouting: ModelRoutingSettings) => Promise<IPCResult>;

  // Workspace Management (for human review)
  getWorktreeStatus: (taskId: string) => Promise<IPCResult<import('../../shared/types').WorktreeStatus>>;
  getWorktreeDiff: (taskId: string) => Promise<IPCResult<import('../../shared/types').WorktreeDiff>>;
  mergeWorktree: (taskId: string, options?: { noCommit?: boolean }) => Promise<IPCResult<import('../../shared/types').WorktreeMergeResult>>;
  mergeWorktreePreview: (taskId: string) => Promise<IPCResult<import('../../shared/types').WorktreeMergeResult>>;
  applyWorktreeFix: (taskId: string, action: import('../../shared/types').WorktreeFixAction) => Promise<IPCResult<import('../../shared/types').WorktreeFixResult>>;
  discardWorktree: (taskId: string) => Promise<IPCResult<import('../../shared/types').WorktreeDiscardResult>>;
  listWorktrees: (projectId: string) => Promise<IPCResult<import('../../shared/types').WorktreeListResult>>;
  worktreeOpenInIDE: (worktreePath: string, ide: SupportedIDE, customPath?: string) => Promise<IPCResult<{ opened: boolean }>>;
  worktreeOpenInTerminal: (worktreePath: string, terminal: SupportedTerminal, customPath?: string) => Promise<IPCResult<{ opened: boolean }>>;
  worktreeDetectTools: () => Promise<IPCResult<{ ides: Array<{ id: string; name: string; path: string; installed: boolean }>; terminals: Array<{ id: string; name: string; path: string; installed: boolean }> }>>;
  archiveTasks: (projectId: string, taskIds: string[], version?: string) => Promise<IPCResult<boolean>>;
  unarchiveTasks: (projectId: string, taskIds: string[]) => Promise<IPCResult<boolean>>;

  // Task Event Listeners
  // Note: projectId is optional for backward compatibility - events without projectId will still work
  onTaskProgress: (callback: (taskId: string, plan: ImplementationPlan, projectId?: string) => void) => () => void;
  onTaskError: (callback: (taskId: string, error: string, projectId?: string) => void) => () => void;
  onTaskLog: (callback: (taskId: string, log: string, projectId?: string) => void) => () => void;
  onTaskStatusChange: (callback: (taskId: string, status: TaskStatus, projectId?: string) => void) => () => void;
  onTaskExecutionProgress: (
    callback: (taskId: string, progress: import('../../shared/types').ExecutionProgress, projectId?: string) => void
  ) => () => void;

  // Task Phase Logs
  getTaskLogs: (projectId: string, specId: string) => Promise<IPCResult<TaskLogs | null>>;
  watchTaskLogs: (projectId: string, specId: string) => Promise<IPCResult>;
  unwatchTaskLogs: (specId: string) => Promise<IPCResult>;
  onTaskLogsChanged: (callback: (specId: string, logs: TaskLogs) => void) => () => void;
  onTaskLogsStream: (callback: (specId: string, chunk: TaskLogStreamChunk) => void) => () => void;
}

export const createTaskAPI = (): TaskAPI => ({
  // Task Operations
  getTasks: (projectId: string): Promise<IPCResult<Task[]>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_LIST, projectId),

  createTask: (
    projectId: string,
    title: string,
    description: string,
    metadata?: TaskMetadata
  ): Promise<IPCResult<Task>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_CREATE, projectId, title, description, metadata),

  createSandboxTask: (
    title: string,
    description: string,
    metadata?: TaskMetadata,
    sourceProjectId?: string
  ): Promise<IPCResult<SandboxTaskCreateResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_CREATE_SANDBOX, title, description, metadata, sourceProjectId),

  importTaskPlan: (
    projectId: string,
    planPath: string,
    options?: TaskPlanImportOptions
  ): Promise<IPCResult<import('../../shared/types').TaskPlanImportResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_IMPORT_PLAN, projectId, planPath, options),

  resumeTaskPlanImport: (taskId: string): Promise<IPCResult<import('../../shared/types').TaskPlanImportResumeResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_IMPORT_PLAN_RESUME, taskId),

  runIntakeAnalysis: (
    projectId: string,
    description: string,
    model: string,
    attachments?: string[],
    requestId?: string,
    iteration?: number
  ): Promise<IPCResult<import('../../shared/types').IntakeResult>> =>
    ipcRenderer.invoke(
      IPC_CHANNELS.INTAKE_ANALYZE,
      projectId,
      description,
      model,
      attachments,
      requestId,
      iteration
    ),

  runIntakeReanalyze: (
    projectId: string,
    description: string,
    model: string,
    answers: import('../../shared/types').ClarifyAnswers,
    attachments?: string[],
    requestId?: string,
    iteration?: number
  ): Promise<IPCResult<import('../../shared/types').IntakeResult>> =>
    ipcRenderer.invoke(
      IPC_CHANNELS.INTAKE_REANALYZE,
      projectId,
      description,
      model,
      answers,
      attachments,
      requestId,
      iteration
    ),

  getIntakeMetrics: (): Promise<IPCResult<import('../../shared/types').IntakeMetricsSummary>> =>
    ipcRenderer.invoke(IPC_CHANNELS.INTAKE_METRICS),

  runPostCodeTests: (
    taskId: string,
    options?: { force?: boolean }
  ): Promise<IPCResult<PostCodeTestsRunResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_POST_CODE_TESTS_RUN, taskId, options),

  fixPostCodeTests: (taskId: string, options?: PostCodeTestsFixOptions): Promise<IPCResult<PostCodeTestsFixResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_POST_CODE_TESTS_FIX, taskId, options),

  deleteTask: (taskId: string): Promise<IPCResult<{ removedProjectId?: string }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_DELETE, taskId),

  updateTask: (
    taskId: string,
    updates: { title?: string; description?: string }
  ): Promise<IPCResult<Task>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_UPDATE, taskId, updates),

  startTask: (taskId: string, options?: TaskStartOptions): void =>
    ipcRenderer.send(IPC_CHANNELS.TASK_START, taskId, options),

  stopTask: (taskId: string): void =>
    ipcRenderer.send(IPC_CHANNELS.TASK_STOP, taskId),

  submitReview: (
    taskId: string,
    approved: boolean,
    feedback?: string
  ): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_REVIEW, taskId, approved, feedback),

  updateTaskStatus: (
    taskId: string,
    status: TaskStatus
  ): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_UPDATE_STATUS, taskId, status),

  recoverStuckTask: (
    taskId: string,
    options?: import('../../shared/types').TaskRecoveryOptions
  ): Promise<IPCResult<TaskRecoveryResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_RECOVER_STUCK, taskId, options),

  checkTaskRunning: (taskId: string): Promise<IPCResult<boolean>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_CHECK_RUNNING, taskId),

  getTaskModelRouting: (taskId: string): Promise<IPCResult<ModelRoutingSettings | null>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_MODEL_ROUTING_GET, taskId),

  setTaskModelRouting: (
    taskId: string,
    modelRouting: ModelRoutingSettings
  ): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_MODEL_ROUTING_SET, taskId, modelRouting),

  // Workspace Management
  getWorktreeStatus: (taskId: string): Promise<IPCResult<import('../../shared/types').WorktreeStatus>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_WORKTREE_STATUS, taskId),

  getWorktreeDiff: (taskId: string): Promise<IPCResult<import('../../shared/types').WorktreeDiff>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_WORKTREE_DIFF, taskId),

  mergeWorktree: (taskId: string, options?: { noCommit?: boolean }): Promise<IPCResult<import('../../shared/types').WorktreeMergeResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_WORKTREE_MERGE, taskId, options),

  mergeWorktreePreview: (taskId: string): Promise<IPCResult<import('../../shared/types').WorktreeMergeResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_WORKTREE_MERGE_PREVIEW, taskId),

  applyWorktreeFix: (
    taskId: string,
    action: import('../../shared/types').WorktreeFixAction
  ): Promise<IPCResult<import('../../shared/types').WorktreeFixResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_WORKTREE_APPLY_FIX, taskId, action),

  discardWorktree: (taskId: string): Promise<IPCResult<import('../../shared/types').WorktreeDiscardResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_WORKTREE_DISCARD, taskId),

  listWorktrees: (projectId: string): Promise<IPCResult<import('../../shared/types').WorktreeListResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_LIST_WORKTREES, projectId),

  worktreeOpenInIDE: (worktreePath: string, ide: SupportedIDE, customPath?: string): Promise<IPCResult<{ opened: boolean }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_WORKTREE_OPEN_IN_IDE, worktreePath, ide, customPath),

  worktreeOpenInTerminal: (worktreePath: string, terminal: SupportedTerminal, customPath?: string): Promise<IPCResult<{ opened: boolean }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_WORKTREE_OPEN_IN_TERMINAL, worktreePath, terminal, customPath),

  worktreeDetectTools: (): Promise<IPCResult<{ ides: Array<{ id: string; name: string; path: string; installed: boolean }>; terminals: Array<{ id: string; name: string; path: string; installed: boolean }> }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_WORKTREE_DETECT_TOOLS),

  archiveTasks: (projectId: string, taskIds: string[], version?: string): Promise<IPCResult<boolean>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_ARCHIVE, projectId, taskIds, version),

  unarchiveTasks: (projectId: string, taskIds: string[]): Promise<IPCResult<boolean>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_UNARCHIVE, projectId, taskIds),

  // Task Event Listeners
  onTaskProgress: (
    callback: (taskId: string, plan: ImplementationPlan, projectId?: string) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      taskId: string,
      plan: ImplementationPlan,
      projectId?: string
    ): void => {
      callback(taskId, plan, projectId);
    };
    ipcRenderer.on(IPC_CHANNELS.TASK_PROGRESS, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TASK_PROGRESS, handler);
    };
  },

  onTaskError: (
    callback: (taskId: string, error: string, projectId?: string) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      taskId: string,
      error: string,
      projectId?: string
    ): void => {
      callback(taskId, error, projectId);
    };
    ipcRenderer.on(IPC_CHANNELS.TASK_ERROR, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TASK_ERROR, handler);
    };
  },

  onTaskLog: (
    callback: (taskId: string, log: string, projectId?: string) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      taskId: string,
      log: string,
      projectId?: string
    ): void => {
      callback(taskId, log, projectId);
    };
    ipcRenderer.on(IPC_CHANNELS.TASK_LOG, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TASK_LOG, handler);
    };
  },

  onTaskStatusChange: (
    callback: (taskId: string, status: TaskStatus, projectId?: string) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      taskId: string,
      status: TaskStatus,
      projectId?: string
    ): void => {
      callback(taskId, status, projectId);
    };
    ipcRenderer.on(IPC_CHANNELS.TASK_STATUS_CHANGE, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TASK_STATUS_CHANGE, handler);
    };
  },

  onTaskExecutionProgress: (
    callback: (taskId: string, progress: import('../../shared/types').ExecutionProgress, projectId?: string) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      taskId: string,
      progress: import('../../shared/types').ExecutionProgress,
      projectId?: string
    ): void => {
      callback(taskId, progress, projectId);
    };
    ipcRenderer.on(IPC_CHANNELS.TASK_EXECUTION_PROGRESS, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TASK_EXECUTION_PROGRESS, handler);
    };
  },

  // Task Phase Logs
  getTaskLogs: (projectId: string, specId: string): Promise<IPCResult<TaskLogs | null>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_LOGS_GET, projectId, specId),

  watchTaskLogs: (projectId: string, specId: string): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_LOGS_WATCH, projectId, specId),

  unwatchTaskLogs: (specId: string): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_LOGS_UNWATCH, specId),

  onTaskLogsChanged: (
    callback: (specId: string, logs: TaskLogs) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      specId: string,
      logs: TaskLogs
    ): void => {
      callback(specId, logs);
    };
    ipcRenderer.on(IPC_CHANNELS.TASK_LOGS_CHANGED, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TASK_LOGS_CHANGED, handler);
    };
  },

  onTaskLogsStream: (
    callback: (specId: string, chunk: TaskLogStreamChunk) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      specId: string,
      chunk: TaskLogStreamChunk
    ): void => {
      callback(specId, chunk);
    };
    ipcRenderer.on(IPC_CHANNELS.TASK_LOGS_STREAM, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TASK_LOGS_STREAM, handler);
    };
  }
});

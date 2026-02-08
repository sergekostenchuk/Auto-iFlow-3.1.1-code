import type { AgentManager } from '../../agent';
import type { PlanImportQueueState } from '../../../shared/types';

export interface PlanImportScheduleGroup {
  parallel: boolean;
  tasks: string[];
}

export interface CreatedTaskRef {
  id: string;
  title: string;
}

export interface AutostartGroup {
  parallel: boolean;
  taskIds: string[];
}

export interface AutostartQueueController {
  pause: (taskId?: string) => void;
  resume: () => void;
  getState: () => PlanImportQueueState;
  isPaused: () => boolean;
  isCompleted: () => boolean;
}

export function buildAutostartGroups(
  schedule: PlanImportScheduleGroup[] | undefined,
  createdTasks: CreatedTaskRef[]
): AutostartGroup[] {
  const titleBuckets = new Map<string, string[]>();

  for (const task of createdTasks) {
    const bucket = titleBuckets.get(task.title) ?? [];
    bucket.push(task.id);
    titleBuckets.set(task.title, bucket);
  }

  const takeId = (title: string): string | undefined => {
    const bucket = titleBuckets.get(title);
    if (!bucket || bucket.length === 0) {
      return undefined;
    }
    const id = bucket.shift();
    if (bucket.length === 0) {
      titleBuckets.delete(title);
    }
    return id;
  };

  const groups: AutostartGroup[] = [];

  if (schedule && schedule.length > 0) {
    for (const group of schedule) {
      const taskIds = group.tasks
        .map((title) => takeId(title))
        .filter((id): id is string => Boolean(id));
      groups.push({ parallel: group.parallel, taskIds });
    }
  } else {
    for (const task of createdTasks) {
      groups.push({ parallel: false, taskIds: [task.id] });
    }
  }

  return groups.filter((group) => group.taskIds.length > 0);
}

const toIso = (): string => new Date().toISOString();

export function startAutostartQueue(
  agentManager: AgentManager,
  groups: AutostartGroup[],
  startTask: (taskId: string) => void,
  onStateChange?: (state: PlanImportQueueState) => void,
  initialState?: PlanImportQueueState
): AutostartQueueController {
  if (groups.length === 0) {
    const emptyState: PlanImportQueueState = {
      status: 'completed',
      cursor: 0,
      groups: [],
      completedTaskIds: [],
      updatedAt: toIso()
    };
    if (onStateChange) {
      onStateChange(emptyState);
    }
    return {
      pause: () => {},
      resume: () => {},
      getState: () => emptyState,
      isPaused: () => false,
      isCompleted: () => true
    };
  }

  let groupIndex = Math.max(0, Math.min(initialState?.cursor ?? 0, groups.length));
  let activeTasks = new Set<string>();
  let pausedTaskId: string | undefined;
  let completedTaskIds = new Set<string>(initialState?.completedTaskIds ?? []);

  let state: PlanImportQueueState = {
    status: initialState?.status ?? 'running',
    cursor: groupIndex,
    groups,
    completedTaskIds: Array.from(completedTaskIds),
    pausedAt: initialState?.pausedAt,
    updatedAt: toIso()
  };

  const emitState = () => {
    state = {
      ...state,
      cursor: groupIndex,
      completedTaskIds: Array.from(completedTaskIds),
      updatedAt: toIso()
    };
    if (onStateChange) {
      onStateChange(state);
    }
  };

  const cleanup = () => {
    agentManager.off('exit', onExit);
    agentManager.off('error', onError);
  };

  const advance = () => {
    if (state.status === 'paused') {
      return;
    }
    groupIndex += 1;
    if (groupIndex >= groups.length) {
      state = {
        ...state,
        status: 'completed',
        cursor: groups.length,
        updatedAt: toIso()
      };
      if (onStateChange) {
        onStateChange(state);
      }
      cleanup();
      return;
    }
    emitState();
    startGroup(groups[groupIndex]);
  };

  const startGroup = (group: AutostartGroup) => {
    const remaining = group.taskIds.filter((taskId) => !completedTaskIds.has(taskId));
    activeTasks = new Set(remaining);
    if (activeTasks.size === 0) {
      advance();
      return;
    }
    for (const taskId of activeTasks) {
      startTask(taskId);
    }
  };

  const markDone = (taskId: string) => {
    if (!activeTasks.has(taskId)) {
      return;
    }
    activeTasks.delete(taskId);
    if (state.status === 'paused' && pausedTaskId === taskId) {
      emitState();
      return;
    }
    if (!completedTaskIds.has(taskId)) {
      completedTaskIds.add(taskId);
      emitState();
    }
    if (activeTasks.size === 0) {
      advance();
    }
  };

  const onExit = (taskId: string) => {
    markDone(taskId);
  };

  const onError = (taskId: string) => {
    markDone(taskId);
  };

  agentManager.on('exit', onExit);
  agentManager.on('error', onError);
  if (state.status !== 'paused' && state.status !== 'completed') {
    startGroup(groups[groupIndex]);
  } else {
    emitState();
  }

  const pause = (taskId?: string) => {
    if (state.status === 'paused' || state.status === 'completed') {
      return;
    }
    pausedTaskId = taskId;
    state = {
      ...state,
      status: 'paused',
      pausedAt: toIso()
    };
    emitState();
  };

  const resume = () => {
    if (state.status !== 'paused') {
      return;
    }
    pausedTaskId = undefined;
    state = {
      ...state,
      status: 'running',
      pausedAt: undefined
    };
    emitState();
    if (groupIndex >= groups.length) {
      advance();
      return;
    }
    startGroup(groups[groupIndex]);
  };

  return {
    pause,
    resume,
    getState: () => state,
    isPaused: () => state.status === 'paused',
    isCompleted: () => state.status === 'completed'
  };
}

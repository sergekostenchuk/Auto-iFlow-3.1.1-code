import { ipcMain, type IpcMainEvent, type BrowserWindow } from 'electron';
import { spawn } from 'child_process';
import path from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { AUTO_BUILD_PATHS, IPC_CHANNELS, getSpecsDir } from '../../../shared/constants';
import type { IPCResult, TaskPlanImportResult, TaskMetadata, TaskPlanImportOptions, TaskPlanImportResumeResult, PlanImportQueueState } from '../../../shared/types';
import type { AgentManager } from '../../agent';
import { projectStore } from '../../project-store';
import { parsePythonCommand } from '../../python-detector';
import { pythonEnvManager, getConfiguredPythonPath } from '../../python-env-manager';
import { getBackendPath } from '../github/utils/subprocess-runner';
import { createTaskInProject } from './crud-handlers';
import { buildAutostartGroups, startAutostartQueue, type PlanImportScheduleGroup, type CreatedTaskRef, type AutostartQueueController, type AutostartGroup } from './plan-import-autostart';
import { appendTaskLogEntry } from '../../task-log-writer';
import { findTaskAndProject } from './shared';

interface PlanImportTaskPayload {
  title: string;
  description: string;
  metadata: TaskMetadata;
  parallel_allowed?: boolean | null;
}

interface PlanImportPayload {
  tasks: PlanImportTaskPayload[];
  schedule?: PlanImportScheduleGroup[];
}

interface PlanImportQueueEntry {
  controller: AutostartQueueController;
  importTaskId: string;
  importSpecDir: string;
  projectId: string;
}

export interface PausePlanImportResult {
  paused: boolean;
  importTaskId?: string;
  importSpecDir?: string;
}

const planImportQueues = new Map<string, PlanImportQueueEntry>();

const buildPythonEnv = (backendPath: string): Record<string, string> => {
  const pythonEnv = pythonEnvManager.getPythonEnv();
  const existing = pythonEnv.PYTHONPATH || '';
  const segments = existing
    ? [existing, backendPath]
    : [backendPath];
  return {
    ...pythonEnv,
    PYTHONPATH: segments.join(path.delimiter),
  };
};

const readTaskMetadata = (specDir: string): TaskMetadata => {
  const metadataPath = path.join(specDir, 'task_metadata.json');
  if (!existsSync(metadataPath)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(metadataPath, 'utf-8')) as TaskMetadata;
  } catch {
    return {};
  }
};

const writeTaskMetadata = (specDir: string, metadata: TaskMetadata): void => {
  const metadataPath = path.join(specDir, 'task_metadata.json');
  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
};

const updateImportQueueMetadata = (specDir: string, queueState: PlanImportQueueState, planImportId: string): void => {
  const metadata = readTaskMetadata(specDir);
  const updated: TaskMetadata = {
    ...metadata,
    planImportId,
    planImportQueue: queueState
  };
  writeTaskMetadata(specDir, updated);
};

const sendStatusChange = (getMainWindow: () => BrowserWindow | null, taskId: string, status: string): void => {
  const mainWindow = getMainWindow();
  if (mainWindow) {
    mainWindow.webContents.send(IPC_CHANNELS.TASK_STATUS_CHANGE, taskId, status);
  }
};

const runPlanImporter = async (
  backendPath: string,
  planPath: string,
  maxConcurrency?: number,
  agentPipeline?: TaskPlanImportOptions['agentPipeline']
): Promise<PlanImportPayload> => {
  const pythonPath = getConfiguredPythonPath();
  const [pythonCommand, pythonArgs] = parsePythonCommand(pythonPath);
  const args = [
    ...pythonArgs,
    '-m',
    'plan_importer.cli',
    '--file',
    planPath,
  ];

  if (maxConcurrency) {
    args.push('--max-concurrency', String(maxConcurrency));
  }

  if (agentPipeline?.enabled) {
    args.push('--agent-pipeline');
    if (agentPipeline.agents) {
      args.push('--agent-profiles', JSON.stringify(agentPipeline.agents));
    }
  }

  const env = buildPythonEnv(backendPath);

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
      if (code !== 0) {
        reject(new Error(stderr.trim() || 'Plan importer failed'));
        return;
      }

      try {
        const parsed = JSON.parse(stdout.trim()) as PlanImportPayload;
        resolve(parsed);
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Failed to parse plan importer output'));
      }
    });
  });
};

const updatePlanStatus = (specDir: string, status: string, reviewReason?: string): void => {
  const planPath = path.join(specDir, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN);
  const now = new Date().toISOString();
  let plan: Record<string, unknown> = {
    feature: 'Import Task Plan',
    description: 'Auto-generated task plan import job',
    created_at: now,
    updated_at: now,
    status,
    phases: []
  };

  if (existsSync(planPath)) {
    try {
      plan = JSON.parse(readFileSync(planPath, 'utf-8')) as Record<string, unknown>;
    } catch {
      // keep fallback
    }
  }

  plan.status = status;
  plan.updated_at = now;
  if (reviewReason) {
    plan.reviewReason = reviewReason;
  }

  writeFileSync(planPath, JSON.stringify(plan, null, 2));
};

const buildLogEntry = (
  type: 'phase_start' | 'phase_end' | 'info' | 'error' | 'success',
  content: string,
  detail?: string
) => ({
  timestamp: new Date().toISOString(),
  type,
  content,
  phase: 'planning' as const,
  subphase: 'TASK PLAN IMPORT',
  detail,
  collapsed: type !== 'error'
});

const appendImportLog = (
  specDir: string,
  taskId: string,
  type: 'phase_start' | 'phase_end' | 'info' | 'error' | 'success',
  content: string,
  detail?: string
): void => {
  appendTaskLogEntry(specDir, taskId, buildLogEntry(type, content, detail));
};

export function registerTaskPlanImportHandlers(
  agentManager: AgentManager,
  getMainWindow: () => BrowserWindow | null
): void {
  ipcMain.handle(
    IPC_CHANNELS.TASK_IMPORT_PLAN,
    async (
      _,
      projectId: string,
      planPath: string,
      options?: TaskPlanImportOptions
    ): Promise<IPCResult<TaskPlanImportResult>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      if (!planPath || !existsSync(planPath)) {
        return { success: false, error: `Plan file not found: ${planPath}` };
      }

      const backendPath = getBackendPath(project);
      if (!backendPath) {
        return { success: false, error: 'Backend path not found. Unable to import plan.' };
      }

      const importDescription = [
        `Plan file: ${planPath}`,
        `Auto-start: ${options?.autoStart ? 'true' : 'false'}`,
        `Max concurrency: ${options?.maxConcurrency ?? 'default'}`,
        options?.agentPipeline?.enabled ? 'Agent pipeline: enabled' : 'Agent pipeline: disabled'
      ].join('\n');

      const importTask = createTaskInProject(
        project,
        'Import Task Plan',
        importDescription,
        {
          sourceType: 'manual',
          category: 'feature'
        }
      );
      const importTaskId = importTask.id;
      const importSpecDir = path.join(project.path, getSpecsDir(project.autoBuildPath), importTask.id);
      const importMetadata = readTaskMetadata(importSpecDir);
      writeTaskMetadata(importSpecDir, { ...importMetadata, planImportId: importTaskId });
      updatePlanStatus(importSpecDir, 'planning');
      appendTaskLogEntry(
        importSpecDir,
        importTask.id,
        buildLogEntry('phase_start', 'Starting task plan import')
      );

      try {
        const payload = await runPlanImporter(
          backendPath,
          planPath,
          options?.maxConcurrency,
          options?.agentPipeline
        );
        appendTaskLogEntry(
          importSpecDir,
          importTask.id,
          buildLogEntry('info', 'Plan parsed successfully', JSON.stringify(payload.schedule ?? [], null, 2))
        );
        const createdTaskIds: string[] = [];
        const createdTasks: CreatedTaskRef[] = [];
        const skipped: Array<{ title: string; reason: string }> = [];
        const errors: Array<{ title?: string; error: string }> = [];

        for (const task of payload.tasks) {
          if (!task.title?.trim()) {
            skipped.push({ title: task.title || 'Untitled', reason: 'Missing task title' });
            continue;
          }

          try {
            const taskMetadata: TaskMetadata = {
              ...task.metadata,
              sourceType: 'imported',
              planImportId: importTaskId,
              planImportPipeline: options?.agentPipeline?.enabled
                ? {
                  enabled: true,
                  mode: 'agent',
                  agents: options.agentPipeline.agents
                }
                : undefined
            };
            const created = createTaskInProject(project, task.title, task.description, taskMetadata);
            createdTaskIds.push(created.id);
            createdTasks.push({ id: created.id, title: task.title });
          } catch (err) {
            errors.push({
              title: task.title,
              error: err instanceof Error ? err.message : 'Failed to create task'
            });
          }
        }

        if (options?.autoStart) {
          const groups = buildAutostartGroups(payload.schedule, createdTasks);
          appendTaskLogEntry(
            importSpecDir,
            importTask.id,
            buildLogEntry('info', 'Autostart schedule prepared', JSON.stringify(groups, null, 2))
          );
          const startTask = (taskId: string) => {
            ipcMain.emit(IPC_CHANNELS.TASK_START, null as unknown as IpcMainEvent, taskId);
          };
          const initialQueueState: PlanImportQueueState = {
            status: 'running',
            cursor: 0,
            groups,
            completedTaskIds: [],
            updatedAt: new Date().toISOString()
          };
          updateImportQueueMetadata(importSpecDir, initialQueueState, importTaskId);
          updatePlanStatus(importSpecDir, 'in_progress');
          sendStatusChange(getMainWindow, importTaskId, 'in_progress');
          const controller = startAutostartQueue(
            agentManager,
            groups,
            startTask,
            (queueState) => {
              updateImportQueueMetadata(importSpecDir, queueState, importTaskId);
              if (queueState.status === 'paused') {
                updatePlanStatus(importSpecDir, 'paused');
                sendStatusChange(getMainWindow, importTaskId, 'paused');
                return;
              }
              if (queueState.status === 'completed') {
                updatePlanStatus(importSpecDir, 'completed');
                sendStatusChange(getMainWindow, importTaskId, 'done');
                planImportQueues.delete(importTaskId);
              }
            },
            initialQueueState
          );
          planImportQueues.set(importTaskId, {
            controller,
            importTaskId,
            importSpecDir,
            projectId: project.id
          });
        }

        appendTaskLogEntry(
          importSpecDir,
          importTask.id,
          buildLogEntry(
            'success',
            `Import finished. Created: ${createdTaskIds.length}, skipped: ${skipped.length}, errors: ${errors.length}`,
            JSON.stringify({ createdTaskIds, skipped, errors }, null, 2)
          )
        );

        if (createdTaskIds.length === 0 && errors.length > 0) {
          updatePlanStatus(importSpecDir, 'failed', 'errors');
        } else if (!options?.autoStart) {
          updatePlanStatus(importSpecDir, 'completed');
        }

        return {
          success: true,
          data: {
            createdTaskIds,
            skipped,
            errors,
            totalTasks: payload.tasks.length
          }
        };
      } catch (err) {
        appendTaskLogEntry(
          importSpecDir,
          importTask.id,
          buildLogEntry('error', 'Plan import failed', err instanceof Error ? err.message : 'Plan import failed')
        );
        updatePlanStatus(importSpecDir, 'failed', 'errors');
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Plan import failed'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.TASK_IMPORT_PLAN_RESUME,
    async (
      _,
      importTaskId: string
    ): Promise<IPCResult<TaskPlanImportResumeResult>> => {
      const { task, project } = findTaskAndProject(importTaskId);
      if (!task || !project) {
        return { success: false, error: 'Task not found' };
      }

      const importSpecDir = path.join(project.path, getSpecsDir(project.autoBuildPath), task.specId);
      const metadata = readTaskMetadata(importSpecDir);
      const savedQueue = metadata.planImportQueue;

      if (!savedQueue || !savedQueue.groups || savedQueue.groups.length === 0) {
        appendImportLog(
          importSpecDir,
          task.id,
          'error',
          'Resume failed: no saved queue found',
          JSON.stringify({ planImportId: task.id }, null, 2)
        );
        return { success: false, error: 'No saved import queue found to resume' };
      }

      let entry = planImportQueues.get(importTaskId);
      if (!entry) {
        const startTask = (taskId: string) => {
          ipcMain.emit(IPC_CHANNELS.TASK_START, null as unknown as IpcMainEvent, taskId);
        };
        const controller = startAutostartQueue(
          agentManager,
          savedQueue.groups as AutostartGroup[],
          startTask,
          (queueState) => {
            updateImportQueueMetadata(importSpecDir, queueState, importTaskId);
            if (queueState.status === 'paused') {
              updatePlanStatus(importSpecDir, 'paused');
              sendStatusChange(getMainWindow, importTaskId, 'paused');
              return;
            }
            if (queueState.status === 'completed') {
              updatePlanStatus(importSpecDir, 'completed');
              sendStatusChange(getMainWindow, importTaskId, 'done');
              planImportQueues.delete(importTaskId);
            }
          },
          savedQueue
        );
        entry = {
          controller,
          importTaskId,
          importSpecDir,
          projectId: project.id
        };
        planImportQueues.set(importTaskId, entry);
      }

      if (entry.controller.isCompleted()) {
        appendImportLog(
          importSpecDir,
          task.id,
          'info',
          'Resume ignored: queue already completed',
          JSON.stringify({ cursor: entry.controller.getState().cursor }, null, 2)
        );
        return {
          success: true,
          data: {
            resumed: false,
            cursor: entry.controller.getState().cursor,
            status: entry.controller.getState().status
          }
        };
      }

      entry.controller.resume();
      appendImportLog(
        importSpecDir,
        task.id,
        'info',
        'Queue resumed',
        JSON.stringify({ cursor: entry.controller.getState().cursor }, null, 2)
      );
      updatePlanStatus(importSpecDir, 'in_progress');
      sendStatusChange(getMainWindow, importTaskId, 'in_progress');

      return {
        success: true,
        data: {
          resumed: true,
          cursor: entry.controller.getState().cursor,
          status: entry.controller.getState().status
        }
      };
    }
  );
}

export const pausePlanImportQueueForTask = (taskId: string): PausePlanImportResult => {
  const { task } = findTaskAndProject(taskId);
  if (!task) {
    return { paused: false };
  }
  const importTaskId = task.metadata?.planImportId ?? task.id;
  const entry = planImportQueues.get(importTaskId);
  if (!entry) {
    return { paused: false, importTaskId };
  }
  if (entry.controller.isPaused() || entry.controller.isCompleted()) {
    return { paused: false, importTaskId, importSpecDir: entry.importSpecDir };
  }
  entry.controller.pause(taskId);
  appendImportLog(
    entry.importSpecDir,
    entry.importTaskId,
    'info',
    'Queue paused',
    JSON.stringify(
      {
        pausedTaskId: taskId,
        cursor: entry.controller.getState().cursor
      },
      null,
      2
    )
  );
  return { paused: true, importTaskId: entry.importTaskId, importSpecDir: entry.importSpecDir };
};

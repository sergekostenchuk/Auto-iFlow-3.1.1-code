import type { BrowserWindow } from 'electron';
import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { IPC_CHANNELS, AUTO_BUILD_PATHS, getSpecsDir } from '../../shared/constants';
import type {
  SDKRateLimitInfo,
  Task,
  TaskStatus,
  Project,
  ImplementationPlan,
  ReviewReason,
  TaskLogEntry,
  TaskMetadata
} from '../../shared/types';
import { AgentManager } from '../agent';
import type { ProcessType, ExecutionProgressData } from '../agent';
import { titleGenerator } from '../title-generator';
import { fileWatcher } from '../file-watcher';
import { projectStore } from '../project-store';
import { notificationService } from '../notification-service';
import { persistPlanStatusSync, getPlanPath, createPlanIfNotExists } from './task/plan-file-utils';
import { findTaskWorktree } from '../worktree-paths';
import { findTaskAndProject } from './task/shared';
import { taskLogService } from '../task-log-service';
import { appendTaskLogEntry } from '../task-log-writer';
import { mergeTaskWorktree } from './task/worktree-handlers';
import { pythonEnvManager } from '../python-env-manager';

type AutoMergeDecision = {
  eligible: boolean;
  requiresMergeReview: boolean;
  reason?: string;
};

const readJsonFile = <T>(filePath: string): T | null => {
  try {
    if (!existsSync(filePath)) {
      return null;
    }
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
};

const getSpecDirCandidates = (task: Task, project: Project): string[] => {
  const specsBaseDir = getSpecsDir(project.autoBuildPath);
  const mainSpecDir = path.join(project.path, specsBaseDir, task.specId);
  const candidates = [task.specsPath, mainSpecDir].filter(Boolean) as string[];
  const unique = Array.from(new Set(candidates));
  return unique.filter((candidate) => existsSync(candidate));
};

const loadTaskMetadataFromDisk = (task: Task, project: Project): TaskMetadata | undefined => {
  const candidates = getSpecDirCandidates(task, project);
  for (const specDir of candidates) {
    const metadataPath = path.join(specDir, 'task_metadata.json');
    const metadata = readJsonFile<TaskMetadata>(metadataPath);
    if (metadata) {
      return metadata;
    }
  }
  return task.metadata;
};

const loadPlanFromDisk = (task: Task, project: Project): ImplementationPlan | null => {
  const candidates = getSpecDirCandidates(task, project);
  for (const specDir of candidates) {
    const planPath = path.join(specDir, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN);
    const plan = readJsonFile<ImplementationPlan>(planPath);
    if (plan) {
      return plan;
    }
  }
  return null;
};

const getPlanSubtasks = (plan: ImplementationPlan | null): Array<{ status?: string }> => {
  if (!plan?.phases) {
    return [];
  }
  return plan.phases.flatMap((phase) => phase.subtasks || (phase as { chunks?: Array<{ status?: string }> }).chunks || []);
};

const areAllSubtasksComplete = (plan: ImplementationPlan | null, task: Task): boolean => {
  const planSubtasks = getPlanSubtasks(plan);
  if (planSubtasks.length > 0) {
    return planSubtasks.every((subtask) => subtask.status === 'completed');
  }
  return task.subtasks?.length ? task.subtasks.every((subtask) => subtask.status === 'completed') : false;
};

const getAutoMergeDecision = (task: Task, project: Project): AutoMergeDecision => {
  const metadata = loadTaskMetadataFromDisk(task, project);
  const requiresMergeReview = metadata?.requireReviewBeforeMerge ?? task.metadata?.requireReviewBeforeMerge ?? true;

  if (requiresMergeReview) {
    return { eligible: false, requiresMergeReview, reason: 'review_required' };
  }

  const plan = loadPlanFromDisk(task, project);
  const allSubtasksComplete = areAllSubtasksComplete(plan, task);
  if (!allSubtasksComplete) {
    return { eligible: false, requiresMergeReview, reason: 'subtasks_incomplete' };
  }

  const planReviewReason = plan
    ? ((plan as { reviewReason?: ReviewReason; review_reason?: ReviewReason }).reviewReason ||
      (plan as { review_reason?: ReviewReason }).review_reason)
    : undefined;
  const reviewReason = planReviewReason ?? task.reviewReason;
  if (reviewReason && reviewReason !== 'completed') {
    return { eligible: false, requiresMergeReview, reason: `review_${reviewReason}` };
  }

  const qaStatus = (plan as unknown as { qa_signoff?: { status?: string } } | null)?.qa_signoff?.status;
  if (qaStatus && qaStatus !== 'approved') {
    return { eligible: false, requiresMergeReview, reason: `qa_${qaStatus}` };
  }

  const worktreePath = findTaskWorktree(project.path, task.specId);
  if (!worktreePath) {
    return { eligible: false, requiresMergeReview, reason: 'no_worktree' };
  }

  return { eligible: true, requiresMergeReview };
};

/**
 * Register all agent-events-related IPC handlers
 */
export function registerAgenteventsHandlers(
  agentManager: AgentManager,
  getMainWindow: () => BrowserWindow | null
): void {
  const autoMergeInProgress = new Set<string>();

  const tryAutoMergeTask = async (taskId: string, task: Task, project: Project, source: string): Promise<void> => {
    const decision = getAutoMergeDecision(task, project);
    if (!decision.eligible) {
      if (!decision.requiresMergeReview) {
        console.warn(`[AUTO-MERGE] Skipped for ${taskId} (${source}):`, decision.reason);
      }
      return;
    }

    if (autoMergeInProgress.has(taskId)) {
      return;
    }

    autoMergeInProgress.add(taskId);
    try {
      const mergeResult = await mergeTaskWorktree(taskId, { noCommit: false }, { pythonEnvManager, getMainWindow });
      if (!mergeResult.success) {
        console.warn('[AUTO-MERGE] Merge failed for task', taskId, mergeResult.error);
      }
    } finally {
      autoMergeInProgress.delete(taskId);
    }
  };
  // ============================================
  // Agent Manager Events → Renderer
  // ============================================

  agentManager.on('log', (taskId: string, log: string) => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      // Include projectId for multi-project filtering (issue #723)
      const { project } = findTaskAndProject(taskId);
      mainWindow.webContents.send(IPC_CHANNELS.TASK_LOG, taskId, log, project?.id);
    }
  });

  agentManager.on('error', (taskId: string, error: string) => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      // Include projectId for multi-project filtering (issue #723)
      const { project, task } = findTaskAndProject(taskId);
      mainWindow.webContents.send(IPC_CHANNELS.TASK_ERROR, taskId, error, project?.id);

      if (project && task) {
        const specsBaseDir = getSpecsDir(project.autoBuildPath);
        const specDir = task.specsPath || path.join(project.path, specsBaseDir, task.specId);
        appendTaskLogEntry(
          specDir,
          task.specId,
          {
            timestamp: new Date().toISOString(),
            type: 'error',
            content: error,
            phase: taskLogService.getActivePhase(specDir) || 'planning',
            detail: error,
            collapsed: false
          }
        );
      }
    }
  });

  // Handle SDK rate limit events from agent manager
  agentManager.on('sdk-rate-limit', (rateLimitInfo: SDKRateLimitInfo) => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.CLAUDE_SDK_RATE_LIMIT, rateLimitInfo);
    }
  });

  // Handle SDK rate limit events from title generator
  titleGenerator.on('sdk-rate-limit', (rateLimitInfo: SDKRateLimitInfo) => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.CLAUDE_SDK_RATE_LIMIT, rateLimitInfo);
    }
  });

  const getTaskFailureMessage = (
    task: Task,
    project: Project,
    code: number | null
  ): string => {
    const specsBaseDir = getSpecsDir(project.autoBuildPath);
    const specDir = task.specsPath || path.join(project.path, specsBaseDir, task.specId);
    const logs = taskLogService.loadLogs(specDir, project.path, specsBaseDir, task.specId);

    if (logs) {
      const phases: Array<keyof typeof logs.phases> = ['planning', 'coding', 'validation'];
      const entries: TaskLogEntry[] = [];
      for (const phase of phases) {
        const phaseEntries = logs.phases[phase]?.entries;
        if (phaseEntries && phaseEntries.length > 0) {
          entries.push(...phaseEntries);
        }
      }

      let latestError: TaskLogEntry | null = null;
      let latestTimestamp = 0;
      let latestIndex = -1;

      entries.forEach((entry, index) => {
        if (entry.type !== 'error') {
          return;
        }
        const entryTime = entry.timestamp ? Date.parse(entry.timestamp) : 0;
        if (
          !latestError ||
          entryTime > latestTimestamp ||
          (entryTime === latestTimestamp && index > latestIndex)
        ) {
          latestError = entry;
          latestTimestamp = entryTime;
          latestIndex = index;
        }
      });

      if (latestError) {
        const message = (latestError.detail || latestError.content || '').trim();
        if (message) {
          return message;
        }
      }
    }

    return `Process exited with code ${code ?? 'unknown'}`;
  };

  agentManager.on('exit', (taskId: string, code: number | null, processType: ProcessType) => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      // Get project info early for multi-project filtering (issue #723)
      const { project: exitProject } = findTaskAndProject(taskId);
      const exitProjectId = exitProject?.id;

      // Send final plan state to renderer BEFORE unwatching
      // This ensures the renderer has the final subtask data (fixes 0/0 subtask bug)
      const finalPlan = fileWatcher.getCurrentPlan(taskId);
      if (finalPlan) {
        mainWindow.webContents.send(IPC_CHANNELS.TASK_PROGRESS, taskId, finalPlan, exitProjectId);
      }

      fileWatcher.unwatch(taskId);

      if (processType === 'spec-creation') {
        console.warn(`[Task ${taskId}] Spec creation completed with code ${code}`);
        if (code !== 0) {
          const { task, project } = findTaskAndProject(taskId);
          if (task && project) {
            const taskTitle = task.title || task.specId;
            const errorMessage = getTaskFailureMessage(task, project, code);
            mainWindow.webContents.send(
              IPC_CHANNELS.TASK_ERROR,
              taskId,
              errorMessage,
              project.id
            );
            const specsBaseDir = getSpecsDir(project.autoBuildPath);
            const specDir = task.specsPath || path.join(project.path, specsBaseDir, task.specId);
            appendTaskLogEntry(
              specDir,
              task.specId,
              {
                timestamp: new Date().toISOString(),
                type: 'error',
                content: errorMessage,
                phase: 'planning',
                detail: errorMessage,
                collapsed: false
              },
              'planning'
            );
            notificationService.notifyTaskFailed(taskTitle, project.id, taskId);
            const mainPlanPath = getPlanPath(project, task);
            const projectId = project.id;
            const taskSpecId = task.specId;
            const projectPath = project.path;
            const autoBuildPath = project.autoBuildPath;
            const reviewReason: ReviewReason = 'errors';

            const persistStatus = (status: TaskStatus) => {
              const mainPersisted = persistPlanStatusSync(mainPlanPath, status, projectId, reviewReason);
              if (!mainPersisted) {
                createPlanIfNotExists(mainPlanPath, task, status, reviewReason).catch((error) => {
                  console.warn(`[Task ${taskId}] Failed to create plan file:`, error);
                });
              }

              const worktreePath = findTaskWorktree(projectPath, taskSpecId);
              if (worktreePath) {
                const specsBaseDir = getSpecsDir(autoBuildPath);
                const worktreePlanPath = path.join(
                  worktreePath,
                  specsBaseDir,
                  taskSpecId,
                  AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN
                );
                const worktreePersisted = persistPlanStatusSync(worktreePlanPath, status, projectId, reviewReason);
                if (!worktreePersisted) {
                  createPlanIfNotExists(worktreePlanPath, task, status, reviewReason).catch((error) => {
                    console.warn(`[Task ${taskId}] Failed to create worktree plan file:`, error);
                  });
                }
              }
            };

            persistStatus('failed');
            mainWindow.webContents.send(
              IPC_CHANNELS.TASK_STATUS_CHANGE,
              taskId,
              'failed' as TaskStatus,
              projectId
            );
            mainWindow.webContents.send(
              IPC_CHANNELS.TASK_EXECUTION_PROGRESS,
              taskId,
              {
                phase: 'failed',
                phaseProgress: 0,
                overallProgress: 0,
                message: errorMessage
              },
              projectId
            );
          }
        }
        return;
      }

      let task: Task | undefined;
      let project: Project | undefined;

      try {
        const projects = projectStore.getProjects();

        // IMPORTANT: Invalidate cache for all projects to ensure we get fresh data
        // This prevents race conditions where cached task data has stale status
        for (const p of projects) {
          projectStore.invalidateTasksCache(p.id);
        }

        for (const p of projects) {
          const tasks = projectStore.getTasks(p.id);
          task = tasks.find((t) => t.id === taskId || t.specId === taskId);
          if (task) {
            project = p;
            break;
          }
        }

        if (task && project) {
          const taskTitle = task.title || task.specId;
          const mainPlanPath = getPlanPath(project, task);
          const projectId = project.id; // Capture for closure

          // Capture task values for closure
          const taskSpecId = task.specId;
          const projectPath = project.path;
          const autoBuildPath = project.autoBuildPath;

          // Use shared utility for persisting status (prevents race conditions)
          // Persist to both main project AND worktree (if exists) for consistency
          const persistStatus = (status: TaskStatus, reviewReason?: ReviewReason) => {
            // Persist to main project
            const mainPersisted = persistPlanStatusSync(mainPlanPath, status, projectId, reviewReason);
            if (mainPersisted) {
              console.warn(`[Task ${taskId}] Persisted status to main plan: ${status}`);
            } else if (reviewReason) {
              createPlanIfNotExists(mainPlanPath, task, status, reviewReason).catch((error) => {
                console.warn(`[Task ${taskId}] Failed to create plan file:`, error);
              });
            }

            // Also persist to worktree if it exists
            const worktreePath = findTaskWorktree(projectPath, taskSpecId);
            if (worktreePath) {
              const specsBaseDir = getSpecsDir(autoBuildPath);
              const worktreePlanPath = path.join(
                worktreePath,
                specsBaseDir,
                taskSpecId,
                AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN
              );
              if (existsSync(worktreePlanPath)) {
                const worktreePersisted = persistPlanStatusSync(worktreePlanPath, status, projectId, reviewReason);
                if (worktreePersisted) {
                  console.warn(`[Task ${taskId}] Persisted status to worktree plan: ${status}`);
                }
              } else if (reviewReason) {
                createPlanIfNotExists(worktreePlanPath, task, status, reviewReason).catch((error) => {
                  console.warn(`[Task ${taskId}] Failed to create worktree plan file:`, error);
                });
              }
            }
          };

        if (code === 0) {
          const autoMergeDecision = getAutoMergeDecision(task, project);
          if (autoMergeDecision.requiresMergeReview) {
            notificationService.notifyReviewNeeded(taskTitle, project.id, taskId);
          }

            // Fallback: Ensure status is updated even if COMPLETE phase event was missed
            // This prevents tasks from getting stuck in ai_review status
            // Uses inverted logic to also handle tasks with no subtasks (treats them as complete)
            const isActiveStatus = task.status === 'in_progress' || task.status === 'ai_review';
            const hasIncompleteSubtasks = task.subtasks && task.subtasks.length > 0 &&
              task.subtasks.some((s) => s.status !== 'completed');

            if (isActiveStatus && !hasIncompleteSubtasks) {
              console.warn(`[Task ${taskId}] Fallback: Moving to human_review (process exited successfully)`);
              persistStatus('human_review');
              // Include projectId for multi-project filtering (issue #723)
              mainWindow.webContents.send(
                IPC_CHANNELS.TASK_STATUS_CHANGE,
                taskId,
                'human_review' as TaskStatus,
                projectId
              );
            }

            void tryAutoMergeTask(taskId, task, project, 'exit');
          } else {
            const errorMessage = getTaskFailureMessage(task, project, code);
            mainWindow.webContents.send(
              IPC_CHANNELS.TASK_ERROR,
              taskId,
              errorMessage,
              projectId
            );
            notificationService.notifyTaskFailed(taskTitle, project.id, taskId);
            persistStatus('failed', 'errors');
            // Include projectId for multi-project filtering (issue #723)
            mainWindow.webContents.send(
              IPC_CHANNELS.TASK_STATUS_CHANGE,
              taskId,
              'failed' as TaskStatus,
              projectId
            );
            mainWindow.webContents.send(
              IPC_CHANNELS.TASK_EXECUTION_PROGRESS,
              taskId,
              {
                phase: 'failed',
                phaseProgress: 0,
                overallProgress: 0,
                message: errorMessage
              },
              projectId
            );
          }
        }
      } catch (error) {
        console.error(`[Task ${taskId}] Exit handler error:`, error);
      }
    }
  });

  agentManager.on('execution-progress', async (taskId: string, progress: ExecutionProgressData) => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      // Use shared helper to find task and project (issue #723 - deduplicate lookup)
      const { task, project } = findTaskAndProject(taskId);
      const taskProjectId = project?.id;

      // Include projectId in execution progress event for multi-project filtering
      mainWindow.webContents.send(IPC_CHANNELS.TASK_EXECUTION_PROGRESS, taskId, progress, taskProjectId);

      const phaseToStatus: Record<string, TaskStatus | null> = {
        'idle': null,
        'planning': 'in_progress',
        'coding': 'in_progress',
        'qa_review': 'ai_review',
        'qa_fixing': 'ai_review',
        'complete': 'human_review',
        'failed': 'failed'
      };

      const newStatus = phaseToStatus[progress.phase];
      const reviewReason: ReviewReason | undefined = progress.phase === 'failed' ? 'errors' : undefined;
      if (newStatus) {
        // Include projectId in status change event for multi-project filtering
        mainWindow.webContents.send(
          IPC_CHANNELS.TASK_STATUS_CHANGE,
          taskId,
          newStatus,
          taskProjectId
        );

        // CRITICAL: Persist status to plan file(s) to prevent flip-flop on task list refresh
        // When getTasks() is called, it reads status from the plan file. Without persisting,
        // the status in the file might differ from the UI, causing inconsistent state.
        // Uses shared utility with locking to prevent race conditions.
        // IMPORTANT: We persist to BOTH main project AND worktree (if exists) to ensure
        // consistency, since getTasks() prefers the worktree version.
        if (task && project) {
          try {
            // Persist to main project plan file
            const mainPlanPath = getPlanPath(project, task);
            persistPlanStatusSync(mainPlanPath, newStatus, project.id, reviewReason);

            // Also persist to worktree plan file if it exists
            // This ensures consistency since getTasks() prefers worktree version
            const worktreePath = findTaskWorktree(project.path, task.specId);
            if (worktreePath) {
              const specsBaseDir = getSpecsDir(project.autoBuildPath);
              const worktreePlanPath = path.join(
                worktreePath,
                specsBaseDir,
                task.specId,
                AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN
              );
              if (existsSync(worktreePlanPath)) {
                persistPlanStatusSync(worktreePlanPath, newStatus, project.id, reviewReason);
              }
            }
          } catch (err) {
            // Ignore persistence errors - UI will still work, just might flip on refresh
            console.warn('[execution-progress] Could not persist status:', err);
          }
        }
      }

      if (progress.phase === 'complete' && task && project) {
        await tryAutoMergeTask(taskId, task, project, 'execution-progress');
      }
    }
  });

  // ============================================
  // File Watcher Events → Renderer
  // ============================================

  fileWatcher.on('progress', (taskId: string, plan: ImplementationPlan) => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      // Use shared helper to find project (issue #723 - deduplicate lookup)
      const { project } = findTaskAndProject(taskId);
      mainWindow.webContents.send(IPC_CHANNELS.TASK_PROGRESS, taskId, plan, project?.id);
    }
  });

  fileWatcher.on('error', (taskId: string, error: string) => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      // Include projectId for multi-project filtering (issue #723)
      const { project } = findTaskAndProject(taskId);
      mainWindow.webContents.send(IPC_CHANNELS.TASK_ERROR, taskId, error, project?.id);
    }
  });
}

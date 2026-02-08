import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import type { TaskLogEntry, TaskLogPhase, TaskLogs } from '../shared/types';
import { taskLogService } from './task-log-service';

const createEmptyLogs = (specId: string): TaskLogs => {
  const now = new Date().toISOString();
  return {
    spec_id: specId,
    created_at: now,
    updated_at: now,
    phases: {
      planning: { phase: 'planning', status: 'pending', started_at: null, completed_at: null, entries: [] },
      coding: { phase: 'coding', status: 'pending', started_at: null, completed_at: null, entries: [] },
      validation: { phase: 'validation', status: 'pending', started_at: null, completed_at: null, entries: [] }
    }
  };
};

export const appendTaskLogEntry = (
  specDir: string,
  specId: string,
  entry: TaskLogEntry,
  phaseOverride?: TaskLogPhase
): void => {
  const logFile = path.join(specDir, 'task_logs.json');
  const phase = phaseOverride || taskLogService.getActivePhase(specDir) || 'planning';

  let logs: TaskLogs;
  if (existsSync(logFile)) {
    try {
      logs = JSON.parse(readFileSync(logFile, 'utf-8')) as TaskLogs;
    } catch {
      logs = createEmptyLogs(specId);
    }
  } else {
    logs = createEmptyLogs(specId);
  }

  const now = new Date().toISOString();
  const phaseLog = logs.phases[phase];
  if (!phaseLog.started_at) {
    phaseLog.started_at = now;
  }
  if (phaseLog.status === 'pending') {
    phaseLog.status = 'active';
  }

  if (entry.type === 'error' && phaseLog.status !== 'failed') {
    phaseLog.status = 'failed';
    phaseLog.completed_at = now;
  }

  phaseLog.entries.push(entry);
  logs.updated_at = now;

  writeFileSync(logFile, JSON.stringify(logs, null, 2));
};

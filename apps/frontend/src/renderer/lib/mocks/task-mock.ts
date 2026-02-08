/**
 * Mock implementation for task operations
 */

import type { TaskRecoveryOptions } from '../../../shared/types';
import { DEFAULT_PROJECT_SETTINGS } from '../../../shared/constants';
import { mockTasks } from './mock-data';

export const taskMock = {
  getTasks: async (projectId: string) => ({
    success: true,
    data: mockTasks.filter(t => t.projectId === projectId)
  }),

  createTask: async (projectId: string, title: string, description: string) => ({
    success: true,
    data: {
      id: `task-${Date.now()}`,
      projectId,
      specId: `00${mockTasks.length + 1}-new-task`,
      title,
      description,
      status: 'backlog' as const,
      subtasks: [],
      logs: [],
      createdAt: new Date(),
      updatedAt: new Date()
    }
  }),

  createSandboxTask: async (title: string, description: string) => ({
    success: true,
    data: {
      task: {
        id: `sandbox-task-${Date.now()}`,
        projectId: 'sandbox-project',
        specId: `00${mockTasks.length + 1}-sandbox-task`,
        title,
        description,
        status: 'backlog' as const,
        subtasks: [],
        logs: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: { sandbox: true }
      },
      project: {
        id: 'sandbox-project',
        name: `Sandbox: ${title || 'Task'}`,
        path: '/tmp/auto-iflow-sandbox',
        autoBuildPath: '.auto-iflow',
        isSandbox: true,
        settings: { ...DEFAULT_PROJECT_SETTINGS },
        createdAt: new Date(),
        updatedAt: new Date()
      }
    }
  }),

  deleteTask: async () => ({ success: true }),

  updateTask: async (_taskId: string, updates: { title?: string; description?: string }) => ({
    success: true,
    data: {
      id: _taskId,
      projectId: 'mock-project-1',
      specId: '001-updated',
      title: updates.title || 'Updated Task',
      description: updates.description || 'Updated description',
      status: 'backlog' as const,
      subtasks: [],
      logs: [],
      createdAt: new Date(),
      updatedAt: new Date()
    }
  }),

  startTask: () => {
    console.warn('[Browser Mock] startTask called');
  },

  stopTask: () => {
    console.warn('[Browser Mock] stopTask called');
  },

  submitReview: async () => ({ success: true }),

  // Task archive operations
  archiveTasks: async () => ({ success: true, data: true }),
  unarchiveTasks: async () => ({ success: true, data: true }),

  // Task status operations
  updateTaskStatus: async () => ({ success: true }),

  recoverStuckTask: async (taskId: string, options?: TaskRecoveryOptions) => ({
    success: true,
    data: {
      taskId,
      recovered: true,
      newStatus: options?.targetStatus || 'backlog',
      message: '[Browser Mock] Task recovered successfully'
    }
  }),

  checkTaskRunning: async () => ({ success: true, data: false }),

  getTaskModelRouting: async () => ({ success: true, data: null }),

  setTaskModelRouting: async () => ({ success: true }),

  runIntakeAnalysis: async (_projectId: string, description: string, model: string) => ({
    success: true,
    data: {
      clarityLevel: 'high',
      clarifyingQuestions: [],
      suggestedTitle: description.slice(0, 80),
      intakeModel: model
    }
  }),

  runIntakeReanalyze: async (_projectId: string, description: string, model: string) => ({
    success: true,
    data: {
      clarityLevel: 'high',
      clarifyingQuestions: [],
      suggestedTitle: description.slice(0, 80),
      intakeModel: model
    }
  }),

  getIntakeMetrics: async () => ({
    success: true,
    data: {
      window_days: 7,
      total_events: 0,
      high_events: 0,
      blocked_events: 0,
      force_high_events: 0,
      high_rate_pct: 0,
      blocked_rate_pct: 0,
      force_high_rate_pct: 0,
      avg_round: 0
    }
  }),

  runPostCodeTests: async () => ({
    success: true,
    data: {
      report: {
        status: 'passed',
        summary: { total: 0, passed: 0, failed: 0 },
        results: []
      }
    }
  }),

  fixPostCodeTests: async (_taskId?: string, _options?: import('../../../shared/types').PostCodeTestsFixOptions) => ({
    success: true,
    data: {
      applied: false,
      message: '[Browser Mock] No fix applied'
    }
  }),

  // Task logs operations
  getTaskLogs: async () => ({
    success: true,
    data: null
  }),

  watchTaskLogs: async () => ({ success: true }),

  unwatchTaskLogs: async () => ({ success: true }),

  // Event Listeners (no-op in browser)
  onTaskProgress: () => () => {},
  onTaskError: () => () => {},
  onTaskLog: () => () => {},
  onTaskStatusChange: () => () => {},
  onTaskExecutionProgress: () => () => {},
  onTaskLogsChanged: () => () => {},
  onTaskLogsStream: () => () => {}
};

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { IPC_CHANNELS } from '../../shared/constants';

const mockHandlers = new Map<string, Function>();

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp')
  },
  ipcMain: {
    handle: (channel: string, handler: Function) => {
      mockHandlers.set(channel, handler);
    },
    removeHandler: (channel: string) => {
      mockHandlers.delete(channel);
    }
  }
}));

const spawnMock = vi.fn();
const execMock = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
  exec: (...args: unknown[]) => execMock(...args)
}));

const existsSyncMock = vi.fn(() => true);
const readFileSyncMock = vi.fn(() => '{}');
vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => existsSyncMock(...args),
  readFileSync: (...args: unknown[]) => readFileSyncMock(...args)
}));

const getProjectMock = vi.fn();
vi.mock('../project-store', () => ({
  projectStore: {
    getProject: (...args: unknown[]) => getProjectMock(...args)
  }
}));

const getBackendPathMock = vi.fn();
vi.mock('../ipc-handlers/github/utils/subprocess-runner', () => ({
  getBackendPath: (...args: unknown[]) => getBackendPathMock(...args)
}));

vi.mock('../python-detector', () => ({
  parsePythonCommand: vi.fn(() => ['python', []])
}));

vi.mock('../python-env-manager', () => ({
  pythonEnvManager: {
    getPythonEnv: vi.fn(() => ({}))
  },
  getConfiguredPythonPath: vi.fn(() => 'python')
}));

const emitIntakeMetricMock = vi.fn();
const getIntakeMetricsSummaryMock = vi.fn(() => ({
  window_days: 7,
  total_events: 1,
  high_events: 1,
  blocked_events: 0,
  force_high_events: 0,
  high_rate_pct: 100,
  blocked_rate_pct: 0,
  force_high_rate_pct: 0,
  avg_round: 1
}));
vi.mock('../intake-metrics', () => ({
  emitIntakeMetric: (...args: unknown[]) => emitIntakeMetricMock(...args),
  getIntakeMetricsSummary: (...args: unknown[]) => getIntakeMetricsSummaryMock(...args)
}));

import { registerIntakeHandlers } from '../ipc-handlers/task/intake-handlers';

const invokeHandler = async (channel: string, ...args: unknown[]) => {
  const handler = mockHandlers.get(channel);
  if (!handler) {
    throw new Error(`Handler not registered: ${channel}`);
  }
  return handler(null, ...args);
};

const createMockProcess = (payload: string, exitCode = 0) => {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const proc = Object.assign(new EventEmitter(), { stdout, stderr });
  queueMicrotask(() => {
    stdout.emit('data', Buffer.from(payload));
    proc.emit('close', exitCode);
  });
  return proc;
};

describe('intake handlers', () => {
  beforeEach(() => {
    mockHandlers.clear();
    spawnMock.mockReset();
    existsSyncMock.mockReset();
    readFileSyncMock.mockReset();
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue('{}');
    getProjectMock.mockReset();
    getBackendPathMock.mockReset();
    emitIntakeMetricMock.mockReset();
    getIntakeMetricsSummaryMock.mockClear();
  });

  it('returns error when project not found', async () => {
    getProjectMock.mockReturnValue(null);
    registerIntakeHandlers(() => null as any);
    const result = await invokeHandler(IPC_CHANNELS.INTAKE_ANALYZE, 'missing', 'desc', 'glm-4.7');
    expect(result).toEqual({ success: false, error: 'Project not found' });
  });

  it('returns normalized intake result on success', async () => {
    getProjectMock.mockReturnValue({ id: 'p1', path: '/tmp/project' });
    getBackendPathMock.mockReturnValue('/tmp/backend');
    spawnMock.mockReturnValue(
      createMockProcess(JSON.stringify({
        clarity_level: 'high',
        clarifying_questions: [{ id: 'q1', question: 'Q', type: 'text' }],
        suggested_title: 'Suggested',
        intake_model: 'glm-4.7'
      }))
    );

    registerIntakeHandlers(() => null as any);
    const result = await invokeHandler(IPC_CHANNELS.INTAKE_ANALYZE, 'p1', 'desc', 'glm-4.7');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data?.clarityLevel).toBe('high');
      expect(result.data?.clarifyingQuestions).toHaveLength(1);
      expect(result.data?.suggestedTitle).toBe('Suggested');
      expect(result.data?.intakeModel).toBe('glm-4.7');
    }
    expect(emitIntakeMetricMock).toHaveBeenCalledTimes(1);
  });

  it('forces high clarity when v2 response has empty blockers', async () => {
    readFileSyncMock.mockReturnValue(JSON.stringify({ intakeV2Enabled: true }));
    getProjectMock.mockReturnValue({ id: 'p1', path: '/tmp/project' });
    getBackendPathMock.mockReturnValue('/tmp/backend');
    spawnMock.mockReturnValue(
      createMockProcess(JSON.stringify({
        clarity_level: 'medium',
        blockers: [],
        clarifying_questions: [],
        suggested_title: 'Suggested',
        intake_model: 'glm-4.7'
      }))
    );

    registerIntakeHandlers(() => null as any);
    const result = await invokeHandler(IPC_CHANNELS.INTAKE_ANALYZE, 'p1', 'desc', 'glm-4.7');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data?.clarityLevel).toBe('high');
      expect(result.data?.blockers).toEqual([]);
    }
  });

  it('normalizes clarity and question types with whitelist fallback', async () => {
    readFileSyncMock.mockReturnValue(JSON.stringify({ intakeV2Enabled: true }));
    getProjectMock.mockReturnValue({ id: 'p1', path: '/tmp/project' });
    getBackendPathMock.mockReturnValue('/tmp/backend');
    spawnMock.mockReturnValue(
      createMockProcess(JSON.stringify({
        clarity_level: ' HIGH ',
        blockers: ['Without file, developer cannot place the button'],
        clarifying_questions: [
          { id: 'q1', question: 'Q1', type: 'TEXT' },
          { id: 'q2', question: 'Q2', type: 'invalid_type' }
        ],
        suggested_title: 'Suggested',
        intake_model: 'glm-4.7'
      }))
    );

    registerIntakeHandlers(() => null as any);
    const result = await invokeHandler(IPC_CHANNELS.INTAKE_ANALYZE, 'p1', 'desc', 'glm-4.7');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data?.clarityLevel).toBe('high');
      expect(result.data?.clarifyingQuestions[0]?.type).toBe('text');
      expect(result.data?.clarifyingQuestions[1]?.type).toBe('text');
    }
  });

  it('keeps non-high clarity when blockers are present in v2 mode', async () => {
    readFileSyncMock.mockReturnValue(JSON.stringify({ intakeV2Enabled: true }));
    getProjectMock.mockReturnValue({ id: 'p1', path: '/tmp/project' });
    getBackendPathMock.mockReturnValue('/tmp/backend');
    spawnMock.mockReturnValue(
      createMockProcess(JSON.stringify({
        clarity_level: 'low',
        blockers: ['Without repro steps, developer cannot verify the bug fix'],
        clarifying_questions: [{ id: 'q1', question: 'How to reproduce?', type: 'text' }],
        suggested_title: 'Suggested',
        intake_model: 'glm-4.7'
      }))
    );

    registerIntakeHandlers(() => null as any);
    const result = await invokeHandler(IPC_CHANNELS.INTAKE_ANALYZE, 'p1', 'Fix the bug', 'glm-4.7');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data?.clarityLevel).toBe('low');
      expect(result.data?.blockers).toEqual(['Without repro steps, developer cannot verify the bug fix']);
    }
  });

  it('keeps clarity unchanged in legacy mode when blockers are missing', async () => {
    readFileSyncMock.mockReturnValue(JSON.stringify({ intakeV2Enabled: false }));
    getProjectMock.mockReturnValue({ id: 'p1', path: '/tmp/project' });
    getBackendPathMock.mockReturnValue('/tmp/backend');
    spawnMock.mockReturnValue(
      createMockProcess(JSON.stringify({
        clarity_level: 'medium',
        clarifying_questions: [{ id: 'q1', question: 'Q', type: 'text' }],
        suggested_title: 'Suggested',
        intake_model: 'glm-4.7'
      }))
    );

    registerIntakeHandlers(() => null as any);
    const result = await invokeHandler(IPC_CHANNELS.INTAKE_ANALYZE, 'p1', 'desc', 'glm-4.7');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data?.clarityLevel).toBe('medium');
      expect((result.data as Record<string, unknown>)?.blockers).toBeUndefined();
    }
  });

  it('returns intake metrics summary through IPC channel', async () => {
    registerIntakeHandlers(() => null as any);

    const result = await invokeHandler(IPC_CHANNELS.INTAKE_METRICS);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        window_days: 7,
        total_events: 1,
      });
    }
    expect(getIntakeMetricsSummaryMock).toHaveBeenCalledTimes(1);
  });
});

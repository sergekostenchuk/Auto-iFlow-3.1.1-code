import { app, ipcMain, type BrowserWindow } from 'electron';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { DEFAULT_APP_SETTINGS, IPC_CHANNELS } from '../../../shared/constants';
import type { AppSettings, IPCResult, IntakeMetricEvent, IntakeOutcome } from '../../../shared/types';
import { projectStore } from '../../project-store';
import { parsePythonCommand } from '../../python-detector';
import { getConfiguredPythonPath, pythonEnvManager } from '../../python-env-manager';
import { getBackendPath } from '../github/utils/subprocess-runner';
import { emitIntakeMetric, getIntakeMetricsSummary } from '../../intake-metrics';

type IntakeClarityLevel = 'high' | 'medium' | 'low';
type IntakeQuestionType = 'text' | 'single_select' | 'multi_select';

interface IntakeQuestionRaw {
  id?: string;
  question?: string;
  type?: string;
  options?: string[];
}

interface IntakeResultRaw {
  clarity_level?: string;
  clarifying_questions?: IntakeQuestionRaw[];
  suggested_title?: string;
  risks?: string[];
  assumptions?: string[];
  notes?: string;
  intake_model?: string;
  reasoning?: string;
  blockers?: unknown;
}

interface IntakeRequest {
  projectId: string;
  description: string;
  model: string;
  attachments?: string[];
  answers?: Record<string, string | string[]>;
  reanalyze?: boolean;
  requestId?: string;
  iteration?: number;
}

const INTAKE_TIMEOUT_MS = 90_000;

const VALID_CLARITY_LEVELS = new Set<IntakeClarityLevel>(['high', 'medium', 'low']);
const VALID_QUESTION_TYPES = new Set<IntakeQuestionType>(['text', 'single_select', 'multi_select']);

const getIntakeV2Enabled = (): boolean => {
  const settingsPath = path.join(app.getPath('userData'), 'settings.json');

  try {
    if (!existsSync(settingsPath)) {
      return Boolean(DEFAULT_APP_SETTINGS.intakeV2Enabled);
    }

    const content = readFileSync(settingsPath, 'utf-8');
    const settings: AppSettings = { ...DEFAULT_APP_SETTINGS, ...JSON.parse(content) };
    return Boolean(settings.intakeV2Enabled);
  } catch (error) {
    console.warn('[intake-handlers] Failed to read intakeV2Enabled from settings:', error);
    return Boolean(DEFAULT_APP_SETTINGS.intakeV2Enabled);
  }
};

const buildPythonEnv = (backendPath: string): Record<string, string> => {
  const pythonEnv = pythonEnvManager.getPythonEnv();
  const existing = pythonEnv.PYTHONPATH || '';
  const segments = existing ? [existing, backendPath] : [backendPath];
  return {
    ...pythonEnv,
    PYTHONPATH: segments.join(path.delimiter),
  };
};

const normalizeClarityLevel = (clarity?: string): IntakeClarityLevel => {
  const normalized = (clarity ?? 'low').trim().toLowerCase();
  if (VALID_CLARITY_LEVELS.has(normalized as IntakeClarityLevel)) {
    return normalized as IntakeClarityLevel;
  }
  if (clarity !== undefined) {
    console.warn('[intake-handlers] Invalid clarity level received, using "low":', clarity);
  }
  return 'low';
};

const normalizeQuestionType = (type?: string): IntakeQuestionType => {
  const normalized = (type ?? 'text').trim().toLowerCase();
  if (VALID_QUESTION_TYPES.has(normalized as IntakeQuestionType)) {
    return normalized as IntakeQuestionType;
  }
  if (type !== undefined) {
    console.warn('[intake-handlers] Invalid question type received, using "text":', type);
  }
  return 'text';
};

const normalizeBlockers = (blockers: unknown): string[] | undefined => {
  if (blockers === undefined) {
    return undefined;
  }
  if (!Array.isArray(blockers)) {
    return [];
  }

  return blockers
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
};

const normalizeQuestions = (questions: IntakeQuestionRaw[] | undefined) =>
  (questions ?? []).map((q, index) => ({
    id: q.id ?? `q${index + 1}`,
    question: q.question ?? '',
    type: normalizeQuestionType(q.type),
    options: q.options ?? [],
  }));

const legacyNormalize = (raw: IntakeResultRaw) => ({
  clarityLevel: raw.clarity_level ?? 'low',
  clarifyingQuestions: normalizeQuestions(raw.clarifying_questions),
  suggestedTitle: raw.suggested_title ?? '',
  risks: raw.risks ?? [],
  assumptions: raw.assumptions ?? [],
  notes: raw.notes ?? '',
  intakeModel: raw.intake_model ?? '',
});

const v2Normalize = (raw: IntakeResultRaw) => {
  const normalized = {
    clarityLevel: normalizeClarityLevel(raw.clarity_level),
    clarifyingQuestions: normalizeQuestions(raw.clarifying_questions),
    suggestedTitle: raw.suggested_title ?? '',
    risks: raw.risks ?? [],
    assumptions: raw.assumptions ?? [],
    notes: raw.notes ?? '',
    intakeModel: raw.intake_model ?? '',
    reasoning: typeof raw.reasoning === 'string' ? raw.reasoning.trim() : '',
    blockers: normalizeBlockers(raw.blockers ?? []),
  };

  if (normalized.blockers !== undefined && normalized.blockers.length === 0 && normalized.clarityLevel !== 'high') {
    console.warn('[intake-handlers] Force-high guard triggered: blockers=[] but clarity was not high', {
      previousClarity: normalized.clarityLevel,
    });
    normalized.clarityLevel = 'high';
  }

  return normalized;
};

const normalizeIntakeResult = (raw: IntakeResultRaw, useV2 = false) =>
  useV2 ? v2Normalize(raw) : legacyNormalize(raw);

const resolveOutcome = (clarityLevel: IntakeClarityLevel): IntakeOutcome => {
  if (clarityLevel === 'high') {
    return 'completed';
  }
  if (clarityLevel === 'low') {
    return 'blocked';
  }
  return 'needs_clarify';
};

const resolveRound = (request: IntakeRequest): number => {
  if (typeof request.iteration === 'number' && Number.isFinite(request.iteration) && request.iteration > 0) {
    return request.iteration;
  }
  return request.reanalyze ? 2 : 1;
};

const emitIntakeMetricEvent = (event: IntakeMetricEvent): void => {
  try {
    emitIntakeMetric(event);
  } catch (error) {
    console.warn('[intake-handlers] Failed to emit intake metric event', error);
  }
};

const logIntakeStart = (payload: Record<string, unknown>): void => {
  console.info('[intake] START', JSON.stringify(payload));
};

const logIntakeResult = (payload: Record<string, unknown>): void => {
  console.info('[intake] RESULT', JSON.stringify(payload));
};

const logIntakeError = (payload: Record<string, unknown>): void => {
  console.error('[intake] ERROR', JSON.stringify(payload));
};

const runIntakeScript = async (
  backendPath: string,
  description: string,
  model: string,
  useV2: boolean,
  attachments?: string[],
  answers?: Record<string, string | string[]>,
  reanalyze?: boolean
): Promise<IntakeResultRaw> => {
  const pythonPath = getConfiguredPythonPath();
  const [pythonCommand, pythonArgs] = parsePythonCommand(pythonPath);

  const scriptPath = path.join(backendPath, 'run_intake.py');
  if (!existsSync(scriptPath)) {
    throw new Error(`run_intake.py not found at ${scriptPath}`);
  }

  const args = [
    ...pythonArgs,
    scriptPath,
    '--description',
    description,
    '--model',
    model,
  ];

  if (useV2) {
    args.push('--intake-v2');
  }

  if (attachments && attachments.length > 0) {
    args.push('--attachments', JSON.stringify(attachments));
  }

  if (reanalyze) {
    args.push('--reanalyze');
  }

  if (answers && Object.keys(answers).length > 0) {
    args.push('--answers', JSON.stringify(answers));
  }

  const env = buildPythonEnv(backendPath);

  return new Promise((resolve, reject) => {
    let settled = false;
    const proc = spawn(pythonCommand, args, {
      cwd: backendPath,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill('SIGTERM');
      setTimeout(() => {
        proc.kill('SIGKILL');
      }, 2000);
      reject(new Error(`Intake analysis timed out after ${Math.round(INTAKE_TIMEOUT_MS / 1000)}s`));
    }, INTAKE_TIMEOUT_MS);

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(err);
    });

    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(stderr.trim() || 'Intake analysis failed'));
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim()) as IntakeResultRaw;
        resolve(parsed);
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Failed to parse intake output'));
      }
    });
  });
};

const resolveBackendPath = (projectId: string): string | null => {
  const project = projectStore.getProject(projectId);
  if (!project) {
    return null;
  }
  return getBackendPath(project);
};

export function registerIntakeHandlers(
  getMainWindow: () => BrowserWindow | null
): void {
  ipcMain.handle(
    IPC_CHANNELS.INTAKE_ANALYZE,
    async (
      _,
      projectId: string,
      description: string,
      model: string,
      attachments?: string[],
      requestId?: string,
      iteration?: number
    ): Promise<IPCResult> => {
      const backendPath = resolveBackendPath(projectId);
      if (!backendPath) {
        return { success: false, error: 'Project not found' };
      }

      const request: IntakeRequest = {
        projectId,
        description,
        model,
        attachments,
        requestId,
        iteration,
      };
      const metricRequestId = request.requestId || randomUUID();
      const startedAt = Date.now();
      const round = resolveRound(request);
      logIntakeStart({
        request_id: metricRequestId,
        round,
        reanalyze: false,
        model: request.model,
        has_attachments: Boolean(request.attachments?.length),
      });

      try {
        const useV2 = getIntakeV2Enabled();
        const result = await runIntakeScript(
          backendPath,
          request.description,
          request.model,
          useV2,
          request.attachments
        );
        const normalizedResult = normalizeIntakeResult(result, useV2);
        const rawClarity = normalizeClarityLevel(result.clarity_level);
        const blockersCount = normalizedResult.blockers?.length ?? 0;
        const forceHighTriggered =
          useV2 &&
          blockersCount === 0 &&
          rawClarity !== 'high' &&
          normalizedResult.clarityLevel === 'high';
        const durationMs = Date.now() - startedAt;
        const outcome = resolveOutcome(normalizedResult.clarityLevel);

        emitIntakeMetricEvent({
          request_id: metricRequestId,
          round,
          clarity: normalizedResult.clarityLevel,
          blockers_count: blockersCount,
          duration_ms: durationMs,
          force_high_triggered: forceHighTriggered,
          outcome,
          timestamp: new Date().toISOString(),
        });
        logIntakeResult({
          request_id: metricRequestId,
          round,
          clarity: normalizedResult.clarityLevel,
          blockers_count: blockersCount,
          force_high_triggered: forceHighTriggered,
          outcome,
          duration_ms: durationMs,
        });

        return { success: true, data: normalizedResult };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Intake analysis failed';
        const durationMs = Date.now() - startedAt;
        emitIntakeMetricEvent({
          request_id: metricRequestId,
          round,
          clarity: 'low',
          blockers_count: 0,
          duration_ms: durationMs,
          force_high_triggered: false,
          outcome: 'error',
          timestamp: new Date().toISOString(),
        });
        logIntakeError({
          request_id: metricRequestId,
          round,
          message,
          duration_ms: durationMs,
        });
        const mainWindow = getMainWindow();
        mainWindow?.webContents.send(IPC_CHANNELS.INTAKE_ERROR, { message });
        return { success: false, error: message };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.INTAKE_REANALYZE,
    async (
      _,
      projectId: string,
      description: string,
      model: string,
      answers?: Record<string, string | string[]>,
      attachments?: string[],
      requestId?: string,
      iteration?: number
    ): Promise<IPCResult> => {
      const backendPath = resolveBackendPath(projectId);
      if (!backendPath) {
        return { success: false, error: 'Project not found' };
      }

      const request: IntakeRequest = {
        projectId,
        description,
        model,
        answers,
        attachments,
        reanalyze: true,
        requestId,
        iteration,
      };
      const metricRequestId = request.requestId || randomUUID();
      const startedAt = Date.now();
      const round = resolveRound(request);
      logIntakeStart({
        request_id: metricRequestId,
        round,
        reanalyze: true,
        model: request.model,
        has_answers: Boolean(request.answers && Object.keys(request.answers).length > 0),
        has_attachments: Boolean(request.attachments?.length),
      });

      try {
        const useV2 = getIntakeV2Enabled();
        const result = await runIntakeScript(
          backendPath,
          request.description,
          request.model,
          useV2,
          request.attachments,
          request.answers,
          request.reanalyze
        );
        const normalizedResult = normalizeIntakeResult(result, useV2);
        const rawClarity = normalizeClarityLevel(result.clarity_level);
        const blockersCount = normalizedResult.blockers?.length ?? 0;
        const forceHighTriggered =
          useV2 &&
          blockersCount === 0 &&
          rawClarity !== 'high' &&
          normalizedResult.clarityLevel === 'high';
        const durationMs = Date.now() - startedAt;
        const outcome = resolveOutcome(normalizedResult.clarityLevel);

        emitIntakeMetricEvent({
          request_id: metricRequestId,
          round,
          clarity: normalizedResult.clarityLevel,
          blockers_count: blockersCount,
          duration_ms: durationMs,
          force_high_triggered: forceHighTriggered,
          outcome,
          timestamp: new Date().toISOString(),
        });
        logIntakeResult({
          request_id: metricRequestId,
          round,
          clarity: normalizedResult.clarityLevel,
          blockers_count: blockersCount,
          force_high_triggered: forceHighTriggered,
          outcome,
          duration_ms: durationMs,
        });

        return { success: true, data: normalizedResult };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Intake analysis failed';
        const durationMs = Date.now() - startedAt;
        emitIntakeMetricEvent({
          request_id: metricRequestId,
          round,
          clarity: 'low',
          blockers_count: 0,
          duration_ms: durationMs,
          force_high_triggered: false,
          outcome: 'error',
          timestamp: new Date().toISOString(),
        });
        logIntakeError({
          request_id: metricRequestId,
          round,
          message,
          duration_ms: durationMs,
        });
        const mainWindow = getMainWindow();
        mainWindow?.webContents.send(IPC_CHANNELS.INTAKE_ERROR, { message });
        return { success: false, error: message };
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.INTAKE_METRICS, async (): Promise<IPCResult> => {
    try {
      return { success: true, data: getIntakeMetricsSummary() };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load intake metrics';
      return { success: false, error: message };
    }
  });
}

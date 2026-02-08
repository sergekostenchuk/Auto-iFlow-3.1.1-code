import { app } from 'electron';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'fs';
import path from 'path';
import type { IntakeMetricEvent, IntakeMetricsSummary } from '../shared/types/task';

const METRICS_DIR_NAME = 'intake-metrics';
const METRICS_RETENTION_DAYS = 7;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const METRICS_FILE_PATTERN = /^\d{4}-\d{2}-\d{2}\.jsonl$/;

const getMetricsDir = (): string => path.join(app.getPath('userData'), METRICS_DIR_NAME);

const ensureMetricsDir = (): string => {
  const metricsDir = getMetricsDir();
  if (!existsSync(metricsDir)) {
    mkdirSync(metricsDir, { recursive: true });
  }
  return metricsDir;
};

const toDateKey = (value: string | Date): string => {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
};

const getDateFromFilename = (filename: string): Date | null => {
  const datePart = filename.replace('.jsonl', '');
  const date = new Date(`${datePart}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const cleanupOldFiles = (now: Date): void => {
  const metricsDir = ensureMetricsDir();
  for (const filename of readdirSync(metricsDir)) {
    if (!METRICS_FILE_PATTERN.test(filename)) {
      continue;
    }
    const fileDate = getDateFromFilename(filename);
    if (!fileDate) {
      continue;
    }
    const ageMs = now.getTime() - fileDate.getTime();
    if (ageMs > METRICS_RETENTION_DAYS * ONE_DAY_MS) {
      unlinkSync(path.join(metricsDir, filename));
    }
  }
};

const readMetricEventsFromFile = (filePath: string): IntakeMetricEvent[] => {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as IntakeMetricEvent)
      .filter((event) => Boolean(event.request_id));
  } catch (error) {
    console.warn('[intake-metrics] Failed to parse metrics file', { filePath, error });
    return [];
  }
};

export const emitIntakeMetric = (event: IntakeMetricEvent): void => {
  const now = new Date();
  cleanupOldFiles(now);

  const metricsDir = ensureMetricsDir();
  const timestamp = event.timestamp || now.toISOString();
  const filePath = path.join(metricsDir, `${toDateKey(timestamp)}.jsonl`);
  const normalizedEvent: IntakeMetricEvent = {
    ...event,
    timestamp,
  };

  appendFileSync(filePath, `${JSON.stringify(normalizedEvent)}\n`, 'utf-8');
};

export const getIntakeMetricsSummary = (): IntakeMetricsSummary => {
  const now = new Date();
  cleanupOldFiles(now);

  const metricsDir = ensureMetricsDir();
  const allEvents = readdirSync(metricsDir)
    .filter((filename) => METRICS_FILE_PATTERN.test(filename))
    .flatMap((filename) => readMetricEventsFromFile(path.join(metricsDir, filename)));

  if (allEvents.length === 0) {
    return {
      window_days: METRICS_RETENTION_DAYS,
      total_events: 0,
      high_events: 0,
      blocked_events: 0,
      force_high_events: 0,
      high_rate_pct: 0,
      blocked_rate_pct: 0,
      force_high_rate_pct: 0,
      avg_round: 0,
    };
  }

  const highEvents = allEvents.filter((event) => event.clarity === 'high').length;
  const blockedEvents = allEvents.filter((event) => event.outcome === 'blocked').length;
  const forceHighEvents = allEvents.filter((event) => event.force_high_triggered).length;
  const roundsTotal = allEvents.reduce((sum, event) => sum + Math.max(event.round, 1), 0);
  const totalEvents = allEvents.length;

  return {
    window_days: METRICS_RETENTION_DAYS,
    total_events: totalEvents,
    high_events: highEvents,
    blocked_events: blockedEvents,
    force_high_events: forceHighEvents,
    high_rate_pct: Number(((highEvents / totalEvents) * 100).toFixed(2)),
    blocked_rate_pct: Number(((blockedEvents / totalEvents) * 100).toFixed(2)),
    force_high_rate_pct: Number(((forceHighEvents / totalEvents) * 100).toFixed(2)),
    avg_round: Number((roundsTotal / totalEvents).toFixed(2)),
  };
};

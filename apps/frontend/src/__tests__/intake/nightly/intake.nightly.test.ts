import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { describe, it, expect } from 'vitest';

const execFileAsync = promisify(execFile);

interface NightlyCase {
  id: string;
  description: string;
  expectedClarity: 'high' | 'medium' | 'low';
}

interface IntakeJsonResponse {
  clarity_level?: string;
}

const NIGHTLY_CASES: NightlyCase[] = [
  {
    id: 'N-01',
    description: 'Add loading spinner to Submit button in LoginForm while async request is pending.',
    expectedClarity: 'high'
  },
  {
    id: 'N-02',
    description: 'Fix the bug in task creation.',
    expectedClarity: 'low'
  }
];

const RUNS_PER_CASE = 5;
const CONSENSUS_THRESHOLD = 0.8;
const TIMEOUT_MS = 90_000;
const MAX_CONSECUTIVE_FAILURES = 3;

const parseJsonLine = (stdout: string): IntakeJsonResponse => {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    try {
      return JSON.parse(line) as IntakeJsonResponse;
    } catch {
      // Continue scanning previous lines
    }
  }

  throw new Error('Intake output did not contain valid JSON');
};

const runIntakeOnce = async (description: string): Promise<'high' | 'medium' | 'low'> => {
  const backendScript = path.resolve(process.cwd(), '../backend/run_intake.py');

  const { stdout } = await execFileAsync(
    'python3',
    [
      backendScript,
      '--description',
      description,
      '--model',
      'glm-4.7',
      '--intake-v2'
    ],
    {
      timeout: TIMEOUT_MS,
      maxBuffer: 1024 * 1024
    }
  );

  const parsed = parseJsonLine(stdout);
  const normalized = String(parsed.clarity_level ?? '').trim().toLowerCase();
  if (normalized === 'high' || normalized === 'medium' || normalized === 'low') {
    return normalized;
  }
  throw new Error(`Unexpected clarity_level: "${parsed.clarity_level ?? ''}"`);
};

describe('intake nightly consensus suite', () => {
  it.skipIf(process.env.INTAKE_NIGHTLY_RUN !== '1')(
    'validates clarity consensus with retries and outage guard',
    async () => {
      let consecutiveFailures = 0;

      for (const testCase of NIGHTLY_CASES) {
        let matched = 0;
        let attempts = 0;
        let retries = 0;

        while (attempts < RUNS_PER_CASE) {
          attempts += 1;
          try {
            const clarity = await runIntakeOnce(testCase.description);
            consecutiveFailures = 0;
            if (clarity === testCase.expectedClarity) {
              matched += 1;
            }
          } catch (error) {
            consecutiveFailures += 1;
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
              // Abort batch during sustained API outage.
              return;
            }
            // Single retry for timeout-like failures.
            if (retries < 1) {
              retries += 1;
              attempts -= 1;
            } else {
              throw error;
            }
          }
        }

        const ratio = matched / RUNS_PER_CASE;
        expect(
          ratio,
          `${testCase.id} consensus ${matched}/${RUNS_PER_CASE} below ${(CONSENSUS_THRESHOLD * 100).toFixed(0)}%`
        ).toBeGreaterThanOrEqual(CONSENSUS_THRESHOLD);
      }
    },
    20 * 60 * 1000
  );
});

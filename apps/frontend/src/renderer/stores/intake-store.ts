import type { IntakeResult } from '../../shared/types';

const INTAKE_DRAFT_PREFIX = 'intake-draft';

export interface IntakeDraft {
  projectId: string;
  intakeResult: IntakeResult;
  intakePhase: 'completed' | 'needs_clarify' | 'blocked';
  intakeModel: string;
  iteration: number;
  sourceDescription: string;
  savedAt: Date;
}

const getIntakeDraftKey = (projectId: string) => `${INTAKE_DRAFT_PREFIX}-${projectId}`;

const migrateIntakeResult = (intakeResult: IntakeResult): IntakeResult => {
  // Idempotent migration: safe to re-apply on every load.
  // `blockers ?? []` and `reasoning ?? ''` stay stable across repeated runs.
  return {
    ...intakeResult,
    blockers: intakeResult.blockers ?? [],
    reasoning: intakeResult.reasoning ?? ''
  };
};

export const saveIntakeDraft = (draft: IntakeDraft): void => {
  try {
    const payload = {
      ...draft,
      savedAt: draft.savedAt.toISOString()
    };
    localStorage.setItem(getIntakeDraftKey(draft.projectId), JSON.stringify(payload));
  } catch (error) {
    console.error('Failed to save intake draft:', error);
  }
};

export const loadIntakeDraft = (projectId: string): IntakeDraft | null => {
  try {
    const stored = localStorage.getItem(getIntakeDraftKey(projectId));
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Omit<IntakeDraft, 'savedAt'> & { savedAt: string };
    return {
      ...parsed,
      intakeResult: migrateIntakeResult(parsed.intakeResult),
      savedAt: new Date(parsed.savedAt)
    };
  } catch (error) {
    console.error('Failed to load intake draft:', error);
    return null;
  }
};

export const clearIntakeDraft = (projectId: string): void => {
  try {
    localStorage.removeItem(getIntakeDraftKey(projectId));
  } catch (error) {
    console.error('Failed to clear intake draft:', error);
  }
};

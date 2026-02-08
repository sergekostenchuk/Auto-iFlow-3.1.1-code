/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TaskCreationWizard, createBlockerSignature, extractBlockerAction } from '../TaskCreationWizard';

const mockRunIntakeAnalysis = vi.fn();
const mockRunIntakeReanalyze = vi.fn();
const mockLoadInsightsSession = vi.fn();
const mockSendMessage = vi.fn();
const mockCreateTask = vi.fn();
const mockCreateSandboxTask = vi.fn();
const mockSaveDraft = vi.fn();
const mockLoadDraft = vi.fn(() => null);
const mockClearDraft = vi.fn();
const mockIsDraftEmpty = vi.fn(() => true);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}));

vi.mock('../../stores/settings-store', () => ({
  useSettingsStore: () => ({
    settings: {
      selectedAgentProfile: 'auto',
      sandboxTasksEnabled: false,
      modelRouting: undefined,
      customPhaseModels: undefined,
      customPhaseThinking: undefined
    }
  })
}));

const mockProjectStoreState = {
  projects: [],
  addProject: vi.fn(),
  openProjectTab: vi.fn()
};

vi.mock('../../stores/project-store', () => ({
  useProjectStore: (selector: (state: typeof mockProjectStoreState) => unknown) =>
    selector(mockProjectStoreState)
}));

vi.mock('../../stores/task-store', () => ({
  createTask: (...args: unknown[]) => mockCreateTask(...args),
  createSandboxTask: (...args: unknown[]) => mockCreateSandboxTask(...args),
  saveDraft: (...args: unknown[]) => mockSaveDraft(...args),
  loadDraft: (...args: unknown[]) => mockLoadDraft(...args),
  clearDraft: (...args: unknown[]) => mockClearDraft(...args),
  isDraftEmpty: (...args: unknown[]) => mockIsDraftEmpty(...args)
}));

vi.mock('../../stores/intake-store', () => ({
  saveIntakeDraft: vi.fn(),
  loadIntakeDraft: vi.fn(() => null),
  clearIntakeDraft: vi.fn()
}));

vi.mock('../../stores/insights-store', () => ({
  loadInsightsSession: (...args: unknown[]) => mockLoadInsightsSession(...args),
  sendMessage: (...args: unknown[]) => mockSendMessage(...args)
}));

vi.mock('../model-routing/useModelRegistry', () => ({
  useModelRegistry: () => ({ data: null, isLoading: false })
}));

describe('TaskCreationWizard intake clarify flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateTask.mockResolvedValue({ id: 'task-1' });
    mockCreateSandboxTask.mockResolvedValue({
      task: { id: 'task-1' },
      project: { id: 'project-1' }
    });

    mockRunIntakeAnalysis.mockResolvedValue({
      success: true,
      data: {
        clarityLevel: 'low',
        clarifyingQuestions: [
          {
            id: 'q1',
            question: 'Specify exact file/location',
            type: 'text'
          }
        ],
        suggestedTitle: '',
        risks: [],
        assumptions: [],
        notes: '',
        intakeModel: 'glm-4.7'
      }
    });

    mockRunIntakeReanalyze.mockResolvedValue({
      success: true,
      data: {
        clarityLevel: 'high',
        clarifyingQuestions: [],
        suggestedTitle: '',
        risks: [],
        assumptions: [],
        notes: '',
        intakeModel: 'glm-4.7'
      }
    });

    Object.defineProperty(window, 'electronAPI', {
      value: {
        runIntakeAnalysis: mockRunIntakeAnalysis,
        runIntakeReanalyze: mockRunIntakeReanalyze
      },
      writable: true
    });

    // Radix components require ResizeObserver in jsdom.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  it('appends Clarifications block to description before reanalyze call', async () => {
    render(
      <TaskCreationWizard
        open
        onOpenChange={vi.fn()}
      />
    );

    const descriptionInput = screen.getByLabelText('Description *');
    fireEvent.change(descriptionInput, {
      target: { value: 'Add a new button in the left sidebar to open Settings' }
    });

    fireEvent.click(screen.getByRole('button', { name: 'wizard.intake.run' }));

    await screen.findByText('Specify exact file/location');

    const clarifyInput = screen.getByPlaceholderText('wizard.intake.answerPlaceholder');
    fireEvent.change(clarifyInput, {
      target: { value: 'apps/frontend/src/renderer/components/Sidebar.tsx' }
    });

    fireEvent.click(screen.getByRole('button', { name: 'wizard.intake.submitClarify' }));

    await waitFor(() => {
      expect(mockRunIntakeReanalyze).toHaveBeenCalledTimes(1);
    });

    const reanalyzeDescription = mockRunIntakeReanalyze.mock.calls[0]?.[1];
    expect(typeof reanalyzeDescription).toBe('string');
    expect(reanalyzeDescription).toContain('Clarifications:');
    expect(reanalyzeDescription).toContain('apps/frontend/src/renderer/components/Sidebar.tsx');
  });

  it('closes clarify modal when collect context is clicked and opens insights', async () => {
    const mockOnOpenInsights = vi.fn();

    render(
      <TaskCreationWizard
        projectId="p1"
        open
        onOpenChange={vi.fn()}
        onOpenInsights={mockOnOpenInsights}
      />
    );

    const descriptionInput = screen.getByLabelText('Description *');
    fireEvent.change(descriptionInput, {
      target: { value: 'Add a new button in the left sidebar to open Settings' }
    });

    fireEvent.click(screen.getByRole('button', { name: 'wizard.intake.run' }));
    await screen.findByText('Specify exact file/location');

    fireEvent.click(screen.getByRole('button', { name: 'wizard.intake.collectContext' }));

    await waitFor(() => {
      expect(mockOnOpenInsights).toHaveBeenCalledTimes(1);
      expect(mockLoadInsightsSession).toHaveBeenCalledWith('p1');
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('Specify exact file/location')).not.toBeInTheDocument();
    });
  });

  it('shows unlock hint only for needs_clarify/blocked and hides when skip intake is enabled', async () => {
    render(
      <TaskCreationWizard
        open
        onOpenChange={vi.fn()}
      />
    );

    expect(screen.queryByText('wizard.intake.createUnlockHint')).not.toBeInTheDocument();

    const descriptionInput = screen.getByLabelText('Description *');
    fireEvent.change(descriptionInput, {
      target: { value: 'Add a new button in the left sidebar to open Settings' }
    });

    fireEvent.click(screen.getByRole('button', { name: 'wizard.intake.run' }));
    await screen.findByText('Specify exact file/location');

    expect(screen.getByText('wizard.intake.createUnlockHint')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'wizard.intake.cancelClarify' }));
    fireEvent.click(screen.getByLabelText('wizard.intake.skipLabel'));

    await waitFor(() => {
      expect(screen.queryByText('wizard.intake.createUnlockHint')).not.toBeInTheDocument();
    });
  });

  it('allows creating task when skip intake is enabled', async () => {
    render(
      <TaskCreationWizard
        projectId="project-1"
        open
        onOpenChange={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText('Description *'), {
      target: { value: 'Fix typo in sidebar label' }
    });

    fireEvent.click(screen.getByLabelText('wizard.intake.skipLabel'));

    const createButton = screen.getByRole('button', { name: 'Create Task' });
    expect(createButton).toBeEnabled();

    fireEvent.click(createButton);

    await waitFor(() => {
      expect(mockCreateTask).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps Create Task disabled while intake is not completed and skip is off', () => {
    render(
      <TaskCreationWizard
        projectId="project-1"
        open
        onOpenChange={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText('Description *'), {
      target: { value: 'Fix typo in sidebar label' }
    });

    const createButton = screen.getByRole('button', { name: 'Create Task' });
    expect(createButton).toBeDisabled();
  });

  it('blocks clarify flow when same blocker signature repeats across rounds', async () => {
    mockRunIntakeAnalysis.mockResolvedValueOnce({
      success: true,
      data: {
        clarityLevel: 'low',
        blockers: ['Without scope, developer cannot identify ownership'],
        clarifyingQuestions: [
          {
            id: 'q1',
            question: 'Which file should be changed?',
            type: 'text'
          }
        ],
        suggestedTitle: '',
        risks: [],
        assumptions: [],
        notes: '',
        intakeModel: 'glm-4.7'
      }
    });

    mockRunIntakeReanalyze
      .mockResolvedValueOnce({
        success: true,
        data: {
          clarityLevel: 'medium',
          blockers: ['Without exact placement, developer cannot place the button'],
          clarifyingQuestions: [
            {
              id: 'q2',
              question: 'Where exactly in sidebar?',
              type: 'text'
            }
          ],
          suggestedTitle: '',
          risks: [],
          assumptions: [],
          notes: '',
          intakeModel: 'glm-4.7'
        }
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          clarityLevel: 'medium',
          blockers: ['Without exact placement, developer cannot place the button'],
          clarifyingQuestions: [
            {
              id: 'q3',
              question: 'Repeat: where exactly in sidebar?',
              type: 'text'
            }
          ],
          suggestedTitle: '',
          risks: [],
          assumptions: [],
          notes: '',
          intakeModel: 'glm-4.7'
        }
      });

    render(
      <TaskCreationWizard
        open
        onOpenChange={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText('Description *'), {
      target: { value: 'Add a new button in the left sidebar to open Settings' }
    });

    fireEvent.click(screen.getByRole('button', { name: 'wizard.intake.run' }));
    await screen.findByText('Which file should be changed?');

    fireEvent.change(screen.getByPlaceholderText('wizard.intake.answerPlaceholder'), {
      target: { value: 'apps/frontend/src/renderer/components/Sidebar.tsx' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'wizard.intake.submitClarify' }));

    await screen.findByText('Where exactly in sidebar?');

    fireEvent.change(screen.getByPlaceholderText('wizard.intake.answerPlaceholder'), {
      target: { value: 'Between badge and settings row' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'wizard.intake.submitClarify' }));

    await screen.findByText('Intake is cycling on the same blockers. Please rephrase the task or provide more detail.');
  });
});

describe('TaskCreationWizard blocker action helpers', () => {
  it('extracts canonical blocker action from "Without X, cannot Y" text', () => {
    const actionA = extractBlockerAction('Without exact file, developer cannot place the button');
    const actionB = extractBlockerAction('Without icon source, developer cannot place the button');

    expect(actionA).toBe('place the button');
    expect(actionB).toBe('place the button');
  });

  it('falls back to normalized blocker text when "cannot" pattern is missing', () => {
    expect(extractBlockerAction('Need exact path from user')).toBe('need exact path from user');
  });

  it('creates deterministic blocker signature from sorted actions', () => {
    const signature = createBlockerSignature([
      'Without tests, developer cannot verify changes',
      'Without file path, developer cannot place the button',
      'Without icon, developer cannot place the button'
    ]);

    expect(signature).toBe('place the button|place the button|verify changes');
  });
});

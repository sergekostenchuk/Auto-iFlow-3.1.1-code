/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { PlanImportSection } from './PlanImportSection';
import { loadTasks } from '../../stores/task-store';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}));

vi.mock('../../stores/task-store', () => ({
  loadTasks: vi.fn()
}));

const mockImportTaskPlan = vi.fn();

Object.defineProperty(window, 'electronAPI', {
  value: {
    importTaskPlan: mockImportTaskPlan
  },
  writable: true
});

describe('PlanImportSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('imports a plan and renders the summary', async () => {
    mockImportTaskPlan.mockResolvedValue({
      success: true,
      data: {
        createdTaskIds: ['task-1', 'task-2'],
        skipped: [],
        errors: [],
        totalTasks: 2
      }
    });

    render(<PlanImportSection projectId="project-123" />);

    const input = screen.getByPlaceholderText('projectSections.plan-import.planFilePlaceholder');
    fireEvent.change(input, { target: { value: '/tmp/plan.md' } });

    const importButton = screen.getByRole('button', {
      name: 'projectSections.plan-import.importAction'
    });
    fireEvent.click(importButton);

    await waitFor(() => {
      expect(mockImportTaskPlan).toHaveBeenCalledWith(
        'project-123',
        '/tmp/plan.md',
        expect.objectContaining({ autoStart: false, maxConcurrency: undefined })
      );
    });

    expect(await screen.findByText('projectSections.plan-import.summaryTitle')).toBeInTheDocument();
    expect(screen.getByText('projectSections.plan-import.summaryTotal')).toBeInTheDocument();
    expect(loadTasks).toHaveBeenCalledWith('project-123');
  });

  it('passes agent pipeline options when enabled', async () => {
    mockImportTaskPlan.mockResolvedValue({
      success: true,
      data: {
        createdTaskIds: ['task-1'],
        skipped: [],
        errors: [],
        totalTasks: 1
      }
    });

    render(<PlanImportSection projectId="project-123" />);

    const input = screen.getByPlaceholderText('projectSections.plan-import.planFilePlaceholder');
    fireEvent.change(input, { target: { value: '/tmp/plan.md' } });

    const switches = screen.getAllByRole('switch');
    fireEvent.click(switches[1]);

    const importButton = screen.getByRole('button', {
      name: 'projectSections.plan-import.importAction'
    });
    fireEvent.click(importButton);

    await waitFor(() => {
      expect(mockImportTaskPlan).toHaveBeenCalledWith(
        'project-123',
        '/tmp/plan.md',
        expect.objectContaining({
          agentPipeline: expect.objectContaining({
            enabled: true,
            agents: expect.any(Object)
          })
        })
      );
    });
  });

  it('shows read-only model and thinking info when agent pipeline is enabled', () => {
    render(<PlanImportSection projectId="project-123" />);

    const switches = screen.getAllByRole('switch');
    fireEvent.click(switches[1]);

    expect(screen.getByText('projectSections.plan-import.modelThinkingTitle')).toBeInTheDocument();
    expect(screen.getByText('projectSections.plan-import.modelRoutingDefaults')).toBeInTheDocument();
    expect(screen.getByText('projectSections.plan-import.modelRoutingHint')).toBeInTheDocument();
  });
});

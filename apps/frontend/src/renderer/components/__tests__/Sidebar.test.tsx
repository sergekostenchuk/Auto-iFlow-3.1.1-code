/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Sidebar } from '../Sidebar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}));

const mockProjectStoreState = {
  projects: [],
  selectedProjectId: null,
  openProjectTab: vi.fn()
};

vi.mock('../../stores/project-store', () => ({
  useProjectStore: (selector: (state: typeof mockProjectStoreState) => unknown) =>
    selector(mockProjectStoreState),
  removeProject: vi.fn(),
  initializeProject: vi.fn()
}));

vi.mock('../../stores/task-store', () => ({
  useTaskStore: (selector: (state: { tasks: Array<unknown> }) => unknown) =>
    selector({ tasks: [] }),
  deleteTask: vi.fn()
}));

vi.mock('../../stores/settings-store', () => ({
  useSettingsStore: (selector: (state: { settings: Record<string, unknown> }) => unknown) =>
    selector({
      settings: {
        sandboxTasksEnabled: false,
        theme: 'dark',
        colorTheme: 'default',
        autoBuildPath: '/tmp/auto-iflow'
      }
    })
}));

describe('Sidebar', () => {
  const mockOnSettingsClick = vi.fn();
  const mockOnNewTaskClick = vi.fn();
  const mockOnImportTaskPlanClick = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'electronAPI', {
      value: {
        getProjectEnv: vi.fn().mockResolvedValue({ success: false })
      },
      writable: true
    });
    window.open = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  it('calls onImportTaskPlanClick when button is clicked', () => {
    render(
      <Sidebar
        onSettingsClick={mockOnSettingsClick}
        onImportTaskPlanClick={mockOnImportTaskPlanClick}
        onNewTaskClick={mockOnNewTaskClick}
      />
    );

    const importButton = screen.getByTestId('sidebar-import-task-plan');
    fireEvent.click(importButton);

    expect(mockOnImportTaskPlanClick).toHaveBeenCalledTimes(1);
  });
});

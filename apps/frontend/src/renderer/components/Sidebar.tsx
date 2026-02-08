import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  Settings,
  Trash2,
  LayoutGrid,
  Terminal,
  Map,
  BookOpen,
  Lightbulb,
  AlertCircle,
  Download,
  RefreshCw,
  Github,
  GitlabIcon,
  GitPullRequest,
  GitMerge,
  FileText,
  Sparkles,
  GitBranch,
  HelpCircle,
  Wrench,
  Users,
  Gamepad2
} from 'lucide-react';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { Separator } from './ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from './ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog';
import { cn } from '../lib/utils';
import {
  useProjectStore,
  removeProject,
  initializeProject
} from '../stores/project-store';
import { deleteTask } from '../stores/task-store';
import { useTaskStore } from '../stores/task-store';
import { useSettingsStore } from '../stores/settings-store';
import { AddProjectModal } from './AddProjectModal';
import { GitSetupModal } from './GitSetupModal';
import { RateLimitIndicator } from './RateLimitIndicator';
import { IFlowStatusBadge } from './IFlowStatusBadge';
import type { Project, AutoBuildVersionInfo, GitStatus, ProjectEnvConfig } from '../../shared/types';
import AutoIFlowLogo from '../assets/auto-iflow-logo.png';

export type SidebarView = 'kanban' | 'terminals' | 'roadmap' | 'context' | 'ideation' | 'github-issues' | 'gitlab-issues' | 'github-prs' | 'gitlab-merge-requests' | 'changelog' | 'insights' | 'worktrees' | 'agent-tools' | 'consilium' | 'tetris';

interface SidebarProps {
  onSettingsClick: () => void;
  onImportTaskPlanClick?: () => void;
  onNewTaskClick: () => void;
  activeView?: SidebarView;
  onViewChange?: (view: SidebarView) => void;
}

interface NavItem {
  id: SidebarView;
  labelKey: string;
  icon: React.ElementType;
  shortcut?: string;
}

// Base nav items always shown
const baseNavItems: NavItem[] = [
  { id: 'kanban', labelKey: 'navigation:items.kanban', icon: LayoutGrid, shortcut: 'K' },
  { id: 'terminals', labelKey: 'navigation:items.terminals', icon: Terminal, shortcut: 'A' },
  { id: 'consilium', labelKey: 'navigation:items.consilium', icon: Users, shortcut: 'O' },
  { id: 'insights', labelKey: 'navigation:items.insights', icon: Sparkles, shortcut: 'N' },
  { id: 'roadmap', labelKey: 'navigation:items.roadmap', icon: Map, shortcut: 'D' },
  { id: 'ideation', labelKey: 'navigation:items.ideation', icon: Lightbulb, shortcut: 'I' },
  { id: 'changelog', labelKey: 'navigation:items.changelog', icon: FileText, shortcut: 'L' },
  { id: 'context', labelKey: 'navigation:items.context', icon: BookOpen, shortcut: 'C' },
  { id: 'agent-tools', labelKey: 'navigation:items.agentTools', icon: Wrench, shortcut: 'M' },
  { id: 'worktrees', labelKey: 'navigation:items.worktrees', icon: GitBranch, shortcut: 'W' },
  { id: 'tetris', labelKey: 'navigation:items.tetris', icon: Gamepad2, shortcut: 'T' }
];

// GitHub nav items shown when GitHub is enabled
const githubNavItems: NavItem[] = [
  { id: 'github-issues', labelKey: 'navigation:items.githubIssues', icon: Github, shortcut: 'G' },
  { id: 'github-prs', labelKey: 'navigation:items.githubPRs', icon: GitPullRequest, shortcut: 'P' }
];

// GitLab nav items shown when GitLab is enabled
const gitlabNavItems: NavItem[] = [
  { id: 'gitlab-issues', labelKey: 'navigation:items.gitlabIssues', icon: GitlabIcon, shortcut: 'B' },
  { id: 'gitlab-merge-requests', labelKey: 'navigation:items.gitlabMRs', icon: GitMerge, shortcut: 'R' }
];

export function Sidebar({
  onSettingsClick,
  onImportTaskPlanClick,
  onNewTaskClick,
  activeView = 'kanban',
  onViewChange
}: SidebarProps) {
  const { t } = useTranslation(['navigation', 'dialogs', 'common']);
  const projects = useProjectStore((state) => state.projects);
  const selectedProjectId = useProjectStore((state) => state.selectedProjectId);
  const openProjectTab = useProjectStore((state) => state.openProjectTab);
  const settings = useSettingsStore((state) => state.settings);
  const tasks = useTaskStore((state) => state.tasks);

  const [showAddProjectModal, setShowAddProjectModal] = useState(false);
  const [showInitDialog, setShowInitDialog] = useState(false);
  const [showGitSetupModal, setShowGitSetupModal] = useState(false);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [pendingProject, setPendingProject] = useState<Project | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [envConfig, setEnvConfig] = useState<ProjectEnvConfig | null>(null);
  const matrixCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const sandboxProjects = useMemo(
    () => projects.filter((project) => project.isSandbox),
    [projects]
  );
  const canCreateTask = Boolean(
    (selectedProjectId && selectedProject?.autoBuildPath) || settings.sandboxTasksEnabled
  );
  const hasActiveAgent = useMemo(() => {
    if (!selectedProjectId) return false;

    return tasks.some((task) => {
      if (task.projectId !== selectedProjectId) return false;
      if (task.status === 'in_progress') return true;
      const phase = task.executionProgress?.phase;
      return Boolean(phase && !['idle', 'complete', 'failed'].includes(phase));
    });
  }, [selectedProjectId, tasks]);

  useEffect(() => {
    const canvas = matrixCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number | null = null;
    let width = 0;
    let height = 0;
    const fontSize = 12;
    const chars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let drops: number[] = [];
    const wordDrops: Array<{ x: number; y: number; text: string; speed: number }> = [];
    const wordList = [
      'FLOW', 'AGENT', 'AI', 'TASK', 'CODE', 'PLAN', 'QA', 'MERGE', 'AUTO',
      'FLUX', 'AGENT', 'CODE', 'TÂCHE', 'PLAN', 'IA',
      'FLUSS', 'AGENT', 'CODE', 'PLAN', 'KI',
      '流', '代码', '计划', '任务', '智能体',
      'フロー', 'コード', '計画', 'タスク', 'AI',
      '흐름', '코드', '계획', '작업', '에이전트'
    ];

    const resize = () => {
      const parent = canvas.parentElement;
      const rect = parent?.getBoundingClientRect() ?? canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const scrollHeight = parent?.scrollHeight ?? rect.height;
      width = rect.width;
      height = Math.max(rect.height, scrollHeight, window.innerHeight);
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const columns = Math.max(1, Math.floor(width / fontSize));
      drops = Array.from({ length: columns }, () => Math.random() * height);
    };

    const toRgb = (value: string) => {
      const rgbMatch = value.match(/rgb\\s*\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*\\)/i);
      if (rgbMatch) {
        return { r: Number(rgbMatch[1]), g: Number(rgbMatch[2]), b: Number(rgbMatch[3]) };
      }
      const normalized = value.replace('#', '').trim();
      if (normalized.length !== 6) return { r: 0, g: 255, b: 106 };
      const r = parseInt(normalized.slice(0, 2), 16);
      const g = parseInt(normalized.slice(2, 4), 16);
      const b = parseInt(normalized.slice(4, 6), 16);
      return { r, g, b };
    };

    const getAccentColor = () => {
      const color = getComputedStyle(document.documentElement)
        .getPropertyValue('--color-accent-foreground')
        .trim();
      return color || '#00FF6A';
    };

    const draw = () => {
      if (!hasActiveAgent) {
        ctx.clearRect(0, 0, width, height);
        return;
      }

      // Fade only existing symbols without tinting the sidebar background
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'source-over';

      const accentColor = getAccentColor();
      const { r, g, b } = toRgb(accentColor);
      ctx.font = `${fontSize}px "JetBrains Mono", "Menlo", monospace`;
      ctx.globalAlpha = 0.35;

      for (let i = 0; i < drops.length; i += 1) {
        const x = i * fontSize;
        const y = drops[i];
        const ch = chars[Math.floor(Math.random() * chars.length)];
        ctx.fillStyle = accentColor;
        ctx.fillText(ch, x, y);

        const speed = 0.8 + Math.random() * 1.6;
        drops[i] = y + speed;
        if (drops[i] > height + 20) {
          drops[i] = -Math.random() * 50;
        }
      }

      // Occasionally spawn word drops
      if (wordDrops.length < 18 && Math.random() > 0.92) {
        const text = wordList[Math.floor(Math.random() * wordList.length)];
        const x = Math.random() * Math.max(0, width - text.length * fontSize);
        wordDrops.push({
          x,
          y: -Math.random() * height,
          text,
          speed: 0.6 + Math.random() * 1.2
        });
      }

      // Draw word drops
      ctx.globalAlpha = 0.45;
      wordDrops.forEach((drop) => {
        ctx.fillStyle = accentColor;
        let y = drop.y;
        for (const ch of drop.text) {
          ctx.fillText(ch, drop.x, y);
          y += fontSize * 1.1;
        }
        drop.y += drop.speed;
      });
      // Remove offscreen word drops
      for (let i = wordDrops.length - 1; i >= 0; i -= 1) {
        if (wordDrops[i].y > height + 40) {
          wordDrops.splice(i, 1);
        }
      }
      ctx.globalAlpha = 1;

      animationId = requestAnimationFrame(draw);
    };

    resize();
    if (hasActiveAgent) {
      animationId = requestAnimationFrame(draw);
    } else {
      ctx.clearRect(0, 0, width, height);
    }

    const handleResize = () => resize();
    window.addEventListener('resize', handleResize);
    const observer = new ResizeObserver(() => resize());
    if (canvas.parentElement) observer.observe(canvas.parentElement);

    return () => {
      if (animationId) cancelAnimationFrame(animationId);
      window.removeEventListener('resize', handleResize);
      observer.disconnect();
    };
  }, [hasActiveAgent, settings.colorTheme, settings.theme]);

  // Load env config when project changes to check GitHub/GitLab enabled state
  useEffect(() => {
    const loadEnvConfig = async () => {
      if (selectedProject?.autoBuildPath) {
        try {
          const result = await window.electronAPI.getProjectEnv(selectedProject.id);
          if (result.success && result.data) {
            setEnvConfig(result.data);
          } else {
            setEnvConfig(null);
          }
        } catch {
          setEnvConfig(null);
        }
      } else {
        setEnvConfig(null);
      }
    };
    loadEnvConfig();
  }, [selectedProject?.id, selectedProject?.autoBuildPath]);

  // Compute visible nav items based on GitHub/GitLab enabled state
  const visibleNavItems = useMemo(() => {
    const items = [...baseNavItems];

    if (envConfig?.githubEnabled) {
      items.push(...githubNavItems);
    }

    if (envConfig?.gitlabEnabled) {
      items.push(...gitlabNavItems);
    }

    return items;
  }, [envConfig?.githubEnabled, envConfig?.gitlabEnabled]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement ||
        (e.target as HTMLElement)?.isContentEditable
      ) {
        return;
      }

      // Only handle shortcuts when a project is selected
      if (!selectedProjectId) return;

      // Check for modifier keys - we want plain key presses only
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key.toUpperCase();

      // Find matching nav item from visible items only
      const matchedItem = visibleNavItems.find((item) => item.shortcut === key);

      if (matchedItem) {
        e.preventDefault();
        onViewChange?.(matchedItem.id);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedProjectId, onViewChange, visibleNavItems]);

  // Check git status when project changes
  useEffect(() => {
    const checkGit = async () => {
      if (selectedProject) {
        try {
          const result = await window.electronAPI.checkGitStatus(selectedProject.path);
          if (result.success && result.data) {
            setGitStatus(result.data);
            // Show git setup modal if project is not a git repo or has no commits
            if (!result.data.isGitRepo || !result.data.hasCommits) {
              setShowGitSetupModal(true);
            }
          }
        } catch (error) {
          console.error('Failed to check git status:', error);
        }
      } else {
        setGitStatus(null);
      }
    };
    checkGit();
  }, [selectedProject]);

  const handleAddProject = () => {
    setShowAddProjectModal(true);
  };

  const handleProjectAdded = (project: Project, needsInit: boolean) => {
    if (needsInit) {
      setPendingProject(project);
      setShowInitDialog(true);
    }
  };

  const handleInitialize = async () => {
    if (!pendingProject) return;

    const projectId = pendingProject.id;
    setIsInitializing(true);
    try {
      const result = await initializeProject(projectId);
      if (result?.success) {
        // Clear pendingProject FIRST before closing dialog
        // This prevents onOpenChange from triggering skip logic
        setPendingProject(null);
        setShowInitDialog(false);
      }
    } finally {
      setIsInitializing(false);
    }
  };

  const handleSkipInit = () => {
    setShowInitDialog(false);
    setPendingProject(null);
  };

  const handleGitInitialized = async () => {
    // Refresh git status after initialization
    if (selectedProject) {
      try {
        const result = await window.electronAPI.checkGitStatus(selectedProject.path);
        if (result.success && result.data) {
          setGitStatus(result.data);
        }
      } catch (error) {
        console.error('Failed to refresh git status:', error);
      }
    }
  };

  const _handleRemoveProject = async (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    await removeProject(projectId);
  };

  const handleSandboxDelete = async (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      const tasksResult = await window.electronAPI.getTasks(projectId);
      if (!tasksResult.success || !tasksResult.data || tasksResult.data.length === 0) {
        console.warn('[Sidebar] No sandbox task found for project', projectId);
        return;
      }
      await deleteTask(tasksResult.data[0].id);
    } catch (error) {
      console.error('Failed to delete sandbox task:', error);
    }
  };


  const handleNavClick = (view: SidebarView) => {
    onViewChange?.(view);
  };

  const renderNavItem = (item: NavItem) => {
    const isActive = activeView === item.id;
    const Icon = item.icon;

    return (
      <button
        key={item.id}
        onClick={() => handleNavClick(item.id)}
        disabled={!selectedProjectId}
        aria-keyshortcuts={item.shortcut}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all duration-200',
          'hover:bg-accent hover:text-accent-foreground',
          'disabled:pointer-events-none disabled:opacity-50',
          isActive && 'bg-accent text-accent-foreground'
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left">{t(item.labelKey)}</span>
        {item.shortcut && (
          <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded-md border border-border bg-secondary px-1.5 font-mono text-[10px] font-medium text-muted-foreground sm:flex">
            {item.shortcut}
          </kbd>
        )}
      </button>
    );
  };

  return (
    <TooltipProvider>
      <div className="relative flex h-full w-64 flex-col overflow-hidden bg-sidebar border-r border-border">
        <canvas
          ref={matrixCanvasRef}
          className={cn(
            'pointer-events-none absolute inset-0 z-20 h-full w-full opacity-70 transition-opacity duration-300',
            hasActiveAgent ? 'opacity-70' : 'opacity-0'
          )}
        />
        {/* Header with drag area - extra top padding for macOS traffic lights */}
        <div className="electron-drag relative z-10 flex h-28 items-center overflow-hidden px-4 pt-6">
          <div className="electron-no-drag relative z-10 flex w-full items-center justify-center gap-3">
            <div
              className="h-16 w-28"
              style={{
                backgroundColor: 'var(--color-accent-foreground)',
                WebkitMaskImage: `url(${AutoIFlowLogo})`,
                maskImage: `url(${AutoIFlowLogo})`,
                WebkitMaskRepeat: 'no-repeat',
                maskRepeat: 'no-repeat',
                WebkitMaskSize: 'contain',
                maskSize: 'contain',
                WebkitMaskPosition: 'center',
                maskPosition: 'center'
              }}
              aria-label="Auto-iFlow logo"
            />
          </div>
        </div>

        <Separator className="mt-2 relative z-10" />


        <Separator className="relative z-10" />

        {/* Navigation - scrollable area */}
        <ScrollArea className="relative z-10 flex-1 min-h-0">
          <div className="px-3 py-4">
            {/* Project Section */}
            <div>
              <h3 className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('sections.project')}
              </h3>
              <nav className="space-y-1">
                {visibleNavItems.map(renderNavItem)}
              </nav>
            </div>

            {sandboxProjects.length > 0 && (
              <div className="mt-6">
                <h3 className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('sections.sandboxes')}
                </h3>
                <div className="space-y-1">
                  {sandboxProjects.map((project) => {
                    const isActiveSandbox = selectedProjectId === project.id;
                    return (
                      <div key={project.id} className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openProjectTab(project.id)}
                          className={cn(
                            'flex flex-1 items-center gap-2 min-w-0 rounded-lg px-3 py-2 text-sm transition-all duration-200',
                            'hover:bg-accent hover:text-accent-foreground',
                            isActiveSandbox && 'bg-accent text-accent-foreground'
                          )}
                        >
                          <span className="truncate">{project.name}</span>
                          <span className="ml-auto text-[10px] uppercase tracking-wide rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                            {t('labels.sandbox')}
                          </span>
                        </button>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={(e) => handleSandboxDelete(project.id, e)}
                              className={cn(
                                'h-7 w-7 rounded-md flex items-center justify-center',
                                'text-muted-foreground hover:text-destructive',
                                'hover:bg-destructive/10 transition-colors'
                              )}
                              aria-label={t('common:buttons.delete')}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="right">
                            {t('common:buttons.delete')}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <Separator />

        {/* Rate Limit Indicator - shows when Claude is rate limited */}
        <RateLimitIndicator />

        {/* Bottom section with Settings, Help, and New Task */}
        <div className="p-4 space-y-3">
          {/* iFlow Status Badge */}
          <IFlowStatusBadge />

          {/* Import Task Plan button */}
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={onImportTaskPlanClick}
            data-testid="sidebar-import-task-plan"
          >
            <Download className="h-4 w-4" />
            {t('items.importTaskPlan')}
          </Button>

          {/* Settings and Help row */}
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1 justify-start gap-2"
                  onClick={onSettingsClick}
                >
                  <Settings className="h-4 w-4" />
                  {t('actions.settings')}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{t('tooltips.settings')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => window.open('https://github.com/sergekostenchuk/Auto-iFlow/issues', '_blank')}
                  aria-label={t('tooltips.help')}
                >
                  <HelpCircle className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{t('tooltips.help')}</TooltipContent>
            </Tooltip>
          </div>

          {/* New Task button */}
          <Button
            className="w-full"
            onClick={onNewTaskClick}
            disabled={!canCreateTask}
          >
            <Plus className="mr-2 h-4 w-4" />
            {t('actions.newTask')}
          </Button>
          {selectedProject && !selectedProject.autoBuildPath && !settings.sandboxTasksEnabled && (
            <p className="mt-2 text-xs text-muted-foreground text-center">
              {t('messages.initializeToCreateTasks')}
            </p>
          )}
        </div>
      </div>

      {/* Initialize Auto-iFlow Dialog */}
      <Dialog open={showInitDialog} onOpenChange={(open) => {
        // Only allow closing if user manually closes (not during initialization)
        if (!open && !isInitializing) {
          handleSkipInit();
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              {t('dialogs:initialize.title')}
            </DialogTitle>
            <DialogDescription>
              {t('dialogs:initialize.description')}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="rounded-lg bg-muted p-4 text-sm">
              <p className="font-medium mb-2">{t('dialogs:initialize.willDo')}</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>{t('dialogs:initialize.createFolder')}</li>
                <li>{t('dialogs:initialize.copyFramework')}</li>
                <li>{t('dialogs:initialize.setupSpecs')}</li>
              </ul>
            </div>
            {!settings.autoBuildPath && (
              <div className="mt-4 rounded-lg border border-warning/50 bg-warning/10 p-4 text-sm">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-warning">{t('dialogs:initialize.sourcePathNotConfigured')}</p>
                    <p className="text-muted-foreground mt-1">
                      {t('dialogs:initialize.sourcePathNotConfiguredDescription')}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleSkipInit} disabled={isInitializing}>
              {t('common:buttons.skip')}
            </Button>
            <Button
              onClick={handleInitialize}
              disabled={isInitializing || !settings.autoBuildPath}
            >
              {isInitializing ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  {t('common:labels.initializing')}
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  {t('common:buttons.initialize')}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Project Modal */}
      <AddProjectModal
        open={showAddProjectModal}
        onOpenChange={setShowAddProjectModal}
        onProjectAdded={handleProjectAdded}
      />

      {/* Git Setup Modal */}
      <GitSetupModal
        open={showGitSetupModal}
        onOpenChange={setShowGitSetupModal}
        project={selectedProject || null}
        gitStatus={gitStatus}
        onGitInitialized={handleGitInitialized}
      />
    </TooltipProvider>
  );
}

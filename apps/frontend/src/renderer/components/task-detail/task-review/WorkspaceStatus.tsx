import { useState } from 'react';
import {
  GitBranch,
  FileCode,
  Plus,
  Minus,
  Eye,
  GitMerge,
  FolderX,
  Loader2,
  RotateCcw,
  AlertTriangle,
  CheckCircle,
  GitCommit,
  Archive,
  Code,
  Terminal,
  Wrench
} from 'lucide-react';
import { Button } from '../../ui/button';
import { Checkbox } from '../../ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '../../ui/dropdown-menu';
import { cn } from '../../../lib/utils';
import type { WorktreeStatus, MergeConflict, MergeStats, GitConflictInfo, SupportedIDE, SupportedTerminal, WorktreeFixAction, PostCodeTestsReport } from '../../../../shared/types';
import { useSettingsStore } from '../../../stores/settings-store';

interface WorkspaceStatusProps {
  taskId: string;
  worktreeStatus: WorktreeStatus;
  workspaceError: string | null;
  stageOnly: boolean;
  mergePreview: { files: string[]; conflicts: MergeConflict[]; summary: MergeStats; gitConflicts?: GitConflictInfo; uncommittedChanges?: { hasChanges: boolean; files: string[]; count: number } | null } | null;
  isLoadingPreview: boolean;
  isMerging: boolean;
  isDiscarding: boolean;
  autoMergeEnabled?: boolean;
  postCodeTests?: PostCodeTestsReport | null;
  postCodeTestsLoaded?: boolean;
  allowMergeWithoutTests?: boolean;
  onAllowMergeWithoutTestsChange?: (value: boolean) => void;
  onShowDiffDialog: (show: boolean) => void;
  onShowDiscardDialog: (show: boolean) => void;
  onShowConflictDialog: (show: boolean) => void;
  onLoadMergePreview: () => void;
  onStageOnlyChange: (value: boolean) => void;
  onMerge: () => void;
  onAutoMerge?: () => void;
  onClose?: () => void;
  onSwitchToTerminals?: () => void;
  onOpenInbuiltTerminal?: (id: string, cwd: string) => void;
}

/**
 * Displays the workspace status including change summary, merge preview, and action buttons
 */
// IDE display names for button labels (short names for buttons)
const IDE_LABELS: Partial<Record<SupportedIDE, string>> = {
  vscode: 'VS Code',
  cursor: 'Cursor',
  windsurf: 'Windsurf',
  zed: 'Zed',
  sublime: 'Sublime',
  webstorm: 'WebStorm',
  intellij: 'IntelliJ',
  pycharm: 'PyCharm',
  xcode: 'Xcode',
  vim: 'Vim',
  neovim: 'Neovim',
  emacs: 'Emacs',
  custom: 'IDE'
};

// Terminal display names for button labels (short names for buttons)
const TERMINAL_LABELS: Partial<Record<SupportedTerminal, string>> = {
  system: 'Terminal',
  terminal: 'Terminal',
  iterm2: 'iTerm',
  warp: 'Warp',
  ghostty: 'Ghostty',
  alacritty: 'Alacritty',
  kitty: 'Kitty',
  wezterm: 'WezTerm',
  hyper: 'Hyper',
  windowsterminal: 'Terminal',
  gnometerminal: 'Terminal',
  konsole: 'Konsole',
  custom: 'Terminal'
};

export function WorkspaceStatus({
  taskId,
  worktreeStatus,
  workspaceError,
  stageOnly,
  mergePreview,
  isLoadingPreview,
  isMerging,
  isDiscarding,
  autoMergeEnabled,
  postCodeTests,
  postCodeTestsLoaded,
  allowMergeWithoutTests,
  onAllowMergeWithoutTestsChange,
  onShowDiffDialog,
  onShowDiscardDialog,
  onShowConflictDialog,
  onLoadMergePreview,
  onStageOnlyChange,
  onMerge,
  onAutoMerge,
  onClose,
  onSwitchToTerminals,
  onOpenInbuiltTerminal
}: WorkspaceStatusProps) {
  const { settings } = useSettingsStore();
  const preferredIDE = settings.preferredIDE || 'vscode';
  const preferredTerminal = settings.preferredTerminal || 'system';
  const [isApplyingFix, setIsApplyingFix] = useState(false);

  const handleOpenInIDE = async () => {
    if (!worktreeStatus.worktreePath) return;
    try {
      await window.electronAPI.worktreeOpenInIDE(
        worktreeStatus.worktreePath,
        preferredIDE,
        settings.customIDEPath
      );
    } catch (err) {
      console.error('Failed to open in IDE:', err);
    }
  };

  const handleOpenInTerminal = async () => {
    if (!worktreeStatus.worktreePath) return;
    try {
      await window.electronAPI.worktreeOpenInTerminal(
        worktreeStatus.worktreePath,
        preferredTerminal,
        settings.customTerminalPath
      );
    } catch (err) {
      console.error('Failed to open in terminal:', err);
    }
  };

  const handleApplyFix = async (action: WorktreeFixAction) => {
    setIsApplyingFix(true);
    try {
      const result = await window.electronAPI.applyWorktreeFix(taskId, action);
      if (!result.success || !result.data?.success) {
        console.error('Failed to apply fix:', result.error || result.data?.message);
        return;
      }
      await onLoadMergePreview();
    } catch (err) {
      console.error('Failed to apply fix:', err);
    } finally {
      setIsApplyingFix(false);
    }
  };

  const hasGitConflicts = mergePreview?.gitConflicts?.hasConflicts;
  const hasUncommittedChanges = mergePreview?.uncommittedChanges?.hasChanges;
  const uncommittedCount = mergePreview?.uncommittedChanges?.count || 0;
  const uncommittedFiles = mergePreview?.uncommittedChanges?.files || [];
  const canCommitGitignore = uncommittedFiles.length === 1 && uncommittedFiles[0] === '.gitignore';
  const hasAIConflicts = mergePreview && mergePreview.conflicts.length > 0;

  // Check if branch needs rebase (main has advanced since spec was created)
  // This requires AI merge even if no explicit file conflicts are detected
  const needsRebase = mergePreview?.gitConflicts?.needsRebase;
  const commitsBehind = mergePreview?.gitConflicts?.commitsBehind || 0;

  // Path-mapped files that need AI merge due to file renames
  const pathMappedAIMergeCount = mergePreview?.summary?.pathMappedAIMergeCount || 0;
  const totalRenames = mergePreview?.gitConflicts?.totalRenames || 0;

  // Branch is behind if needsRebase is true and there are commits to catch up on
  // This triggers AI merge for path-mapped files even without explicit conflicts
  const isBranchBehind = needsRebase && commitsBehind > 0;

  // Has path-mapped files that need AI merge
  const hasPathMappedMerges = pathMappedAIMergeCount > 0;
  const postCodeStatus = postCodeTests?.status;
  const postCodeTestsFailed = postCodeTestsLoaded && postCodeStatus === 'failed';
  const postCodeTestsMissing = postCodeTestsLoaded && !postCodeStatus;
  const testsOverrideAllowed = Boolean(allowMergeWithoutTests);
  const isMergeBlockedByTests = (postCodeTestsFailed || postCodeTestsMissing) && !testsOverrideAllowed;
  const shouldShowTestsOverride = postCodeTestsLoaded && (postCodeTestsFailed || postCodeTestsMissing);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header with stats */}
      <div className="px-4 py-3 bg-muted/30 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium text-sm text-foreground flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-purple-400" />
            Build Ready for Review
          </h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onShowDiffDialog(true)}
            className="h-7 px-2 text-xs"
          >
            <Eye className="h-3.5 w-3.5 mr-1" />
            View
          </Button>
        </div>

        {/* Compact stats row */}
        <div className="flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <FileCode className="h-3.5 w-3.5" />
            <span className="font-medium text-foreground">{worktreeStatus.filesChanged || 0}</span> files
          </span>
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <GitCommit className="h-3.5 w-3.5" />
            <span className="font-medium text-foreground">{worktreeStatus.commitCount || 0}</span> commits
          </span>
          <span className="flex items-center gap-1 text-success">
            <Plus className="h-3.5 w-3.5" />
            <span className="font-medium">{worktreeStatus.additions || 0}</span>
          </span>
          <span className="flex items-center gap-1 text-destructive">
            <Minus className="h-3.5 w-3.5" />
            <span className="font-medium">{worktreeStatus.deletions || 0}</span>
          </span>
        </div>

        {/* Branch info */}
        {worktreeStatus.branch && (
          <div className="mt-2 text-xs text-muted-foreground">
            <code className="bg-background/80 px-1.5 py-0.5 rounded text-[11px]">{worktreeStatus.branch}</code>
            <span className="mx-1.5">→</span>
            <code className="bg-background/80 px-1.5 py-0.5 rounded text-[11px]">{worktreeStatus.baseBranch || 'main'}</code>
          </div>
        )}

        {/* Worktree path display */}
        {worktreeStatus.worktreePath && (
          <div className="mt-2 text-xs text-muted-foreground font-mono">
            📁 {worktreeStatus.worktreePath}
          </div>
        )}

        {/* Open in IDE/Terminal buttons */}
        {worktreeStatus.worktreePath && (
          <div className="flex gap-2 mt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenInIDE}
              className="h-7 px-2 text-xs"
            >
              <Code className="h-3.5 w-3.5 mr-1" />
              Open in {IDE_LABELS[preferredIDE]}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenInTerminal}
              className="h-7 px-2 text-xs"
            >
              <Terminal className="h-3.5 w-3.5 mr-1" />
              Open in {TERMINAL_LABELS[preferredTerminal]}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={isApplyingFix}
                >
                  <Wrench className="h-3.5 w-3.5 mr-1" />
                  Fix
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel>Merge issues</DropdownMenuLabel>
                <div className="px-2 py-1 text-xs text-muted-foreground space-y-1">
                  {hasUncommittedChanges ? (
                    <div>
                      Uncommitted changes in main: {uncommittedCount}
                      <div className="mt-1 space-y-0.5">
                        {uncommittedFiles.slice(0, 3).map((file) => (
                          <div key={file} className="font-mono text-[11px] truncate">
                            {file}
                          </div>
                        ))}
                        {uncommittedFiles.length > 3 && (
                          <div className="text-[11px]">+{uncommittedFiles.length - 3} more</div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div>No blocking changes detected</div>
                  )}
                  {isBranchBehind && (
                    <div>
                      Branch behind {mergePreview?.gitConflicts?.baseBranch || 'main'} by {commitsBehind} commit{commitsBehind === 1 ? '' : 's'}
                    </div>
                  )}
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={!canCommitGitignore || isApplyingFix}
                  onClick={() => handleApplyFix('commit_gitignore')}
                >
                  <GitCommit className="h-4 w-4 mr-2" />
                  Commit .gitignore
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!hasUncommittedChanges || isApplyingFix}
                  onClick={() => handleApplyFix('stash_changes')}
                >
                  <Archive className="h-4 w-4 mr-2" />
                  Stash changes
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={isApplyingFix}
                  onClick={onLoadMergePreview}
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Refresh preview
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {/* Status/Warnings Section */}
      <div className="px-4 py-3 space-y-3">
        {/* Workspace Error */}
        {workspaceError && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-destructive/10 border border-destructive/20">
            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
            <p className="text-sm text-destructive">{workspaceError}</p>
          </div>
        )}

        {/* Uncommitted Changes Warning */}
        {hasUncommittedChanges && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-warning/10 border border-warning/20">
            <AlertTriangle className="h-4 w-4 text-warning mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-warning">
                Merge blocked: {uncommittedCount} uncommitted {uncommittedCount === 1 ? 'change' : 'changes'} in main project
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Commit or stash changes in the main project, then refresh the preview.
              </p>
            </div>
          </div>
        )}

        {shouldShowTestsOverride && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg border border-warning/30 bg-warning/10">
            <AlertTriangle className="h-4 w-4 text-warning mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0 space-y-2">
              <div>
                <p className="text-sm font-medium text-warning">Merge blocked: post-code tests not passing</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Enable override to proceed without successful post-code tests.
                </p>
              </div>
              <label className="inline-flex items-center gap-2 text-xs text-foreground/80 cursor-pointer select-none">
                <Checkbox
                  checked={testsOverrideAllowed}
                  onCheckedChange={(checked) => onAllowMergeWithoutTestsChange?.(checked === true)}
                  className="border-warning/60 data-[state=checked]:border-warning"
                />
                Ignore missing/failed tests for this merge
              </label>
            </div>
          </div>
        )}

        {/* Loading indicator */}
        {isLoadingPreview && !mergePreview && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking for conflicts...
          </div>
        )}

        {/* Merge Status */}
        {mergePreview && (
          <div className={cn(
            "flex items-center justify-between p-2.5 rounded-lg border",
            hasGitConflicts || isBranchBehind || hasPathMappedMerges
              ? "bg-warning/10 border-warning/20"
              : !hasAIConflicts
                ? "bg-success/10 border-success/20"
                : "bg-warning/10 border-warning/20"
          )}>
            <div className="flex items-center gap-2">
              {hasGitConflicts ? (
                <>
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  <div>
                    <span className="text-sm font-medium text-warning">Branch Diverged</span>
                    <span className="text-xs text-muted-foreground ml-2">AI will resolve</span>
                  </div>
                </>
              ) : isBranchBehind || hasPathMappedMerges ? (
                <>
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  <div>
                    <span className="text-sm font-medium text-warning">
                      {hasPathMappedMerges ? 'Files Renamed' : 'Branch Behind'}
                    </span>
                    <span className="text-xs text-muted-foreground ml-2">
                      AI will resolve ({hasPathMappedMerges ? `${pathMappedAIMergeCount} files` : `${commitsBehind} commits`})
                    </span>
                  </div>
                </>
              ) : !hasAIConflicts ? (
                <>
                  <CheckCircle className="h-4 w-4 text-success" />
                  <span className="text-sm font-medium text-success">Ready to merge</span>
                  <span className="text-xs text-muted-foreground ml-1">
                    {mergePreview.summary.totalFiles} files
                  </span>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  <span className="text-sm font-medium text-warning">
                    {mergePreview.conflicts.length} conflict{mergePreview.conflicts.length !== 1 ? 's' : ''}
                  </span>
                </>
              )}
            </div>
            <div className="flex items-center gap-1">
              {(hasGitConflicts || isBranchBehind || hasPathMappedMerges || hasAIConflicts) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onShowConflictDialog(true)}
                  className="h-7 text-xs"
                >
                  Details
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={onLoadMergePreview}
                disabled={isLoadingPreview}
                className="h-7 px-2"
                title="Refresh"
              >
                {isLoadingPreview ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Git Conflicts Details */}
        {hasGitConflicts && mergePreview?.gitConflicts && (
          <div className="text-xs text-muted-foreground pl-6">
            Main branch has {mergePreview.gitConflicts.commitsBehind} new commit{mergePreview.gitConflicts.commitsBehind !== 1 ? 's' : ''}.
            {mergePreview.gitConflicts.conflictingFiles.length > 0 && (
              <span className="text-warning">
                {' '}{mergePreview.gitConflicts.conflictingFiles.length} file{mergePreview.gitConflicts.conflictingFiles.length !== 1 ? 's' : ''} need merging.
              </span>
            )}
          </div>
        )}

        {/* Branch Behind Details (no explicit conflicts but needs AI merge due to path mappings) */}
        {!hasGitConflicts && isBranchBehind && mergePreview?.gitConflicts && (
          <div className="text-xs text-muted-foreground pl-6">
            Target branch has {commitsBehind} new commit{commitsBehind !== 1 ? 's' : ''} since this build started.
            {hasPathMappedMerges ? (
              <span className="text-warning">
                {' '}{pathMappedAIMergeCount} file{pathMappedAIMergeCount !== 1 ? 's' : ''} need AI merge due to {totalRenames} file rename{totalRenames !== 1 ? 's' : ''}.
              </span>
            ) : totalRenames > 0 ? (
              <span className="text-warning"> {totalRenames} file rename{totalRenames !== 1 ? 's' : ''} detected - AI will handle the merge.</span>
            ) : (
              <span className="text-warning"> Files may have been renamed or moved - AI will handle the merge.</span>
            )}
          </div>
        )}
      </div>

      {/* Actions Footer */}
      <div className="px-4 py-3 bg-muted/20 border-t border-border space-y-3">
        {/* Stage Only Option - only show after conflicts have been checked */}
        {mergePreview && (
          <label className="inline-flex items-center gap-2.5 text-sm cursor-pointer select-none px-3 py-2 rounded-lg border border-border bg-background/50 hover:bg-background/80 transition-colors">
            <Checkbox
              checked={stageOnly}
              onCheckedChange={(checked) => onStageOnlyChange(checked === true)}
              className="border-muted-foreground/50 data-[state=checked]:border-primary"
            />
            <span className={cn(
              "transition-colors",
              stageOnly ? "text-foreground" : "text-muted-foreground"
            )}>Stage only (review in IDE before committing)</span>
          </label>
        )}

        {/* Primary Actions */}
        <div className="flex gap-2">
          {/* State 1: No merge preview yet - show "Check for Conflicts" */}
          {!mergePreview && !isLoadingPreview && (
            <Button
              variant="default"
              onClick={onLoadMergePreview}
              disabled={isMerging || isDiscarding}
              className="flex-1"
            >
              <GitMerge className="mr-2 h-4 w-4" />
              Check for Conflicts
            </Button>
          )}

          {autoMergeEnabled && !mergePreview && !isLoadingPreview && (
            <Button
              variant="success"
              onClick={onAutoMerge}
              disabled={isMerging || isDiscarding}
              className="flex-1"
            >
              <GitMerge className="mr-2 h-4 w-4" />
              Auto-merge now
            </Button>
          )}

          {/* State 2: Loading merge preview */}
          {isLoadingPreview && (
            <Button
              variant="default"
              disabled
              className="flex-1"
            >
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Checking for conflicts...
            </Button>
          )}

          {/* State 3: Merge preview loaded - show appropriate merge/stage button */}
          {mergePreview && !isLoadingPreview && (
            <Button
              variant={hasGitConflicts || isBranchBehind || hasPathMappedMerges ? "warning" : "success"}
              onClick={onMerge}
              disabled={isMerging || isDiscarding || hasUncommittedChanges || isMergeBlockedByTests}
              className="flex-1"
            >
              {isMerging ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {hasGitConflicts || isBranchBehind || hasPathMappedMerges ? 'Resolving...' : stageOnly ? 'Staging...' : 'Merging...'}
                </>
              ) : (
                <>
                  <GitMerge className="mr-2 h-4 w-4" />
                  {hasGitConflicts || isBranchBehind || hasPathMappedMerges
                    ? (stageOnly ? 'Stage with AI Merge' : 'Merge with AI')
                    : (stageOnly ? 'Stage to Main' : 'Merge to Main')}
                </>
              )}
            </Button>
          )}

          <Button
            variant="outline"
            size="icon"
            onClick={() => onShowDiscardDialog(true)}
            disabled={isMerging || isDiscarding}
            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 hover:border-destructive/30"
            title="Discard build"
          >
            <FolderX className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

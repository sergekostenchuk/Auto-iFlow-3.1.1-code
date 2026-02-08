import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';
import { cn } from '../lib/utils';
import type { Project, TabState } from '../../shared/types';

interface StartupRestoreDialogProps {
  open: boolean;
  projects: Project[];
  tabState: TabState | null;
  onRestore: (tabState: TabState) => void;
  onStartFresh: () => void;
  onOpenChange?: (open: boolean) => void;
}

export function StartupRestoreDialog({
  open,
  projects,
  tabState,
  onRestore,
  onStartFresh,
  onOpenChange
}: StartupRestoreDialogProps) {
  const { t } = useTranslation('dialogs');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const projectMap = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);

  const orderedIds = useMemo(() => {
    const baseOrder = tabState?.tabOrder?.length ? tabState.tabOrder : tabState?.openProjectIds ?? [];
    const openIds = tabState?.openProjectIds ?? [];
    return [...baseOrder, ...openIds.filter((id) => !baseOrder.includes(id))];
  }, [tabState]);

  const availableProjects = useMemo(
    () => orderedIds.map((id) => projectMap.get(id)).filter(Boolean) as Project[],
    [orderedIds, projectMap]
  );

  useEffect(() => {
    if (!open) return;
    const initialIds = availableProjects.map((project) => project.id);
    const preferredActive = tabState?.activeProjectId && initialIds.includes(tabState.activeProjectId)
      ? tabState.activeProjectId
      : initialIds[0] ?? null;
    setSelectedIds(initialIds);
    setActiveId(preferredActive);
  }, [open, availableProjects, tabState]);

  const handleToggleProject = (projectId: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = checked ? [...prev, projectId] : prev.filter((id) => id !== projectId);
      if (!checked && activeId === projectId) {
        setActiveId(next[0] ?? null);
      } else if (checked && !activeId) {
        setActiveId(projectId);
      }
      return next;
    });
  };

  const handleRestore = () => {
    if (!tabState) return;
    const orderedSelection = orderedIds.filter((id) => selectedIds.includes(id));
    const resolvedActive = activeId && orderedSelection.includes(activeId)
      ? activeId
      : orderedSelection[0] ?? null;
    onRestore({
      openProjectIds: orderedSelection,
      activeProjectId: resolvedActive,
      tabOrder: orderedSelection
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('startupRestore.title')}</DialogTitle>
          <DialogDescription>{t('startupRestore.description')}</DialogDescription>
        </DialogHeader>

        {availableProjects.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4">
            {t('startupRestore.empty')}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('startupRestore.tabsTitle')}
            </div>
            <div className="max-h-64 space-y-2 overflow-auto pr-1">
              <RadioGroup value={activeId ?? ''} onValueChange={setActiveId}>
                {availableProjects.map((project) => {
                  const isSelected = selectedIds.includes(project.id);
                  return (
                    <div
                      key={project.id}
                      className={cn(
                        'flex items-start gap-3 rounded-lg border p-3 transition-colors',
                        isSelected ? 'border-primary/40 bg-primary/5' : 'border-border'
                      )}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(value) => handleToggleProject(project.id, value === true)}
                        aria-label={t('startupRestore.selectProject', { name: project.name })}
                      />
                      <RadioGroupItem
                        value={project.id}
                        disabled={!isSelected}
                        aria-label={t('startupRestore.activeProject', { name: project.name })}
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">{project.name}</div>
                        <div className="text-xs text-muted-foreground truncate" title={project.path}>
                          {project.path}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </RadioGroup>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('startupRestore.note')}
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="ghost" onClick={onStartFresh}>
            {t('startupRestore.startFresh')}
          </Button>
          <Button
            type="button"
            onClick={handleRestore}
            disabled={selectedIds.length === 0}
          >
            {t('startupRestore.restore')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

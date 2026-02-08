import { useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { useToast } from '../../hooks/use-toast';
import { useModelRegistry } from '../model-routing/useModelRegistry';
import { ModelRoutingEditor } from '../model-routing/ModelRoutingEditor';
import { mergeRoutingWithFallback, normalizeRouting } from '../model-routing/model-routing-utils';
import { DEFAULT_MODEL_ROUTING, TASK_COMPLEXITY_LABELS } from '../../../shared/constants';
import { useSettingsStore, saveSettings } from '../../stores/settings-store';
import { useTaskStore } from '../../stores/task-store';
import type { ProjectEnvConfig, Task } from '../../../shared/types';
import type { ModelRegistryData, ModelRoutingSettings, ModelTier, ResolvedModelSnapshot } from '../../../shared/types/settings';

interface TaskModelRoutingProps {
  task: Task;
}

const COMPLEXITY_TIER: Record<string, ModelTier> = {
  simple: 'economy',
  trivial: 'economy',
  small: 'economy',
  standard: 'balanced',
  medium: 'balanced',
  large: 'premium',
  complex: 'premium'
};

const COMPLEXITY_ASSESSMENT_LABELS: Record<string, string> = {
  simple: 'Simple',
  standard: 'Standard',
  complex: 'Complex'
};

const formatResolvedSnapshot = (
  snapshot: ResolvedModelSnapshot,
  registry?: ModelRegistryData
): Array<{ label: string; value: string }> => {
  const displayName = (modelId: string) =>
    registry?.models.find((model) => model.id === modelId)?.displayName || modelId;

  return [
    { label: 'Spec', value: displayName(snapshot.spec) },
    { label: 'Planning', value: displayName(snapshot.planning) },
    { label: 'Coding', value: displayName(snapshot.coding) },
    { label: 'Validation', value: displayName(snapshot.validation) }
  ];
};

export function TaskModelRouting({ task }: TaskModelRoutingProps) {
  const { toast } = useToast();
  const { data, isLoading, error, reload } = useModelRegistry();
  const appSettings = useSettingsStore((state) => state.settings);
  const updateTask = useTaskStore((state) => state.updateTask);

  const [taskRouting, setTaskRouting] = useState<ModelRoutingSettings | null>(
    task.metadata?.modelRouting ?? null
  );
  const [projectEnv, setProjectEnv] = useState<ProjectEnvConfig | null>(null);
  const [routingError, setRoutingError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingRouting, setIsLoadingRouting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(
    appSettings.modelRoutingAdvanced ?? false
  );

  useEffect(() => {
    setShowAdvanced(appSettings.modelRoutingAdvanced ?? false);
  }, [appSettings.modelRoutingAdvanced]);

  useEffect(() => {
    let active = true;
    setIsLoadingRouting(true);
    setRoutingError(null);

    window.electronAPI
      .getTaskModelRouting(task.id)
      .then((result) => {
        if (!active) return;
        if (result.success) {
          setTaskRouting(result.data ?? null);
        } else {
          setRoutingError(result.error || 'Failed to load task model routing.');
        }
      })
      .catch((err) => {
        if (!active) return;
        setRoutingError(err instanceof Error ? err.message : 'Failed to load task model routing.');
      })
      .finally(() => {
        if (active) {
          setIsLoadingRouting(false);
        }
      });

    return () => {
      active = false;
    };
  }, [task.id]);

  useEffect(() => {
    let active = true;

    window.electronAPI
      .getProjectEnv(task.projectId)
      .then((result) => {
        if (!active) return;
        if (result.success && result.data) {
          setProjectEnv(result.data);
        }
      })
      .catch(() => {
        if (active) {
          setProjectEnv(null);
        }
      });

    return () => {
      active = false;
    };
  }, [task.projectId]);

  const routing = useMemo(
    () => normalizeRouting(taskRouting ?? DEFAULT_MODEL_ROUTING),
    [taskRouting]
  );
  const appRouting = useMemo(
    () => normalizeRouting(appSettings.modelRouting ?? DEFAULT_MODEL_ROUTING),
    [appSettings.modelRouting]
  );
  const parentRouting = useMemo(
    () => mergeRoutingWithFallback(normalizeRouting(projectEnv?.modelRouting), appRouting),
    [projectEnv?.modelRouting, appRouting]
  );
  const complexityKey =
    task.metadata?.complexityAssessment?.complexity ?? task.metadata?.complexity ?? null;
  const complexityLabel = useMemo(() => {
    if (task.metadata?.complexity) {
      return TASK_COMPLEXITY_LABELS[task.metadata.complexity] || task.metadata.complexity;
    }
    if (task.metadata?.complexityAssessment?.complexity) {
      return (
        COMPLEXITY_ASSESSMENT_LABELS[task.metadata.complexityAssessment.complexity] ||
        task.metadata.complexityAssessment.complexity
      );
    }
    return null;
  }, [task.metadata?.complexity, task.metadata?.complexityAssessment?.complexity]);
  const recommendationTier = useMemo(() => {
    if (!complexityKey) return null;
    return COMPLEXITY_TIER[complexityKey] ?? null;
  }, [complexityKey]);
  const resolvedSnapshot = task.metadata?.resolvedModel;
  const resolvedEntries = useMemo(() => {
    if (!resolvedSnapshot) return [];
    return formatResolvedSnapshot(resolvedSnapshot, data ?? undefined);
  }, [resolvedSnapshot, data]);

  const handleRoutingChange = async (next: ModelRoutingSettings) => {
    const previous = taskRouting;
    setTaskRouting(next);
    setIsSaving(true);
    setRoutingError(null);

    const result = await window.electronAPI.setTaskModelRouting(task.id, next);

    if (!result.success) {
      setTaskRouting(previous ?? null);
      const message = result.error || 'Failed to save task model routing.';
      setRoutingError(message);
      toast({
        title: 'Save failed',
        description: message
      });
    } else {
      updateTask(task.id, {
        metadata: {
          ...(task.metadata ?? {}),
          modelRouting: next
        }
      });
    }

    setIsSaving(false);
  };

  const handleToggleAdvanced = async (value: boolean) => {
    const previous = showAdvanced;
    setShowAdvanced(value);
    const success = await saveSettings({ modelRoutingAdvanced: value });
    if (!success) {
      setShowAdvanced(previous);
      toast({
        title: 'Failed to update advanced mode',
        description: 'Unable to save model routing preferences.'
      });
    }
  };

  if (isLoading || isLoadingRouting) {
    return (
      <div className="space-y-2 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading model routing...
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-3 text-sm text-muted-foreground">
        <p>{error || 'Unable to load model registry.'}</p>
        <Button variant="outline" size="sm" onClick={reload}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Task Model Routing</h3>
          <p className="text-xs text-muted-foreground">
            Override models for this task only. Changes apply on the next run.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {complexityLabel && (
            <Badge variant="outline" className="text-[10px]">
              Complexity: {complexityLabel}
            </Badge>
          )}
          {isSaving && (
            <Badge variant="secondary" className="text-[10px]">
              Saving...
            </Badge>
          )}
          {routingError && (
            <Badge variant="destructive" className="text-[10px]">
              Error
            </Badge>
          )}
        </div>
      </div>

      {resolvedEntries.length > 0 && (
        <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-xs">
          <div className="text-xs font-medium text-muted-foreground">
            Resolved models (snapshot when task started)
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {resolvedEntries.map((entry) => (
              <div key={entry.label} className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{entry.label}</span>
                <span className="text-foreground">{entry.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {routingError && (
        <div className="text-xs text-destructive">{routingError}</div>
      )}

      <ModelRoutingEditor
        routing={routing}
        onChange={handleRoutingChange}
        registry={data}
        parentRouting={parentRouting}
        allowInherit={true}
        inheritLabel="Inherit project/app defaults"
        sourceLabels={{
          self: 'Task override',
          parent: 'Project/app default',
          recommended: 'Recommended'
        }}
        recommendationTier={recommendationTier}
        showAdvanced={showAdvanced}
        onToggleAdvanced={handleToggleAdvanced}
      />
    </div>
  );
}

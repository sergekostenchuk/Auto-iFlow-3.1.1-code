import { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '../ui/button';
import { useSettingsStore } from '../../stores/settings-store';
import { useModelRegistry } from '../model-routing/useModelRegistry';
import { ModelRoutingEditor } from '../model-routing/ModelRoutingEditor';
import { normalizeRouting } from '../model-routing/model-routing-utils';
import { DEFAULT_MODEL_ROUTING } from '../../../shared/constants';
import type { ProjectEnvConfig } from '../../../shared/types';

interface ProjectModelRoutingSettingsProps {
  envConfig: ProjectEnvConfig | null;
  updateEnvConfig: (updates: Partial<ProjectEnvConfig>) => void;
}

export function ProjectModelRoutingSettings({
  envConfig,
  updateEnvConfig
}: ProjectModelRoutingSettingsProps) {
  const { data, isLoading, error, reload } = useModelRegistry();
  const appSettings = useSettingsStore((state) => state.settings);
  const [showAdvanced, setShowAdvanced] = useState(appSettings.modelRoutingAdvanced ?? false);

  useEffect(() => {
    setShowAdvanced(appSettings.modelRoutingAdvanced ?? false);
  }, [appSettings.modelRoutingAdvanced]);

  if (!envConfig) {
    return (
      <div className="text-sm text-muted-foreground">
        Initialize this project to configure model routing overrides.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading models...
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

  const routing = normalizeRouting(envConfig.modelRouting);
  const appRouting = normalizeRouting(appSettings.modelRouting ?? DEFAULT_MODEL_ROUTING);

  return (
    <ModelRoutingEditor
      routing={routing}
      onChange={(next) => updateEnvConfig({ modelRouting: next })}
      registry={data}
      parentRouting={appRouting}
      allowInherit={true}
      inheritLabel="Inherit app defaults"
      sourceLabels={{
        self: 'Project override',
        parent: 'App default',
        recommended: 'Recommended'
      }}
      showAdvanced={showAdvanced}
      onToggleAdvanced={setShowAdvanced}
    />
  );
}

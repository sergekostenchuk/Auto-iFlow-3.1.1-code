import { Loader2, RefreshCw } from 'lucide-react';
import { SettingsSection } from './SettingsSection';
import { Button } from '../ui/button';
import { useModelRegistry } from '../model-routing/useModelRegistry';
import { ModelRoutingEditor } from '../model-routing/ModelRoutingEditor';
import { normalizeRouting } from '../model-routing/model-routing-utils';
import { DEFAULT_MODEL_ROUTING } from '../../../shared/constants';
import type { AppSettings } from '../../../shared/types';

interface ModelRoutingSettingsProps {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
}

export function ModelRoutingSettings({ settings, onSettingsChange }: ModelRoutingSettingsProps) {
  const { data, isLoading, error, reload } = useModelRegistry();
  const routing = normalizeRouting(settings.modelRouting ?? DEFAULT_MODEL_ROUTING);
  const showAdvanced = settings.modelRoutingAdvanced ?? false;

  if (isLoading) {
    return (
      <SettingsSection
        title="Model Routing"
        description="Control which iFlow models run each phase and feature."
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading models...
        </div>
      </SettingsSection>
    );
  }

  if (!data) {
    return (
      <SettingsSection
        title="Model Routing"
        description="Control which iFlow models run each phase and feature."
      >
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>{error || 'Unable to load model registry.'}</p>
          <Button variant="outline" size="sm" onClick={reload}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        </div>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      title="Model Routing"
      description="Control which iFlow models run each phase and feature. Changes apply to new tasks."
    >
      <ModelRoutingEditor
        routing={routing}
        onChange={(next) => onSettingsChange({ ...settings, modelRouting: next })}
        registry={data}
        parentRouting={null}
        allowInherit={true}
        inheritLabel="Use recommended"
        sourceLabels={{
          self: 'App override',
          parent: 'Inherited',
          recommended: 'Recommended'
        }}
        showAdvanced={showAdvanced}
        onToggleAdvanced={(value) => onSettingsChange({ ...settings, modelRoutingAdvanced: value })}
      />
    </SettingsSection>
  );
}

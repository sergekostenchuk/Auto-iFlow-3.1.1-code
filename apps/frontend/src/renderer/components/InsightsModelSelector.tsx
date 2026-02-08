import { useState, useMemo } from 'react';
import { Brain, Scale, Zap, Sparkles, Sliders, Check } from 'lucide-react';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel
} from './ui/dropdown-menu';
import { DEFAULT_AGENT_PROFILES } from '../../shared/constants';
import type { InsightsModelConfig } from '../../shared/types';
import type { ModelRegistryEntry } from '../../shared/types/settings';
import { CustomModelModal } from './CustomModelModal';
import { useModelRegistry } from './model-routing/useModelRegistry';

interface InsightsModelSelectorProps {
  currentConfig?: InsightsModelConfig;
  onConfigChange: (config: InsightsModelConfig) => void;
  disabled?: boolean;
}

const iconMap: Record<string, React.ElementType> = {
  Brain,
  Scale,
  Zap,
  Sparkles
};

export function InsightsModelSelector({
  currentConfig,
  onConfigChange,
  disabled
}: InsightsModelSelectorProps) {
  const [showCustomModal, setShowCustomModal] = useState(false);
  const { data: registry, isLoading: isLoadingRegistry } = useModelRegistry();

  // Default to 'balanced' if no config, or if 'auto' profile was selected (not applicable for insights)
  const rawProfileId = currentConfig?.profileId || 'balanced';
  const selectedProfileId = rawProfileId === 'auto' ? 'balanced' : rawProfileId;
  const profiles = useMemo(
    () => DEFAULT_AGENT_PROFILES.filter((p) => p.id !== 'auto'),
    []
  );
  const profile = profiles.find(p => p.id === selectedProfileId);

  const modelOptions = useMemo<ModelRegistryEntry[]>(() => {
    if (!registry?.models) {
      if (currentConfig?.model) {
        return [{
          id: currentConfig.model,
          displayName: currentConfig.model,
          tier: 'experimental',
          supportsThinking: true
        }];
      }
      return [];
    }

    const options = [...registry.models];
    const currentModel = currentConfig?.model;
    if (currentModel) {
      const resolvedId = registry.legacyAliases[currentModel] ?? currentModel;
      const existing = options.find(
        (model) => model.id === resolvedId || model.aliases?.includes(currentModel)
      );
      if (!existing) {
        options.unshift({
          id: currentModel,
          displayName: `Missing: ${currentModel}`,
          tier: 'experimental',
          supportsThinking: true
        });
      }
    }

    return options;
  }, [currentConfig?.model, registry]);

  const resolveModelLabel = (modelId: string | undefined) => {
    if (!modelId) {
      return 'Unknown';
    }
    if (!registry) {
      return modelId;
    }
    const resolvedId = registry.legacyAliases[modelId] ?? modelId;
    const match = registry.models.find(
      (model) => model.id === resolvedId || model.aliases?.includes(modelId)
    );
    return match?.displayName || modelId;
  };

  // Get the appropriate icon
  const Icon = selectedProfileId === 'custom'
    ? Sliders
    : (profile?.icon ? iconMap[profile.icon] : Scale);

  const handleSelectProfile = (profileId: string) => {
    if (profileId === 'custom') {
      setShowCustomModal(true);
      return;
    }

    const selected = profiles.find(p => p.id === profileId);
    if (selected) {
      onConfigChange({
        profileId: selected.id,
        model: selected.model,
        thinkingLevel: selected.thinkingLevel
      });
    }
  };

  const handleCustomSave = (config: InsightsModelConfig) => {
    onConfigChange(config);
    setShowCustomModal(false);
  };

  // Build display text for current selection
  const getDisplayText = () => {
    if (selectedProfileId === 'custom' && currentConfig) {
      const modelLabel = resolveModelLabel(currentConfig.model);
      return `${modelLabel} + ${currentConfig.thinkingLevel}`;
    }
    return profile?.name || 'Balanced';
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-2 px-2"
            disabled={disabled}
            title={`Model: ${getDisplayText()}`}
          >
            <Icon className="h-4 w-4" />
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {getDisplayText()}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>Agent Profile</DropdownMenuLabel>
          {profiles.map((p) => {
            const ProfileIcon = iconMap[p.icon || 'Brain'];
            const isSelected = selectedProfileId === p.id;
            const modelLabel = resolveModelLabel(p.model);
            return (
              <DropdownMenuItem
                key={p.id}
                onClick={() => handleSelectProfile(p.id)}
                className="flex cursor-pointer items-center gap-2"
              >
                <ProfileIcon className="h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{p.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {modelLabel} + {p.thinkingLevel}
                  </div>
                </div>
                {isSelected && (
                  <Check className="h-4 w-4 shrink-0 text-primary" />
                )}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => handleSelectProfile('custom')}
            className="flex cursor-pointer items-center gap-2"
          >
            <Sliders className="h-4 w-4 shrink-0" />
            <div className="flex-1">
              <div className="font-medium">Custom...</div>
              <div className="text-xs text-muted-foreground">
                Choose model & thinking level
              </div>
            </div>
            {selectedProfileId === 'custom' && (
              <Check className="h-4 w-4 shrink-0 text-primary" />
            )}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CustomModelModal
        open={showCustomModal}
        currentConfig={currentConfig}
        modelOptions={modelOptions}
        isLoading={isLoadingRegistry}
        onSave={handleCustomSave}
        onClose={() => setShowCustomModal(false)}
      />
    </>
  );
}

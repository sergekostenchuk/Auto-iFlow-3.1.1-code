import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription
} from './ui/dialog';
import { Button } from './ui/button';
import { Label } from './ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from './ui/select';
import { THINKING_LEVELS } from '../../shared/constants';
import type { InsightsModelConfig } from '../../shared/types';
import type { ModelType, ThinkingLevel } from '../../shared/types';
import type { ModelRegistryEntry } from '../../shared/types/settings';

interface CustomModelModalProps {
  currentConfig?: InsightsModelConfig;
  onSave: (config: InsightsModelConfig) => void;
  onClose: () => void;
  open?: boolean;
  modelOptions: ModelRegistryEntry[];
  isLoading?: boolean;
}

export function CustomModelModal({
  currentConfig,
  onSave,
  onClose,
  open = true,
  modelOptions,
  isLoading = false
}: CustomModelModalProps) {
  const { t } = useTranslation('dialogs');
  const fallbackModelId = useMemo(
    () => currentConfig?.model || modelOptions[0]?.id || 'glm-4.7',
    [currentConfig?.model, modelOptions]
  );
  const selectOptions = useMemo(
    () => (modelOptions.length > 0
      ? modelOptions
      : [{
        id: fallbackModelId,
        displayName: fallbackModelId,
        tier: 'experimental',
        supportsThinking: true
      }]),
    [fallbackModelId, modelOptions]
  );
  const [model, setModel] = useState<ModelType>(
    fallbackModelId
  );
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(
    currentConfig?.thinkingLevel || 'medium'
  );

  // Sync internal state when modal opens or config changes
  useEffect(() => {
    if (open) {
      setModel(currentConfig?.model || fallbackModelId);
      setThinkingLevel(currentConfig?.thinkingLevel || 'medium');
    }
  }, [open, currentConfig, fallbackModelId]);

  const handleSave = () => {
    onSave({
      profileId: 'custom',
      model,
      thinkingLevel
    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('customModel.title')}</DialogTitle>
          <DialogDescription>
            {t('customModel.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="model-select">{t('customModel.model')}</Label>
            <Select value={model} onValueChange={(v) => setModel(v as ModelType)}>
              <SelectTrigger id="model-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {isLoading && (
                  <SelectItem value="__loading__" disabled>
                    Loading models...
                  </SelectItem>
                )}
                {selectOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="thinking-select">{t('customModel.thinkingLevel')}</Label>
            <Select value={thinkingLevel} onValueChange={(v) => setThinkingLevel(v as ThinkingLevel)}>
              <SelectTrigger id="thinking-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {THINKING_LEVELS.map((level) => (
                  <SelectItem key={level.value} value={level.value}>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{level.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {level.description}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('customModel.cancel')}
          </Button>
          <Button onClick={handleSave}>
            {t('customModel.apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

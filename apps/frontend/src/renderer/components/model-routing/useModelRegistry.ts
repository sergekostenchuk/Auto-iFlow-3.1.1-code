import { useCallback, useEffect, useState } from 'react';
import { useSettingsStore } from '../../stores/settings-store';
import type { ModelRegistryData } from '../../../shared/types/settings';

interface ModelRegistryState {
  data: ModelRegistryData | null;
  isLoading: boolean;
  error: string | null;
  reload: () => void;
}

export function useModelRegistry(): ModelRegistryState {
  const activeProfileId = useSettingsStore((state) => state.activeProfileId);
  const [data, setData] = useState<ModelRegistryData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRegistry = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.getModelRegistry();
      if (result.success && result.data) {
        setData(result.data);
      } else {
        setError(result.error || 'Failed to load model registry');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load model registry');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRegistry();
  }, [loadRegistry, activeProfileId]);

  return {
    data,
    isLoading,
    error,
    reload: loadRegistry
  };
}

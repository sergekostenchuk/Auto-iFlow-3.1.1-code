import { useState, useEffect } from 'react';
import { useSettingsStore } from '../../../stores/settings-store';

/**
 * Hook to check if the ideation feature has valid authentication.
 * This combines two sources of authentication:
 * 1. iFlow CLI auth (API key or web login)
 * 2. Active API profile (custom endpoint)
 *
 * @returns { hasToken, isLoading, error, checkAuth }
 * - hasToken: true if either iFlow auth exists OR active API profile is configured
 * - isLoading: true while checking authentication status
 * - error: any error that occurred during auth check
 * - checkAuth: function to manually re-check authentication status
 */
export function useIdeationAuth() {
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Get active API profile info from settings store
  const activeProfileId = useSettingsStore((state) => state.activeProfileId);

  const resolveHasAPIProfile = async (profileId?: string | null): Promise<boolean> => {
    // Trust the store when it's already populated to avoid extra IPC calls; fallback to IPC only when empty.
    if (profileId && profileId !== '') {
      return true;
    }

    try {
      const profilesResult = await window.electronAPI.getAPIProfiles();
      return Boolean(
        profilesResult.success &&
        profilesResult.data?.activeProfileId &&
        profilesResult.data.activeProfileId !== ''
      );
    } catch {
      return false;
    }
  };

  useEffect(() => {
    const performCheck = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const statusResult = await window.electronAPI.checkIflowStatus();
        const hasIflowAuth = Boolean(
          statusResult.success && (statusResult.data?.hasApiKey || statusResult.data?.hasWebLogin)
        );

        const hasAPIProfile = await resolveHasAPIProfile(activeProfileId);

        // Auth is valid if either iFlow auth or API profile exists
        setHasToken(Boolean(hasIflowAuth || hasAPIProfile));

        if (!statusResult.success && !hasAPIProfile) {
          setError(statusResult.error || 'Failed to check iFlow status');
        }
      } catch (err) {
        setHasToken(false);
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    };

    performCheck();
  }, [activeProfileId]);

  // Expose checkAuth for manual re-checks
  const checkAuth = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const statusResult = await window.electronAPI.checkIflowStatus();
      const hasIflowAuth = Boolean(
        statusResult.success && (statusResult.data?.hasApiKey || statusResult.data?.hasWebLogin)
      );

      const hasAPIProfile = await resolveHasAPIProfile(activeProfileId);

      setHasToken(Boolean(hasIflowAuth || hasAPIProfile));

      if (!statusResult.success && !hasAPIProfile) {
        setError(statusResult.error || 'Failed to check iFlow status');
      }
    } catch (err) {
      setHasToken(false);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  };

  return { hasToken, isLoading, error, checkAuth };
}

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  AlertCircle,
  Key,
  Loader2,
  CheckCircle2,
  Eye,
  EyeOff,
  Info,
  LogIn,
  ChevronDown,
  ChevronRight
} from 'lucide-react';
import { useSettingsStore, loadProfiles, saveSettings } from '../stores/settings-store';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from './ui/tooltip';
import { cn } from '../lib/utils';
import type { IFlowCliStatus } from '../../shared/types/cli';

interface EnvConfigModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfigured?: () => void;
  title?: string;
  description?: string;
  projectId?: string;
}

export function EnvConfigModal({
  open,
  onOpenChange,
  onConfigured,
  title = 'iFlow Authentication Required',
  description = 'Sign in to iFlow to use AI features like Ideation and Roadmap generation.',
  projectId: _projectId
}: EnvConfigModalProps) {
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [cliStatus, setCliStatus] = useState<IFlowCliStatus | null>(null);
  const [activeProfileName, setActiveProfileName] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const settings = useSettingsStore((state) => state.settings);
  const profiles = useSettingsStore((state) => state.profiles);
  const activeProfileId = useSettingsStore((state) => state.activeProfileId);

  const hasApiProfile = Boolean(activeProfileId);
  const hasApiKey = Boolean(cliStatus?.hasApiKey);
  const hasWebLogin = Boolean(cliStatus?.hasWebLogin);
  const hasAuth = hasApiKey || hasWebLogin || hasApiProfile;

  const clearPoll = useCallback(() => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const refreshStatus = useCallback(async (): Promise<IFlowCliStatus | null> => {
    setIsChecking(true);
    setError(null);

    try {
      const result = await window.electronAPI.checkIflowStatus();
      if (result.success && result.data) {
        setCliStatus(result.data);
        return result.data;
      }
      setError(result.error || 'Failed to check iFlow status');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check iFlow status');
    } finally {
      setIsChecking(false);
    }

    return null;
  }, []);

  const pollForWebLogin = useCallback((attemptsRemaining = 8) => {
    clearPoll();

    if (attemptsRemaining <= 0) {
      return;
    }

    pollRef.current = setTimeout(async () => {
      const status = await refreshStatus();
      if (!status?.hasWebLogin) {
        pollForWebLogin(attemptsRemaining - 1);
        return;
      }
      setIsAuthenticating(false);
      setSuccess(true);
      window.dispatchEvent(new Event('iflow-status-refresh'));
    }, 2000);
  }, [clearPoll, refreshStatus]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setSuccess(false);
    setApiKey(settings.globalIflowApiKey || '');
    setShowManualEntry(false);
    setIsAuthenticating(false);

    void loadProfiles();
    void refreshStatus();
  }, [open, refreshStatus, settings.globalIflowApiKey]);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (hasAuth) {
      setSuccess(true);
    } else {
      setSuccess(false);
    }
  }, [hasAuth, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const profile = profiles.find((item) => item.id === activeProfileId);
    setActiveProfileName(profile?.name ?? null);
  }, [open, profiles, activeProfileId]);

  useEffect(() => () => clearPoll(), [clearPoll]);

  const handleStartWebLogin = async () => {
    setIsAuthenticating(true);
    setError(null);

    try {
      const current = await refreshStatus();
      if (current?.hasWebLogin) {
        setSuccess(true);
        setIsAuthenticating(false);
        return;
      }

      const result = await window.electronAPI.startIflowWebLogin();
      if (!result.success) {
        setError(result.error || 'Failed to start iFlow web login');
        setIsAuthenticating(false);
        return;
      }

      if (result.data?.opened === false) {
        await refreshStatus();
        setSuccess(true);
        setIsAuthenticating(false);
        return;
      }

      pollForWebLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start iFlow web login');
      setIsAuthenticating(false);
    }
  };

  const handleSaveApiKey = async () => {
    if (!apiKey.trim()) {
      setError('Please enter an API key');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const saved = await saveSettings({ globalIflowApiKey: apiKey.trim() });
      if (!saved) {
        setError('Failed to save API key');
        setIsSaving(false);
        return;
      }

      await refreshStatus();
      setSuccess(true);
      setShowManualEntry(false);

      setTimeout(() => {
        onConfigured?.();
        onOpenChange(false);
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save API key');
    } finally {
      setIsSaving(false);
    }
  };

  const openAppSettings = (section: 'integrations' | 'api-profiles') => {
    window.dispatchEvent(new CustomEvent('open-app-settings', { detail: section }));
    onOpenChange(false);
  };

  const handleClose = () => {
    if (!isSaving && !isAuthenticating) {
      setApiKey('');
      setError(null);
      setSuccess(false);
      onOpenChange(false);
    }
  };

  const statusPill = (enabled: boolean, label: string) => (
    <span
      className={cn(
        'text-xs px-2 py-0.5 rounded inline-flex items-center gap-1',
        enabled ? 'bg-success/20 text-success' : 'bg-warning/20 text-warning'
      )}
    >
      {enabled ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
      {label}
    </span>
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <Key className="h-5 w-5" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {isChecking && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isChecking && success && (
          <div className="py-4">
            <div className="rounded-lg bg-success/10 border border-success/30 p-4 flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-success">
                  iFlow is configured
                </p>
                <p className="text-xs text-success/80 mt-1">
                  You can now use AI features like Ideation and Roadmap generation.
                </p>
              </div>
            </div>
          </div>
        )}

        {!isChecking && !success && (
          <div className="py-4 space-y-4">
            {error && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            <div className="space-y-3">
              <div className="rounded-lg bg-info/10 border border-info/30 p-4">
                <div className="flex items-start gap-3">
                  <Info className="h-5 w-5 text-info shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm text-foreground font-medium mb-1">
                      Web login
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Sign in via the iFlow CLI and authenticate with your browser.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {statusPill(hasWebLogin, hasWebLogin ? 'Web login configured' : 'Web login not configured')}
                {statusPill(hasApiKey, hasApiKey ? 'API key configured' : 'API key not configured')}
              </div>

              <Button
                onClick={handleStartWebLogin}
                disabled={isAuthenticating}
                className="w-full"
                size="lg"
              >
                {isAuthenticating ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Waiting for authentication...
                  </>
                ) : (
                  <>
                    <LogIn className="mr-2 h-5 w-5" />
                    Sign in via website
                  </>
                )}
              </Button>

              {isAuthenticating && (
                <p className="text-xs text-muted-foreground text-center">
                  Complete the login in the terminal window, then return here.
                </p>
              )}
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border"></div>
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">or</span>
              </div>
            </div>

            <div className="space-y-3">
              <button
                onClick={() => setShowManualEntry(!showManualEntry)}
                className="w-full flex items-center justify-between text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <span>Enter API key manually</span>
                {showManualEntry ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>

              {showManualEntry && (
                <div className="space-y-3 pl-4 border-l-2 border-border">
                  <div className="space-y-2">
                    <Label htmlFor="iflow-api-key" className="text-sm font-medium text-foreground">
                      iFlow API key
                    </Label>
                    <div className="relative">
                      <Input
                        id="iflow-api-key"
                        type={showApiKey ? 'text' : 'password'}
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="Enter your API key..."
                        className="pr-10 font-mono text-sm"
                        disabled={isSaving || isAuthenticating}
                      />
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => setShowApiKey(!showApiKey)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          >
                            {showApiKey ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {showApiKey ? 'Hide key' : 'Show key'}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Stored in Settings &gt; Integrations.
                    </p>
                  </div>

                  <Button
                    onClick={handleSaveApiKey}
                    disabled={isSaving || isAuthenticating}
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Key className="mr-2 h-4 w-4" />
                        Save API key
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border"></div>
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">or</span>
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-lg bg-muted/50 p-4">
                <p className="text-sm text-foreground font-medium mb-1">API profiles</p>
                <p className="text-xs text-muted-foreground">
                  {hasApiProfile
                    ? `Active profile: ${activeProfileName || 'Configured profile'}.`
                    : 'Configure an API profile to use a custom endpoint.'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => openAppSettings('api-profiles')}
                >
                  Manage API profiles
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => openAppSettings('integrations')}
                >
                  Open integrations
                </Button>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isSaving || isAuthenticating}>
            {success ? 'Close' : 'Cancel'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Hook to check if iFlow auth is configured (web login, API key, or API profile).
 */
export function useIflowAuthCheck() {
  const [hasAuth, setHasAuth] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const activeProfileId = useSettingsStore((state) => state.activeProfileId);

  const checkAuth = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const hasApiProfile = Boolean(activeProfileId);

    try {
      const result = await window.electronAPI.checkIflowStatus();
      const hasIflowAuth = Boolean(
        result.success && (result.data?.hasApiKey || result.data?.hasWebLogin)
      );

      setHasAuth(hasIflowAuth || hasApiProfile);

      if (!result.success && !hasApiProfile) {
        setError(result.error || 'Failed to check iFlow status');
      }
    } catch (err) {
      setHasAuth(hasApiProfile);
      if (!hasApiProfile) {
        setError(err instanceof Error ? err.message : 'Failed to check iFlow status');
      }
    } finally {
      setIsLoading(false);
    }
  }, [activeProfileId]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  return { hasAuth, isLoading, error, checkAuth };
}

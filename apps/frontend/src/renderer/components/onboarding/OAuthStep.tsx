import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle2, Loader2, LogIn, Terminal } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { cn } from '../../lib/utils';
import type { IFlowCliStatus } from '../../../shared/types/cli';

interface OAuthStepProps {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

export function OAuthStep({ onNext, onBack, onSkip }: OAuthStepProps) {
  const { t } = useTranslation('onboarding');
  const [cliStatus, setCliStatus] = useState<IFlowCliStatus | null>(null);
  const [isChecking, setIsChecking] = useState(true);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasWebLogin = Boolean(cliStatus?.hasWebLogin);
  const hasApiKey = Boolean(cliStatus?.hasApiKey);
  const hasAuth = hasWebLogin || hasApiKey;
  const hasCli = Boolean(cliStatus?.installed);

  const clearPoll = useCallback(() => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const refreshStatus = useCallback(async () => {
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
    }, 2000);
  }, [clearPoll, refreshStatus]);

  const handleWebLogin = async () => {
    setIsAuthenticating(true);
    setError(null);

    try {
      const current = await refreshStatus();
      if (current?.hasWebLogin) {
        setIsAuthenticating(false);
        return;
      }

      const result = await window.electronAPI.startIflowWebLogin();
      if (!result.success) {
        setError(result.error || 'Failed to start iFlow web login');
        setIsAuthenticating(false);
        return;
      }

      pollForWebLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start iFlow web login');
      setIsAuthenticating(false);
    }
  };

  useEffect(() => {
    refreshStatus();
    return () => clearPoll();
  }, [refreshStatus, clearPoll]);

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
    <div className="flex h-full flex-col items-center justify-center px-8 py-6">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <LogIn className="h-7 w-7" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">
            Sign in to iFlow
          </h1>
          <p className="mt-2 text-muted-foreground">
            Authenticate with the iFlow CLI to enable AI features.
          </p>
        </div>

        <div className="space-y-6">
          {!hasCli && !isChecking && (
            <Card className="border border-warning/30 bg-warning/10">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <Terminal className="h-5 w-5 text-warning mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-foreground">iFlow CLI not detected</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Install it with <code className="px-1 bg-muted rounded">npm i -g iflow</code> and try again.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="border border-border bg-card/50">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Status</p>
                  <p className="text-xs text-muted-foreground">Web login or API key is required.</p>
                </div>
                {isChecking && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {statusPill(hasWebLogin, hasWebLogin ? 'Web login configured' : 'Web login not configured')}
                {statusPill(hasApiKey, hasApiKey ? 'API key configured' : 'API key not configured')}
              </div>

              {error && (
                <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              <Button
                onClick={handleWebLogin}
                disabled={isAuthenticating || isChecking || !hasCli}
                className="w-full"
              >
                {isAuthenticating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Waiting for authentication...
                  </>
                ) : (
                  <>Sign in via website</>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="flex justify-between items-center mt-10 pt-6 border-t border-border">
          <Button variant="ghost" onClick={onBack}>
            {t('common:back', 'Back')}
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onSkip}>
              {t('common:skip', 'Skip for now')}
            </Button>
            <Button onClick={onNext} disabled={!hasAuth}>
              {t('common:continue', 'Continue')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

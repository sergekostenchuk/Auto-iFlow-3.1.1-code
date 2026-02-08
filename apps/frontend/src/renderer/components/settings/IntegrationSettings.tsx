import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Key,
  Eye,
  EyeOff,
  Info,
  Link2,
  Check,
  X,
  Loader2
} from 'lucide-react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { toast } from '../../hooks/use-toast';
import { SettingsSection } from './SettingsSection';
import type { AppSettings } from '../../../shared/types';

interface IntegrationSettingsProps {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  isOpen: boolean;
}

/**
 * Integration settings for iFlow and API keys
 */
export function IntegrationSettings({ settings, onSettingsChange, isOpen }: IntegrationSettingsProps) {
  const { t } = useTranslation('settings');
  // Password visibility toggle for global API keys
  const [showIflowKey, setShowIflowKey] = useState(false);
  const [showGlobalOpenAIKey, setShowGlobalOpenAIKey] = useState(false);
  const [isWebLoginPending, setIsWebLoginPending] = useState(false);
  const [isResetPending, setIsResetPending] = useState(false);
  const [webLoginConfigured, setWebLoginConfigured] = useState<boolean | null>(null);
  const [cliApiKeyConfigured, setCliApiKeyConfigured] = useState<boolean | null>(null);
  const webLoginPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasIflowKey = Boolean(settings.globalIflowApiKey?.trim()) || Boolean(cliApiKeyConfigured);
  const webLoginStatusLabel = webLoginConfigured === null
    ? t('integrations.iflowWebLoginChecking')
    : webLoginConfigured
      ? t('integrations.iflowConnected')
      : t('integrations.iflowNotConfigured');
  const webLoginStatusClass = cn(
    'text-xs px-2 py-0.5 rounded inline-flex items-center gap-1',
    webLoginConfigured === null
      ? 'bg-muted/60 text-muted-foreground'
      : webLoginConfigured
        ? 'bg-success/20 text-success'
        : 'bg-warning/20 text-warning'
  );
  const webLoginStatusIcon = webLoginConfigured === null
    ? <Loader2 className="h-3 w-3 animate-spin" />
    : webLoginConfigured
      ? <Check className="h-3 w-3" />
      : <X className="h-3 w-3" />;

  const clearWebLoginPoll = useCallback(() => {
    if (webLoginPollRef.current) {
      clearTimeout(webLoginPollRef.current);
      webLoginPollRef.current = null;
    }
  }, []);

  const refreshWebLoginStatus = useCallback(async (): Promise<boolean> => {
    if (!window.electronAPI?.checkIflowStatus) {
      setWebLoginConfigured(false);
      return false;
    }

    try {
      const result = await window.electronAPI.checkIflowStatus();
      if (result.success && result.data) {
        const configured = Boolean(result.data.hasWebLogin);
        setWebLoginConfigured(configured);
        setCliApiKeyConfigured(Boolean(result.data.hasApiKey));
        window.dispatchEvent(new Event('iflow-status-refresh'));
        return configured;
      }
    } catch (error) {
      console.error('Failed to check iFlow status:', error);
    }

    setWebLoginConfigured(false);
    setCliApiKeyConfigured(false);
    window.dispatchEvent(new Event('iflow-status-refresh'));
    return false;
  }, []);

  const pollForWebLogin = useCallback((attemptsRemaining = 8) => {
    clearWebLoginPoll();

    if (attemptsRemaining <= 0) {
      return;
    }

    webLoginPollRef.current = setTimeout(async () => {
      const configured = await refreshWebLoginStatus();
      if (!configured) {
        pollForWebLogin(attemptsRemaining - 1);
      }
    }, 2000);
  }, [clearWebLoginPoll, refreshWebLoginStatus]);

  useEffect(() => {
    if (isOpen) {
      setWebLoginConfigured(null);
      void refreshWebLoginStatus();
    }
  }, [isOpen, refreshWebLoginStatus]);

  useEffect(() => () => clearWebLoginPoll(), [clearWebLoginPoll]);

  const handleWebLogin = async () => {
    if (!window.electronAPI?.startIflowWebLogin) {
      toast({
        variant: 'destructive',
        title: t('integrations.iflowWebLoginErrorTitle'),
        description: t('integrations.iflowWebLoginErrorDescription')
      });
      return;
    }

    setIsWebLoginPending(true);
    try {
      if (window.electronAPI?.checkIflowStatus) {
        const status = await window.electronAPI.checkIflowStatus();
        if (status.success && status.data?.hasWebLogin) {
          setWebLoginConfigured(true);
          toast({
            title: t('integrations.iflowWebLoginAlreadyTitle'),
            description: t('integrations.iflowWebLoginAlreadyDescription')
          });
          window.dispatchEvent(new Event('iflow-status-refresh'));
          return;
        }
      }

      const result = await window.electronAPI.startIflowWebLogin();
      if (!result.success) {
        toast({
          variant: 'destructive',
          title: t('integrations.iflowWebLoginErrorTitle'),
          description: result.error || t('integrations.iflowWebLoginErrorDescription')
        });
      } else {
        if (result.data?.opened === false) {
          setWebLoginConfigured(true);
          toast({
            title: t('integrations.iflowWebLoginAlreadyTitle'),
            description: t('integrations.iflowWebLoginAlreadyDescription')
          });
        } else {
          toast({
            title: t('integrations.iflowWebLoginToastTitle'),
            description: t('integrations.iflowWebLoginToastDescription')
          });
          setWebLoginConfigured(null);
          pollForWebLogin();
        }
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: t('integrations.iflowWebLoginErrorTitle'),
        description: error instanceof Error ? error.message : t('integrations.iflowWebLoginErrorDescription')
      });
    } finally {
      setIsWebLoginPending(false);
    }
  };

  const handleResetOAuth = async () => {
    if (!window.electronAPI?.resetIflowOAuth) {
      toast({
        variant: 'destructive',
        title: t('integrations.iflowWebLogoutErrorTitle'),
        description: t('integrations.iflowWebLogoutErrorDescription')
      });
      return;
    }

    setIsResetPending(true);
    try {
      const result = await window.electronAPI.resetIflowOAuth();
      if (!result.success) {
        toast({
          variant: 'destructive',
          title: t('integrations.iflowWebLogoutErrorTitle'),
          description: result.error || t('integrations.iflowWebLogoutErrorDescription')
        });
      } else {
        toast({
          title: t('integrations.iflowWebLogoutToastTitle'),
          description: t('integrations.iflowWebLogoutToastDescription')
        });
        clearWebLoginPoll();
        void refreshWebLoginStatus();
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: t('integrations.iflowWebLogoutErrorTitle'),
        description: error instanceof Error ? error.message : t('integrations.iflowWebLogoutErrorDescription')
      });
    } finally {
      setIsResetPending(false);
    }
  };

  return (
    <SettingsSection
      title={t('integrations.title')}
      description={t('integrations.description')}
    >
      <div className="space-y-6">
        {/* iFlow Section */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-muted-foreground" />
            <h4 className="text-sm font-semibold text-foreground">{t('integrations.iflow')}</h4>
          </div>

          <div className="rounded-lg bg-muted/30 border border-border p-4">
            <p className="text-sm text-muted-foreground mb-4">
              {t('integrations.iflowDescription')}
            </p>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="globalIflowKey" className="text-sm font-medium text-foreground">
                  {t('integrations.iflowApiKey')}
                </Label>
                <span
                  className={cn(
                    'text-xs px-2 py-0.5 rounded inline-flex items-center gap-1',
                    hasIflowKey ? 'bg-success/20 text-success' : 'bg-warning/20 text-warning'
                  )}
                >
                  {hasIflowKey ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                  {hasIflowKey
                    ? t('integrations.iflowConnected')
                    : t('integrations.iflowNotConfigured')}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('integrations.iflowApiKeyDescription')}
              </p>
              <div className="relative max-w-lg">
                <Input
                  id="globalIflowKey"
                  type={showIflowKey ? 'text' : 'password'}
                  placeholder={t('integrations.iflowApiKeyPlaceholder')}
                  value={settings.globalIflowApiKey || ''}
                  onChange={(e) =>
                    onSettingsChange({ ...settings, globalIflowApiKey: e.target.value || undefined })
                  }
                  className="pr-10 font-mono text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowIflowKey(!showIflowKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showIflowKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium text-foreground">
                  {t('integrations.iflowWebLoginTitle')}
                </Label>
                <span className={webLoginStatusClass}>
                  {webLoginStatusIcon}
                  {webLoginStatusLabel}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('integrations.iflowWebLoginDescription')}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  className="gap-2"
                  onClick={handleWebLogin}
                  disabled={isWebLoginPending}
                  type="button"
                >
                  {isWebLoginPending && <Loader2 className="h-3 w-3 animate-spin" />}
                  {t('integrations.iflowWebLoginButton')}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="gap-2"
                  onClick={handleResetOAuth}
                  disabled={isResetPending}
                  type="button"
                >
                  {isResetPending && <Loader2 className="h-3 w-3 animate-spin" />}
                  {t('integrations.iflowWebLogoutButton')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('integrations.iflowWebLoginHint')}
              </p>
            </div>
          </div>
        </div>

        {/* API Keys Section */}
        <div className="space-y-4 pt-4 border-t border-border">
          <div className="flex items-center gap-2">
            <Key className="h-4 w-4 text-muted-foreground" />
            <h4 className="text-sm font-semibold text-foreground">{t('integrations.apiKeys')}</h4>
          </div>

          <div className="rounded-lg bg-info/10 border border-info/30 p-3">
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 text-info shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                {t('integrations.apiKeysInfo')}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="globalOpenAIKey" className="text-sm font-medium text-foreground">
                {t('integrations.openaiKey')}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t('integrations.openaiKeyDescription')}
              </p>
              <div className="relative max-w-lg">
                <Input
                  id="globalOpenAIKey"
                  type={showGlobalOpenAIKey ? 'text' : 'password'}
                  placeholder="sk-..."
                  value={settings.globalOpenAIApiKey || ''}
                  onChange={(e) =>
                    onSettingsChange({ ...settings, globalOpenAIApiKey: e.target.value || undefined })
                  }
                  className="pr-10 font-mono text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowGlobalOpenAIKey(!showGlobalOpenAIKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showGlobalOpenAIKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Check, AlertTriangle, X, Loader2, RefreshCw } from 'lucide-react';
import { Button } from './ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from './ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from './ui/tooltip';
import { cn } from '../lib/utils';
import type { IFlowCliStatus } from '../../shared/types/cli';
import { useSettingsStore } from '../stores/settings-store';

interface IFlowStatusBadgeProps {
  className?: string;
}

type StatusType = 'loading' | 'ready' | 'missing-cli' | 'missing-key' | 'error';

// Check every 24 hours
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * iFlow CLI status badge for the sidebar.
 * Shows installation status and API key readiness.
 */
export function IFlowStatusBadge({ className }: IFlowStatusBadgeProps) {
  const { t } = useTranslation(['common', 'navigation']);
  const settings = useSettingsStore((state) => state.settings);
  const [status, setStatus] = useState<StatusType>('loading');
  const [cliInfo, setCliInfo] = useState<IFlowCliStatus | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  // Check iFlow CLI status
  const checkStatus = useCallback(async () => {
    try {
      if (!window.electronAPI?.checkIflowStatus) {
        setStatus('error');
        return;
      }

      const result = await window.electronAPI.checkIflowStatus();

      if (result.success && result.data) {
        setCliInfo(result.data);
        setLastChecked(new Date());
        const hasAuth = Boolean(result.data.hasApiKey || result.data.hasWebLogin);

        if (!result.data.installed) {
          setStatus('missing-cli');
        } else if (!hasAuth) {
          setStatus('missing-key');
        } else {
          setStatus('ready');
        }
      } else {
        setStatus('error');
      }
    } catch (err) {
      console.error('Failed to check iFlow status:', err);
      setStatus('error');
    }
  }, []);

  // Initial check and periodic re-check
  useEffect(() => {
    checkStatus();

    const interval = setInterval(() => {
      checkStatus();
    }, CHECK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [checkStatus]);

  // Re-check when API key changes
  useEffect(() => {
    if (status !== 'loading') {
      checkStatus();
    }
  }, [settings.globalIflowApiKey, checkStatus, status]);

  // Re-check when the app regains focus (e.g., after CLI auth in a terminal)
  useEffect(() => {
    const handleFocus = () => {
      checkStatus();
    };
    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, [checkStatus]);

  // Re-check when other UI flows request a refresh
  useEffect(() => {
    const handleRefresh = () => {
      checkStatus();
    };
    window.addEventListener('iflow-status-refresh', handleRefresh);
    return () => {
      window.removeEventListener('iflow-status-refresh', handleRefresh);
    };
  }, [checkStatus]);

  // Get status indicator color
  const getStatusColor = () => {
    switch (status) {
      case 'ready':
        return 'bg-green-500';
      case 'missing-key':
        return 'bg-yellow-500';
      case 'missing-cli':
      case 'error':
        return 'bg-destructive';
      default:
        return 'bg-muted-foreground';
    }
  };

  const getAuthLabel = () => {
    if (cliInfo?.authType === 'oauth-iflow') {
      return t('navigation:iflow.authTypeWeb', 'Web login');
    }
    if (cliInfo?.authType === 'iflow') {
      return t('navigation:iflow.authTypeApiKey', 'API key');
    }
    if (cliInfo?.authType === 'openai-compatible') {
      return t('navigation:iflow.authTypeOpenAI', 'OpenAI-compatible');
    }
    if (cliInfo?.authType) {
      return cliInfo.authType;
    }
    if (cliInfo?.hasWebLogin) {
      return t('navigation:iflow.authTypeWeb', 'Web login');
    }
    if (cliInfo?.hasApiKey) {
      return t('navigation:iflow.authTypeApiKey', 'API key');
    }
    return t('navigation:iflow.authTypeUnknown', 'Unknown');
  };

  // Get status icon
  const getStatusIcon = () => {
    switch (status) {
      case 'loading':
        return <Loader2 className="h-3 w-3 animate-spin" />;
      case 'ready':
        return <Check className="h-3 w-3" />;
      case 'missing-key':
        return <AlertTriangle className="h-3 w-3" />;
      case 'missing-cli':
        return <X className="h-3 w-3" />;
      case 'error':
        return <AlertTriangle className="h-3 w-3" />;
    }
  };

  // Get tooltip text
  const getTooltipText = () => {
    switch (status) {
      case 'loading':
        return t('navigation:iflow.checking', 'Checking iFlow...');
      case 'ready':
        return t('navigation:iflow.ready', 'iFlow is ready');
      case 'missing-cli':
        return t('navigation:iflow.cliMissing', 'iFlow CLI not installed');
      case 'missing-key':
        return t('navigation:iflow.keyMissing', 'iFlow API key not configured');
      case 'error':
        return t('navigation:iflow.error', 'Error checking iFlow');
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'w-full justify-start gap-2 text-xs',
                status === 'missing-cli' || status === 'error' ? 'text-destructive' : '',
                status === 'missing-key' ? 'text-yellow-600 dark:text-yellow-500' : '',
                className
              )}
            >
              <div className="relative">
                <Activity className="h-4 w-4" />
                <span className={cn(
                  'absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full',
                  getStatusColor()
                )} />
              </div>
              <span className="truncate">iFlow</span>
              {status === 'missing-cli' && (
                <span className="ml-auto text-[10px] bg-destructive/20 text-destructive px-1.5 py-0.5 rounded">
                  {t('common:install', 'Install')}
                </span>
              )}
              {status === 'missing-key' && (
                <span className="ml-auto text-[10px] bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 px-1.5 py-0.5 rounded">
                  {t('navigation:iflow.configure', 'Configure')}
                </span>
              )}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">
          {getTooltipText()}
        </TooltipContent>
      </Tooltip>

      <PopoverContent side="right" align="end" className="w-72">
        <div className="space-y-3">
          {/* Header */}
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <Activity className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h4 className="text-sm font-medium">iFlow</h4>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                {getStatusIcon()}
                {status === 'ready' && t('navigation:iflow.ready', 'iFlow is ready')}
                {status === 'missing-key' && t('navigation:iflow.keyMissing', 'API key not configured')}
                {status === 'missing-cli' && t('navigation:iflow.cliMissing', 'iFlow CLI not installed')}
                {status === 'loading' && t('navigation:iflow.checking', 'Checking iFlow...')}
                {status === 'error' && t('navigation:iflow.error', 'Error')}
              </p>
            </div>
          </div>

          {/* Status details */}
          <div className="text-xs space-y-1 p-2 bg-muted rounded-md">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('navigation:iflow.authType', 'Auth')}:</span>
              <span>{getAuthLabel()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('navigation:iflow.apiKey', 'API key')}:</span>
              <span className={cn(cliInfo?.hasApiKey ? 'text-success' : 'text-warning')}>
                {cliInfo?.hasApiKey
                  ? t('navigation:iflow.configured', 'Configured')
                  : t('navigation:iflow.notConfigured', 'Not configured')}
              </span>
            </div>
            {(cliInfo?.authType === 'oauth-iflow' || cliInfo?.hasWebLogin) && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('navigation:iflow.webLogin', 'Web login')}:</span>
                <span className={cn(cliInfo?.hasWebLogin ? 'text-success' : 'text-warning')}>
                  {cliInfo?.hasWebLogin
                    ? t('navigation:iflow.configured', 'Configured')
                    : t('navigation:iflow.notConfigured', 'Not configured')}
                </span>
              </div>
            )}
            {cliInfo?.installed && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('navigation:iflow.version', 'Version')}:</span>
                <span className="font-mono">{cliInfo.installed}</span>
              </div>
            )}
            {cliInfo?.permissionMode && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('navigation:iflow.permissionMode', 'Permission')}:</span>
                <span className="font-mono">{cliInfo.permissionMode}</span>
              </div>
            )}
            {settings.defaultModel && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('navigation:iflow.model', 'Model')}:</span>
                <span className="font-mono">{settings.defaultModel}</span>
              </div>
            )}
            {lastChecked && (
              <div className="flex justify-between text-muted-foreground">
                <span>{t('navigation:iflow.lastChecked', 'Last checked')}:</span>
                <span>{lastChecked.toLocaleTimeString()}</span>
              </div>
            )}
          </div>

          {status === 'missing-key' && (
            <p className="text-xs text-muted-foreground">
              {t('navigation:iflow.configureHint', 'Add your iFlow API key in Settings → Integrations.')}
            </p>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => checkStatus()}
              disabled={status === 'loading'}
            >
              <RefreshCw className={cn('h-3 w-3', status === 'loading' && 'animate-spin')} />
              {t('common:refresh', 'Refresh')}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

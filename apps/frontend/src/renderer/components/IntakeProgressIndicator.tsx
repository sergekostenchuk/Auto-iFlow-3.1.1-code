import { Loader2, CheckCircle2, AlertTriangle, HelpCircle, Circle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';

interface IntakeProgressIndicatorProps {
  phase: 'idle' | 'analyzing' | 'completed' | 'needs_clarify' | 'blocked';
}

export function IntakeProgressIndicator({ phase }: IntakeProgressIndicatorProps) {
  const { t } = useTranslation('tasks');

  const config = {
    idle: { icon: Circle, label: t('wizard.intake.status.idle'), className: 'text-muted-foreground' },
    analyzing: { icon: Loader2, label: t('wizard.intake.status.analyzing'), className: 'text-info' },
    completed: { icon: CheckCircle2, label: t('wizard.intake.status.completed'), className: 'text-success' },
    needs_clarify: { icon: HelpCircle, label: t('wizard.intake.status.needsClarify'), className: 'text-warning' },
    blocked: { icon: AlertTriangle, label: t('wizard.intake.status.blocked'), className: 'text-destructive' }
  }[phase];

  const Icon = config.icon;

  return (
    <div className={cn('flex items-center gap-2 text-xs', config.className)}>
      <Icon className={cn('h-3.5 w-3.5', phase === 'analyzing' && 'animate-spin')} />
      <span>{config.label}</span>
    </div>
  );
}

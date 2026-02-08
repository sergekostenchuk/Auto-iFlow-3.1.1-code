import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Upload, CheckCircle2, AlertCircle, FileText } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../ui/select';
import { loadTasks } from '../../stores/task-store';
import type { TaskPlanImportResult } from '../../../shared/types';
import { DEFAULT_AGENT_PROFILES } from '../../../shared/constants/models';

interface PlanImportSectionProps {
  projectId: string;
}

type AgentPipelineStage = 'parser' | 'decomposer' | 'normalizer' | 'scheduler';

const DEFAULT_AGENT_PROFILE_ID = DEFAULT_AGENT_PROFILES[0]?.id ?? 'auto';

export function PlanImportSection({ projectId }: PlanImportSectionProps) {
  const { t } = useTranslation('settings');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [planPath, setPlanPath] = useState('');
  const [autoStart, setAutoStart] = useState(false);
  const [maxConcurrency, setMaxConcurrency] = useState('');
  const [useAgentPipeline, setUseAgentPipeline] = useState(false);
  const [agentProfiles, setAgentProfiles] = useState<Record<AgentPipelineStage, string>>({
    parser: DEFAULT_AGENT_PROFILE_ID,
    decomposer: DEFAULT_AGENT_PROFILE_ID,
    normalizer: DEFAULT_AGENT_PROFILE_ID,
    scheduler: DEFAULT_AGENT_PROFILE_ID
  });
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TaskPlanImportResult | null>(null);
  const agentProfileMap = useMemo(() => {
    return new Map(DEFAULT_AGENT_PROFILES.map((profile) => [profile.id, profile]));
  }, []);

  const handleBrowse = async () => {
    if (window.electronAPI?.selectFile) {
      const selectedPath = await window.electronAPI.selectFile();
      if (selectedPath) {
        setPlanPath(selectedPath);
        setError(null);
      }
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const filePath = (file as { path?: string }).path;
    if (!filePath) {
      setError(t('projectSections.plan-import.filePathUnavailable'));
      setPlanPath(file.name);
      return;
    }

    setPlanPath(filePath);
    setError(null);
  };

  const handleImport = async () => {
    if (!planPath.trim()) return;

    setIsImporting(true);
    setError(null);
    setResult(null);

    const maxConcurrencyValue = Number(maxConcurrency);
    const maxConcurrencyOption = Number.isFinite(maxConcurrencyValue) && maxConcurrencyValue > 0
      ? maxConcurrencyValue
      : undefined;
    const agentPipelineOption = useAgentPipeline
      ? {
        enabled: true,
        agents: {
          parserProfileId: agentProfiles.parser,
          decomposerProfileId: agentProfiles.decomposer,
          normalizerProfileId: agentProfiles.normalizer,
          schedulerProfileId: agentProfiles.scheduler
        }
      }
      : undefined;

    try {
      const response = await window.electronAPI.importTaskPlan(projectId, planPath.trim(), {
        autoStart,
        maxConcurrency: maxConcurrencyOption,
        agentPipeline: agentPipelineOption
      });

      if (!response.success || !response.data) {
        setError(response.error || t('projectSections.plan-import.importFailed'));
        return;
      }

      setResult(response.data);

      if (response.data.createdTaskIds.length > 0) {
        await loadTasks(projectId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('projectSections.plan-import.importFailed'));
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-4">
        <div className="flex items-start gap-3">
          <FileText className="h-5 w-5 text-info mt-0.5" />
          <div>
            <p className="text-sm font-medium text-foreground">{t('projectSections.plan-import.title')}</p>
            <p className="text-xs text-muted-foreground">
              {t('projectSections.plan-import.description')}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium text-foreground">{t('projectSections.plan-import.planFile')}</Label>
          <div className="flex gap-2">
            <Input
              placeholder={t('projectSections.plan-import.planFilePlaceholder')}
              value={planPath}
              onChange={(event) => {
                setPlanPath(event.target.value);
                setError(null);
              }}
            />
            <Button type="button" variant="outline" onClick={handleBrowse}>
              <Upload className="h-4 w-4 mr-2" />
              {t('projectSections.plan-import.browse')}
            </Button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.markdown"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>

        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-3">
            <Switch
              checked={autoStart}
              onCheckedChange={setAutoStart}
            />
            <div>
              <p className="text-sm font-medium text-foreground">{t('projectSections.plan-import.autoStart')}</p>
              <p className="text-xs text-muted-foreground">{t('projectSections.plan-import.autoStartHint')}</p>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t('projectSections.plan-import.maxConcurrency')}</Label>
            <Input
              type="number"
              min="1"
              placeholder={t('projectSections.plan-import.maxConcurrencyPlaceholder')}
              value={maxConcurrency}
              onChange={(event) => setMaxConcurrency(event.target.value)}
              className="w-32"
            />
          </div>
        </div>

        <div className="rounded-md border border-border/60 bg-background/40 p-3 space-y-4">
          <div className="flex items-start gap-3">
            <Switch checked={useAgentPipeline} onCheckedChange={setUseAgentPipeline} />
            <div>
              <p className="text-sm font-medium text-foreground">{t('projectSections.plan-import.useAgentPipeline')}</p>
              <p className="text-xs text-muted-foreground">{t('projectSections.plan-import.useAgentPipelineHint')}</p>
            </div>
          </div>

          {useAgentPipeline && (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                {([
                  { key: 'parser', label: t('projectSections.plan-import.agentParser') },
                  { key: 'decomposer', label: t('projectSections.plan-import.agentDecomposer') },
                  { key: 'normalizer', label: t('projectSections.plan-import.agentNormalizer') },
                  { key: 'scheduler', label: t('projectSections.plan-import.agentScheduler') }
                ] as const).map(({ key, label }) => (
                  <div key={key} className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{label}</Label>
                    <Select
                      value={agentProfiles[key]}
                      onValueChange={(value) => setAgentProfiles((prev) => ({ ...prev, [key]: value }))}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DEFAULT_AGENT_PROFILES.map((profile) => (
                          <SelectItem key={profile.id} value={profile.id}>
                            {profile.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>

              <div className="rounded-md border border-border/60 bg-muted/40 p-3 space-y-2">
                <div className="text-xs font-medium text-foreground">
                  {t('projectSections.plan-import.modelThinkingTitle')}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('projectSections.plan-import.modelRoutingDefaults')}
                </p>
                <div className="grid gap-2 md:grid-cols-2">
                  {([
                    { key: 'parser', label: t('projectSections.plan-import.agentParser') },
                    { key: 'decomposer', label: t('projectSections.plan-import.agentDecomposer') },
                    { key: 'normalizer', label: t('projectSections.plan-import.agentNormalizer') },
                    { key: 'scheduler', label: t('projectSections.plan-import.agentScheduler') }
                  ] as const).map(({ key, label }) => {
                    const profile = agentProfileMap.get(agentProfiles[key]);
                    const modelLabel = profile?.model ?? '—';
                    const thinkingLabel = profile?.thinkingLevel ?? '—';
                    return (
                      <div key={`profile-${key}`} className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{label}:</span>{' '}
                        {modelLabel} · {thinkingLabel}
                      </div>
                    );
                  })}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t('projectSections.plan-import.modelRoutingHint')}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Button
            onClick={handleImport}
            disabled={!planPath.trim() || isImporting}
          >
            {isImporting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('projectSections.plan-import.importing')}
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                {t('projectSections.plan-import.importAction')}
              </>
            )}
          </Button>
          {error && (
            <div className="flex items-center text-sm text-destructive">
              <AlertCircle className="h-4 w-4 mr-2" />
              {error}
            </div>
          )}
        </div>
      </div>

      {result && (
        <div className="rounded-lg border border-border bg-background p-4 space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-success" />
            <p className="text-sm font-medium text-foreground">
              {t('projectSections.plan-import.summaryTitle')}
            </p>
          </div>
          <div className="text-xs text-muted-foreground space-y-1">
            <p>{t('projectSections.plan-import.summaryTotal', { total: result.totalTasks })}</p>
            <p>{t('projectSections.plan-import.summaryCreated', { count: result.createdTaskIds.length })}</p>
            <p>{t('projectSections.plan-import.summarySkipped', { count: result.skipped.length })}</p>
            <p>{t('projectSections.plan-import.summaryErrors', { count: result.errors.length })}</p>
          </div>

          {(result.skipped.length > 0 || result.errors.length > 0) && (
            <div className="text-xs text-muted-foreground space-y-1">
              {result.skipped.map((item) => (
                <p key={`skipped-${item.title}`}>• {item.title}: {item.reason}</p>
              ))}
              {result.errors.map((item, index) => (
                <p key={`error-${item.title ?? 'unknown'}-${index}`}>• {item.title ?? 'Task'}: {item.error}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

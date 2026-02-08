import { useMemo } from 'react';
import { RotateCcw, Sparkles } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../ui/select';
import { Switch } from '../ui/switch';
import { cn } from '../../lib/utils';
import { THINKING_LEVELS } from '../../../shared/constants';
import type {
  ModelChoice,
  ModelRegistryData,
  ModelRegistryEntry,
  ModelRoutingAdvancedRoles,
  ModelRoutingFeatures,
  ModelRoutingPhases,
  ModelRoutingSettings,
  ModelTier
} from '../../../shared/types/settings';

const PHASE_ITEMS: Array<{
  key: keyof ModelRoutingPhases;
  label: string;
  description: string;
  recommendationKey: string;
}> = [
  { key: 'spec', label: 'Spec Creation', description: 'Discovery, requirements, context', recommendationKey: 'spec' },
  { key: 'planning', label: 'Planning', description: 'Implementation planning and architecture', recommendationKey: 'planning' },
  { key: 'coding', label: 'Coding', description: 'Core implementation work', recommendationKey: 'coding' },
  { key: 'validation', label: 'Validation', description: 'QA review and fixes', recommendationKey: 'validation' }
];

const FEATURE_ITEMS: Array<{
  key: keyof ModelRoutingFeatures;
  label: string;
  description: string;
  recommendationKey: string;
}> = [
  { key: 'consilium', label: 'Consilium', description: 'Multi-agent ideation council', recommendationKey: 'consilium' },
  { key: 'insights', label: 'Insights', description: 'Ask questions about your codebase', recommendationKey: 'insights' },
  { key: 'ideation', label: 'Ideation', description: 'Generate new ideas and directions', recommendationKey: 'ideation' },
  { key: 'github', label: 'GitHub', description: 'Issues and PR review agents', recommendationKey: 'github' },
  { key: 'intake', label: 'Intake', description: 'Preflight intake analysis for new tasks', recommendationKey: 'intake' },
  { key: 'merge', label: 'Merge', description: 'AI merge conflict resolution', recommendationKey: 'merge' },
  { key: 'commit', label: 'Commit', description: 'Commit message generation', recommendationKey: 'commit' }
];

const ADVANCED_ROLE_ITEMS: Array<{
  feature: keyof ModelRoutingAdvancedRoles;
  label: string;
  description: string;
  roles: Array<{ key: string; label: string; description: string }>;
}> = [
  {
    feature: 'consilium',
    label: 'Consilium Roles',
    description: 'Override each council persona individually',
    roles: [
      { key: 'innovator', label: 'Innovator', description: 'Blue ocean, bold ideas' },
      { key: 'realist', label: 'Realist', description: 'Risks, competition, market fit' },
      { key: 'facilitator', label: 'Facilitator', description: 'Synthesizes and structures' }
    ]
  },
  {
    feature: 'github',
    label: 'GitHub Roles',
    description: 'Control models per GitHub review role',
    roles: [
      { key: 'review', label: 'Review', description: 'Primary PR review' },
      { key: 'followUp', label: 'Follow-up', description: 'Follow-up review and fixes' },
      { key: 'batch', label: 'Batch', description: 'Issue batching and triage' }
    ]
  },
  {
    feature: 'insights',
    label: 'Insights Roles',
    description: 'Split extraction vs summarization models',
    roles: [
      { key: 'extractor', label: 'Extractor', description: 'Pulls evidence and snippets' },
      { key: 'summarizer', label: 'Summarizer', description: 'Summarizes findings' }
    ]
  }
];

interface SourceLabels {
  self: string;
  parent: string;
  recommended: string;
}

interface ModelRoutingEditorProps {
  routing: ModelRoutingSettings;
  onChange: (routing: ModelRoutingSettings) => void;
  registry: ModelRegistryData;
  parentRouting?: ModelRoutingSettings | null;
  allowInherit: boolean;
  inheritLabel: string;
  sourceLabels: SourceLabels;
  recommendationTier?: ModelTier | null;
  showAdvanced: boolean;
  onToggleAdvanced?: (value: boolean) => void;
}

interface ResolvedChoice {
  model: string;
  modelSource: string;
  thinkingLevel: string;
  thinkingSource: string;
  recommendedModel: string;
  missingModel: string | null;
}

const resolveRecommended = (
  registry: ModelRegistryData,
  phase?: string,
  feature?: string,
  tierPreference?: ModelTier | null
): string => {
  const recommendedByTag = registry.models.filter((model) => {
    const tags = model.recommendedFor ?? [];
    return (phase && tags.includes(phase)) || (feature && tags.includes(feature));
  });

  const candidates = recommendedByTag.length > 0 ? recommendedByTag : registry.models;
  if (tierPreference) {
    const tierMatch = candidates.find((model) => model.tier === tierPreference);
    if (tierMatch) {
      return tierMatch.id;
    }
  }

  return candidates[0]?.id || '';
};

const getModelInfo = (registry: ModelRegistryData, modelId: string): ModelRegistryEntry | undefined =>
  registry.models.find((model) => model.id === modelId);

const resolveChoice = (
  registry: ModelRegistryData,
  choice: ModelChoice,
  parentChoice: ModelChoice | undefined,
  phase?: string,
  feature?: string,
  sourceLabels?: SourceLabels,
  tierPreference?: ModelTier | null
): ResolvedChoice => {
  const recommendedModel = resolveRecommended(registry, phase, feature, tierPreference);
  const missingModel = choice.model && !getModelInfo(registry, choice.model) ? choice.model : null;
  const modelOverride = missingModel ? null : choice.model;
  const parentModel = parentChoice?.model ?? null;
  const model = modelOverride || parentModel || recommendedModel;

  const thinkingOverride = choice.thinkingLevel ?? null;
  const parentThinking = parentChoice?.thinkingLevel ?? null;
  const thinkingLevel = thinkingOverride || parentThinking || 'medium';

  const labels = sourceLabels ?? { self: 'Override', parent: 'Inherited', recommended: 'Recommended' };
  const modelSource = modelOverride ? labels.self : parentModel ? labels.parent : labels.recommended;
  const thinkingSource = thinkingOverride ? labels.self : parentThinking ? labels.parent : labels.recommended;

  return {
    model,
    modelSource,
    thinkingLevel,
    thinkingSource,
    recommendedModel,
    missingModel
  };
};

const ModelInfoCard = ({ model, isRecommended }: { model: ModelRegistryEntry | undefined; isRecommended: boolean }) => {
  if (!model) {
    return null;
  }

  return (
    <div className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="font-medium text-foreground">{model.displayName}</span>
        {isRecommended && (
          <Badge variant="outline" className="text-[10px]">
            Recommended
          </Badge>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground">
        <Badge variant="secondary" className="text-[10px] capitalize">
          {model.tier}
        </Badge>
        <span>Thinking: {model.supportsThinking ? 'Supported' : 'No'}</span>
        {model.contextWindow ? <span>Context: {model.contextWindow} tokens</span> : null}
        {model.costPer1M ? (
          <span>
            Cost: ${model.costPer1M.input}/{model.costPer1M.output} per 1M
          </span>
        ) : null}
      </div>
    </div>
  );
};

const ModelRoutingRow = ({
  label,
  description,
  choice,
  parentChoice,
  registry,
  phase,
  feature,
  allowInherit,
  inheritLabel,
  sourceLabels,
  tierPreference,
  onChange
}: {
  label: string;
  description: string;
  choice: ModelChoice;
  parentChoice?: ModelChoice;
  registry: ModelRegistryData;
  phase?: string;
  feature?: string;
  allowInherit: boolean;
  inheritLabel: string;
  sourceLabels: SourceLabels;
  tierPreference?: ModelTier | null;
  onChange: (next: ModelChoice) => void;
}) => {
  const resolved = resolveChoice(
    registry,
    choice,
    parentChoice,
    phase,
    feature,
    sourceLabels,
    tierPreference
  );
  const effectiveModelInfo = getModelInfo(registry, resolved.model);
  const hasOverride = choice.model !== null || choice.thinkingLevel !== null;
  const selectValue = choice.model ?? (allowInherit ? '__inherit__' : resolved.model);
  const thinkingValue = choice.thinkingLevel ?? (allowInherit ? '__inherit__' : resolved.thinkingLevel);
  const missingModel = resolved.missingModel;

  const modelOptions = useMemo(() => {
    const options = [...registry.models];
    if (missingModel) {
      options.unshift({
        id: missingModel,
        displayName: `Missing: ${missingModel}`,
        tier: 'experimental',
        supportsThinking: true
      });
    }
    return options;
  }, [registry.models, missingModel]);

  return (
    <div className="rounded-lg border border-border/50 bg-card px-4 py-3 space-y-3">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium text-foreground">{label}</div>
            <div className="text-xs text-muted-foreground">{description}</div>
          </div>
          {hasOverride && allowInherit && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => onChange({ model: null, thinkingLevel: null })}
            >
              <RotateCcw className="mr-1 h-3 w-3" />
              Reset
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">Model</div>
          <Select
            value={selectValue}
            onValueChange={(value) =>
              onChange({
                ...choice,
                model: value === '__inherit__' ? null : value
              })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent>
              {allowInherit && (
                <SelectItem value="__inherit__">{inheritLabel}</SelectItem>
              )}
              {modelOptions.map((model) => (
                <SelectItem key={model.id} value={model.id} disabled={model.id === missingModel}>
                  <div className="flex items-center justify-between gap-2">
                    <span>{model.displayName}</span>
                    {model.id === resolved.recommendedModel && (
                      <Badge variant="outline" className="text-[9px]">
                        Recommended
                      </Badge>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {missingModel && (
            <div className="text-xs text-amber-500">
              Missing model "{missingModel}". Falling back to {effectiveModelInfo?.displayName || resolved.model}.
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">Thinking</div>
          <Select
            value={thinkingValue}
            onValueChange={(value) =>
              onChange({
                ...choice,
                thinkingLevel: value === '__inherit__' ? null : value
              })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Select thinking level" />
            </SelectTrigger>
            <SelectContent>
              {allowInherit && (
                <SelectItem value="__inherit__">{inheritLabel}</SelectItem>
              )}
              {THINKING_LEVELS.map((level) => (
                <SelectItem key={level.value} value={level.value}>
                  <div className="flex flex-col">
                    <span>{level.label}</span>
                    <span className="text-[10px] text-muted-foreground">{level.description}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="text-xs text-muted-foreground flex flex-wrap gap-2">
        <span>
          Effective: <span className="text-foreground">{effectiveModelInfo?.displayName || resolved.model}</span>
        </span>
        <span className="text-muted-foreground">({resolved.modelSource})</span>
        <span>Thinking: {resolved.thinkingLevel}</span>
        <span className="text-muted-foreground">({resolved.thinkingSource})</span>
      </div>

      <ModelInfoCard
        model={effectiveModelInfo}
        isRecommended={resolved.model === resolved.recommendedModel}
      />
    </div>
  );
};

export function ModelRoutingEditor({
  routing,
  onChange,
  registry,
  parentRouting,
  allowInherit,
  inheritLabel,
  sourceLabels,
  recommendationTier,
  showAdvanced,
  onToggleAdvanced
}: ModelRoutingEditorProps) {
  const parent = parentRouting;

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Spec Pipeline</h3>
            <p className="text-xs text-muted-foreground">
              Configure models for the core spec → plan → code → validate phases.
            </p>
          </div>
        </div>
        <div className="space-y-3">
          {PHASE_ITEMS.map((phase) => (
            <ModelRoutingRow
              key={phase.key}
              label={phase.label}
              description={phase.description}
              choice={routing.phases[phase.key]}
              parentChoice={parent?.phases?.[phase.key]}
              registry={registry}
              phase={phase.recommendationKey}
              allowInherit={allowInherit}
              inheritLabel={inheritLabel}
              sourceLabels={sourceLabels}
              tierPreference={recommendationTier}
              onChange={(next) =>
                onChange({
                  ...routing,
                  phases: {
                    ...routing.phases,
                    [phase.key]: next
                  }
                })
              }
            />
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Feature Pipelines</h3>
          <p className="text-xs text-muted-foreground">
            Configure models for specialized workflows like Consilium, Insights, and GitHub.
          </p>
        </div>
        <div className="space-y-3">
          {FEATURE_ITEMS.map((feature) => (
            <ModelRoutingRow
              key={feature.key}
              label={feature.label}
              description={feature.description}
              choice={routing.features[feature.key]}
              parentChoice={parent?.features?.[feature.key]}
              registry={registry}
              feature={feature.recommendationKey}
              allowInherit={allowInherit}
              inheritLabel={inheritLabel}
              sourceLabels={sourceLabels}
              tierPreference={recommendationTier}
              onChange={(next) =>
                onChange({
                  ...routing,
                  features: {
                    ...routing.features,
                    [feature.key]: next
                  }
                })
              }
            />
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              Advanced Roles
              <Badge variant="outline" className="text-[10px]">
                Optional
              </Badge>
            </h3>
            <p className="text-xs text-muted-foreground">
              Override models for specific sub-roles inside complex features.
            </p>
          </div>
          {onToggleAdvanced && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Sparkles className={cn('h-4 w-4', showAdvanced ? 'text-primary' : 'text-muted-foreground')} />
              <span>Advanced mode</span>
              <Switch checked={showAdvanced} onCheckedChange={onToggleAdvanced} />
            </div>
          )}
        </div>

        {showAdvanced && (
          <div className="space-y-5">
            {ADVANCED_ROLE_ITEMS.map((group) => {
              const roles = group.roles;
              const roleRouting = routing.advancedRoles?.[group.feature] ?? {};
              const parentRoles = parent?.advancedRoles?.[group.feature] ?? {};

              return (
                <div key={group.feature} className="space-y-3">
                  <div>
                    <div className="text-sm font-medium text-foreground">{group.label}</div>
                    <div className="text-xs text-muted-foreground">{group.description}</div>
                  </div>
                  <div className="space-y-3">
                    {roles.map((role) => (
                      <ModelRoutingRow
                        key={role.key}
                        label={role.label}
                        description={role.description}
                        choice={(roleRouting as Record<string, ModelChoice>)[role.key] ?? { model: null, thinkingLevel: null }}
                        parentChoice={(parentRoles as Record<string, ModelChoice>)[role.key]}
                        registry={registry}
                        feature={group.feature}
                        allowInherit={allowInherit}
                        inheritLabel={inheritLabel}
                        sourceLabels={sourceLabels}
                        tierPreference={recommendationTier}
                        onChange={(next) => {
                          const updatedRoles = {
                            ...(routing.advancedRoles ?? {}),
                            [group.feature]: {
                              ...(routing.advancedRoles?.[group.feature] ?? {}),
                              [role.key]: next
                            }
                          } as ModelRoutingAdvancedRoles;

                          onChange({
                            ...routing,
                            advancedRoles: updatedRoles
                          });
                        }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

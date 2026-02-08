import type { ModelChoice, ModelRoutingSettings } from '../../../shared/types/settings';

const emptyChoice = (): ModelChoice => ({ model: null, thinkingLevel: null });

const mergeChoice = (base: ModelChoice, override?: Partial<ModelChoice>): ModelChoice => ({
  model: override?.model ?? base.model,
  thinkingLevel: override?.thinkingLevel ?? base.thinkingLevel
});

const coalesceChoice = (primary: ModelChoice, fallback: ModelChoice): ModelChoice => ({
  model: primary.model ?? fallback.model,
  thinkingLevel: primary.thinkingLevel ?? fallback.thinkingLevel
});

export const createEmptyRouting = (): ModelRoutingSettings => ({
  phases: {
    spec: emptyChoice(),
    planning: emptyChoice(),
    coding: emptyChoice(),
    validation: emptyChoice()
  },
  features: {
    consilium: emptyChoice(),
    insights: emptyChoice(),
    ideation: emptyChoice(),
    github: emptyChoice(),
    intake: emptyChoice(),
    merge: emptyChoice(),
    commit: emptyChoice()
  },
  advancedRoles: {
    consilium: {
      innovator: emptyChoice(),
      realist: emptyChoice(),
      facilitator: emptyChoice()
    },
    github: {
      review: emptyChoice(),
      followUp: emptyChoice(),
      batch: emptyChoice()
    },
    insights: {
      extractor: emptyChoice(),
      summarizer: emptyChoice()
    }
  }
});

export const normalizeRouting = (routing?: Partial<ModelRoutingSettings> | null): ModelRoutingSettings => {
  const base = createEmptyRouting();
  if (!routing) {
    return base;
  }

  return {
    phases: {
      spec: mergeChoice(base.phases.spec, routing.phases?.spec),
      planning: mergeChoice(base.phases.planning, routing.phases?.planning),
      coding: mergeChoice(base.phases.coding, routing.phases?.coding),
      validation: mergeChoice(base.phases.validation, routing.phases?.validation)
    },
    features: {
      consilium: mergeChoice(base.features.consilium, routing.features?.consilium),
      insights: mergeChoice(base.features.insights, routing.features?.insights),
      ideation: mergeChoice(base.features.ideation, routing.features?.ideation),
      github: mergeChoice(base.features.github, routing.features?.github),
      intake: mergeChoice(base.features.intake, routing.features?.intake),
      merge: mergeChoice(base.features.merge, routing.features?.merge),
      commit: mergeChoice(base.features.commit, routing.features?.commit)
    },
    advancedRoles: {
      consilium: {
        innovator: mergeChoice(base.advancedRoles?.consilium?.innovator ?? emptyChoice(), routing.advancedRoles?.consilium?.innovator),
        realist: mergeChoice(base.advancedRoles?.consilium?.realist ?? emptyChoice(), routing.advancedRoles?.consilium?.realist),
        facilitator: mergeChoice(base.advancedRoles?.consilium?.facilitator ?? emptyChoice(), routing.advancedRoles?.consilium?.facilitator)
      },
      github: {
        review: mergeChoice(base.advancedRoles?.github?.review ?? emptyChoice(), routing.advancedRoles?.github?.review),
        followUp: mergeChoice(base.advancedRoles?.github?.followUp ?? emptyChoice(), routing.advancedRoles?.github?.followUp),
        batch: mergeChoice(base.advancedRoles?.github?.batch ?? emptyChoice(), routing.advancedRoles?.github?.batch)
      },
      insights: {
        extractor: mergeChoice(base.advancedRoles?.insights?.extractor ?? emptyChoice(), routing.advancedRoles?.insights?.extractor),
        summarizer: mergeChoice(base.advancedRoles?.insights?.summarizer ?? emptyChoice(), routing.advancedRoles?.insights?.summarizer)
      }
    }
  };
};

export const mergeRoutingWithFallback = (
  primary: ModelRoutingSettings,
  fallback: ModelRoutingSettings
): ModelRoutingSettings => ({
  phases: {
    spec: coalesceChoice(primary.phases.spec, fallback.phases.spec),
    planning: coalesceChoice(primary.phases.planning, fallback.phases.planning),
    coding: coalesceChoice(primary.phases.coding, fallback.phases.coding),
    validation: coalesceChoice(primary.phases.validation, fallback.phases.validation)
  },
  features: {
    consilium: coalesceChoice(primary.features.consilium, fallback.features.consilium),
    insights: coalesceChoice(primary.features.insights, fallback.features.insights),
    ideation: coalesceChoice(primary.features.ideation, fallback.features.ideation),
    github: coalesceChoice(primary.features.github, fallback.features.github),
    intake: coalesceChoice(primary.features.intake, fallback.features.intake),
    merge: coalesceChoice(primary.features.merge, fallback.features.merge),
    commit: coalesceChoice(primary.features.commit, fallback.features.commit)
  },
  advancedRoles: {
    consilium: {
      innovator: coalesceChoice(
        primary.advancedRoles?.consilium?.innovator ?? emptyChoice(),
        fallback.advancedRoles?.consilium?.innovator ?? emptyChoice()
      ),
      realist: coalesceChoice(
        primary.advancedRoles?.consilium?.realist ?? emptyChoice(),
        fallback.advancedRoles?.consilium?.realist ?? emptyChoice()
      ),
      facilitator: coalesceChoice(
        primary.advancedRoles?.consilium?.facilitator ?? emptyChoice(),
        fallback.advancedRoles?.consilium?.facilitator ?? emptyChoice()
      )
    },
    github: {
      review: coalesceChoice(
        primary.advancedRoles?.github?.review ?? emptyChoice(),
        fallback.advancedRoles?.github?.review ?? emptyChoice()
      ),
      followUp: coalesceChoice(
        primary.advancedRoles?.github?.followUp ?? emptyChoice(),
        fallback.advancedRoles?.github?.followUp ?? emptyChoice()
      ),
      batch: coalesceChoice(
        primary.advancedRoles?.github?.batch ?? emptyChoice(),
        fallback.advancedRoles?.github?.batch ?? emptyChoice()
      )
    },
    insights: {
      extractor: coalesceChoice(
        primary.advancedRoles?.insights?.extractor ?? emptyChoice(),
        fallback.advancedRoles?.insights?.extractor ?? emptyChoice()
      ),
      summarizer: coalesceChoice(
        primary.advancedRoles?.insights?.summarizer ?? emptyChoice(),
        fallback.advancedRoles?.insights?.summarizer ?? emptyChoice()
      )
    }
  }
});

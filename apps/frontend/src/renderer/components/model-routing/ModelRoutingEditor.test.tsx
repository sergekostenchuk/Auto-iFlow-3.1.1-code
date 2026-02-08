/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModelRoutingEditor } from './ModelRoutingEditor';
import { createEmptyRouting } from './model-routing-utils';
import type { ModelRegistryData } from '../../../shared/types/settings';

describe('ModelRoutingEditor', () => {
  it('falls back to recommended when selected model is missing', () => {
    const routing = createEmptyRouting();
    routing.phases.spec.model = 'missing-model';

    const registry: ModelRegistryData = {
      models: [
        {
          id: 'glm-4.7',
          displayName: 'GLM-4.7',
          tier: 'balanced',
          supportsThinking: true,
          recommendedFor: ['spec']
        }
      ],
      legacyAliases: {},
      bootstrapModel: 'glm-4.7'
    };

    render(
      <ModelRoutingEditor
        routing={routing}
        onChange={vi.fn()}
        registry={registry}
        allowInherit={false}
        inheritLabel="Inherited"
        sourceLabels={{ self: 'Override', parent: 'Inherited', recommended: 'Recommended' }}
        showAdvanced={false}
      />
    );

    expect(screen.getByText(/Missing model/)).toBeInTheDocument();
    expect(screen.getByText(/Falling back to GLM-4.7/)).toBeInTheDocument();
  });
});

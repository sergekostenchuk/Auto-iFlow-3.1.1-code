/**
 * Model and agent profile constants
 * Claude feature models, iFlow coding models, thinking levels, memory backends, and agent profiles
 */

import type {
  AgentProfile,
  PhaseModelConfig,
  FeatureModelConfig,
  FeatureThinkingConfig,
  ModelRoutingSettings,
} from '../types/settings';

// ============================================
// Available Models (Claude - feature tools / legacy)
// ============================================

export const AVAILABLE_MODELS = [
  { value: 'opus', label: 'Claude Opus 4.5' },
  { value: 'sonnet', label: 'Claude Sonnet 4.5' },
  { value: 'haiku', label: 'Claude Haiku 4.5' }
] as const;

// ============================================
// Available Models (iFlow - coding pipeline)
// ============================================

export const AVAILABLE_CODING_MODELS = [
  { value: 'glm-4.7', label: 'GLM-4.7' },
  { value: 'iflow-rome-30ba3b', label: 'iFlow-ROME-30BA3B' },
  { value: 'deepseek-v3.2', label: 'DeepSeek-V3.2' },
  { value: 'qwen3-coder-plus', label: 'Qwen3-Coder-Plus' },
  { value: 'kimi-k2-thinking', label: 'Kimi-K2-Thinking' },
  { value: 'minimax-m2.1', label: 'MiniMax-M2.1' },
  { value: 'kimi-k2-0905', label: 'Kimi-K2-0905' }
] as const;

// Maps model shorthand to actual Claude model IDs
export const MODEL_ID_MAP: Record<string, string> = {
  opus: 'claude-opus-4-5-20251101',
  sonnet: 'claude-sonnet-4-5-20250929',
  haiku: 'claude-haiku-4-5-20251001'
} as const;

// Maps thinking levels to budget tokens (null = no extended thinking)
export const THINKING_BUDGET_MAP: Record<string, number | null> = {
  none: null,
  low: 1024,
  medium: 4096,
  high: 16384,
  ultrathink: 65536
} as const;

// ============================================
// Thinking Levels
// ============================================

// Thinking levels for models (budget token allocation)
export const THINKING_LEVELS = [
  { value: 'none', label: 'None', description: 'No extended thinking' },
  { value: 'low', label: 'Low', description: 'Brief consideration' },
  { value: 'medium', label: 'Medium', description: 'Moderate analysis' },
  { value: 'high', label: 'High', description: 'Deep thinking' },
  { value: 'ultrathink', label: 'Ultra Think', description: 'Maximum reasoning depth' }
] as const;

// ============================================
// Agent Profiles - Phase Configurations
// ============================================

// Phase configurations for each preset profile
// Each profile has its own default phase models and thinking levels

// Auto (Optimized) - iFlow with optimized thinking per phase
export const AUTO_PHASE_MODELS: PhaseModelConfig = {
  spec: 'glm-4.7',
  planning: 'glm-4.7',
  coding: 'qwen3-coder-plus',
  qa: 'glm-4.7'
};

export const AUTO_PHASE_THINKING: import('../types/settings').PhaseThinkingConfig = {
  spec: 'ultrathink',   // Deep thinking for comprehensive spec creation
  planning: 'high',     // High thinking for planning complex features
  coding: 'low',        // Faster coding iterations
  qa: 'low'             // Efficient QA review
};

// Complex Tasks - deeper reasoning model across all phases
export const COMPLEX_PHASE_MODELS: PhaseModelConfig = {
  spec: 'kimi-k2-thinking',
  planning: 'kimi-k2-thinking',
  coding: 'kimi-k2-thinking',
  qa: 'kimi-k2-thinking'
};

export const COMPLEX_PHASE_THINKING: import('../types/settings').PhaseThinkingConfig = {
  spec: 'ultrathink',
  planning: 'ultrathink',
  coding: 'ultrathink',
  qa: 'ultrathink'
};

// Balanced - GLM with medium thinking across all phases
export const BALANCED_PHASE_MODELS: PhaseModelConfig = {
  spec: 'glm-4.7',
  planning: 'glm-4.7',
  coding: 'glm-4.7',
  qa: 'glm-4.7'
};

export const BALANCED_PHASE_THINKING: import('../types/settings').PhaseThinkingConfig = {
  spec: 'medium',
  planning: 'medium',
  coding: 'medium',
  qa: 'medium'
};

// Quick Edits - fast coding model with low thinking across all phases
export const QUICK_PHASE_MODELS: PhaseModelConfig = {
  spec: 'qwen3-coder-plus',
  planning: 'qwen3-coder-plus',
  coding: 'qwen3-coder-plus',
  qa: 'qwen3-coder-plus'
};

export const QUICK_PHASE_THINKING: import('../types/settings').PhaseThinkingConfig = {
  spec: 'low',
  planning: 'low',
  coding: 'low',
  qa: 'low'
};

// Default phase configuration (used for fallback, matches 'Balanced' profile for cost-effectiveness)
export const DEFAULT_PHASE_MODELS: PhaseModelConfig = BALANCED_PHASE_MODELS;
export const DEFAULT_PHASE_THINKING: import('../types/settings').PhaseThinkingConfig = BALANCED_PHASE_THINKING;

// ============================================
// Feature Settings (Non-Pipeline Features)
// ============================================

// Default feature model configuration (for insights, ideation, roadmap, github, utility)
export const DEFAULT_FEATURE_MODELS: FeatureModelConfig = {
  insights: 'sonnet',     // Fast, responsive chat
  ideation: 'opus',       // Creative ideation benefits from Opus
  roadmap: 'opus',        // Strategic planning benefits from Opus
  githubIssues: 'opus',   // Issue triage and analysis benefits from Opus
  githubPrs: 'opus',      // PR review benefits from thorough Opus analysis
  utility: 'haiku'        // Fast utility operations (commit messages, merge resolution)
};

// Default feature thinking configuration
export const DEFAULT_FEATURE_THINKING: FeatureThinkingConfig = {
  insights: 'medium',     // Balanced thinking for chat
  ideation: 'high',       // Deep thinking for creative ideas
  roadmap: 'high',        // Strategic thinking for roadmap
  githubIssues: 'medium', // Moderate thinking for issue analysis
  githubPrs: 'medium',    // Moderate thinking for PR review
  utility: 'low'          // Fast thinking for utility operations
};

export const DEFAULT_MODEL_ROUTING: ModelRoutingSettings = {
  phases: {
    spec: { model: 'glm-4.7', thinkingLevel: 'medium' },
    planning: { model: 'glm-4.7', thinkingLevel: 'medium' },
    coding: { model: 'glm-4.7', thinkingLevel: 'medium' },
    validation: { model: 'glm-4.7', thinkingLevel: 'medium' },
  },
  features: {
    consilium: { model: 'glm-4.7', thinkingLevel: 'medium' },
    insights: { model: 'glm-4.7', thinkingLevel: 'medium' },
    ideation: { model: 'kimi-k2-thinking', thinkingLevel: 'high' },
    github: { model: 'kimi-k2-thinking', thinkingLevel: 'medium' },
    merge: { model: 'qwen3-coder-plus', thinkingLevel: 'low' },
    commit: { model: 'qwen3-coder-plus', thinkingLevel: 'low' },
    intake: { model: 'glm-4.7', thinkingLevel: 'medium' },
  },
};

// Feature labels for UI display
export const FEATURE_LABELS: Record<keyof FeatureModelConfig, { label: string; description: string }> = {
  insights: { label: 'Insights Chat', description: 'Ask questions about your codebase' },
  ideation: { label: 'Ideation', description: 'Generate feature ideas and improvements' },
  roadmap: { label: 'Roadmap', description: 'Create strategic feature roadmaps' },
  githubIssues: { label: 'GitHub Issues', description: 'Automated issue triage and labeling' },
  githubPrs: { label: 'GitHub PR Review', description: 'AI-powered pull request reviews' },
  utility: { label: 'Utility', description: 'Commit messages and merge conflict resolution' }
};

// Default agent profiles for preset model/thinking configurations
// All profiles have per-phase configuration for full customization
export const DEFAULT_AGENT_PROFILES: AgentProfile[] = [
  {
    id: 'auto',
    name: 'Auto (Optimized)',
    description: 'Uses iFlow defaults with optimized thinking levels',
    model: 'glm-4.7',
    thinkingLevel: 'high',
    icon: 'Sparkles',
    phaseModels: AUTO_PHASE_MODELS,
    phaseThinking: AUTO_PHASE_THINKING
  },
  {
    id: 'complex',
    name: 'Complex Tasks',
    description: 'For intricate, multi-step implementations requiring deep analysis',
    model: 'kimi-k2-thinking',
    thinkingLevel: 'ultrathink',
    icon: 'Brain',
    phaseModels: COMPLEX_PHASE_MODELS,
    phaseThinking: COMPLEX_PHASE_THINKING
  },
  {
    id: 'balanced',
    name: 'Balanced',
    description: 'Good balance of speed and quality for most tasks',
    model: 'glm-4.7',
    thinkingLevel: 'medium',
    icon: 'Scale',
    phaseModels: BALANCED_PHASE_MODELS,
    phaseThinking: BALANCED_PHASE_THINKING
  },
  {
    id: 'quick',
    name: 'Quick Edits',
    description: 'Fast iterations for simple changes and quick fixes',
    model: 'qwen3-coder-plus',
    thinkingLevel: 'low',
    icon: 'Zap',
    phaseModels: QUICK_PHASE_MODELS,
    phaseThinking: QUICK_PHASE_THINKING
  }
];

// Feature-only profiles (Claude defaults) for insights/utility selectors
export const FEATURE_AGENT_PROFILES: AgentProfile[] = [
  {
    id: 'auto',
    name: 'Auto (Optimized)',
    description: 'Uses Opus across all phases with optimized thinking levels',
    model: 'opus',
    thinkingLevel: 'high',
    icon: 'Sparkles'
  },
  {
    id: 'complex',
    name: 'Complex Tasks',
    description: 'For intricate, multi-step implementations requiring deep analysis',
    model: 'opus',
    thinkingLevel: 'ultrathink',
    icon: 'Brain'
  },
  {
    id: 'balanced',
    name: 'Balanced',
    description: 'Good balance of speed and quality for most tasks',
    model: 'sonnet',
    thinkingLevel: 'medium',
    icon: 'Scale'
  },
  {
    id: 'quick',
    name: 'Quick Edits',
    description: 'Fast iterations for simple changes and quick fixes',
    model: 'haiku',
    thinkingLevel: 'low',
    icon: 'Zap'
  }
];

// ============================================
// Memory Backends
// ============================================

export const MEMORY_BACKENDS = [
  { value: 'file', label: 'File-based (default)' },
  { value: 'graphiti', label: 'Graphiti (LadybugDB)' }
] as const;

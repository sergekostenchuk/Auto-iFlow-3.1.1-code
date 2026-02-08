/**
 * Application configuration constants
 * Default settings, file paths, and project structure
 */

import { DEFAULT_MODEL_ROUTING } from './models';

// ============================================
// UI Scale Constants
// ============================================

export const UI_SCALE_MIN = 75;
export const UI_SCALE_MAX = 200;
export const UI_SCALE_DEFAULT = 100;
export const UI_SCALE_STEP = 5;

// ============================================
// Default App Settings
// ============================================

export const DEFAULT_APP_SETTINGS = {
  theme: 'system' as const,
  colorTheme: 'default' as const,
  defaultModel: 'glm-4.7',
  agentFramework: 'auto-iflow',
  pythonPath: undefined as string | undefined,
  gitPath: undefined as string | undefined,
  githubCLIPath: undefined as string | undefined,
  autoBuildPath: undefined as string | undefined,
  autoUpdateAutoBuild: true,
  autoNameTerminals: true,
  onboardingCompleted: false,
  notifications: {
    onTaskComplete: true,
    onTaskFailed: true,
    onReviewNeeded: true,
    sound: false
  },
  // Global API keys (used as defaults for all projects)
  globalClaudeOAuthToken: undefined as string | undefined,
  globalIflowApiKey: undefined as string | undefined,
  iflowOAuthResetAt: undefined as number | undefined,
  globalOpenAIApiKey: undefined as string | undefined,
  // Selected agent profile - defaults to 'auto' for per-phase optimized model selection
  selectedAgentProfile: 'auto',
  // Changelog preferences (persisted between sessions)
  changelogFormat: 'keep-a-changelog' as const,
  changelogAudience: 'user-facing' as const,
  changelogEmojiLevel: 'none' as const,
  // UI Scale (default 100% - standard size)
  uiScale: UI_SCALE_DEFAULT,
  // Startup restore prompt behavior
  startupRestoreMode: 'ask' as const,
  // Sandbox task isolation (1 task = 1 repo)
  sandboxTasksEnabled: true,
  // Strict Intake V2 rollout switch
  intakeV2Enabled: false,
  // Beta updates opt-in (receive pre-release versions)
  betaUpdates: false,
  // Language preference (default to English)
  language: 'en' as const,
  // Anonymous error reporting (Sentry) - enabled by default to help improve the app
  sentryEnabled: true,
  // Global model routing defaults
  modelRouting: DEFAULT_MODEL_ROUTING,
  modelRoutingAdvanced: false
};

// ============================================
// Default Project Settings
// ============================================

export const DEFAULT_PROJECT_SETTINGS = {
  model: 'glm-4.7',
  memoryBackend: 'file' as const,
  linearSync: false,
  notifications: {
    onTaskComplete: true,
    onTaskFailed: true,
    onReviewNeeded: true,
    sound: false
  },
  // Graphiti MCP server for agent-accessible knowledge graph (enabled by default)
  graphitiMcpEnabled: true,
  graphitiMcpUrl: 'http://localhost:8000/mcp/',
  // Include CLAUDE.md instructions in agent context (enabled by default)
  useClaudeMd: true
};

// ============================================
// Graphiti Defaults
// ============================================

export const DEFAULT_GRAPHITI_DATABASE = 'auto_iflow_memory';

// ============================================
// Auto Build File Paths
// ============================================

// File paths relative to project
// IMPORTANT: All paths use the data directory (installed instance), NOT source code
export const DEFAULT_AUTO_BUILD_PATH = '.auto-iflow';
// Canonical branch namespace for new worktrees
export const AUTO_BUILD_BRANCH_NAMESPACE = 'auto-iflow';

export const AUTO_BUILD_PATHS = {
  SPECS_DIR: `${DEFAULT_AUTO_BUILD_PATH}/specs`,
  ROADMAP_DIR: `${DEFAULT_AUTO_BUILD_PATH}/roadmap`,
  IDEATION_DIR: `${DEFAULT_AUTO_BUILD_PATH}/ideation`,
  IMPLEMENTATION_PLAN: 'implementation_plan.json',
  SPEC_FILE: 'spec.md',
  QA_REPORT: 'qa_report.md',
  BUILD_PROGRESS: 'build-progress.txt',
  CONTEXT: 'context.json',
  REQUIREMENTS: 'requirements.json',
  ROADMAP_FILE: 'roadmap.json',
  ROADMAP_DISCOVERY: 'roadmap_discovery.json',
  COMPETITOR_ANALYSIS: 'competitor_analysis.json',
  IDEATION_FILE: 'ideation.json',
  IDEATION_CONTEXT: 'ideation_context.json',
  PROJECT_INDEX: `${DEFAULT_AUTO_BUILD_PATH}/project_index.json`,
  GRAPHITI_STATE: '.graphiti_state.json'
} as const;

/**
 * Get the specs directory path.
 * All specs go to the project's data directory (default .auto-iflow).
 */
export function getSpecsDir(autoBuildPath: string | undefined): string {
  const basePath = autoBuildPath || DEFAULT_AUTO_BUILD_PATH;
  return `${basePath}/specs`;
}

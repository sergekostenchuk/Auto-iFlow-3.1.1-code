"""
Security Constants
==================

Shared constants for the security module.
"""

# Environment variable name for the project directory
# Set by agents (coder.py, loop.py) at startup to ensure security hooks
# can find the correct project directory even in worktree mode.
PROJECT_DIR_ENV_VAR = "AUTO_IFLOW_PROJECT_DIR"

# Environment variable for spec directory (used for task_intake lookup)
SPEC_DIR_ENV_VAR = "AUTO_IFLOW_SPEC_DIR"

# Environment variables for task routing context
TASK_TYPE_ENV_VAR = "AUTO_IFLOW_TASK_TYPE"
NOISE_PROFILE_ENV_VAR = "AUTO_IFLOW_NOISE_PROFILE"

# Environment variables for manual verification guardrails
# When enabled, Bash commands are blocked to avoid hanging local sessions.
MANUAL_VERIFICATION_ENV_VAR = "AUTO_IFLOW_MANUAL_VERIFICATION"
MANUAL_VERIFICATION_SUBTASK_ENV_VAR = "AUTO_IFLOW_MANUAL_VERIFICATION_SUBTASK"

# Environment variables for blocking test commands during coding
# Tests must run only in post-code test phase.
BLOCK_TEST_COMMANDS_ENV_VAR = "AUTO_IFLOW_BLOCK_TEST_COMMANDS"
TEST_PLAN_ENV_VAR = "AUTO_IFLOW_TEST_PLAN"

# Commands blocked for non-code tasks (enforced in security hooks)
NON_CODE_BLOCKED_COMMANDS = [
    "npm test",
    "npm run test",
    "npm run test:backend",
    "npm run test:e2e",
    "npm run build",
    "npm run package",
    "pnpm test",
    "pnpm run test",
    "yarn test",
    "pytest",
    "go test",
    "cargo test",
    "bundle exec rspec",
    "dotnet test",
    "mvn test",
    "gradle test",
    "git commit",
    "git merge",
    "git rebase",
    "git cherry-pick",
    "./init.sh",
    "chmod +x init.sh",
]

# Security configuration filenames
# These are the files that control which commands are allowed to run.
ALLOWLIST_FILENAME = ".auto-iflow-allowlist"
PROFILE_FILENAME = ".auto-iflow-security.json"

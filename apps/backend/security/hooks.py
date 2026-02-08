"""
Security Hooks
==============

Pre-tool-use hooks that validate bash commands for security.
Main enforcement point for the security system.
"""

import json
import os
from pathlib import Path
from typing import Any

from project_analyzer import BASE_COMMANDS, SecurityProfile, is_command_allowed

from .parser import extract_commands, get_command_for_validation, split_command_segments
from .constants import (
    BLOCK_TEST_COMMANDS_ENV_VAR,
    MANUAL_VERIFICATION_ENV_VAR,
    MANUAL_VERIFICATION_SUBTASK_ENV_VAR,
    NON_CODE_BLOCKED_COMMANDS,
    SPEC_DIR_ENV_VAR,
    TASK_TYPE_ENV_VAR,
    TEST_PLAN_ENV_VAR,
)
from .profile import get_security_profile
from .validator import VALIDATORS

DEFAULT_BLOCKED_TEST_COMMANDS = [
    "npm test",
    "npm run test",
    "npm run test:backend",
    "npm run test:e2e",
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
]


def _normalize_command(command: str) -> str:
    return " ".join(command.strip().split())


def _load_test_plan_from_env() -> list[str]:
    raw = os.environ.get(TEST_PLAN_ENV_VAR, "").strip()
    if not raw:
        return []
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return [
                _normalize_command(entry)
                for entry in data
                if isinstance(entry, str) and entry.strip()
            ]
    except json.JSONDecodeError:
        pass
    return [
        _normalize_command(entry)
        for entry in raw.replace(",", "\n").splitlines()
        if entry.strip()
    ]


def _segment_matches_test_plan(segment: str, plan_commands: list[str]) -> bool:
    if not plan_commands:
        return False
    segment_norm = _normalize_command(segment)
    if not segment_norm:
        return False
    for plan_cmd in plan_commands:
        plan_norm = _normalize_command(plan_cmd)
        if not plan_norm:
            continue
        if segment_norm == plan_norm:
            return True
        if segment_norm.startswith(f"{plan_norm} "):
            return True
        if plan_norm.startswith(f"{segment_norm} "):
            return True
    return False


def _load_task_intake_from_spec(spec_dir: Path) -> dict:
    intake_path = spec_dir / "task_intake.json"
    if not intake_path.exists():
        return {}
    try:
        with intake_path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _resolve_task_type() -> str:
    env_value = os.environ.get(TASK_TYPE_ENV_VAR)
    if env_value:
        return env_value
    spec_dir_value = os.environ.get(SPEC_DIR_ENV_VAR)
    if spec_dir_value:
        intake = _load_task_intake_from_spec(Path(spec_dir_value))
        task_type = intake.get("task_type")
        if isinstance(task_type, str) and task_type.strip():
            return task_type.strip()
    return "code"


async def bash_security_hook(
    input_data: dict[str, Any],
    tool_use_id: str | None = None,
    context: Any | None = None,
) -> dict[str, Any]:
    """
    Pre-tool-use hook that validates bash commands using dynamic allowlist.

    This is the main security enforcement point. It:
    1. Validates tool_input structure (must be dict with 'command' key)
    2. Extracts command names from the command string
    3. Checks each command against the project's security profile
    4. Runs additional validation for sensitive commands
    5. Blocks disallowed commands with clear error messages

    Args:
        input_data: Dict containing tool_name and tool_input
        tool_use_id: Optional tool use ID
        context: Optional context

    Returns:
        Empty dict to allow, or {"decision": "block", "reason": "..."} to block
    """
    if input_data.get("tool_name") != "Bash":
        return {}

    if os.environ.get(MANUAL_VERIFICATION_ENV_VAR, "").lower() == "true":
        subtask = os.environ.get(MANUAL_VERIFICATION_SUBTASK_ENV_VAR, "").strip()
        suffix = f" for subtask {subtask}" if subtask else ""
        return {
            "decision": "block",
            "reason": f"Manual verification mode{suffix}: command execution disabled",
        }

    # Validate tool_input structure before accessing
    tool_input = input_data.get("tool_input")

    # Check if tool_input is None (malformed tool call)
    if tool_input is None:
        return {
            "decision": "block",
            "reason": "Bash tool_input is None - malformed tool call from SDK",
        }

    # Check if tool_input is a dict
    if not isinstance(tool_input, dict):
        return {
            "decision": "block",
            "reason": f"Bash tool_input must be dict, got {type(tool_input).__name__}",
        }

    # Now safe to access command
    command = tool_input.get("command", "")
    if not command:
        return {}

    segments = split_command_segments(command)

    if os.environ.get(BLOCK_TEST_COMMANDS_ENV_VAR, "").lower() == "true":
        test_plan = _load_test_plan_from_env()
        blocked_commands = test_plan or DEFAULT_BLOCKED_TEST_COMMANDS
        if any(
            _segment_matches_test_plan(segment, blocked_commands)
            for segment in segments
        ):
            return {
                "decision": "block",
                "reason": "Test commands are reserved for Post-Code Tests. Run tests only after coding completes.",
            }

    task_type = _resolve_task_type()
    if task_type != "code":
        if any(
            _segment_matches_test_plan(segment, NON_CODE_BLOCKED_COMMANDS)
            for segment in segments
        ):
            return {
                "decision": "block",
                "reason": "Non-code task: command execution limited to read-only operations.",
            }

    # Get the working directory from context or use current directory
    # Priority:
    # 1. Environment variable PROJECT_DIR_ENV_VAR (set by agent on startup)
    # 2. input_data cwd (passed by SDK in the tool call)
    # 3. Context cwd (should be set by ClaudeSDKClient but sometimes isn't)
    # 4. Current working directory (fallback, may be incorrect in worktree mode)
    from .constants import PROJECT_DIR_ENV_VAR

    cwd = os.environ.get(PROJECT_DIR_ENV_VAR)
    if not cwd:
        cwd = input_data.get("cwd")
    if not cwd and context and hasattr(context, "cwd"):
        cwd = context.cwd
    if not cwd:
        cwd = os.getcwd()

    # Get or create security profile
    # Note: In actual use, spec_dir would be passed through context
    try:
        profile = get_security_profile(Path(cwd))
    except Exception as e:
        # If profile creation fails, fall back to base commands only
        print(f"Warning: Could not load security profile: {e}")
        profile = SecurityProfile()
        profile.base_commands = BASE_COMMANDS.copy()

    # Extract all commands from the command string
    commands = extract_commands(command)

    if not commands:
        # Could not parse - fail safe by blocking
        return {
            "decision": "block",
            "reason": f"Could not parse command for security validation: {command}",
        }

    # Split into segments for per-command validation

    # Get all allowed commands
    allowed = profile.get_all_allowed_commands()

    # Check each command against the allowlist
    for cmd in commands:
        # Check if command is allowed
        is_allowed, reason = is_command_allowed(cmd, profile)

        if not is_allowed:
            return {
                "decision": "block",
                "reason": reason,
            }

        # Additional validation for sensitive commands
        if cmd in VALIDATORS:
            cmd_segment = get_command_for_validation(cmd, segments)
            if not cmd_segment:
                cmd_segment = command

            validator = VALIDATORS[cmd]
            allowed, reason = validator(cmd_segment)
            if not allowed:
                return {"decision": "block", "reason": reason}

    return {}


def validate_command(
    command: str,
    project_dir: Path | None = None,
) -> tuple[bool, str]:
    """
    Validate a command string (for testing/debugging).

    Args:
        command: Full command string to validate
        project_dir: Optional project directory (uses cwd if not provided)

    Returns:
        (is_allowed, reason) tuple
    """
    if project_dir is None:
        project_dir = Path.cwd()

    profile = get_security_profile(project_dir)
    commands = extract_commands(command)

    if not commands:
        return False, "Could not parse command"

    segments = split_command_segments(command)

    for cmd in commands:
        is_allowed_result, reason = is_command_allowed(cmd, profile)
        if not is_allowed_result:
            return False, reason

        if cmd in VALIDATORS:
            cmd_segment = get_command_for_validation(cmd, segments)
            if not cmd_segment:
                cmd_segment = command

            validator = VALIDATORS[cmd]
            allowed, reason = validator(cmd_segment)
            if not allowed:
                return False, reason

    return True, ""

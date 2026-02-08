#!/usr/bin/env python3
"""
Tests for security hooks.
"""

import json

import pytest

from security.constants import (
    BLOCK_TEST_COMMANDS_ENV_VAR,
    MANUAL_VERIFICATION_ENV_VAR,
    MANUAL_VERIFICATION_SUBTASK_ENV_VAR,
    TASK_TYPE_ENV_VAR,
    TEST_PLAN_ENV_VAR,
)
from security.hooks import bash_security_hook


@pytest.mark.asyncio
async def test_bash_security_hook_blocks_manual_verification(monkeypatch):
    monkeypatch.setenv(MANUAL_VERIFICATION_ENV_VAR, "true")
    monkeypatch.setenv(MANUAL_VERIFICATION_SUBTASK_ENV_VAR, "subtask-1")

    result = await bash_security_hook(
        {"tool_name": "Bash", "tool_input": {"command": "npm test"}}
    )

    assert result.get("decision") == "block"
    assert "Manual verification" in result.get("reason", "")


@pytest.mark.asyncio
async def test_bash_security_hook_blocks_test_commands(monkeypatch):
    monkeypatch.setenv(BLOCK_TEST_COMMANDS_ENV_VAR, "true")
    monkeypatch.setenv(TEST_PLAN_ENV_VAR, json.dumps(["npm test"]))

    result = await bash_security_hook(
        {"tool_name": "Bash", "tool_input": {"command": "npm test"}}
    )

    assert result.get("decision") == "block"
    assert "Post-Code" in result.get("reason", "")


@pytest.mark.asyncio
async def test_bash_security_hook_blocks_noncode_commands(monkeypatch):
    monkeypatch.setenv(TASK_TYPE_ENV_VAR, "analysis")

    result = await bash_security_hook(
        {"tool_name": "Bash", "tool_input": {"command": "git commit -m \"x\""}}
    )

    assert result.get("decision") == "block"
    assert "Non-code" in result.get("reason", "")

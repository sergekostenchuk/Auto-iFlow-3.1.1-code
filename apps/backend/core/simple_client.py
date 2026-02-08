"""
Simple iFlow Client Factory
===========================

Factory for creating minimal iFlow clients for single-turn utility operations
like commit message generation, merge conflict resolution, and batch analysis.

These clients don't need full security configurations or MCP servers.
Use `create_client()` from `core.client` for full agent sessions.
"""

import os
from pathlib import Path

from agents.tools_pkg import get_agent_config, get_default_thinking_level
from core.iflow_client import create_iflow_client
from core.iflow_compat import IFlowCompatClient
from phase_config import get_thinking_budget


def create_simple_client(
    agent_type: str = "merge_resolver",
    model: str = "glm-4.7",
    system_prompt: str | None = None,
    cwd: Path | None = None,
    max_turns: int = 1,
    max_thinking_tokens: int | None = None,
) -> IFlowCompatClient:
    """
    Create a minimal iFlow client for single-turn utility operations.

    Args:
        agent_type: Agent type from AGENT_CONFIGS. Determines available tools.
                   Common utility types:
                   - "merge_resolver" - Text-only merge conflict analysis
                   - "commit_message" - Text-only commit message generation
                   - "insights" - Read-only code insight extraction
                   - "batch_analysis" - Read-only batch issue analysis
                   - "batch_validation" - Read-only validation
        model: iFlow model to use
        system_prompt: Optional custom system prompt (for specialized tasks)
        cwd: Working directory for file operations (optional)
        max_turns: Maximum conversation turns (default: 1 for single-turn)
        max_thinking_tokens: Override thinking budget (None = use agent default from
                            AGENT_CONFIGS, converted using phase_config.THINKING_BUDGET_MAP)

    Returns:
        Configured iFlow client wrapper
    """
    # Validate agent type (raises ValueError if unknown type)
    get_agent_config(agent_type)

    # Determine thinking budget using the single source of truth (phase_config.py)
    if max_thinking_tokens is None:
        thinking_level = get_default_thinking_level(agent_type)
        max_thinking_tokens = get_thinking_budget(thinking_level)

    enable_thinking = max_thinking_tokens is not None and max_thinking_tokens > 0
    session_settings = {"system_prompt": system_prompt} if system_prompt else None

    client = create_iflow_client(
        project_dir=cwd or Path.cwd(),
        model=model,
        permission_mode=os.environ.get("IFLOW_PERMISSION_MODE", "auto"),
        enable_thinking=enable_thinking,
        max_turns=max_turns,
        session_settings=session_settings,
        mcp_servers=None,
        file_access=bool(cwd),
        file_allowed_dirs=[str(cwd.resolve())] if cwd else None,
        file_read_only=True,
    )

    return IFlowCompatClient(client)

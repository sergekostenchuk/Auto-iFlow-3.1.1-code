"""
iFlow Client
============

iFlow integration for AI-based conflict resolution.

This module provides the factory function for creating an AIResolver
configured to use iFlow via the SDK wrapper.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .resolver import AIResolver

logger = logging.getLogger(__name__)


def create_iflow_resolver() -> AIResolver:
    """
    Create an AIResolver configured to use iFlow via the SDK wrapper.

    Uses the same auth discovery pattern as the rest of the framework.
    Reads model/thinking settings from environment variables:
    - UTILITY_MODEL_ID: Full model ID (e.g., "glm-4.7")
    - UTILITY_THINKING_BUDGET: Thinking budget tokens (e.g., "1024")

    Returns:
        Configured AIResolver instance
    """
    # Import here to avoid circular dependency
    from core.auth import ensure_iflow_auth_env, has_iflow_auth
    from init import resolve_auto_build_dir
    from phase_config import resolve_model

    from .resolver import AIResolver

    if not has_iflow_auth():
        logger.warning("No authentication token found, AI resolution unavailable")
        return AIResolver()

    # Ensure SDK can find the token
    ensure_iflow_auth_env()

    try:
        from core.simple_client import create_simple_client
    except ImportError:
        logger.warning("core.simple_client not available, AI resolution unavailable")
        return AIResolver()

    model_override = os.environ.get("UTILITY_MODEL_ID")
    budget_override = os.environ.get("UTILITY_THINKING_BUDGET")

    try:
        project_dir = Path.cwd()
        auto_build_path = resolve_auto_build_dir(project_dir).name
        model, _, thinking_budget = resolve_model(
            feature="merge",
            project_dir=project_dir,
            auto_build_path=auto_build_path,
            cli_model=model_override,
        )
    except Exception:
        model = model_override or "glm-4.7"
        thinking_budget = None

    if budget_override is not None:
        if not budget_override:
            thinking_budget = None
        else:
            try:
                parsed_budget = int(budget_override)
                thinking_budget = parsed_budget if parsed_budget > 0 else None
            except ValueError:
                thinking_budget = 1024

    logger.info(
        "Merge resolver using model=%s, thinking_budget=%s",
        model,
        thinking_budget,
    )

    def call_iflow(system: str, user: str) -> str:
        """Call iFlow using the SDK wrapper for merge resolution."""

        async def _run_merge() -> str:
            # Create a minimal client for merge resolution
            client = create_simple_client(
                agent_type="merge_resolver",
                model=model,
                system_prompt=system,
                max_thinking_tokens=thinking_budget,
            )

            try:
                # Use async context manager to handle connect/disconnect
                # This is the standard pattern used throughout the codebase
                async with client:
                    await client.query(user)

                    response_text = ""
                    async for msg in client.receive_response():
                        msg_type = type(msg).__name__
                        if msg_type == "AssistantMessage" and hasattr(msg, "content"):
                            for block in msg.content:
                                # Must check block type - only TextBlock has .text attribute
                                block_type = type(block).__name__
                                if block_type == "TextBlock" and hasattr(block, "text"):
                                    response_text += block.text

                    logger.info("AI merge response: %s chars", len(response_text))
                    return response_text

            except Exception as exc:
                logger.error("iFlow SDK call failed: %s", exc)
                print(f"    [ERROR] iFlow SDK error: {exc}", file=sys.stderr)
                return ""

        try:
            return asyncio.run(_run_merge())
        except Exception as exc:
            logger.error("asyncio.run failed: %s", exc)
            print(f"    [ERROR] asyncio error: {exc}", file=sys.stderr)
            return ""

    logger.info("Using iFlow SDK for merge resolution")
    return AIResolver(ai_call_fn=call_iflow)

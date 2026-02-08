"""
iFlow Agent SDK Compatibility Layer
==================================

This module provides minimal shims for the legacy Claude Agent SDK API,
backed by the iFlow SDK. It allows existing integrations to run on iFlow
without the Claude SDK dependency.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, AsyncIterator, Callable, Iterable

from core.auth import ensure_iflow_auth_env, has_iflow_auth
from core.iflow_client import create_iflow_client
from core.iflow_compat import (
    AssistantMessage,
    IFlowCompatClient,
    TextBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
)
from phase_config import resolve_model_id

logger = logging.getLogger(__name__)


@dataclass
class ClaudeAgentOptions:
    model: str | None = None
    system_prompt: str | None = None
    allowed_tools: list[str] | None = None
    max_turns: int | None = None
    max_thinking_tokens: int | None = None
    cwd: str | None = None
    settings: str | None = None
    output_format: dict | None = None
    agents: dict[str, Any] | None = None
    mcp_servers: dict[str, Any] | None = None
    env: dict[str, str] | None = None
    permission_mode: str | None = None


@dataclass
class AgentDefinition:
    description: str
    prompt: str
    tools: list[str] | None = None
    model: str | None = None


def tool(name: str, description: str, params: dict[str, Any] | None = None) -> Callable:
    """Decorator to attach tool metadata to a function."""

    def decorator(fn: Callable) -> Callable:
        setattr(fn, "__tool_name__", name)
        setattr(fn, "__tool_description__", description)
        setattr(fn, "__tool_params__", params or {})
        return fn

    return decorator


def create_sdk_mcp_server(
    name: str,
    version: str,
    tools: Iterable[Callable],
) -> dict[str, Any]:
    """Return a lightweight MCP server descriptor for compatibility."""
    return {
        "name": name,
        "version": version,
        "tools": list(tools),
    }


def _normalize_mcp_servers(servers: dict[str, Any] | list[dict[str, Any]] | None) -> list[dict[str, Any]] | None:
    if not servers:
        return None
    if isinstance(servers, list):
        return servers
    if isinstance(servers, dict):
        normalized: list[dict[str, Any]] = []
        for key, value in servers.items():
            if isinstance(value, dict):
                entry = {"id": key, "name": key}
                entry.update(value)
                normalized.append(entry)
        return normalized or None
    return None


def _resolve_model(model: str | None) -> str:
    if not model:
        return "glm-4.7"

    lower = model.lower()
    if lower in ("haiku", "sonnet", "opus"):
        return resolve_model_id(lower)
    if "claude-haiku" in lower:
        return resolve_model_id("haiku")
    if "claude-sonnet" in lower:
        return resolve_model_id("sonnet")
    if "claude-opus" in lower:
        return resolve_model_id("opus")
    return resolve_model_id(model)


def _is_read_only(allowed_tools: list[str] | None) -> bool:
    if not allowed_tools:
        return False
    write_markers = (
        "write",
        "edit",
        "bash",
        "shell",
        "terminal",
        "applypatch",
        "delete",
        "remove",
        "mkdir",
        "touch",
        "mv",
        "cp",
    )
    for tool_name in allowed_tools:
        lower = tool_name.lower()
        if any(marker in lower for marker in write_markers):
            return False
    return True


class ClaudeSDKClient:
    """Compatibility client that proxies to the iFlow SDK."""

    def __init__(self, options: ClaudeAgentOptions | dict | None = None) -> None:
        if options is None:
            options = ClaudeAgentOptions()
        if isinstance(options, dict):
            options = ClaudeAgentOptions(**options)
        self.options = options
        self._client: IFlowCompatClient | None = None

    def _build_client(self) -> IFlowCompatClient:
        if not has_iflow_auth():
            raise RuntimeError("iFlow authentication required.")
        ensure_iflow_auth_env()

        cwd = Path(self.options.cwd).resolve() if self.options.cwd else Path.cwd()
        model = _resolve_model(self.options.model)
        session_settings: dict[str, Any] | None = None
        if self.options.system_prompt or self.options.max_thinking_tokens is not None:
            session_settings = {}
            if self.options.system_prompt:
                session_settings["system_prompt"] = self.options.system_prompt
            if self.options.max_thinking_tokens is not None:
                session_settings["max_thinking_tokens"] = self.options.max_thinking_tokens
            if self.options.output_format is not None:
                session_settings["output_format"] = self.options.output_format

        client = create_iflow_client(
            project_dir=cwd,
            model=model,
            permission_mode=self.options.permission_mode,
            enable_thinking=bool(self.options.max_thinking_tokens and self.options.max_thinking_tokens > 0),
            max_turns=self.options.max_turns,
            session_settings=session_settings,
            mcp_servers=_normalize_mcp_servers(self.options.mcp_servers),
            file_access=bool(self.options.cwd),
            file_allowed_dirs=[str(cwd)] if self.options.cwd else None,
            file_read_only=_is_read_only(self.options.allowed_tools),
        )
        return IFlowCompatClient(client)

    async def __aenter__(self) -> "ClaudeSDKClient":
        if self._client is None:
            self._client = self._build_client()
        await self._client.__aenter__()
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        if self._client:
            await self._client.__aexit__(exc_type, exc, tb)

    async def query(self, prompt: str) -> None:
        if self._client is None:
            self._client = self._build_client()
        await self._client.query(prompt)

    async def receive_response(self) -> AsyncIterator[Any]:
        if self._client is None:
            self._client = self._build_client()
        async for msg in self._client.receive_response():
            yield msg

    async def receive_messages(self) -> AsyncIterator[Any]:
        async for msg in self.receive_response():
            yield msg


def _extract_json(text: str) -> Any | None:
    if not text:
        return None

    code_block = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
    if code_block:
        candidate = code_block.group(1)
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass

    brace_start = text.find("{")
    brace_end = text.rfind("}")
    if brace_start != -1 and brace_end != -1 and brace_end > brace_start:
        candidate = text[brace_start : brace_end + 1]
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass

    list_start = text.find("[")
    list_end = text.rfind("]")
    if list_start != -1 and list_end != -1 and list_end > list_start:
        candidate = text[list_start : list_end + 1]
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass

    return None


async def query(
    prompt: str,
    options: ClaudeAgentOptions | dict | None = None,
) -> AsyncIterator[Any]:
    """Run a single SDK-style query and stream responses."""
    resolved_options = options
    if isinstance(options, dict):
        resolved_options = ClaudeAgentOptions(**options)
    client = ClaudeSDKClient(options=resolved_options)
    async with client:
        await client.query(prompt)
        collected_text = ""

        async for msg in client.receive_response():
            if isinstance(msg, AssistantMessage):
                for block in msg.content:
                    if isinstance(block, TextBlock):
                        collected_text += block.text
            yield msg

        if isinstance(resolved_options, ClaudeAgentOptions) and resolved_options.output_format:
            structured = _extract_json(collected_text)
            if structured is not None:
                tool_block = ToolUseBlock(name="StructuredOutput", input=structured)
                yield AssistantMessage([tool_block], structured_output=structured)

IFlowAgentOptions = ClaudeAgentOptions
IFlowSDKClient = ClaudeSDKClient
iflow_query = query

__all__ = [
    "AgentDefinition",
    "AssistantMessage",
    "ClaudeAgentOptions",
    "ClaudeSDKClient",
    "IFlowAgentOptions",
    "IFlowSDKClient",
    "TextBlock",
    "ToolResultBlock",
    "ToolUseBlock",
    "UserMessage",
    "create_sdk_mcp_server",
    "iflow_query",
    "query",
    "tool",
]

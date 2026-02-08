"""
iFlow compatibility utilities.

Provides a lightweight wrapper around the iFlow SDK client that emits
Claude-like message objects (AssistantMessage/TextBlock/ToolUseBlock) so
existing agent logic can keep working without the Claude SDK dependency.
"""

from __future__ import annotations

import inspect
from dataclasses import dataclass
from typing import Any, AsyncIterator, Iterable

from .iflow_client import iter_agent_messages, send_agent_message


@dataclass
class TextBlock:
    text: str
    type: str = "text"


@dataclass
class ToolUseBlock:
    name: str
    input: Any = None
    id: str | None = None
    type: str = "tool_use"


@dataclass
class ToolResultBlock:
    content: Any
    is_error: bool = False
    tool_name: str | None = None
    tool_use_id: str | None = None
    type: str = "tool_result"


@dataclass
class AssistantMessage:
    content: list[Any]
    structured_output: Any | None = None


@dataclass
class UserMessage:
    content: list[Any]


def _extract_text_from_message(msg: Any) -> str | None:
    if hasattr(msg, "content") and isinstance(msg.content, str):
        return msg.content
    if hasattr(msg, "chunk") and msg.chunk is not None:
        chunk = msg.chunk
        if hasattr(chunk, "text"):
            return chunk.text
        if isinstance(chunk, str):
            return chunk
        return str(chunk)
    if hasattr(msg, "content") and msg.content is not None:
        return str(msg.content)
    return None


def _convert_iflow_message(msg: Any) -> Iterable[Any]:
    msg_type = type(msg).__name__

    if msg_type == "AssistantMessage":
        if hasattr(msg, "content") and isinstance(msg.content, list):
            # Already Claude-like (or compat) payload.
            return [msg]

        text = _extract_text_from_message(msg)
        if text:
            return [AssistantMessage([TextBlock(text)])]
        return []

    if msg_type == "ToolCallMessage":
        tool_name = getattr(msg, "tool_name", None) or getattr(msg, "name", None)
        tool_args = getattr(msg, "args", None)
        if tool_args is None:
            tool_args = getattr(msg, "input", None)
        tool_id = getattr(msg, "id", None) or getattr(msg, "tool_call_id", None) or getattr(msg, "call_id", None)
        if tool_name:
            return [AssistantMessage([ToolUseBlock(tool_name, tool_args, tool_id)])]
        return []

    if msg_type == "ToolResultMessage":
        tool_name = getattr(msg, "tool_name", None) or getattr(msg, "name", None)
        output = getattr(msg, "output", None)
        if output is None:
            output = getattr(msg, "result", None)
        if output is None:
            output = getattr(msg, "content", None)
        is_error = bool(getattr(msg, "is_error", False))
        if getattr(msg, "error", None) is not None:
            is_error = True
        tool_use_id = (
            getattr(msg, "tool_use_id", None)
            or getattr(msg, "tool_call_id", None)
            or getattr(msg, "id", None)
        )
        return [
            UserMessage(
                [ToolResultBlock(output, is_error=is_error, tool_name=tool_name, tool_use_id=tool_use_id)]
            )
        ]

    return [msg]


class IFlowCompatClient:
    """
    Wrap an IFlow client and emit Claude-compatible message objects.
    """

    def __init__(self, client: Any) -> None:
        self._client = client

    async def __aenter__(self) -> "IFlowCompatClient":
        enter = getattr(self._client, "__aenter__", None)
        if enter and inspect.iscoroutinefunction(enter):
            await enter()
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        exit_fn = getattr(self._client, "__aexit__", None)
        if exit_fn and inspect.iscoroutinefunction(exit_fn):
            await exit_fn(exc_type, exc, tb)

    async def query(self, prompt: str) -> None:
        await send_agent_message(self._client, prompt)

    async def send_message(self, prompt: str) -> None:
        await send_agent_message(self._client, prompt)

    async def receive_response(self) -> AsyncIterator[Any]:
        async for msg in iter_agent_messages(self._client):
            for converted in _convert_iflow_message(msg):
                yield converted

    async def receive_messages(self) -> AsyncIterator[Any]:
        async for msg in self.receive_response():
            yield msg

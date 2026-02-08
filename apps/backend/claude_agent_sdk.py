"""
Deprecated Claude Agent SDK shim.

This module keeps legacy imports working while routing to the iFlow-backed
compatibility layer in iflow_agent_sdk.
"""

from iflow_agent_sdk import (
    AgentDefinition,
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    IFlowAgentOptions,
    IFlowSDKClient,
    TextBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
    create_sdk_mcp_server,
    iflow_query,
    query,
    tool,
)

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

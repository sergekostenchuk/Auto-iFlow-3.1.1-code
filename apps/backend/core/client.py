"""
iFlow Client Configuration
==========================

Functions for creating and configuring the iFlow SDK client.

All AI interactions should use `create_client()` to ensure consistent configuration
and proper tool/MCP server setup. For simple single-turn operations, use
`create_simple_client()` from `core.simple_client`.
"""

import copy
import json
import logging
import os
import threading
import time
from pathlib import Path
from typing import Any

from init import DEFAULT_AUTO_BUILD_DIR
logger = logging.getLogger(__name__)

# =============================================================================
# Project Index Cache
# =============================================================================
# Caches project index and capabilities to avoid reloading on every create_client() call.
# This significantly reduces the time to create new agent sessions.

_PROJECT_INDEX_CACHE: dict[str, tuple[dict[str, Any], dict[str, bool], float]] = {}
_CACHE_TTL_SECONDS = 300  # 5 minute TTL
_CACHE_LOCK = threading.Lock()  # Protects _PROJECT_INDEX_CACHE access


def _get_cached_project_data(
    project_dir: Path,
) -> tuple[dict[str, Any], dict[str, bool]]:
    """
    Get project index and capabilities with caching.

    Args:
        project_dir: Path to the project directory

    Returns:
        Tuple of (project_index, project_capabilities)
    """

    key = str(project_dir.resolve())
    now = time.time()
    debug = os.environ.get("DEBUG", "").lower() in ("true", "1")

    # Check cache with lock
    with _CACHE_LOCK:
        if key in _PROJECT_INDEX_CACHE:
            cached_index, cached_capabilities, cached_time = _PROJECT_INDEX_CACHE[key]
            cache_age = now - cached_time
            if cache_age < _CACHE_TTL_SECONDS:
                if debug:
                    print(
                        f"[ClientCache] Cache HIT for project index (age: {cache_age:.1f}s / TTL: {_CACHE_TTL_SECONDS}s)"
                    )
                logger.debug(f"Using cached project index for {project_dir}")
                # Return deep copies to prevent callers from corrupting the cache
                return copy.deepcopy(cached_index), copy.deepcopy(cached_capabilities)
            elif debug:
                print(
                    f"[ClientCache] Cache EXPIRED for project index (age: {cache_age:.1f}s > TTL: {_CACHE_TTL_SECONDS}s)"
                )

    # Cache miss or expired - load fresh data (outside lock to avoid blocking)
    load_start = time.time()
    logger.debug(f"Loading project index for {project_dir}")
    project_index = load_project_index(project_dir)
    project_capabilities = detect_project_capabilities(project_index)

    if debug:
        load_duration = (time.time() - load_start) * 1000
        print(
            f"[ClientCache] Cache MISS - loaded project index in {load_duration:.1f}ms"
        )

    # Store in cache with lock - use double-checked locking pattern
    # Re-check if another thread populated the cache while we were loading
    with _CACHE_LOCK:
        if key in _PROJECT_INDEX_CACHE:
            cached_index, cached_capabilities, cached_time = _PROJECT_INDEX_CACHE[key]
            cache_age = time.time() - cached_time
            if cache_age < _CACHE_TTL_SECONDS:
                # Another thread already cached valid data while we were loading
                if debug:
                    print(
                        "[ClientCache] Cache was populated by another thread, using cached data"
                    )
                # Return deep copies to prevent callers from corrupting the cache
                return copy.deepcopy(cached_index), copy.deepcopy(cached_capabilities)
        # Either no cache entry or it's expired - store our fresh data
        _PROJECT_INDEX_CACHE[key] = (project_index, project_capabilities, time.time())

    # Return the freshly loaded data (no need to copy since it's not from cache)
    return project_index, project_capabilities


def invalidate_project_cache(project_dir: Path | None = None) -> None:
    """
    Invalidate the project index cache.

    Args:
        project_dir: Specific project to invalidate, or None to clear all
    """
    with _CACHE_LOCK:
        if project_dir is None:
            _PROJECT_INDEX_CACHE.clear()
            logger.debug("Cleared all project index cache entries")
        else:
            key = str(project_dir.resolve())
            if key in _PROJECT_INDEX_CACHE:
                del _PROJECT_INDEX_CACHE[key]
                logger.debug(f"Invalidated project index cache for {project_dir}")


from agents.tools_pkg import get_required_mcp_servers
from core.iflow_client import create_iflow_client
from core.iflow_compat import IFlowCompatClient
from linear_updater import is_linear_enabled
from prompts_pkg.project_context import detect_project_capabilities, load_project_index


def _validate_custom_mcp_server(server: dict) -> bool:
    """
    Validate a custom MCP server configuration for security.

    Ensures only expected fields with valid types are present.
    Rejects configurations that could lead to command injection.

    Args:
        server: Dict representing a custom MCP server configuration

    Returns:
        True if valid, False otherwise
    """
    if not isinstance(server, dict):
        return False

    # Required fields
    required_fields = {"id", "name", "type"}
    if not all(field in server for field in required_fields):
        logger.warning(
            f"Custom MCP server missing required fields: {required_fields - server.keys()}"
        )
        return False

    # Validate field types
    if not isinstance(server.get("id"), str) or not server["id"]:
        return False
    if not isinstance(server.get("name"), str) or not server["name"]:
        return False
    # FIX: Changed from ('command', 'url') to ('command', 'http') to match actual usage
    if server.get("type") not in ("command", "http"):
        logger.warning(f"Invalid MCP server type: {server.get('type')}")
        return False

    # Allowlist of safe executable commands for MCP servers
    # Only allow known package managers and interpreters - NO shell commands
    SAFE_COMMANDS = {
        "npx",
        "npm",
        "node",
        "python",
        "python3",
        "uv",
        "uvx",
    }

    # Blocklist of dangerous shell commands that should never be allowed
    DANGEROUS_COMMANDS = {
        "bash",
        "sh",
        "cmd",
        "powershell",
        "pwsh",  # PowerShell Core
        "/bin/bash",
        "/bin/sh",
        "/bin/zsh",
        "/usr/bin/bash",
        "/usr/bin/sh",
        "zsh",
        "fish",
    }

    # Dangerous interpreter flags that allow arbitrary code execution
    # Covers Python (-e, -c, -m, -p), Node.js (--eval, --print, loaders), and general
    DANGEROUS_FLAGS = {
        "--eval",
        "-e",
        "-c",
        "--exec",
        "-m",  # Python module execution
        "-p",  # Python eval+print
        "--print",  # Node.js print
        "--input-type=module",  # Node.js ES module mode
        "--experimental-loader",  # Node.js custom loaders
        "--require",  # Node.js require injection
        "-r",  # Node.js require shorthand
    }

    # Type-specific validation
    if server["type"] == "command":
        if not isinstance(server.get("command"), str) or not server["command"]:
            logger.warning("Command-type MCP server missing 'command' field")
            return False

        # SECURITY FIX: Validate command is in safe list and not in dangerous list
        command = server.get("command", "")

        # Reject paths - commands must be bare names only (no / or \)
        # This prevents path traversal like '/custom/malicious' or './evil'
        if "/" in command or "\\" in command:
            logger.warning(
                f"Rejected command with path in MCP server: {command}. "
                f"Commands must be bare names without path separators."
            )
            return False

        if command in DANGEROUS_COMMANDS:
            logger.warning(
                f"Rejected dangerous command in MCP server: {command}. "
                f"Shell commands are not allowed for security reasons."
            )
            return False

        if command not in SAFE_COMMANDS:
            logger.warning(
                f"Rejected unknown command in MCP server: {command}. "
                f"Only allowed commands: {', '.join(sorted(SAFE_COMMANDS))}"
            )
            return False

        # Validate args is a list of strings if present
        if "args" in server:
            if not isinstance(server["args"], list):
                return False
            if not all(isinstance(arg, str) for arg in server["args"]):
                return False
            # Check for dangerous interpreter flags that allow code execution
            for arg in server["args"]:
                if arg in DANGEROUS_FLAGS:
                    logger.warning(
                        f"Rejected dangerous flag '{arg}' in MCP server args. "
                        f"Interpreter code execution flags are not allowed."
                    )
                    return False
    elif server["type"] == "http":
        if not isinstance(server.get("url"), str) or not server["url"]:
            logger.warning("HTTP-type MCP server missing 'url' field")
            return False
        # Validate headers is a dict of strings if present
        if "headers" in server:
            if not isinstance(server["headers"], dict):
                return False
            if not all(
                isinstance(k, str) and isinstance(v, str)
                for k, v in server["headers"].items()
            ):
                return False

    # Optional description must be string if present
    if "description" in server and not isinstance(server.get("description"), str):
        return False

    # Reject any unexpected fields that could be exploited
    allowed_fields = {
        "id",
        "name",
        "type",
        "command",
        "args",
        "url",
        "headers",
        "description",
    }
    unexpected_fields = set(server.keys()) - allowed_fields
    if unexpected_fields:
        logger.warning(f"Custom MCP server has unexpected fields: {unexpected_fields}")
        return False

    return True


def load_project_mcp_config(project_dir: Path) -> dict:
    """
    Load MCP configuration from project's data directory .env file.

    Returns a dict of MCP-related env vars:
    - CONTEXT7_ENABLED (default: true)
    - LINEAR_MCP_ENABLED (default: true)
    - ELECTRON_MCP_ENABLED (default: false)
    - PUPPETEER_MCP_ENABLED (default: false)
    - AGENT_MCP_<agent>_ADD (per-agent MCP additions)
    - AGENT_MCP_<agent>_REMOVE (per-agent MCP removals)
    - CUSTOM_MCP_SERVERS (JSON array of custom server configs)

    Args:
        project_dir: Path to the project directory

    Returns:
        Dict of MCP configuration values (string values, except CUSTOM_MCP_SERVERS which is parsed JSON)
    """
    env_path = project_dir / ".auto-iflow" / ".env"
    if not env_path.exists():
        return {}

    config = {}
    mcp_keys = {
        "CONTEXT7_ENABLED",
        "LINEAR_MCP_ENABLED",
        "ELECTRON_MCP_ENABLED",
        "PUPPETEER_MCP_ENABLED",
    }

    try:
        with open(env_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    key, value = line.split("=", 1)
                    key = key.strip()
                    value = value.strip().strip("\"'")
                    # Include global MCP toggles
                    if key in mcp_keys:
                        config[key] = value
                    # Include per-agent MCP overrides (AGENT_MCP_<agent>_ADD/REMOVE)
                    elif key.startswith("AGENT_MCP_"):
                        config[key] = value
                    # Include custom MCP servers (parse JSON with schema validation)
                    elif key == "CUSTOM_MCP_SERVERS":
                        try:
                            parsed = json.loads(value)
                            if not isinstance(parsed, list):
                                logger.warning(
                                    "CUSTOM_MCP_SERVERS must be a JSON array"
                                )
                                config["CUSTOM_MCP_SERVERS"] = []
                            else:
                                # Validate each server and filter out invalid ones
                                valid_servers = []
                                for i, server in enumerate(parsed):
                                    if _validate_custom_mcp_server(server):
                                        valid_servers.append(server)
                                    else:
                                        logger.warning(
                                            f"Skipping invalid custom MCP server at index {i}"
                                        )
                                config["CUSTOM_MCP_SERVERS"] = valid_servers
                        except json.JSONDecodeError:
                            logger.warning(
                                f"Failed to parse CUSTOM_MCP_SERVERS JSON: {value}"
                            )
                            config["CUSTOM_MCP_SERVERS"] = []
    except Exception as e:
        logger.debug(f"Failed to load project MCP config from {env_path}: {e}")

    return config


def is_graphiti_mcp_enabled() -> bool:
    """
    Check if Graphiti MCP server integration is enabled.

    Requires GRAPHITI_MCP_URL to be set (e.g., http://localhost:8000/mcp/)
    This is separate from GRAPHITI_ENABLED which controls the Python library integration.
    """
    return bool(os.environ.get("GRAPHITI_MCP_URL"))


def get_graphiti_mcp_url() -> str:
    """Get the Graphiti MCP server URL."""
    return os.environ.get("GRAPHITI_MCP_URL", "http://localhost:8000/mcp/")


def is_electron_mcp_enabled() -> bool:
    """
    Check if Electron MCP server integration is enabled.

    Requires ELECTRON_MCP_ENABLED to be set to 'true'.
    When enabled, QA agents can use Puppeteer MCP tools to connect to Electron apps
    via Chrome DevTools Protocol on the configured debug port.
    """
    return os.environ.get("ELECTRON_MCP_ENABLED", "").lower() == "true"


def get_electron_debug_port() -> int:
    """Get the Electron remote debugging port (default: 9222)."""
    return int(os.environ.get("ELECTRON_DEBUG_PORT", "9222"))


def should_use_claude_md() -> bool:
    """Check if CLAUDE.md instructions should be included in system prompt."""
    return os.environ.get("USE_CLAUDE_MD", "").lower() == "true"


def load_claude_md(project_dir: Path) -> str | None:
    """
    Load CLAUDE.md content from project root if it exists.

    Args:
        project_dir: Root directory of the project

    Returns:
        Content of CLAUDE.md if found, None otherwise
    """
    claude_md_path = project_dir / "CLAUDE.md"
    if claude_md_path.exists():
        try:
            return claude_md_path.read_text(encoding="utf-8")
        except Exception:
            return None
    return None


def create_client(
    project_dir: Path,
    spec_dir: Path,
    model: str,
    agent_type: str = "coder",
    max_thinking_tokens: int | None = None,
    output_format: dict | None = None,
    agents: dict | None = None,
) -> IFlowCompatClient:
    """
    Create an iFlow client configured for agent sessions.

    Args:
        project_dir: Root directory for the project (working directory)
        spec_dir: Directory containing the spec (for data access)
        model: iFlow model to use
        agent_type: Agent type identifier from AGENT_CONFIGS
                   (e.g., 'coder', 'planner', 'qa_reviewer', 'spec_gatherer')
        max_thinking_tokens: Token budget for extended thinking (None = disabled)
        output_format: Reserved for future iFlow structured output support
        agents: Reserved for future parallel subagent support

    Returns:
        Configured iFlow client wrapper
    """
    # Check if Linear integration is enabled
    linear_enabled = is_linear_enabled()
    linear_api_key = os.environ.get("LINEAR_API_KEY", "")

    # Load project capabilities for dynamic MCP tool selection
    # This enables context-aware tool injection based on project type
    # Uses caching to avoid reloading on every create_client() call
    project_index, project_capabilities = _get_cached_project_data(project_dir)

    # Load per-project MCP configuration from the project data directory (.env)
    mcp_config = load_project_mcp_config(project_dir)

    # Get required MCP servers for this agent type
    # This is the key optimization - only start servers the agent needs
    # Now also respects per-project MCP configuration
    required_servers = get_required_mcp_servers(
        agent_type,
        project_capabilities,
        linear_enabled,
        mcp_config,
    )

    # Check if Graphiti MCP is enabled (already filtered by get_required_mcp_servers)
    graphiti_mcp_enabled = "graphiti" in required_servers

    # Detect if we're running in a worktree and get the original project directory
    # Worktrees are located in:
    # - .auto-iflow worktrees/tasks/{spec-name}
    # When running in a worktree, allow access to both the worktree
    # and the original project's data directory for spec files.
    allowed_dirs = {project_dir.resolve(), spec_dir.resolve()}
    resolved_project_path = project_dir.resolve()

    # Check for worktree paths and extract original project directory
    # This handles spec worktrees, PR review worktrees, and legacy worktrees
    # Note: Windows paths are normalized to forward slashes before comparison
    worktree_markers = [
        f"/{DEFAULT_AUTO_BUILD_DIR}/worktrees/tasks/",  # Spec/task worktrees
        f"/{DEFAULT_AUTO_BUILD_DIR}/github/pr/worktrees/",  # PR review worktrees
    ]
    project_path_posix = str(resolved_project_path).replace("\\", "/")

    for marker in worktree_markers:
        if marker in project_path_posix:
            # Extract the original project directory (parent of worktree location)
            # Use rsplit to get the rightmost occurrence (handles nested projects)
            original_project_str = project_path_posix.rsplit(marker, 1)[0]
            original_project_dir = Path(original_project_str)

            # Grant file access for relevant directories in the original project
            dirs_to_permit = [
                original_project_dir / ".auto-iflow",
            ]

            for dir_path in dirs_to_permit:
                if dir_path.exists():
                    allowed_dirs.add(dir_path.resolve())
            break

    # Build list of MCP servers for display based on required_servers
    mcp_servers_list = []
    if "context7" in required_servers:
        mcp_servers_list.append("context7 (documentation)")
    if "electron" in required_servers:
        mcp_servers_list.append(
            f"electron (desktop automation, port {get_electron_debug_port()})"
        )
    if "puppeteer" in required_servers:
        mcp_servers_list.append("puppeteer (browser automation)")
    if "linear" in required_servers:
        mcp_servers_list.append("linear (project management)")
    if graphiti_mcp_enabled:
        mcp_servers_list.append("graphiti-memory (knowledge graph)")
    if mcp_servers_list:
        print(f"   - MCP servers: {', '.join(mcp_servers_list)}")
    else:
        print("   - MCP servers: none (minimal configuration)")

    # Show detected project capabilities for QA agents
    if agent_type in ("qa_reviewer", "qa_fixer") and any(project_capabilities.values()):
        caps = [
            k.replace("is_", "").replace("has_", "")
            for k, v in project_capabilities.items()
            if v
        ]
        print(f"   - Project capabilities: {', '.join(caps)}")
    print()

    # Configure MCP servers - ONLY start servers that are required
    # This is the key optimization to reduce context bloat and startup latency
    mcp_servers: list[dict[str, Any]] = []

    def _add_mcp_server(server_id: str, config: dict[str, Any]) -> None:
        entry = {"id": server_id, "name": server_id}
        entry.update(config)
        mcp_servers.append(entry)

    if "context7" in required_servers:
        _add_mcp_server(
            "context7",
            {"command": "npx", "args": ["-y", "@upstash/context7-mcp"]},
        )

    if "electron" in required_servers:
        # Electron MCP for desktop apps
        _add_mcp_server("electron", {"command": "npm", "args": ["exec", "electron-mcp-server"]})

    if "puppeteer" in required_servers:
        # Puppeteer for web frontends (not Electron)
        _add_mcp_server("puppeteer", {"command": "npx", "args": ["puppeteer-mcp-server"]})

    if "linear" in required_servers and linear_api_key:
        _add_mcp_server(
            "linear",
            {
                "type": "http",
                "url": "https://mcp.linear.app/mcp",
                "headers": {"Authorization": f"Bearer {linear_api_key}"},
            },
        )

    if graphiti_mcp_enabled:
        _add_mcp_server("graphiti-memory", {"type": "http", "url": get_graphiti_mcp_url()})

    # Add custom MCP servers from project config
    custom_servers = mcp_config.get("CUSTOM_MCP_SERVERS", [])
    for custom in custom_servers:
        server_id = custom.get("id")
        if not server_id:
            continue
        # Only include if agent has it in their effective server list
        if server_id not in required_servers:
            continue
        server_type = custom.get("type", "command")
        if server_type == "command":
            _add_mcp_server(
                server_id,
                {"command": custom.get("command", "npx"), "args": custom.get("args", [])},
            )
        elif server_type == "http":
            server_config = {
                "type": "http",
                "url": custom.get("url", ""),
            }
            if custom.get("headers"):
                server_config["headers"] = custom["headers"]
            _add_mcp_server(server_id, server_config)

    # Build system prompt
    base_prompt = (
        f"You are an expert full-stack developer building production-quality software. "
        f"Your working directory is: {project_dir.resolve()}\n"
        f"Your filesystem access is RESTRICTED to this directory only. "
        f"Use relative paths (starting with ./) for all file operations. "
        f"Never use absolute paths or try to access files outside your working directory.\n\n"
        f"You follow existing code patterns, write clean maintainable code, and verify "
        f"your work through thorough testing. You communicate progress through Git commits "
        f"and build-progress.txt updates."
    )

    # Include CLAUDE.md if enabled and present
    if should_use_claude_md():
        claude_md_content = load_claude_md(project_dir)
        if claude_md_content:
            base_prompt = f"{base_prompt}\n\n# Project Instructions (from CLAUDE.md)\n\n{claude_md_content}"
            print("   - CLAUDE.md: included in system prompt")
        else:
            print("   - CLAUDE.md: not found in project root")
    else:
        print("   - CLAUDE.md: disabled by project settings")
    print()

    session_settings = {
        "system_prompt": base_prompt,
    }

    client = create_iflow_client(
        project_dir=project_dir,
        model=model,
        permission_mode=os.environ.get("IFLOW_PERMISSION_MODE", "auto"),
        enable_thinking=max_thinking_tokens is not None,
        max_turns=1000,
        session_settings=session_settings,
        mcp_servers=mcp_servers if mcp_servers else None,
        file_access=True,
        file_allowed_dirs=[str(path) for path in sorted(allowed_dirs)],
        file_read_only=False,
    )

    return IFlowCompatClient(client)

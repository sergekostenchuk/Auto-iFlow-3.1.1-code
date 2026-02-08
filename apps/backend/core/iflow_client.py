"""
iFlow client utilities for coding agents.
"""

from __future__ import annotations

import inspect
import logging
import os
import json
import sys
from pathlib import Path
from typing import Any, AsyncIterator

logger = logging.getLogger(__name__)


def _load_iflow() -> tuple[Any, Any, Any | None, Any | None]:
    try:
        from iflow_sdk import IFlowClient, IFlowOptions
    except ImportError as exc:  # pragma: no cover - runtime requirement
        raise RuntimeError(
            "iflow-sdk is required. Install with: pip install iflow-sdk"
        ) from exc

    try:
        from iflow_sdk import PermissionMode  # type: ignore
    except Exception:
        PermissionMode = None

    try:
        from iflow_sdk import ApprovalMode  # type: ignore
    except Exception:
        ApprovalMode = None

    try:
        # Import for side-effect: apply no-checkpointing patch if available.
        from wrappers import iflow_wrapper as _iflow_wrapper  # noqa: F401
    except Exception:
        pass

    return IFlowClient, IFlowOptions, PermissionMode, ApprovalMode


def _get_enum_value(enum_cls: Any | None, name: str) -> Any | None:
    if not enum_cls:
        return None
    return getattr(enum_cls, name, None)


def _resolve_permission_mode(
    mode: str | None,
    permission_enum: Any | None,
    approval_enum: Any | None,
) -> Any | None:
    normalized = (mode or "auto").lower().strip()

    if permission_enum is not None:
        mapping = {
            "auto": _get_enum_value(permission_enum, "AUTO"),
            "manual": _get_enum_value(permission_enum, "MANUAL"),
            "selective": _get_enum_value(permission_enum, "SELECTIVE"),
        }
        resolved = mapping.get(normalized)
        if resolved is not None:
            return resolved
        return _get_enum_value(permission_enum, "SELECTIVE")

    if approval_enum is not None:
        mapping = {
            "yolo": _get_enum_value(approval_enum, "YOLO"),
            "auto": _get_enum_value(approval_enum, "AUTO_EDIT"),
            "manual": _get_enum_value(approval_enum, "DEFAULT"),
            "plan": _get_enum_value(approval_enum, "PLAN"),
        }
        resolved = mapping.get(normalized)
        if resolved is not None:
            return resolved
        return _get_enum_value(approval_enum, "AUTO_EDIT")

    return None


def _build_iflow_options(options_cls: Any, options_kwargs: dict[str, Any]) -> Any:
    sig = inspect.signature(options_cls)
    allowed = set(sig.parameters.keys())
    filtered = {k: v for k, v in options_kwargs.items() if k in allowed and v is not None}
    return options_cls(**filtered)

def _iter_iflow_settings_paths() -> list[Path]:
    paths: list[Path] = []

    env_dir = os.environ.get("IFLOW_HOME") or os.environ.get("IFLOW_DIR")
    if env_dir:
        base = Path(env_dir).expanduser()
        paths.append(base / "settings.json")
        paths.append(base / "config" / "settings.json")

    home = Path.home()
    paths.append(home / ".iflow" / "settings.json")
    paths.append(home / ".iflow" / "config" / "settings.json")

    xdg_config_home = os.environ.get("XDG_CONFIG_HOME")
    if xdg_config_home:
        base = Path(xdg_config_home).expanduser()
    else:
        base = home / ".config"
    paths.append(base / "iflow" / "settings.json")
    paths.append(base / "iflow" / "config" / "settings.json")

    if sys.platform == "darwin":
        paths.append(home / "Library" / "Application Support" / "iflow" / "settings.json")
        paths.append(home / "Library" / "Application Support" / "iFlow" / "settings.json")
        paths.append(home / "Library" / "Application Support" / "iflow" / "config" / "settings.json")
        paths.append(home / "Library" / "Application Support" / "iFlow" / "config" / "settings.json")

    return paths


def _load_iflow_cli_settings() -> dict[str, Any]:
    for settings_path in _iter_iflow_settings_paths():
        try:
            if settings_path.exists():
                with settings_path.open("r", encoding="utf-8") as fh:
                    data = json.load(fh)
                if isinstance(data, dict):
                    return data
        except Exception:
            continue
    return {}


def _resolve_iflow_auth(
    model_name_override: str | None = None,
) -> tuple[str | None, dict[str, Any] | None]:
    auth_method_id = os.environ.get("IFLOW_AUTH_METHOD_ID") or os.environ.get("IFLOW_AUTH_METHOD")

    api_key = os.environ.get("IFLOW_API_KEY") or os.environ.get("IFLOW_APIKEY")
    base_url = os.environ.get("IFLOW_BASE_URL")
    model_name = os.environ.get("IFLOW_MODEL_NAME")

    auth_state = None
    try:
        from core.auth import get_iflow_auth_state

        auth_state = get_iflow_auth_state()
    except Exception:
        auth_state = None

    if not auth_method_id or not api_key or not base_url:
        settings = _load_iflow_cli_settings()
        if not auth_method_id:
            auth_method_id = settings.get("selectedAuthType")
        if not api_key:
            api_key = settings.get("apiKey") or settings.get("iflowApiKey")
        if not base_url:
            base_url = settings.get("baseUrl")
        if not model_name:
            model_name = settings.get("modelName")

    if auth_state:
        if not auth_method_id:
            auth_method_id = auth_state.auth_type
        if not api_key:
            api_key = auth_state.api_key
        if not base_url:
            base_url = auth_state.base_url
        if not model_name:
            model_name = auth_state.model_name
        if auth_method_id == "iflow" and not api_key and auth_state.has_web_login:
            auth_method_id = "oauth-iflow"

    if not auth_method_id and api_key:
        auth_method_id = "iflow"

    if auth_method_id == "iflow" and api_key:
        auth_info: dict[str, Any] = {"apiKey": api_key}
        if base_url:
            auth_info["baseUrl"] = base_url
        model_name_final = model_name_override or model_name
        if model_name_final:
            auth_info["modelName"] = model_name_final
        return auth_method_id, auth_info

    return auth_method_id, None


def create_iflow_client(
    project_dir: Path,
    model: str,
    permission_mode: str | None = None,
    enable_thinking: bool = False,
    timeout: float | None = None,
    max_turns: int | None = None,
    log_level: str | None = None,
    session_settings: Any | None = None,
    mcp_servers: list[dict[str, Any]] | None = None,
    commands: list[dict[str, Any]] | None = None,
    file_access: bool | None = None,
    file_allowed_dirs: list[str] | None = None,
    file_read_only: bool | None = None,
    process_log_file: str | None = None,
    process_start_port: int | None = None,
    auto_start_process: bool | None = None,
) -> Any:
    """
    Create an iFlow client configured for coding agents.

    Args:
        project_dir: Working directory for the agent.
        model: iFlow model ID.
        permission_mode: auto/manual/selective (if supported by SDK).
        enable_thinking: Enable model thinking mode when supported.
        timeout: Optional timeout in seconds.
        max_turns: Optional max turns for a session.
        log_level: Optional log level for iFlow process.

    Returns:
        Configured IFlowClient instance.
    """
    IFlowClient, IFlowOptions, PermissionMode, ApprovalMode = _load_iflow()

    if permission_mode is None:
        permission_mode = os.environ.get("IFLOW_PERMISSION_MODE", "auto")

    resolved_permission = _resolve_permission_mode(
        permission_mode, PermissionMode, ApprovalMode
    )

    cwd = str(project_dir.resolve())
    options_kwargs = {
        "cwd": cwd,
        "permission_mode": resolved_permission,
        "approval_mode": resolved_permission,
        "timeout": timeout,
        "max_turns": max_turns,
        "log_level": log_level,
        "session_settings": session_settings,
        "mcp_servers": mcp_servers,
        "commands": commands,
        "file_access": file_access,
        "file_allowed_dirs": file_allowed_dirs,
        "file_read_only": file_read_only,
        "process_log_file": process_log_file,
        "process_start_port": process_start_port,
        "auto_start_process": auto_start_process,
    }

    auth_method_id, auth_method_info = _resolve_iflow_auth(model_name_override=model)
    if auth_method_id:
        options_kwargs["auth_method_id"] = auth_method_id
    if auth_method_info:
        options_kwargs["auth_method_info"] = auth_method_info

    options = _build_iflow_options(IFlowOptions, options_kwargs)
    return IFlowClient(options)


async def send_agent_message(client: Any, message: str) -> None:
    if hasattr(client, "query"):
        await client.query(message)
        return
    if hasattr(client, "send_message"):
        await client.send_message(message)
        return
    raise RuntimeError("Client does not support query/send_message")


async def iter_agent_messages(client: Any) -> AsyncIterator[Any]:
    if hasattr(client, "receive_response"):
        async for msg in client.receive_response():
            yield msg
        return
    if hasattr(client, "receive_messages"):
        async for msg in client.receive_messages():
            yield msg
        return
    raise RuntimeError("Client does not support receive_response/receive_messages")

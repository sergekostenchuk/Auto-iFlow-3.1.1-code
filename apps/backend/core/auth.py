"""
iFlow authentication helpers.

Resolves iFlow auth from environment variables and CLI settings files.
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


IFLOW_ENV_VARS = {
    "auth_method_id": ("IFLOW_AUTH_METHOD_ID", "IFLOW_AUTH_METHOD"),
    "api_key": ("IFLOW_API_KEY", "IFLOW_APIKEY"),
    "base_url": ("IFLOW_BASE_URL",),
    "model_name": ("IFLOW_MODEL_NAME",),
}


@dataclass
class IFlowAuthState:
    has_api_key: bool
    has_web_login: bool
    auth_type: str | None
    api_key: str | None
    base_url: str | None
    model_name: str | None


def _iter_iflow_base_dirs() -> list[Path]:
    paths: list[Path] = []

    env_dir = os.environ.get("IFLOW_HOME") or os.environ.get("IFLOW_DIR")
    if env_dir:
        paths.append(Path(env_dir).expanduser())

    paths.append(Path.home() / ".iflow")

    xdg_config_home = os.environ.get("XDG_CONFIG_HOME")
    if xdg_config_home:
        base = Path(xdg_config_home).expanduser()
    else:
        base = Path.home() / ".config"
    paths.append(base / "iflow")

    if sys.platform == "darwin":
        paths.append(Path.home() / "Library" / "Application Support" / "iflow")
        paths.append(Path.home() / "Library" / "Application Support" / "iFlow")

    # De-dupe while preserving order
    seen: set[Path] = set()
    unique_paths: list[Path] = []
    for path in paths:
        if path in seen:
            continue
        seen.add(path)
        unique_paths.append(path)

    return unique_paths


def _iter_iflow_settings_paths() -> list[Path]:
    paths: list[Path] = []
    for base_dir in _iter_iflow_base_dirs():
        paths.append(base_dir / "settings.json")
        paths.append(base_dir / "config" / "settings.json")
    return paths


def _iter_iflow_oauth_paths() -> list[Path]:
    names = ("oauth_creds.json", "credentials.json", "auth.json")
    paths: list[Path] = []
    for base_dir in _iter_iflow_base_dirs():
        for name in names:
            paths.append(base_dir / name)
            paths.append(base_dir / "config" / name)
    return paths


def _iter_iflow_accounts_paths() -> list[Path]:
    paths: list[Path] = []
    for base_dir in _iter_iflow_base_dirs():
        paths.append(base_dir / "iflow_accounts.json")
        paths.append(base_dir / "config" / "iflow_accounts.json")
    return paths


def _iter_iflow_log_dirs() -> list[Path]:
    paths: list[Path] = []
    for base_dir in _iter_iflow_base_dirs():
        paths.append(base_dir / "log")
        paths.append(base_dir / "logs")
    return paths


def _iter_iflow_log_files() -> list[Path]:
    files: list[Path] = []
    for log_dir in _iter_iflow_log_dirs():
        try:
            if not log_dir.exists() or not log_dir.is_dir():
                continue
            for entry in log_dir.iterdir():
                if entry.is_file() and entry.suffix == ".log":
                    files.append(entry)
        except Exception:
            continue
    return files


def _has_iflow_log_auth(auth_type: str) -> bool:
    for log_file in _iter_iflow_log_files():
        try:
            content = log_file.read_text(encoding="utf-8")
        except Exception:
            continue
        if not content:
            continue
        if f'Authenticated via "{auth_type}"' in content:
            return True
        if f"Authenticated via '{auth_type}'" in content:
            return True
    return False


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


def _has_token_like_value(value: Any) -> bool:
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, list):
        return any(_has_token_like_value(item) for item in value)
    if isinstance(value, dict):
        for key, entry in value.items():
            if isinstance(entry, str) and entry.strip():
                return True
            if "token" in key.lower() or "key" in key.lower() or "secret" in key.lower():
                if _has_token_like_value(entry):
                    return True
            if _has_token_like_value(entry):
                return True
    return False


def _has_iflow_oauth_credentials() -> bool:
    for creds_path in _iter_iflow_oauth_paths():
        if not creds_path.exists():
            continue
        try:
            raw = creds_path.read_text(encoding="utf-8").strip()
            if not raw:
                continue
            try:
                parsed = json.loads(raw)
                if _has_token_like_value(parsed):
                    return True
            except json.JSONDecodeError:
                return True
            if creds_path.stat().st_size > 0:
                return True
        except Exception:
            return True
    return False


def _has_iflow_accounts() -> bool:
    for accounts_path in _iter_iflow_accounts_paths():
        try:
            if not accounts_path.exists():
                continue
            with accounts_path.open("r", encoding="utf-8") as fh:
                data = json.load(fh)
            if not isinstance(data, dict):
                continue
            active = data.get("active")
            if isinstance(active, str) and active.strip():
                return True
            for key in ("accounts", "profiles", "old"):
                value = data.get(key)
                if isinstance(value, list) and value:
                    return True
        except Exception:
            continue
    return False


def _get_env_value(keys: tuple[str, ...]) -> str | None:
    for key in keys:
        value = os.environ.get(key)
        if value:
            return value
    return None


def get_iflow_auth_state() -> IFlowAuthState:
    settings = _load_iflow_cli_settings()

    auth_type = _get_env_value(IFLOW_ENV_VARS["auth_method_id"]) or settings.get(
        "selectedAuthType"
    )
    api_key = _get_env_value(IFLOW_ENV_VARS["api_key"]) or settings.get("apiKey") or settings.get(
        "iflowApiKey"
    )
    base_url = _get_env_value(IFLOW_ENV_VARS["base_url"]) or settings.get("baseUrl")
    model_name = _get_env_value(IFLOW_ENV_VARS["model_name"]) or settings.get("modelName")

    has_api_key = bool(api_key and str(api_key).strip())
    has_web_login = (
        auth_type == "oauth-iflow"
        or _has_iflow_oauth_credentials()
        or _has_iflow_accounts()
        or _has_iflow_log_auth("oauth-iflow")
    )

    if not auth_type and has_api_key:
        auth_type = "iflow"
    if not auth_type and has_web_login:
        auth_type = "oauth-iflow"
    if auth_type == "iflow" and not has_api_key and has_web_login:
        auth_type = "oauth-iflow"

    return IFlowAuthState(
        has_api_key=has_api_key,
        has_web_login=has_web_login,
        auth_type=auth_type,
        api_key=str(api_key).strip() if api_key else None,
        base_url=str(base_url).strip() if base_url else None,
        model_name=str(model_name).strip() if model_name else None,
    )


def has_iflow_auth() -> bool:
    state = get_iflow_auth_state()
    return state.has_api_key or state.has_web_login


def ensure_iflow_auth_env() -> None:
    state = get_iflow_auth_state()

    if state.auth_type and not _get_env_value(IFLOW_ENV_VARS["auth_method_id"]):
        os.environ["IFLOW_AUTH_METHOD_ID"] = state.auth_type

    if state.api_key and not _get_env_value(IFLOW_ENV_VARS["api_key"]):
        os.environ["IFLOW_API_KEY"] = state.api_key

    if state.base_url and not _get_env_value(IFLOW_ENV_VARS["base_url"]):
        os.environ["IFLOW_BASE_URL"] = state.base_url

    if state.model_name and not _get_env_value(IFLOW_ENV_VARS["model_name"]):
        os.environ["IFLOW_MODEL_NAME"] = state.model_name


def require_iflow_auth() -> None:
    if not has_iflow_auth():
        raise ValueError(
            "iFlow authentication required. Configure an API key in Settings → Integrations "
            "or sign in via Web login in the iFlow CLI."
        )

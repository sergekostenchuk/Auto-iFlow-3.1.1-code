"""
Model registry backed by shared/models.json.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

from core.paths import resolve_shared_path

logger = logging.getLogger(__name__)


def _load_models_json() -> dict[str, Any]:
    path = resolve_shared_path("models.json")
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _collect_aliases(models: list[dict[str, Any]]) -> dict[str, str]:
    alias_map: dict[str, str] = {}
    for model in models:
        model_id = model.get("id")
        for alias in model.get("aliases", []) or []:
            alias_map[alias] = model_id
    return alias_map


def _validate_unique_ids(models: list[dict[str, Any]]) -> None:
    seen: set[str] = set()
    for model in models:
        model_id = model.get("id")
        if not model_id:
            raise ValueError("Model entry missing required 'id'.")
        if model_id in seen:
            raise ValueError(f"Duplicate model id in models.json: {model_id}")
        seen.add(model_id)


def _validate_unique_aliases(models: list[dict[str, Any]], legacy_aliases: dict[str, str]) -> None:
    seen: dict[str, str] = {}
    for alias, target in legacy_aliases.items():
        if alias in seen and seen[alias] != target:
            raise ValueError(f"Duplicate legacy alias in models.json: {alias}")
        seen[alias] = target

    for model in models:
        model_id = model.get("id", "")
        for alias in model.get("aliases", []) or []:
            if alias in seen and seen[alias] != model_id:
                raise ValueError(f"Alias collision in models.json: {alias}")
            seen[alias] = model_id


def _validate_custom_model_entry(model: dict[str, Any]) -> bool:
    required = ("id", "displayName", "tier", "supportsThinking")
    missing = [field for field in required if field not in model]
    if missing:
        logger.warning(
            "Custom model missing required fields %s; skipping entry: %s",
            ", ".join(missing),
            model.get("id", "<unknown>"),
        )
        return False
    return True


def load_model_registry() -> dict[str, Any]:
    data = _load_models_json()
    models = data.get("models", [])
    legacy_aliases = data.get("legacyAliases", {})
    _validate_unique_ids(models)
    _validate_unique_aliases(models, legacy_aliases)
    return data


def get_all_models(api_profile: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    data = load_model_registry()
    base_models = data.get("models", [])
    custom_models = []
    if api_profile:
        custom_models = api_profile.get("custom_models", []) or []

    merged: dict[str, dict[str, Any]] = {m["id"]: dict(m) for m in base_models}

    for custom in custom_models:
        if not _validate_custom_model_entry(custom):
            continue
        model_id = custom["id"]
        if model_id in merged:
            logger.warning("Custom model overrides base model id: %s", model_id)
        merged[model_id] = dict(custom)

    return list(merged.values())


def get_legacy_aliases() -> dict[str, str]:
    return load_model_registry().get("legacyAliases", {})


def build_alias_map(api_profile: dict[str, Any] | None = None) -> dict[str, str]:
    data = load_model_registry()
    legacy_aliases = dict(data.get("legacyAliases", {}))
    models = get_all_models(api_profile)
    custom_aliases = _collect_aliases(models)

    for alias, target in custom_aliases.items():
        if alias in legacy_aliases and legacy_aliases[alias] != target:
            logger.warning("Custom alias overrides legacy alias: %s", alias)
        legacy_aliases[alias] = target

    return legacy_aliases


def resolve_model_id(model: str, api_profile: dict[str, Any] | None = None) -> str:
    """
    Resolve a model shorthand/alias to a full model ID.
    """
    env_var_map = {
        "haiku": ["IFLOW_DEFAULT_HAIKU_MODEL"],
        "sonnet": ["IFLOW_DEFAULT_SONNET_MODEL"],
        "opus": ["IFLOW_DEFAULT_OPUS_MODEL"],
    }
    if model in env_var_map:
        for env_var in env_var_map[model]:
            env_value = os.environ.get(env_var)
            if env_value:
                return env_value

    alias_map = build_alias_map(api_profile)
    return alias_map.get(model, model)


def get_model_info(model_id: str, api_profile: dict[str, Any] | None = None) -> dict[str, Any] | None:
    for model in get_all_models(api_profile):
        if model.get("id") == model_id:
            return model
    return None


def get_bootstrap_model() -> str:
    data = load_model_registry()
    bootstrap = data.get("bootstrapModel")
    if not bootstrap:
        raise ValueError("bootstrapModel missing from models.json")
    return bootstrap

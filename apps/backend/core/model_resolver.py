"""
Model resolver with role > feature > phase priority and multi-level settings.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from core.model_registry import (
    get_bootstrap_model as _get_bootstrap_model,
    get_model_info,
    load_model_registry,
    resolve_model_id,
)
from init import resolve_auto_build_dir
from phase_config import load_task_metadata

THINKING_PARAMS: dict[str, int | None] = {
    "none": None,
    "low": 1024,
    "medium": 4096,
    "high": 16384,
    "ultrathink": 65536,
}

PIPELINE_MODEL_CONTEXT: dict[str, dict[str, Any]] = {
    "spec_runner": {"phase": "spec"},
    "planning_runner": {"phase": "planning"},
    "coding_runner": {"phase": "coding"},
    "validation_runner": {"phase": "validation"},
    "consilium_orchestrator": {
        "feature": "consilium",
        "roles": ["innovator", "realist", "facilitator"],
    },
    "insight_extractor": {"feature": "insights", "role": "extractor"},
    "ideation_generator": {"feature": "ideation"},
    "github_batch_issues": {"feature": "github", "role": "batch"},
    "github_followup_reviewer": {"feature": "github", "role": "followUp"},
    "merge_resolver": {"feature": "merge", "role": "resolver"},
    "commit_message": {"feature": "commit", "role": "message"},
    "spec_compaction": {"bootstrap": True},
}


def _normalize_phase(phase: str | None) -> str | None:
    if phase == "qa":
        return "validation"
    return phase


def get_pipeline_context(pipeline_name: str, role: str | None = None) -> dict[str, str | None]:
    context = PIPELINE_MODEL_CONTEXT.get(pipeline_name, {})
    return {
        "phase": context.get("phase"),
        "feature": context.get("feature"),
        "role": role or context.get("role"),
    }


def get_bootstrap_model() -> str:
    return resolve_model_id(_get_bootstrap_model())


def _load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except (json.JSONDecodeError, OSError):
        return {}


def _get_project_paths(
    spec_dir: Path,
    project_dir: Path | None,
    auto_build_path: str | None,
) -> tuple[Path, Path]:
    if project_dir and auto_build_path:
        return project_dir, project_dir / auto_build_path
    auto_build_dir = spec_dir.parent.parent
    return auto_build_dir.parent, auto_build_dir


def _load_project_env(project_dir: Path, auto_build_dir: Path) -> dict[str, Any]:
    return _load_json(auto_build_dir / "project.env.json")


def _load_app_settings(app_settings_path: Path | None = None) -> dict[str, Any]:
    env_path = os.environ.get("AUTO_CLAUDE_SETTINGS_PATH")
    candidate = app_settings_path or (Path(env_path) if env_path else None)
    if not candidate:
        return {}
    return _load_json(candidate)


def _select_choice(
    routing: dict[str, Any],
    phase: str | None,
    feature: str | None,
    role: str | None,
) -> dict[str, Any] | None:
    if role and feature:
        advanced_roles = routing.get("advancedRoles", {})
        role_choice = (
            advanced_roles.get(feature, {}) or {}
        ).get(role)
        if isinstance(role_choice, dict):
            return role_choice
    if feature:
        feature_choice = routing.get("features", {}).get(feature)
        if isinstance(feature_choice, dict):
            return feature_choice
    if phase:
        phase_choice = routing.get("phases", {}).get(phase)
        if isinstance(phase_choice, dict):
            return phase_choice
    return None


def _resolve_from_sources(
    sources: list[dict[str, Any]],
    phase: str | None,
    feature: str | None,
    role: str | None,
) -> tuple[str | None, str | None]:
    model_value: str | None = None
    thinking_level: str | None = None

    for routing in sources:
        choice = _select_choice(routing, phase, feature, role)
        if not choice:
            continue
        if model_value is None and choice.get("model") is not None:
            model_value = choice.get("model")
        if thinking_level is None and choice.get("thinkingLevel") is not None:
            thinking_level = choice.get("thinkingLevel")
        if model_value is not None and thinking_level is not None:
            break

    return model_value, thinking_level


def _get_recommended_model(phase: str | None, feature: str | None) -> str:
    registry = load_model_registry()
    for model in registry.get("models", []):
        recommended = model.get("recommendedFor", [])
        if phase and phase in recommended:
            return model["id"]
        if feature and feature in recommended:
            return model["id"]
    return registry["models"][0]["id"]


def _get_thinking_budget(thinking_level: str, model_id: str) -> tuple[str, int | None]:
    model_info = get_model_info(model_id) or {}
    supports_thinking = model_info.get("supportsThinking", True)
    if not supports_thinking:
        return "none", None

    level = thinking_level if thinking_level in THINKING_PARAMS else "medium"
    return level, THINKING_PARAMS[level]


def resolve_model(
    phase: str | None = None,
    feature: str | None = None,
    role: str | None = None,
    spec_dir: Path | None = None,
    project_dir: Path | None = None,
    auto_build_path: str | None = None,
    app_settings_path: Path | None = None,
    cli_model: str | None = None,
    cli_thinking: str | None = None,
) -> tuple[str, str, int | None]:
    """
    Resolve model with priority:
    1) CLI overrides
    2) task_metadata.json (advancedRoles > features > phases)
    3) project.env.json
    4) app settings
    5) recommended
    """
    phase = _normalize_phase(phase)

    task_routing: dict[str, Any] = {}
    project_routing: dict[str, Any] = {}
    app_routing: dict[str, Any] = {}

    if spec_dir:
        task_metadata = load_task_metadata(spec_dir) or {}
        task_routing = task_metadata.get("modelRouting", {}) or {}
        project_dir, auto_build_dir = _get_project_paths(spec_dir, project_dir, auto_build_path)
        project_env = _load_project_env(project_dir, auto_build_dir)
        project_routing = project_env.get("modelRouting", {}) or {}
    elif project_dir:
        resolved_path = auto_build_path or resolve_auto_build_dir(project_dir).name
        auto_build_dir = project_dir / resolved_path
        project_env = _load_project_env(project_dir, auto_build_dir)
        project_routing = project_env.get("modelRouting", {}) or {}

    app_settings = _load_app_settings(app_settings_path)
    app_routing = app_settings.get("modelRouting", {}) or {}

    sources = [task_routing, project_routing, app_routing]

    model_value, thinking_level = _resolve_from_sources(sources, phase, feature, role)

    if cli_model:
        model_value = cli_model
    if cli_thinking:
        thinking_level = cli_thinking

    if model_value is None:
        model_value = _get_recommended_model(phase, feature)
    if thinking_level is None:
        thinking_level = "medium"

    model_id = resolve_model_id(model_value)
    resolved_level, thinking_budget = _get_thinking_budget(thinking_level, model_id)

    return model_id, resolved_level, thinking_budget

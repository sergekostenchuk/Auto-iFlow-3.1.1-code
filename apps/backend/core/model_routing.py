"""
Model routing helpers for resolving effective models from settings sources.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from core.model_registry import load_model_registry, resolve_model_id
from phase_config import load_task_metadata


def _load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except (json.JSONDecodeError, OSError):
        return {}


def _get_project_paths(spec_dir: Path, project_dir: Path | None, auto_build_path: str | None) -> tuple[Path, Path]:
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


def _resolve_phase_model(model_routing: dict[str, Any], phase: str) -> str | None:
    phases = model_routing.get("phases", {})
    choice = phases.get(phase)
    if not isinstance(choice, dict):
        return None
    model = choice.get("model")
    if model is None:
        return None
    return resolve_model_id(model)


def _get_recommended_model(phase: str) -> str:
    registry = load_model_registry()
    for model in registry.get("models", []):
        if phase in model.get("recommendedFor", []):
            return model["id"]
    # Fallback to first model in list
    return registry["models"][0]["id"]


def get_effective_model(
    phase: str,
    spec_dir: Path,
    project_dir: Path | None = None,
    auto_build_path: str | None = None,
    app_settings_path: Path | None = None,
    cli_model: str | None = None,
) -> str:
    """
    Resolve effective model for a phase using priority:
    1. CLI override
    2. task_metadata.json (modelRouting.phases)
    3. project.env.json (modelRouting.phases)
    4. app settings (modelRouting.phases)
    5. recommended model
    """
    if cli_model:
        return resolve_model_id(cli_model)

    project_dir, auto_build_dir = _get_project_paths(spec_dir, project_dir, auto_build_path)

    task_metadata = load_task_metadata(spec_dir) or {}
    task_routing = task_metadata.get("modelRouting", {})
    model = _resolve_phase_model(task_routing, phase)
    if model:
        return model

    project_env = _load_project_env(project_dir, auto_build_dir)
    project_routing = project_env.get("modelRouting", {})
    model = _resolve_phase_model(project_routing, phase)
    if model:
        return model

    app_settings = _load_app_settings(app_settings_path)
    app_routing = app_settings.get("modelRouting", {})
    model = _resolve_phase_model(app_routing, phase)
    if model:
        return model

    return _get_recommended_model(phase)


def write_resolved_model_snapshot(
    spec_dir: Path,
    project_dir: Path | None = None,
    auto_build_path: str | None = None,
    app_settings_path: Path | None = None,
) -> dict[str, str]:
    phases = ("spec", "planning", "coding", "validation")
    snapshot = {
        phase: get_effective_model(
            phase=phase,
            spec_dir=spec_dir,
            project_dir=project_dir,
            auto_build_path=auto_build_path,
            app_settings_path=app_settings_path,
        )
        for phase in phases
    }

    metadata_path = spec_dir / "task_metadata.json"
    metadata = _load_json(metadata_path)
    metadata["resolvedModel"] = snapshot
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    return snapshot

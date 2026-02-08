"""
Legacy task_metadata.json migration helpers.

Adds modelRouting.phases from legacy fields (phaseModels/phaseThinking/model/thinkingLevel).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


LEGACY_PHASE_MAP = {
    "spec": "spec",
    "planning": "planning",
    "coding": "coding",
    "qa": "validation",
    "validation": "validation",
}

DEFAULT_PHASES = ("spec", "planning", "coding", "validation")


def _normalize_phase(name: str) -> str | None:
    if not name:
        return None
    return LEGACY_PHASE_MAP.get(name.strip().lower())


def _load_json(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except (json.JSONDecodeError, OSError):
        return {}


def migrate_task_metadata_file(metadata_path: Path) -> bool:
    if not metadata_path.exists():
        return False

    data = _load_json(metadata_path)
    if not data or "modelRouting" in data:
        return False

    phase_models = data.get("phaseModels", {}) or {}
    phase_thinking = data.get("phaseThinking", {}) or {}
    default_model = data.get("model")
    default_thinking = data.get("thinkingLevel")

    phases: dict[str, dict[str, str | None]] = {}

    def ensure_phase(phase: str) -> None:
        phases.setdefault(phase, {"model": None, "thinkingLevel": None})

    for phase, model in phase_models.items():
        normalized = _normalize_phase(str(phase))
        if not normalized or model is None:
            continue
        ensure_phase(normalized)
        phases[normalized]["model"] = str(model)

    for phase, thinking in phase_thinking.items():
        normalized = _normalize_phase(str(phase))
        if not normalized or thinking is None:
            continue
        ensure_phase(normalized)
        phases[normalized]["thinkingLevel"] = str(thinking)

    if default_model:
        for phase in DEFAULT_PHASES:
            ensure_phase(phase)
            if phases[phase]["model"] is None:
                phases[phase]["model"] = str(default_model)

    if default_thinking:
        for phase in DEFAULT_PHASES:
            ensure_phase(phase)
            if phases[phase]["thinkingLevel"] is None:
                phases[phase]["thinkingLevel"] = str(default_thinking)

    if not phases:
        return False

    data["modelRouting"] = {
        "phases": {
            phase: {
                "model": entry["model"],
                "thinkingLevel": entry["thinkingLevel"],
            }
            for phase, entry in phases.items()
        }
    }

    metadata_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return True


def migrate_task_metadata_tree(specs_dir: Path) -> dict[str, int]:
    result = {"updated": 0, "skipped": 0, "missing": 0, "errors": 0}
    if not specs_dir.exists():
        return result

    for spec_dir in specs_dir.glob("[0-9][0-9][0-9]-*"):
        if not spec_dir.is_dir():
            continue
        metadata_path = spec_dir / "task_metadata.json"
        if not metadata_path.exists():
            result["missing"] += 1
            continue
        try:
            changed = migrate_task_metadata_file(metadata_path)
            if changed:
                result["updated"] += 1
            else:
                result["skipped"] += 1
        except Exception:
            result["errors"] += 1
    return result

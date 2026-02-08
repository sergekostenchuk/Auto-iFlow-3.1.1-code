"""
Proof Writer
============

Creates and appends proof entries for acceptance criteria based on task_intake.json.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from spec.pipeline.preflight_scoper import load_task_intake


def _load_proofs(spec_dir: Path) -> dict:
    proofs_path = spec_dir / "proofs.json"
    if not proofs_path.exists():
        return {"proofs": []}
    try:
        with proofs_path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        if isinstance(data, dict) and isinstance(data.get("proofs"), list):
            return data
    except (OSError, json.JSONDecodeError):
        pass
    return {"proofs": []}


def _save_proofs(spec_dir: Path, data: dict) -> None:
    proofs_path = spec_dir / "proofs.json"
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    with proofs_path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2)


def _resolve_file_path(project_dir: Path, spec_dir: Path, file_ref: str | None) -> Path | None:
    if not file_ref:
        return None
    candidate = project_dir / file_ref
    if candidate.exists():
        return candidate
    candidate = spec_dir / file_ref
    if candidate.exists():
        return candidate
    return None


def _snippet_from_file(path: Path | None, max_lines: int = 15) -> str:
    if not path or not path.exists():
        return ""
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return ""
    if not lines:
        return ""
    snippet_lines = lines[:max_lines]
    return "\n".join(snippet_lines)


def _has_proof(proofs: list[dict], criterion: str, file_ref: str | None) -> bool:
    for proof in proofs:
        if proof.get("criterion") != criterion:
            continue
        if file_ref and proof.get("file") != file_ref:
            continue
        return True
    return False


def append_acceptance_proofs(spec_dir: Path, project_dir: Path) -> int:
    intake = load_task_intake(spec_dir) or {}
    acceptance_map = intake.get("acceptance_map", []) or []
    output_files = intake.get("output_files", []) or []

    if not acceptance_map:
        return 0

    data = _load_proofs(spec_dir)
    proofs = data.get("proofs", [])
    appended = 0

    for entry in acceptance_map:
        if not isinstance(entry, dict):
            continue
        criterion = entry.get("criterion")
        if not isinstance(criterion, str) or not criterion.strip():
            continue
        file_ref = entry.get("file") or (output_files[0] if output_files else "")
        if _has_proof(proofs, criterion, file_ref):
            continue
        path = _resolve_file_path(project_dir, spec_dir, file_ref)
        snippet = _snippet_from_file(path)
        proofs.append(
            {
                "criterion": criterion,
                "file": file_ref,
                "snippet": snippet,
                "source": "auto",
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        appended += 1

    if appended:
        data["proofs"] = proofs
        _save_proofs(spec_dir, data)

    return appended


def ensure_noncode_proof(spec_dir: Path, project_dir: Path) -> bool:
    intake = load_task_intake(spec_dir) or {}
    task_type = intake.get("task_type", "code")
    if task_type == "code":
        return False

    data = _load_proofs(spec_dir)
    proofs = data.get("proofs", [])
    if proofs:
        return False

    spec_file = spec_dir / "spec.md"
    snippet = _snippet_from_file(spec_file)
    proofs.append(
        {
            "criterion": "Non-code deliverable",
            "file": str(spec_file.name),
            "snippet": snippet,
            "source": "auto",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
    )
    data["proofs"] = proofs
    _save_proofs(spec_dir, data)
    return True

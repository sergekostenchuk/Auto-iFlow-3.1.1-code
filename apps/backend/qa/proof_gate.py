"""
Proof Gate
==========

Validates that acceptance criteria have corresponding proof entries.
"""

from __future__ import annotations

import json
from pathlib import Path

from spec.pipeline.preflight_scoper import load_task_intake


def _load_proofs(spec_dir: Path) -> list[dict]:
    proofs_path = spec_dir / "proofs.json"
    if not proofs_path.exists():
        return []
    try:
        with proofs_path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        proofs = data.get("proofs") if isinstance(data, dict) else []
        return proofs if isinstance(proofs, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def _proof_matches(criterion: str, file_ref: str | None, proofs: list[dict]) -> bool:
    for proof in proofs:
        if proof.get("criterion") != criterion:
            continue
        if file_ref and proof.get("file") != file_ref:
            continue
        return True
    return False


def validate_proof_gate(spec_dir: Path) -> tuple[bool, list[str]]:
    intake = load_task_intake(spec_dir) or {}
    task_type = intake.get("task_type", "code")
    acceptance_map = intake.get("acceptance_map", []) or []
    proofs = _load_proofs(spec_dir)

    if task_type != "code":
        if proofs:
            return True, []
        return False, ["Non-code task missing proof entry"]

    if not acceptance_map:
        return True, []

    missing: list[str] = []
    for entry in acceptance_map:
        if not isinstance(entry, dict):
            continue
        criterion = entry.get("criterion")
        if not isinstance(criterion, str) or not criterion.strip():
            continue
        file_ref = entry.get("file") or ""
        if not _proof_matches(criterion, file_ref, proofs):
            missing.append(
                f"Missing proof for criterion '{criterion}'" + (
                    f" (file: {file_ref})" if file_ref else ""
                )
            )

    return len(missing) == 0, missing

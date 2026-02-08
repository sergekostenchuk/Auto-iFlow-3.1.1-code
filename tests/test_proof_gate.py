#!/usr/bin/env python3
"""Tests for proof gate validation."""

import json
from pathlib import Path

from qa.proof_gate import validate_proof_gate


def _write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def test_proof_gate_passes_with_proofs(tmp_path: Path) -> None:
    spec_dir = tmp_path / "spec"
    spec_dir.mkdir(parents=True)

    _write_json(
        spec_dir / "task_intake.json",
        {
            "task_type": "code",
            "acceptance_map": [
                {"criterion": "Context menu appears", "file": "main/index.ts"}
            ],
        },
    )
    _write_json(
        spec_dir / "proofs.json",
        {
            "proofs": [
                {
                    "criterion": "Context menu appears",
                    "file": "main/index.ts",
                    "snippet": "menu.popup()",
                }
            ]
        },
    )

    ok, missing = validate_proof_gate(spec_dir)
    assert ok is True
    assert missing == []


def test_proof_gate_fails_when_missing(tmp_path: Path) -> None:
    spec_dir = tmp_path / "spec"
    spec_dir.mkdir(parents=True)

    _write_json(
        spec_dir / "task_intake.json",
        {
            "task_type": "code",
            "acceptance_map": [
                {"criterion": "Context menu appears", "file": "main/index.ts"}
            ],
        },
    )

    ok, missing = validate_proof_gate(spec_dir)
    assert ok is False
    assert any("Context menu appears" in item for item in missing)


def test_proof_gate_noncode_requires_proof(tmp_path: Path) -> None:
    spec_dir = tmp_path / "spec"
    spec_dir.mkdir(parents=True)

    _write_json(
        spec_dir / "task_intake.json",
        {"task_type": "analysis", "acceptance_map": []},
    )

    ok, missing = validate_proof_gate(spec_dir)
    assert ok is False
    assert missing

#!/usr/bin/env python3
"""Tests for preflight scoper routing and intake generation."""

import json
from pathlib import Path

from spec.pipeline.preflight_scoper import determine_pipeline, run_preflight_scoper


def _write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def test_preflight_scoper_creates_task_intake(tmp_path: Path) -> None:
    project_dir = tmp_path / "project"
    spec_dir = project_dir / ".auto-iflow" / "specs" / "001-test"
    spec_dir.mkdir(parents=True)

    _write_json(
        spec_dir / "requirements.json",
        {
            "task_description": "Update documentation for context menu",
            "workflow_type": "docs",
            "user_requirements": ["Keep it short"],
        },
    )
    _write_json(
        spec_dir / "scope_contract.json",
        {
            "acceptance": ["Docs updated"],
            "candidate_files": ["README.md"],
            "test_plan": ["npm test"],
        },
    )

    intake = run_preflight_scoper(
        spec_dir=spec_dir,
        project_dir=project_dir,
        task_description="Update documentation for context menu",
    )

    intake_path = spec_dir / "task_intake.json"
    assert intake_path.exists()
    assert intake["task_type"] == "content"
    assert intake["noise_profile"] == "low"
    assert intake["tests_to_run"] == []
    assert intake["acceptance_map"]


def test_determine_pipeline_noncode() -> None:
    assert determine_pipeline({"task_type": "analysis"}) == "non-code"

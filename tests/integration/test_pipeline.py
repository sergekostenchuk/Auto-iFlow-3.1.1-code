#!/usr/bin/env python3
"""Integration tests for pipeline routing."""

import json
from pathlib import Path

from qa.criteria import should_run_qa


def _write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def test_should_run_qa_skips_noncode(tmp_path: Path) -> None:
    spec_dir = tmp_path / "spec"
    spec_dir.mkdir(parents=True)

    _write_json(
        spec_dir / "implementation_plan.json",
        {
            "phases": [
                {"subtasks": [{"status": "completed"}]},
            ]
        },
    )
    _write_json(
        spec_dir / "task_intake.json",
        {"task_type": "analysis"},
    )

    assert should_run_qa(spec_dir) is False

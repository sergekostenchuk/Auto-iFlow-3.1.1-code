import json
import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_ROOT))

from qa import criteria


def _write_plan(spec_dir: Path, payload: dict) -> None:
    plan_file = spec_dir / "implementation_plan.json"
    plan_file.write_text(json.dumps(payload))


def _write_post_code_report(spec_dir: Path, status: str) -> None:
    report_file = spec_dir / "post_code_tests.json"
    report_file.write_text(json.dumps({"status": status}))


def test_sync_plan_status_blocks_human_review_when_post_code_failed(
    monkeypatch, tmp_path: Path
) -> None:
    spec_dir = tmp_path / ".auto-iflow" / "specs" / "001-test"
    spec_dir.mkdir(parents=True)

    plan = {
        "status": "in_progress",
        "planStatus": "in_progress",
        "qa_signoff": {"status": "approved"},
    }
    _write_plan(spec_dir, plan)
    _write_post_code_report(spec_dir, "failed")

    monkeypatch.setattr(criteria, "is_build_complete", lambda *_a, **_k: True)

    updated = criteria.sync_plan_status_after_qa(spec_dir)
    assert updated is False

    saved = json.loads((spec_dir / "implementation_plan.json").read_text())
    assert saved["status"] == "ai_review"
    assert saved["planStatus"] == "review"

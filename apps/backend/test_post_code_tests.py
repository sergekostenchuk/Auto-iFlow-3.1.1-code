import json
import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_ROOT))

from spec import post_code_tests


def _write_scope_contract(spec_dir: Path, payload: dict) -> None:
    spec_dir.mkdir(parents=True, exist_ok=True)
    (spec_dir / "scope_contract.json").write_text(json.dumps(payload))


def _write_task_intake(spec_dir: Path, payload: dict) -> None:
    spec_dir.mkdir(parents=True, exist_ok=True)
    (spec_dir / "task_intake.json").write_text(json.dumps(payload))


def test_should_run_post_code_tests_requires_plan(monkeypatch, tmp_path: Path) -> None:
    spec_dir = tmp_path / ".auto-iflow" / "specs" / "001-test"
    project_dir = tmp_path / "project"
    project_dir.mkdir()

    _write_scope_contract(spec_dir, {"test_plan": []})
    monkeypatch.setattr(post_code_tests, "_get_latest_commit", lambda *_a, **_k: "abc")

    assert post_code_tests.should_run_post_code_tests(spec_dir, project_dir) is True


def test_should_run_returns_false_for_noncode(tmp_path: Path) -> None:
    spec_dir = tmp_path / ".auto-iflow" / "specs" / "001-test"
    project_dir = tmp_path / "project"
    project_dir.mkdir()

    _write_task_intake(spec_dir, {"task_type": "plan"})

    assert post_code_tests.should_run_post_code_tests(spec_dir, project_dir) is False


@pytest.mark.asyncio
async def test_run_post_code_tests_fails_without_plan(monkeypatch, tmp_path: Path) -> None:
    spec_dir = tmp_path / ".auto-iflow" / "specs" / "001-test"
    project_dir = tmp_path / "project"
    project_dir.mkdir()

    _write_scope_contract(spec_dir, {"test_plan": []})
    monkeypatch.setattr(post_code_tests, "_get_latest_commit", lambda *_a, **_k: "abc")

    report = await post_code_tests.run_post_code_tests(spec_dir, project_dir)

    assert report["status"] == "failed"
    assert report["reason"] == "No test_plan entries in scope_contract.json"
    report_file = spec_dir / post_code_tests.REPORT_FILENAME
    assert report_file.exists()


@pytest.mark.asyncio
async def test_run_post_code_tests_skips_noncode_task(monkeypatch, tmp_path: Path) -> None:
    spec_dir = tmp_path / ".auto-iflow" / "specs" / "001-test"
    project_dir = tmp_path / "project"
    project_dir.mkdir()

    _write_task_intake(spec_dir, {"task_type": "analysis", "tests_to_run": []})
    _write_scope_contract(spec_dir, {"test_plan": []})
    monkeypatch.setattr(post_code_tests, "_get_latest_commit", lambda *_a, **_k: "abc")

    report = await post_code_tests.run_post_code_tests(spec_dir, project_dir)

    assert report["status"] == "skipped"
    assert "non-code" in report.get("reason", "").lower()


@pytest.mark.asyncio
async def test_post_code_tests_passed_false_without_plan(monkeypatch, tmp_path: Path) -> None:
    spec_dir = tmp_path / ".auto-iflow" / "specs" / "001-test"
    project_dir = tmp_path / "project"
    project_dir.mkdir()

    _write_scope_contract(spec_dir, {"test_plan": []})
    monkeypatch.setattr(post_code_tests, "_get_latest_commit", lambda *_a, **_k: "abc")

    await post_code_tests.run_post_code_tests(spec_dir, project_dir)

    assert post_code_tests.post_code_tests_passed(spec_dir) is False

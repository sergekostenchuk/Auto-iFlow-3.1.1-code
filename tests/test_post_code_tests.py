#!/usr/bin/env python3
"""
Tests for post-code test runner helpers.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

from spec.post_code_tests import (
    get_post_code_test_status,
    get_test_plan,
    load_post_code_report,
    post_code_tests_passed,
    should_run_post_code_tests,
)


def _write_scope_contract(spec_dir: Path, test_plan: list[str]) -> None:
    spec_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "intent": "change",
        "outcome": "Test",
        "where": "apps/**",
        "why": "Test",
        "when": "Runtime",
        "acceptance": ["It works"],
        "test_plan": test_plan,
        "allowed_paths": ["apps/**"],
    }
    (spec_dir / "scope_contract.json").write_text(json.dumps(payload, indent=2))


def _write_task_intake(
    spec_dir: Path,
    tests_to_run: list[object],
    files_to_modify: list[str] | None = None,
) -> None:
    spec_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "task_type": "code",
        "tests_to_run": tests_to_run,
    }
    if files_to_modify is not None:
        payload["files_to_modify"] = files_to_modify
    (spec_dir / "task_intake.json").write_text(json.dumps(payload, indent=2))


def _init_git_repo(project_dir: Path) -> str:
    project_dir.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env.update(
        {
            "GIT_AUTHOR_NAME": "Test",
            "GIT_AUTHOR_EMAIL": "test@example.com",
            "GIT_COMMITTER_NAME": "Test",
            "GIT_COMMITTER_EMAIL": "test@example.com",
        }
    )
    subprocess.run(["git", "init"], cwd=project_dir, check=True, env=env)
    (project_dir / "README.md").write_text("test")
    subprocess.run(["git", "add", "."], cwd=project_dir, check=True, env=env)
    subprocess.run(["git", "commit", "-m", "init"], cwd=project_dir, check=True, env=env)
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=project_dir,
        capture_output=True,
        text=True,
        check=True,
        env=env,
    )
    return result.stdout.strip()


def test_get_test_plan_filters_invalid_entries(tmp_path: Path) -> None:
    spec_dir = tmp_path / "spec"
    _write_scope_contract(
        spec_dir,
        ["npm test", "", "   ", 123],  # type: ignore[list-item]
    )

    test_plan = get_test_plan(spec_dir)

    assert test_plan == ["npm test"]


def test_get_test_plan_prefers_task_intake_aliases(tmp_path: Path) -> None:
    spec_dir = tmp_path / "spec"
    _write_scope_contract(spec_dir, ["npm test"])
    _write_task_intake(
        spec_dir,
        [
            "PYTEST_SECURITY",
            "PYTEST_SECURITY",
            "python3 -m pytest tests/test_security_hooks.py -v",
            {"cmd": "npm test", "timeout": 5},
        ],
    )

    test_plan = get_test_plan(spec_dir)

    assert test_plan == [
        "python3 -m pytest tests/test_security_hooks.py -v",
        "npm test",
    ]


def test_get_test_plan_applies_smart_cap_direct_matches(tmp_path: Path) -> None:
    spec_dir = tmp_path / "spec"
    _write_task_intake(
        spec_dir,
        ["PYTEST_SECURITY", "PYTEST_PROOF_GATE", "PYTEST_PIPELINE", "NPM_TEST"],
        files_to_modify=[
            "apps/backend/security/hooks.py",
            "apps/backend/qa/proof_gate.py",
            "apps/backend/spec/pipeline/orchestrator.py",
            "apps/frontend/src/renderer/App.tsx",
        ],
    )

    test_plan = get_test_plan(spec_dir)

    assert test_plan == [
        "python3 -m pytest tests/test_security_hooks.py -v",
        "python3 -m pytest tests/test_proof_gate.py -v",
        "python3 -m pytest tests/integration/test_pipeline.py -v",
    ]


def test_should_run_post_code_tests_without_report(tmp_path: Path) -> None:
    project_dir = tmp_path / "project"
    _init_git_repo(project_dir)
    spec_dir = project_dir / ".auto-iflow" / "specs" / "001-test"
    _write_scope_contract(spec_dir, ["npm test"])

    assert should_run_post_code_tests(spec_dir, project_dir) is True


def test_should_run_post_code_tests_skips_when_commit_matches(tmp_path: Path) -> None:
    project_dir = tmp_path / "project"
    commit = _init_git_repo(project_dir)
    spec_dir = project_dir / ".auto-iflow" / "specs" / "001-test"
    _write_scope_contract(spec_dir, ["npm test"])
    report = {
        "status": "passed",
        "commit": commit,
        "test_plan": ["npm test"],
        "results": [],
    }
    (spec_dir / "post_code_tests.json").write_text(json.dumps(report, indent=2))

    assert should_run_post_code_tests(spec_dir, project_dir) is False


def test_post_code_tests_status_reads_report(tmp_path: Path) -> None:
    spec_dir = tmp_path / "spec"
    report = {"status": "failed"}
    spec_dir.mkdir(parents=True, exist_ok=True)
    (spec_dir / "post_code_tests.json").write_text(json.dumps(report, indent=2))

    assert load_post_code_report(spec_dir) is not None
    assert get_post_code_test_status(spec_dir) == "failed"
    assert post_code_tests_passed(spec_dir) is False

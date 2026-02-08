import asyncio
from pathlib import Path

import pytest

from spec import env_reality_check
from spec.phases.requirements_phases import RequirementsPhaseMixin


class _DummyLogger:
    def __init__(self) -> None:
        self.messages: list[tuple[str, str]] = []

    def log_with_detail(self, message, detail, *_args, **_kwargs):
        self.messages.append((message, detail))


class _DummyUI:
    def __init__(self) -> None:
        self.statuses: list[tuple[str, str]] = []

    def print_status(self, message, status):
        self.statuses.append((message, status))


class _DummyPhase(RequirementsPhaseMixin):
    def __init__(self, project_dir: Path, spec_dir: Path):
        self.project_dir = project_dir
        self.spec_dir = spec_dir
        self.task_logger = _DummyLogger()
        self.ui = _DummyUI()


def test_env_reality_check_missing_paths(tmp_path):
    project_dir = tmp_path / "missing-project"
    spec_dir = tmp_path / "missing-specs"

    result = env_reality_check.run_env_reality_check(
        project_dir=project_dir,
        spec_dir=spec_dir,
        project_index={},
        env={"PATH": ""},
    )

    assert result["status"] == "failed"
    assert "project_dir does not exist" in result["errors"]
    assert "spec_dir does not exist" in result["errors"]


def test_env_reality_check_iflow_required_missing(tmp_path):
    project_dir = tmp_path / "project"
    spec_dir = tmp_path / "specs"
    project_dir.mkdir()
    spec_dir.mkdir()

    result = env_reality_check.run_env_reality_check(
        project_dir=project_dir,
        spec_dir=spec_dir,
        project_index={},
        requirements={"requires_iflow_cli": True},
        env={"PATH": ""},
    )

    assert result["status"] == "failed"
    assert "required binary missing: iflow" in result["errors"]


def test_env_reality_check_iflow_override_found(tmp_path):
    project_dir = tmp_path / "project"
    spec_dir = tmp_path / "specs"
    project_dir.mkdir()
    spec_dir.mkdir()
    iflow_path = tmp_path / "iflow"
    iflow_path.write_text("#!/bin/sh\necho iflow\n")

    result = env_reality_check.run_env_reality_check(
        project_dir=project_dir,
        spec_dir=spec_dir,
        project_index={},
        requirements={"requires_iflow_cli": True},
        env={"IFLOW_CLI_PATH": str(iflow_path), "PATH": ""},
    )

    assert result["status"] == "passed"
    binaries = {item["name"]: item for item in result["checks"]["binaries"]}
    assert binaries["iflow"]["found"] is True
    assert binaries["iflow"]["path"] == str(iflow_path)


def test_phase_env_reality_check_writes_report(tmp_path, monkeypatch):
    project_dir = tmp_path / "project"
    spec_dir = tmp_path / "specs"
    project_dir.mkdir()
    spec_dir.mkdir()

    payload = {
        "status": "passed",
        "errors": [],
        "warnings": [],
        "checks": {"paths": {}, "binaries": []},
        "created_at": "now",
    }

    monkeypatch.setattr(
        env_reality_check, "run_env_reality_check", lambda **_kwargs: payload
    )

    phase = _DummyPhase(project_dir, spec_dir)
    result = asyncio.run(phase.phase_env_reality_check())

    assert result.success is True
    assert (spec_dir / "env_reality_check.json").exists()

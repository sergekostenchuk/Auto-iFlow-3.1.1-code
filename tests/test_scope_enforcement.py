#!/usr/bin/env python3
"""
Tests for scope enforcement helpers.
"""

import json
from pathlib import Path

from spec.scope_enforcement import resolve_scope_write_dirs


def _write_scope_contract(spec_dir: Path, payload: dict) -> None:
    spec_dir.mkdir(parents=True, exist_ok=True)
    (spec_dir / "scope_contract.json").write_text(json.dumps(payload, indent=2))


def test_scope_enforcement_missing_contract(tmp_path: Path):
    allowed, error = resolve_scope_write_dirs(tmp_path / "spec", tmp_path / "project")
    assert allowed == []
    assert error is not None
    assert "scope_contract.json not found" in error


def test_scope_enforcement_resolves_allowed_dirs(tmp_path: Path):
    project_dir = tmp_path / "project"
    spec_dir = project_dir / ".auto-iflow" / "specs" / "001-test"
    payload = {
        "allowed_paths": ["apps/frontend/**", "apps/backend/src/**"],
    }
    _write_scope_contract(spec_dir, payload)

    allowed, error = resolve_scope_write_dirs(spec_dir, project_dir)
    assert error is None

    allowed_set = set(allowed)
    assert str(spec_dir.resolve()) in allowed_set
    assert str((project_dir / ".auto-iflow").resolve()) in allowed_set
    assert str((project_dir / "apps/frontend").resolve()) in allowed_set
    assert str((project_dir / "apps/backend/src").resolve()) in allowed_set


def test_scope_enforcement_requires_allowed_paths(tmp_path: Path):
    project_dir = tmp_path / "project"
    spec_dir = project_dir / ".auto-iflow" / "specs" / "001-test"
    payload = {
        "allowed_paths": [],
    }
    _write_scope_contract(spec_dir, payload)

    allowed, error = resolve_scope_write_dirs(spec_dir, project_dir)
    assert allowed == []
    assert error is not None
    assert "missing allowed_paths" in error

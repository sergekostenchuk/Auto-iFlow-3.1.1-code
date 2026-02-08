#!/usr/bin/env python3
"""
Tests for scope contract rules.
"""

from spec.validate_pkg.scope_contract_rules import (
    DEFAULT_FORBIDDEN_PATHS,
    derive_allowed_paths,
    derive_forbidden_paths,
    derive_test_plan,
    validate_scope_rules,
)


def test_derive_allowed_paths_from_services(sample_project_index: dict):
    allowed = derive_allowed_paths(sample_project_index)
    assert "backend/**" in allowed
    assert "frontend/**" in allowed


def test_derive_allowed_paths_from_absolute_paths():
    project_index = {
        "project_root": "/repo",
        "services": {
            "backend": {"path": "/repo/apps/backend"},
            "frontend": {"path": "/repo/apps/frontend"},
        },
    }
    allowed = derive_allowed_paths(project_index)
    assert "apps/backend/**" in allowed
    assert "apps/frontend/**" in allowed


def test_derive_allowed_paths_fallback_top_level_dirs():
    project_index = {"top_level_dirs": ["apps", "packages", ".github"]}
    allowed = derive_allowed_paths(project_index)
    assert "apps/**" in allowed
    assert "packages/**" in allowed
    assert ".github/**" not in allowed


def test_derive_forbidden_paths_includes_defaults():
    project_index = {"top_level_dirs": ["docs"]}
    forbidden = derive_forbidden_paths(project_index)
    assert ".auto-iflow/**" in forbidden
    assert ".design-system/**" in forbidden
    assert "docs/**" in forbidden
    assert all(entry in forbidden for entry in DEFAULT_FORBIDDEN_PATHS)


def test_derive_test_plan_from_services(sample_project_index: dict):
    plan = derive_test_plan(sample_project_index)
    assert "npm test" in plan
    assert "npm run test:backend" in plan


def test_validate_scope_rules_detects_empty_allowed():
    errors, warnings = validate_scope_rules([], [".auto-iflow/**"])
    assert "allowed_paths must not be empty" in errors
    assert warnings == []


def test_validate_scope_rules_detects_absolute_path():
    errors, _ = validate_scope_rules(["/abs/path/**"], [".auto-iflow/**"])
    assert any("must be relative" in error for error in errors)


def test_validate_scope_rules_detects_overlap():
    errors, _ = validate_scope_rules(
        ["apps/frontend/**"], ["apps/**", ".auto-iflow/**"]
    )
    assert any("overlaps forbidden_paths" in error for error in errors)

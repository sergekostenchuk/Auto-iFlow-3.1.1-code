#!/usr/bin/env python3
"""
Tests for ScopeContractValidator.
"""

import json
from pathlib import Path

from spec.validate_pkg.validators.scope_contract_validator import ScopeContractValidator


def _write_scope_contract(spec_dir: Path, payload: dict) -> Path:
    scope_file = spec_dir / "scope_contract.json"
    scope_file.write_text(json.dumps(payload, indent=2))
    return scope_file


def test_scope_contract_missing_file(tmp_path: Path):
    validator = ScopeContractValidator(tmp_path)
    result = validator.validate()
    assert result.valid is False
    assert "scope_contract.json not found" in result.errors


def test_scope_contract_invalid_json(tmp_path: Path):
    scope_file = tmp_path / "scope_contract.json"
    scope_file.write_text("{invalid json")
    validator = ScopeContractValidator(tmp_path)
    result = validator.validate()
    assert result.valid is False
    assert any("invalid JSON" in err for err in result.errors)


def test_scope_contract_invalid_intent(tmp_path: Path):
    payload = {
        "intent": "ship",
        "outcome": "Define the expected outcome.",
        "where": "apps/**",
        "why": "Needed for test.",
        "when": "During runtime.",
        "acceptance": ["criteria"],
        "test_plan": ["npm test"],
        "allowed_paths": ["apps/**"],
        "forbidden_paths": [".auto-iflow/**"],
        "candidate_files": [],
    }
    _write_scope_contract(tmp_path, payload)
    validator = ScopeContractValidator(tmp_path)
    result = validator.validate()
    assert result.valid is False
    assert "Invalid intent value: ship" in result.errors


def test_scope_contract_rule_overlap(tmp_path: Path):
    payload = {
        "intent": "change",
        "outcome": "Adjust files.",
        "where": "apps/**",
        "why": "Needed for test.",
        "when": "During runtime.",
        "acceptance": ["criteria"],
        "test_plan": ["npm test"],
        "allowed_paths": ["apps/**"],
        "forbidden_paths": ["apps/**"],
        "candidate_files": [],
    }
    _write_scope_contract(tmp_path, payload)
    validator = ScopeContractValidator(tmp_path)
    result = validator.validate()
    assert result.valid is False
    assert any("overlaps forbidden_paths" in err for err in result.errors)


def test_scope_contract_valid(tmp_path: Path):
    payload = {
        "intent": "change",
        "outcome": "Adjust files.",
        "where": "apps/**",
        "why": "Needed for test.",
        "when": "During runtime.",
        "acceptance": ["criteria"],
        "test_plan": ["npm test"],
        "allowed_paths": ["apps/**"],
        "forbidden_paths": [".auto-iflow/**"],
        "candidate_files": [],
    }
    _write_scope_contract(tmp_path, payload)
    validator = ScopeContractValidator(tmp_path)
    result = validator.validate()
    assert result.valid is True


def test_scope_contract_valid_noncode_empty_test_plan(tmp_path: Path):
    payload = {
        "task_type": "plan",
        "intent": "investigate",
        "outcome": "Verify documentation.",
        "where": "NEW-PLANS/**",
        "why": "Needed for test.",
        "when": "During planning.",
        "acceptance": ["criteria"],
        "test_plan": [],
        "allowed_paths": ["NEW-PLANS/**"],
        "forbidden_paths": [".auto-iflow/**"],
        "candidate_files": ["NEW-PLANS/example.md"],
    }
    _write_scope_contract(tmp_path, payload)
    validator = ScopeContractValidator(tmp_path)
    result = validator.validate()
    assert result.valid is True

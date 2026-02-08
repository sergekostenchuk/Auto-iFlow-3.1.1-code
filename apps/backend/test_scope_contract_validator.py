from __future__ import annotations

import json
import sys
from pathlib import Path

SPEC_ROOT = Path(__file__).resolve().parent / "spec"
if str(SPEC_ROOT) not in sys.path:
    sys.path.insert(0, str(SPEC_ROOT))

from validate_pkg.spec_validator import SpecValidator
from validate_pkg.validators.scope_contract_validator import ScopeContractValidator


def _write_scope_contract(spec_dir: Path, payload: dict) -> None:
    (spec_dir / "scope_contract.json").write_text(json.dumps(payload))


def _valid_payload() -> dict:
    return {
        "intent": "change",
        "outcome": "Adjust UI status indicator behavior",
        "where": "apps/frontend",
        "why": "Ensure status reflects CLI/auth state",
        "when": "On app startup and refresh",
        "acceptance": ["Status reflects detected CLI/auth state"],
        "test_plan": ["npm test"],
        "allowed_paths": ["apps/frontend/**"],
        "forbidden_paths": [".git/**"],
        "candidate_files": ["apps/frontend/src/renderer/components/IFlowStatusBadge.tsx"],
    }


def test_scope_contract_missing_file_fails(tmp_path: Path) -> None:
    validator = ScopeContractValidator(tmp_path)
    result = validator.validate()
    assert result.valid is False
    assert "scope_contract.json not found" in result.errors


def test_scope_contract_invalid_json_fails(tmp_path: Path) -> None:
    (tmp_path / "scope_contract.json").write_text("{")
    result = ScopeContractValidator(tmp_path).validate()
    assert result.valid is False
    assert any("invalid JSON" in message for message in result.errors)


def test_scope_contract_missing_fields_fails(tmp_path: Path) -> None:
    _write_scope_contract(tmp_path, {"intent": "change"})
    result = ScopeContractValidator(tmp_path).validate()
    assert result.valid is False
    assert any("Missing required field" in message for message in result.errors)


def test_scope_contract_valid_payload_passes(tmp_path: Path) -> None:
    _write_scope_contract(tmp_path, _valid_payload())
    result = ScopeContractValidator(tmp_path).validate()
    assert result.valid is True
    assert result.errors == []


def test_spec_validator_fails_when_scope_contract_missing(tmp_path: Path) -> None:
    spec_validator = SpecValidator(tmp_path)
    result = spec_validator.validate_scope_contract()
    assert result.valid is False

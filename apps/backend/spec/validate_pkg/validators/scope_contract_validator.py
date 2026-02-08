"""
Scope Contract Validator
========================

Validates scope_contract.json content and guardrail rules.
"""

from __future__ import annotations

import json
from pathlib import Path

from ..models import ValidationResult
from ..schemas import SCOPE_CONTRACT_SCHEMA
from ..scope_contract_rules import validate_scope_rules


class ScopeContractValidator:
    """Validates scope_contract.json exists and follows required structure."""

    def __init__(self, spec_dir: Path):
        self.spec_dir = Path(spec_dir)

    def validate(self) -> ValidationResult:
        scope_file = self.spec_dir / "scope_contract.json"
        errors: list[str] = []
        warnings: list[str] = []
        fixes: list[str] = []

        if not scope_file.exists():
            errors.append("scope_contract.json not found")
            fixes.append("Create scope_contract.json during preflight")
            return ValidationResult(False, "scope_contract", errors, warnings, fixes)

        try:
            payload = json.loads(scope_file.read_text())
        except json.JSONDecodeError as exc:
            errors.append(f"scope_contract.json invalid JSON: {exc}")
            fixes.append("Fix JSON syntax in scope_contract.json")
            return ValidationResult(False, "scope_contract", errors, warnings, fixes)

        task_type = payload.get("task_type")
        for field in SCOPE_CONTRACT_SCHEMA["required_fields"]:
            value = payload.get(field)
            if field == "test_plan" and task_type and task_type != "code":
                continue
            if value is None or value == "" or value == []:
                errors.append(f"Missing required field: {field}")

        intent = payload.get("intent")
        if intent and intent not in SCOPE_CONTRACT_SCHEMA["intent_values"]:
            errors.append(f"Invalid intent value: {intent}")

        allowed_paths = payload.get("allowed_paths", [])
        forbidden_paths = payload.get("forbidden_paths", [])
        test_plan = payload.get("test_plan", [])

        if not isinstance(allowed_paths, list):
            errors.append("allowed_paths must be a list")
        if not isinstance(forbidden_paths, list):
            errors.append("forbidden_paths must be a list")
        if not isinstance(test_plan, list):
            errors.append("test_plan must be a list")

        if isinstance(allowed_paths, list) and isinstance(forbidden_paths, list):
            rule_errors, rule_warnings = validate_scope_rules(
                allowed_paths, forbidden_paths
            )
            errors.extend(rule_errors)
            warnings.extend(rule_warnings)

        if errors:
            fixes.append("Regenerate scope_contract.json with valid fields")

        return ValidationResult(len(errors) == 0, "scope_contract", errors, warnings, fixes)

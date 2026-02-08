#!/usr/bin/env python3
"""
Tests for implementation_plan validator warnings.
"""

import json
from pathlib import Path

from spec.validate_pkg.validators.implementation_plan_validator import (
    ImplementationPlanValidator,
)


def test_validator_warns_on_test_commands_in_verification(tmp_path: Path) -> None:
    spec_dir = tmp_path
    (spec_dir / "scope_contract.json").write_text(
        json.dumps({"test_plan": ["npm test"]}, indent=2)
    )

    plan = {
        "feature": "test-only-post-code",
        "workflow_type": "simple",
        "phases": [
            {
                "phase": 1,
                "name": "Implementation",
                "subtasks": [
                    {
                        "id": "subtask-1-1",
                        "description": "Make a change",
                        "status": "pending",
                        "verification": {"type": "command", "run": "npm test"},
                    }
                ],
            }
        ],
    }
    (spec_dir / "implementation_plan.json").write_text(json.dumps(plan, indent=2))

    result = ImplementationPlanValidator(spec_dir).validate()

    assert result.valid is True
    assert any(
        "verification command matches test_plan" in warning
        for warning in result.warnings
    )

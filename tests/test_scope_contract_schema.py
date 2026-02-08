#!/usr/bin/env python3
"""
Tests for Scope Contract schema.
"""

from spec.validate_pkg.schemas import SCOPE_CONTRACT_SCHEMA


def test_scope_contract_schema_required_fields():
    required = SCOPE_CONTRACT_SCHEMA["required_fields"]
    assert "intent" in required
    assert "outcome" in required
    assert "where" in required
    assert "why" in required
    assert "when" in required
    assert "acceptance" in required
    assert "test_plan" in required
    assert "allowed_paths" in required


def test_scope_contract_schema_intent_values():
    intents = SCOPE_CONTRACT_SCHEMA["intent_values"]
    assert "create" in intents
    assert "change" in intents
    assert "delete" in intents
    assert "investigate" in intents

import pytest

from plan_importer.agent_pipeline import run_agent_pipeline


def test_agent_pipeline_returns_metadata():
    plan = """
# Section One
- [ ] Task Alpha
- [ ] Task Beta (parallel: true)
"""
    payload = run_agent_pipeline(plan, max_concurrency=2, agent_profiles={"parser": "auto"})

    assert "pipeline" in payload
    assert payload["pipeline"]["enabled"] is True
    assert payload["pipeline"]["mode"] == "agent"
    assert payload["pipeline"]["agents"]["parser"] == "auto"
    assert payload["tasks"]
    assert payload["schedule"]

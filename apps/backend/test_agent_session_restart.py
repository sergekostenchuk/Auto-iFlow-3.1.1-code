import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_ROOT))

from agents import coder as coder_mod


class DummyStatusManager:
    def __init__(self, *_args, **_kwargs) -> None:
        self.active = None

    def set_active(self, *_args, **_kwargs) -> None:
        return None

    def update(self, *_args, **_kwargs) -> None:
        return None

    def update_subtasks(self, *_args, **_kwargs) -> None:
        return None

    def update_session(self, *_args, **_kwargs) -> None:
        return None


class DummyRecoveryManager:
    def __init__(self, *_args, **_kwargs) -> None:
        self._attempts = {}

    def get_attempt_count(self, subtask_id: str | None) -> int:
        if not subtask_id:
            return 0
        return self._attempts.get(subtask_id, 0)

    def get_recovery_hints(self, _subtask_id: str) -> list[str]:
        return []

    def record_attempt(self, *_args, **_kwargs) -> None:
        return None

    def record_good_commit(self, *_args, **_kwargs) -> None:
        return None

    def mark_subtask_stuck(self, *_args, **_kwargs) -> None:
        return None

    def get_stuck_subtasks(self) -> list[dict]:
        return []


@pytest.mark.asyncio
async def test_run_autonomous_agent_fresh_context(monkeypatch, tmp_path: Path) -> None:
    spec_dir = tmp_path / ".auto-iflow" / "specs" / "001-test"
    spec_dir.mkdir(parents=True)
    project_dir = tmp_path / "project"
    project_dir.mkdir()

    plan = {
        "phases": [
            {
                "name": "Phase 1",
                "subtasks": [
                    {
                        "id": "subtask-1-1",
                        "description": "Test subtask",
                        "service": "all",
                    }
                ],
            }
        ]
    }
    next_subtask = plan["phases"][0]["subtasks"][0]

    monkeypatch.setattr(coder_mod, "StatusManager", DummyStatusManager)
    monkeypatch.setattr(coder_mod, "RecoveryManager", DummyRecoveryManager)
    monkeypatch.setattr(coder_mod, "get_task_logger", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(coder_mod, "debug_memory_system_status", lambda *_a, **_k: None)
    monkeypatch.setattr(
        coder_mod,
        "count_subtasks_detailed",
        lambda *_a, **_k: {"completed": 0, "total": 1, "in_progress": 0},
    )
    monkeypatch.setattr(coder_mod, "is_first_run", lambda *_a, **_k: False)
    monkeypatch.setattr(coder_mod, "is_build_complete", lambda *_a, **_k: False)
    monkeypatch.setattr(coder_mod, "load_implementation_plan", lambda *_a, **_k: plan)
    monkeypatch.setattr(coder_mod, "get_next_subtask", lambda *_a, **_k: next_subtask)
    monkeypatch.setattr(coder_mod, "find_phase_for_subtask", lambda *_a, **_k: {"name": "Phase 1"})
    monkeypatch.setattr(coder_mod, "generate_subtask_prompt", lambda **_k: "prompt")
    monkeypatch.setattr(coder_mod, "load_subtask_context", lambda *_a, **_k: {})
    monkeypatch.setattr(coder_mod, "format_context_for_prompt", lambda *_a, **_k: "")
    async def fake_graphiti_context(*_args, **_kwargs):
        return None

    monkeypatch.setattr(coder_mod, "get_graphiti_context", fake_graphiti_context)
    monkeypatch.setattr(coder_mod, "print_progress_summary", lambda *_a, **_k: None)
    monkeypatch.setattr(coder_mod, "print_build_complete_banner", lambda *_a, **_k: None)
    monkeypatch.setattr(coder_mod, "emit_phase", lambda *_a, **_k: None)
    monkeypatch.setattr(coder_mod, "is_linear_enabled", lambda *_a, **_k: False)
    monkeypatch.setattr(coder_mod, "resolve_scope_write_dirs", lambda *_a, **_k: ([], None))

    create_calls: list[dict | None] = []

    def fake_create_iflow_client(*_args, **kwargs):
        create_calls.append(kwargs.get("session_settings"))

        class DummyClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, _exc_type, _exc, _tb):
                return False

        return DummyClient()

    async def fake_run_agent_session(*_args, **_kwargs):
        return "complete", "done"

    async def fake_post_session_processing(*_args, **_kwargs):
        return True

    monkeypatch.setattr(coder_mod, "create_iflow_client", fake_create_iflow_client)
    monkeypatch.setattr(coder_mod, "run_agent_session", fake_run_agent_session)
    monkeypatch.setattr(coder_mod, "post_session_processing", fake_post_session_processing)

    await coder_mod.run_autonomous_agent(
        project_dir=project_dir,
        spec_dir=spec_dir,
        model="test-model",
        max_iterations=1,
    )

    assert create_calls
    session_settings = create_calls[0]
    assert session_settings is not None
    assert session_settings.get("fresh_context") is True
    assert "subtask-1-1" in session_settings.get("session_id", "")


@pytest.mark.asyncio
async def test_run_autonomous_agent_scope_enforcement_blocks(monkeypatch, tmp_path: Path) -> None:
    spec_dir = tmp_path / ".auto-iflow" / "specs" / "001-test"
    spec_dir.mkdir(parents=True)
    project_dir = tmp_path / "project"
    project_dir.mkdir()

    plan = {
        "phases": [
            {
                "name": "Phase 1",
                "subtasks": [
                    {
                        "id": "subtask-1-1",
                        "description": "Test subtask",
                        "service": "all",
                    }
                ],
            }
        ]
    }
    next_subtask = plan["phases"][0]["subtasks"][0]

    class DummyLogger:
        def log_error(self, *_args, **_kwargs) -> None:
            return None

    monkeypatch.setattr(coder_mod, "StatusManager", DummyStatusManager)
    monkeypatch.setattr(coder_mod, "RecoveryManager", DummyRecoveryManager)
    monkeypatch.setattr(coder_mod, "get_task_logger", lambda *_a, **_k: DummyLogger())
    monkeypatch.setattr(coder_mod, "debug_memory_system_status", lambda *_a, **_k: None)
    monkeypatch.setattr(
        coder_mod,
        "count_subtasks_detailed",
        lambda *_a, **_k: {"completed": 0, "total": 1, "in_progress": 0},
    )
    monkeypatch.setattr(coder_mod, "is_first_run", lambda *_a, **_k: False)
    monkeypatch.setattr(coder_mod, "is_build_complete", lambda *_a, **_k: False)
    monkeypatch.setattr(coder_mod, "load_implementation_plan", lambda *_a, **_k: plan)
    monkeypatch.setattr(coder_mod, "get_next_subtask", lambda *_a, **_k: next_subtask)
    monkeypatch.setattr(coder_mod, "find_phase_for_subtask", lambda *_a, **_k: {"name": "Phase 1"})
    monkeypatch.setattr(coder_mod, "generate_subtask_prompt", lambda **_k: "prompt")
    monkeypatch.setattr(coder_mod, "load_subtask_context", lambda *_a, **_k: {})
    monkeypatch.setattr(coder_mod, "format_context_for_prompt", lambda *_a, **_k: "")

    async def fake_graphiti_context(*_args, **_kwargs):
        return None

    monkeypatch.setattr(coder_mod, "get_graphiti_context", fake_graphiti_context)
    monkeypatch.setattr(coder_mod, "print_progress_summary", lambda *_a, **_k: None)
    monkeypatch.setattr(coder_mod, "print_build_complete_banner", lambda *_a, **_k: None)
    monkeypatch.setattr(coder_mod, "emit_phase", lambda *_a, **_k: None)
    monkeypatch.setattr(coder_mod, "is_linear_enabled", lambda *_a, **_k: False)
    monkeypatch.setattr(
        coder_mod, "resolve_scope_write_dirs", lambda *_a, **_k: ([], "blocked")
    )

    def fake_create_iflow_client(*_args, **_kwargs):
        raise AssertionError("create_iflow_client should not be called when scope blocks")

    monkeypatch.setattr(coder_mod, "create_iflow_client", fake_create_iflow_client)

    await coder_mod.run_autonomous_agent(
        project_dir=project_dir,
        spec_dir=spec_dir,
        model="test-model",
        max_iterations=1,
    )

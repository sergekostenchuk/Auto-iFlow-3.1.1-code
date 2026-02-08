import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_ROOT))

from agents import session as session_mod


class DummyRecoveryManager:
    def record_attempt(self, *_args, **_kwargs) -> None:
        return None

    def record_good_commit(self, *_args, **_kwargs) -> None:
        return None

    def get_attempt_count(self, *_args, **_kwargs) -> int:
        return 0


class DummyLogger:
    def __init__(self) -> None:
        self.errors: list[str] = []

    def log_error(self, message, *_args, **_kwargs) -> None:
        self.errors.append(message)


@pytest.mark.asyncio
async def test_post_session_processing_runs_post_code_tests(monkeypatch, tmp_path: Path) -> None:
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
                        "status": "completed",
                    }
                ],
            }
        ]
    }
    subtask = plan["phases"][0]["subtasks"][0]

    monkeypatch.setattr(session_mod, "sync_spec_to_source", lambda *_a, **_k: False)
    monkeypatch.setattr(session_mod, "load_implementation_plan", lambda *_a, **_k: plan)
    monkeypatch.setattr(session_mod, "find_subtask_in_plan", lambda *_a, **_k: subtask)
    monkeypatch.setattr(session_mod, "get_latest_commit", lambda *_a, **_k: "abc1234")
    monkeypatch.setattr(session_mod, "get_commit_count", lambda *_a, **_k: 1)
    monkeypatch.setattr(
        session_mod,
        "count_subtasks_detailed",
        lambda *_a, **_k: {"completed": 1, "total": 1, "in_progress": 0},
    )
    monkeypatch.setattr(session_mod, "is_build_complete", lambda *_a, **_k: True)
    monkeypatch.setattr(session_mod, "_append_build_progress", lambda *_a, **_k: None)

    async def fake_extract_session_insights(*_a, **_k):
        return None

    async def fake_save_session_memory(*_a, **_k):
        return True, "graphiti"

    monkeypatch.setattr(session_mod, "extract_session_insights", fake_extract_session_insights)
    monkeypatch.setattr(session_mod, "save_session_memory", fake_save_session_memory)

    called = {"tests": False}

    async def fake_run_post_code_tests_if_needed(*_a, **_k):
        called["tests"] = True
        return {"status": "failed"}

    monkeypatch.setattr(
        session_mod, "run_post_code_tests_if_needed", fake_run_post_code_tests_if_needed
    )

    logger = DummyLogger()
    monkeypatch.setattr(session_mod, "get_task_logger", lambda *_a, **_k: logger)

    await session_mod.post_session_processing(
        spec_dir=spec_dir,
        project_dir=project_dir,
        subtask_id="subtask-1-1",
        session_num=1,
        commit_before=None,
        commit_count_before=0,
        recovery_manager=DummyRecoveryManager(),
        linear_enabled=False,
        status_manager=None,
        source_spec_dir=None,
    )

    assert called["tests"] is True
    assert any("Human Review blocked" in message for message in logger.errors)

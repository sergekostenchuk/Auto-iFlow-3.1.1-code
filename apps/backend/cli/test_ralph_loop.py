from pathlib import Path

from cli.build_commands import _run_build_with_optional_ralph_loop


def _noop(*_args, **_kwargs) -> None:
    return None


def test_ralph_loop_disabled_runs_once(tmp_path: Path) -> None:
    calls = {"agent": 0, "qa": 0}

    def run_agent_func(**_kwargs) -> None:
        calls["agent"] += 1

    def run_qa_func(**_kwargs) -> bool:
        calls["qa"] += 1
        return False

    def should_run_qa_func(_spec_dir: Path) -> bool:
        return True

    qa_approved = _run_build_with_optional_ralph_loop(
        working_dir=tmp_path,
        spec_dir=tmp_path / "spec",
        model=None,
        max_iterations=None,
        verbose=False,
        source_spec_dir=None,
        skip_qa=False,
        ralph_loop_enabled=False,
        ralph_loop_max=3,
        run_agent_func=run_agent_func,
        run_qa_func=run_qa_func,
        should_run_qa_func=should_run_qa_func,
        sync_spec_func=lambda *_args, **_kwargs: False,
        debug_success=_noop,
        debug_info=_noop,
    )

    assert qa_approved is False
    assert calls["agent"] == 1
    assert calls["qa"] == 1


def test_ralph_loop_multi_iteration_until_passes(tmp_path: Path) -> None:
    calls = {"agent": 0, "qa": 0}
    qa_results = [False, False, True]

    def run_agent_func(**_kwargs) -> None:
        calls["agent"] += 1

    def run_qa_func(**_kwargs) -> bool:
        calls["qa"] += 1
        return qa_results.pop(0)

    def should_run_qa_func(_spec_dir: Path) -> bool:
        return True

    qa_approved = _run_build_with_optional_ralph_loop(
        working_dir=tmp_path,
        spec_dir=tmp_path / "spec",
        model=None,
        max_iterations=None,
        verbose=False,
        source_spec_dir=None,
        skip_qa=False,
        ralph_loop_enabled=True,
        ralph_loop_max=5,
        run_agent_func=run_agent_func,
        run_qa_func=run_qa_func,
        should_run_qa_func=should_run_qa_func,
        sync_spec_func=lambda *_args, **_kwargs: False,
        debug_success=_noop,
        debug_info=_noop,
    )

    assert qa_approved is True
    assert calls["agent"] == 3
    assert calls["qa"] == 3

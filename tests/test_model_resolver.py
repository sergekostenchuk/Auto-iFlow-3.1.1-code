import json
from pathlib import Path

import pytest

from core import model_resolver


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _setup_spec_dir(tmp_path: Path) -> tuple[Path, Path, Path]:
    project_dir = tmp_path / "project"
    auto_build_dir = project_dir / ".auto-iflow"
    spec_dir = auto_build_dir / "specs" / "001"
    spec_dir.mkdir(parents=True, exist_ok=True)
    return project_dir, auto_build_dir, spec_dir


def test_resolve_model_role_priority(tmp_path: Path) -> None:
    project_dir, auto_build_dir, spec_dir = _setup_spec_dir(tmp_path)

    task_metadata = {
        "modelRouting": {
            "phases": {"spec": {"model": "glm-4.7", "thinkingLevel": "low"}},
            "features": {"github": {"model": "deepseek-v3.2", "thinkingLevel": "medium"}},
            "advancedRoles": {
                "github": {"batch": {"model": "kimi-k2-0905", "thinkingLevel": "high"}}
            },
        }
    }
    _write_json(spec_dir / "task_metadata.json", task_metadata)
    _write_json(auto_build_dir / "project.env.json", {})

    model_id, thinking_level, thinking_budget = model_resolver.resolve_model(
        phase="spec",
        feature="github",
        role="batch",
        spec_dir=spec_dir,
        project_dir=project_dir,
        auto_build_path=".auto-iflow",
    )

    assert model_id == "kimi-k2-0905"
    assert thinking_level == "high"
    assert thinking_budget == 16384


def test_resolve_model_fallbacks_to_feature(tmp_path: Path) -> None:
    project_dir, auto_build_dir, spec_dir = _setup_spec_dir(tmp_path)

    task_metadata = {
        "modelRouting": {
            "phases": {"spec": {"model": "glm-4.7", "thinkingLevel": "low"}},
            "features": {"github": {"model": "deepseek-v3.2", "thinkingLevel": "medium"}},
        }
    }
    _write_json(spec_dir / "task_metadata.json", task_metadata)
    _write_json(auto_build_dir / "project.env.json", {})

    model_id, thinking_level, thinking_budget = model_resolver.resolve_model(
        phase="spec",
        feature="github",
        role="batch",
        spec_dir=spec_dir,
        project_dir=project_dir,
        auto_build_path=".auto-iflow",
    )

    assert model_id == "deepseek-v3.2"
    assert thinking_level == "medium"
    assert thinking_budget == 4096


def test_resolve_model_cli_override(tmp_path: Path) -> None:
    project_dir, auto_build_dir, spec_dir = _setup_spec_dir(tmp_path)

    task_metadata = {
        "modelRouting": {
            "phases": {"spec": {"model": "glm-4.7", "thinkingLevel": "high"}},
        }
    }
    _write_json(spec_dir / "task_metadata.json", task_metadata)
    _write_json(auto_build_dir / "project.env.json", {})

    model_id, thinking_level, thinking_budget = model_resolver.resolve_model(
        phase="spec",
        spec_dir=spec_dir,
        project_dir=project_dir,
        auto_build_path=".auto-iflow",
        cli_model="minimax-m2.1",
        cli_thinking="low",
    )

    assert model_id == "minimax-m2.1"
    assert thinking_level == "low"
    assert thinking_budget == 1024


def test_resolve_model_invalid_thinking_falls_back(tmp_path: Path) -> None:
    project_dir, auto_build_dir, spec_dir = _setup_spec_dir(tmp_path)

    task_metadata = {
        "modelRouting": {
            "features": {"ideation": {"model": "glm-4.7", "thinkingLevel": "banana"}},
        }
    }
    _write_json(spec_dir / "task_metadata.json", task_metadata)
    _write_json(auto_build_dir / "project.env.json", {})

    model_id, thinking_level, thinking_budget = model_resolver.resolve_model(
        feature="ideation",
        spec_dir=spec_dir,
        project_dir=project_dir,
        auto_build_path=".auto-iflow",
    )

    assert model_id == "glm-4.7"
    assert thinking_level == "medium"
    assert thinking_budget == 4096


def test_resolve_model_project_env_without_spec_dir(tmp_path: Path) -> None:
    project_dir = tmp_path / "project"
    auto_build_dir = project_dir / ".auto-iflow"
    auto_build_dir.mkdir(parents=True, exist_ok=True)

    project_env = {
        "modelRouting": {
            "features": {
                "consilium": {"model": "deepseek-v3.2", "thinkingLevel": "low"}
            }
        }
    }
    _write_json(auto_build_dir / "project.env.json", project_env)

    model_id, thinking_level, thinking_budget = model_resolver.resolve_model(
        feature="consilium",
        project_dir=project_dir,
        auto_build_path=".auto-iflow",
    )

    assert model_id == "deepseek-v3.2"
    assert thinking_level == "low"
    assert thinking_budget == 1024


def test_resolve_model_disables_thinking_for_unsupported_model(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    project_dir, auto_build_dir, spec_dir = _setup_spec_dir(tmp_path)

    task_metadata = {
        "modelRouting": {
            "features": {"merge": {"model": "glm-4.7", "thinkingLevel": "high"}},
        }
    }
    _write_json(spec_dir / "task_metadata.json", task_metadata)
    _write_json(auto_build_dir / "project.env.json", {})

    def fake_model_info(model_id: str) -> dict:
        return {"supportsThinking": False}

    monkeypatch.setattr(model_resolver, "get_model_info", fake_model_info)

    model_id, thinking_level, thinking_budget = model_resolver.resolve_model(
        feature="merge",
        spec_dir=spec_dir,
        project_dir=project_dir,
        auto_build_path=".auto-iflow",
    )

    assert model_id == "glm-4.7"
    assert thinking_level == "none"
    assert thinking_budget is None

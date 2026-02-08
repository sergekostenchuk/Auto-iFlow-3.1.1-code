import json

from core import model_registry, model_resolver


def _write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def _write_registry(tmp_path, data):
    path = tmp_path / "models.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def _patch_registry(monkeypatch, path):
    monkeypatch.setattr(model_registry, "resolve_shared_path", lambda _: path)


def _base_registry():
    return {
        "models": [
            {
                "id": "role-model",
                "displayName": "Role Model",
                "tier": "balanced",
                "supportsThinking": True,
            },
            {
                "id": "feature-model",
                "displayName": "Feature Model",
                "tier": "balanced",
                "supportsThinking": True,
            },
            {
                "id": "phase-model",
                "displayName": "Phase Model",
                "tier": "balanced",
                "supportsThinking": True,
                "recommendedFor": ["coding"],
            },
            {
                "id": "project-model",
                "displayName": "Project Model",
                "tier": "balanced",
                "supportsThinking": True,
            },
            {
                "id": "app-model",
                "displayName": "App Model",
                "tier": "balanced",
                "supportsThinking": True,
            },
        ],
        "legacyAliases": {},
        "bootstrapModel": "phase-model",
    }


def test_resolve_model_role_feature_phase_priority(monkeypatch, tmp_path):
    _patch_registry(monkeypatch, _write_registry(tmp_path, _base_registry()))

    project_dir = tmp_path / "project"
    auto_build_dir = project_dir / ".auto-iflow"
    spec_dir = auto_build_dir / "specs" / "001-test"
    spec_dir.mkdir(parents=True)

    _write_json(
        spec_dir / "task_metadata.json",
        {
            "modelRouting": {
                "phases": {"coding": {"model": "phase-model"}},
                "features": {"github": {"model": "feature-model"}},
                "advancedRoles": {"github": {"review": {"model": "role-model"}}},
            }
        },
    )

    model_id, _, _ = model_resolver.resolve_model(
        feature="github", role="review", spec_dir=spec_dir
    )
    assert model_id == "role-model"

    model_id, _, _ = model_resolver.resolve_model(feature="github", spec_dir=spec_dir)
    assert model_id == "feature-model"

    model_id, _, _ = model_resolver.resolve_model(phase="coding", spec_dir=spec_dir)
    assert model_id == "phase-model"


def test_resolve_model_fallback_project_then_app(monkeypatch, tmp_path):
    registry = _base_registry()
    registry["models"].append(
        {
            "id": "recommended-model",
            "displayName": "Recommended",
            "tier": "balanced",
            "supportsThinking": True,
            "recommendedFor": ["planning"],
        }
    )
    _patch_registry(monkeypatch, _write_registry(tmp_path, registry))

    project_dir = tmp_path / "project"
    auto_build_dir = project_dir / ".auto-iflow"
    spec_dir = auto_build_dir / "specs" / "002-test"
    spec_dir.mkdir(parents=True)

    _write_json(spec_dir / "task_metadata.json", {"modelRouting": {}})
    _write_json(
        auto_build_dir / "project.env.json",
        {"modelRouting": {"phases": {"planning": {"model": "project-model"}}}},
    )
    app_settings = tmp_path / "app_settings.json"
    _write_json(
        app_settings,
        {"modelRouting": {"phases": {"planning": {"model": "app-model"}}}},
    )
    monkeypatch.setenv("AUTO_CLAUDE_SETTINGS_PATH", str(app_settings))

    model_id, _, _ = model_resolver.resolve_model(phase="planning", spec_dir=spec_dir)
    assert model_id == "project-model"

    (auto_build_dir / "project.env.json").unlink()
    model_id, _, _ = model_resolver.resolve_model(phase="planning", spec_dir=spec_dir)
    assert model_id == "app-model"

    monkeypatch.delenv("AUTO_CLAUDE_SETTINGS_PATH", raising=False)
    model_id, _, _ = model_resolver.resolve_model(phase="planning", spec_dir=spec_dir)
    assert model_id == "recommended-model"


def test_resolve_model_cli_override(monkeypatch, tmp_path):
    _patch_registry(monkeypatch, _write_registry(tmp_path, _base_registry()))

    project_dir = tmp_path / "project"
    auto_build_dir = project_dir / ".auto-iflow"
    spec_dir = auto_build_dir / "specs" / "003-test"
    spec_dir.mkdir(parents=True)
    _write_json(spec_dir / "task_metadata.json", {"modelRouting": {}})

    model_id, _, _ = model_resolver.resolve_model(
        phase="planning", spec_dir=spec_dir, cli_model="cli-model"
    )
    assert model_id == "cli-model"


def test_resolve_model_allows_custom_model_id(monkeypatch, tmp_path):
    _patch_registry(monkeypatch, _write_registry(tmp_path, _base_registry()))

    project_dir = tmp_path / "project"
    auto_build_dir = project_dir / ".auto-iflow"
    spec_dir = auto_build_dir / "specs" / "004-custom-model"
    spec_dir.mkdir(parents=True)

    _write_json(
        spec_dir / "task_metadata.json",
        {"modelRouting": {"phases": {"coding": {"model": "custom-model"}}}},
    )

    model_id, _, _ = model_resolver.resolve_model(phase="coding", spec_dir=spec_dir)
    assert model_id == "custom-model"

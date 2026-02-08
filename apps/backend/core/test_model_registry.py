import json

import pytest

from core import model_registry


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
                "id": "glm-4.7",
                "displayName": "GLM-4.7",
                "tier": "balanced",
                "supportsThinking": True,
            }
        ],
        "legacyAliases": {"sonnet": "glm-4.7"},
        "bootstrapModel": "glm-4.7",
    }


def test_load_model_registry_duplicate_ids_raises(monkeypatch, tmp_path):
    data = _base_registry()
    data["models"].append(
        {
            "id": "glm-4.7",
            "displayName": "Duplicate",
            "tier": "balanced",
            "supportsThinking": True,
        }
    )
    _patch_registry(monkeypatch, _write_registry(tmp_path, data))

    with pytest.raises(ValueError, match="Duplicate model id"):
        model_registry.load_model_registry()


def test_load_model_registry_alias_collision_raises(monkeypatch, tmp_path):
    data = _base_registry()
    data["models"].append(
        {
            "id": "other-model",
            "displayName": "Other",
            "tier": "balanced",
            "supportsThinking": True,
            "aliases": ["sonnet"],
        }
    )
    data["legacyAliases"] = {"sonnet": "glm-4.7"}
    _patch_registry(monkeypatch, _write_registry(tmp_path, data))

    with pytest.raises(ValueError, match="Alias collision"):
        model_registry.load_model_registry()


def test_build_alias_map_custom_override(monkeypatch, tmp_path):
    data = _base_registry()
    _patch_registry(monkeypatch, _write_registry(tmp_path, data))

    api_profile = {
        "custom_models": [
            {
                "id": "custom-model",
                "displayName": "Custom",
                "tier": "balanced",
                "supportsThinking": True,
                "aliases": ["sonnet"],
            }
        ]
    }

    alias_map = model_registry.build_alias_map(api_profile)
    assert alias_map["sonnet"] == "custom-model"


def test_resolve_model_id_env_override(monkeypatch, tmp_path):
    data = _base_registry()
    _patch_registry(monkeypatch, _write_registry(tmp_path, data))
    monkeypatch.setenv("IFLOW_DEFAULT_SONNET_MODEL", "env-override")

    assert model_registry.resolve_model_id("sonnet") == "env-override"


def test_get_bootstrap_model(monkeypatch, tmp_path):
    data = _base_registry()
    _patch_registry(monkeypatch, _write_registry(tmp_path, data))

    assert model_registry.get_bootstrap_model() == "glm-4.7"

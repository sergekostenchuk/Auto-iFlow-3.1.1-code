from __future__ import annotations

from core.model_registry import build_alias_map, get_all_models, load_model_registry


def test_load_model_registry_has_models() -> None:
    data = load_model_registry()
    assert "models" in data
    assert any(model["id"] == "glm-4.7" for model in data["models"])


def test_custom_model_overrides_base() -> None:
    custom = {
        "id": "glm-4.7",
        "displayName": "GLM-4.7 Custom",
        "tier": "balanced",
        "supportsThinking": True,
    }
    models = get_all_models({"custom_models": [custom]})
    model = next(model for model in models if model["id"] == "glm-4.7")
    assert model["displayName"] == "GLM-4.7 Custom"


def test_custom_alias_overrides_legacy() -> None:
    custom = {
        "id": "custom-sonnet",
        "displayName": "Custom Sonnet",
        "tier": "balanced",
        "supportsThinking": True,
        "aliases": ["sonnet"],
    }
    alias_map = build_alias_map({"custom_models": [custom]})
    assert alias_map["sonnet"] == "custom-sonnet"

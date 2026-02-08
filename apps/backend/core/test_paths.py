from pathlib import Path

from core import paths


def test_resolve_shared_path_prefers_resources_dir(tmp_path, monkeypatch):
    resources_dir = tmp_path / "Resources"
    core_dir = resources_dir / "backend" / "core"
    core_dir.mkdir(parents=True, exist_ok=True)
    fake_paths_file = core_dir / "paths.py"
    fake_paths_file.write_text("# fake", encoding="utf-8")

    shared_dir = resources_dir / "shared"
    shared_dir.mkdir(parents=True, exist_ok=True)
    target = shared_dir / "models.json"
    target.write_text("{}", encoding="utf-8")

    monkeypatch.setattr(paths, "__file__", str(fake_paths_file))

    resolved = paths.resolve_shared_path("models.json")
    assert resolved == target

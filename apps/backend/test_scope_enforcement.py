import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_ROOT))

from spec.scope_enforcement import resolve_scope_write_dirs


def test_resolve_scope_write_dirs_missing_contract(tmp_path: Path) -> None:
    spec_dir = tmp_path / ".auto-iflow" / "specs" / "001-test"
    spec_dir.mkdir(parents=True)
    project_dir = tmp_path / "project"
    project_dir.mkdir()

    allowed_dirs, error = resolve_scope_write_dirs(spec_dir, project_dir)

    assert allowed_dirs == []
    assert error == "scope_contract.json not found"


def test_resolve_scope_write_dirs_missing_allowed_paths(tmp_path: Path) -> None:
    spec_dir = tmp_path / ".auto-iflow" / "specs" / "001-test"
    spec_dir.mkdir(parents=True)
    project_dir = tmp_path / "project"
    project_dir.mkdir()

    (spec_dir / "scope_contract.json").write_text('{"allowed_paths": []}')

    allowed_dirs, error = resolve_scope_write_dirs(spec_dir, project_dir)

    assert allowed_dirs == []
    assert error == "scope_contract.json missing allowed_paths"


def test_resolve_scope_write_dirs_valid_paths(tmp_path: Path) -> None:
    spec_dir = tmp_path / ".auto-iflow" / "specs" / "001-test"
    spec_dir.mkdir(parents=True)
    project_dir = tmp_path / "project"
    project_dir.mkdir()

    (spec_dir / "scope_contract.json").write_text(
        '{"allowed_paths": ["apps/frontend/**"]}'
    )

    allowed_dirs, error = resolve_scope_write_dirs(spec_dir, project_dir)

    assert error is None
    assert allowed_dirs

    resolved = set(allowed_dirs)
    expected_project_root = project_dir / "apps" / "frontend"
    expected_auto_build = project_dir / ".auto-iflow"

    assert str(spec_dir.resolve()) in resolved
    assert str(expected_project_root.resolve()) in resolved
    assert str(expected_auto_build.resolve()) in resolved

"""
Scope Enforcement Helpers
=========================

Utilities for enforcing scope contract rules during coding sessions.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from init import resolve_auto_build_dir


def _dedupe_paths(paths: list[Path]) -> list[Path]:
    seen: set[str] = set()
    result: list[Path] = []
    for path in paths:
        resolved = str(path.resolve())
        if resolved in seen:
            continue
        seen.add(resolved)
        result.append(path)
    return result


def _extract_root(path: str) -> str | None:
    cleaned = path.strip().replace("\\", "/").lstrip("/")
    if not cleaned:
        return None

    if cleaned.endswith("/**"):
        cleaned = cleaned[:-3]

    wildcard_match = re.search(r"[*?\[]", cleaned)
    if wildcard_match:
        cleaned = cleaned[: wildcard_match.start()]

    cleaned = cleaned.rstrip("/")
    if not cleaned:
        return None

    candidate = Path(cleaned)
    if candidate.suffix:
        candidate = candidate.parent

    cleaned = str(candidate)
    if cleaned in {"", "."}:
        return None
    return cleaned


def resolve_scope_write_dirs(
    spec_dir: Path,
    project_dir: Path,
) -> tuple[list[str], str | None]:
    """
    Resolve allowed write directories from scope_contract.json.

    Returns:
        (allowed_dirs, error_message). If error_message is not None, enforcement should fail.
    """
    scope_file = spec_dir / "scope_contract.json"
    if not scope_file.exists():
        return [], "scope_contract.json not found"

    try:
        payload = json.loads(scope_file.read_text())
    except json.JSONDecodeError as exc:
        return [], f"scope_contract.json invalid JSON: {exc}"

    allowed_paths = payload.get("allowed_paths", [])
    if not isinstance(allowed_paths, list) or not allowed_paths:
        return [], "scope_contract.json missing allowed_paths"

    roots: list[Path] = []
    for entry in allowed_paths:
        if not isinstance(entry, str):
            continue
        root = _extract_root(entry)
        if root:
            roots.append(project_dir / root)

    if not roots:
        return [], "allowed_paths produced no usable roots"

    auto_build_dir = resolve_auto_build_dir(project_dir)
    allowed_dirs = [spec_dir, auto_build_dir]
    allowed_dirs.extend(roots)

    deduped = _dedupe_paths(allowed_dirs)
    return [str(path.resolve()) for path in deduped], None

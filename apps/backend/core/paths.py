"""
Shared resource path helpers.

Resolves files that are packaged outside app.asar (e.g., shared/models.json)
and still works in dev mode.
"""

from __future__ import annotations

import sys
from pathlib import Path


def resolve_shared_path(filename: str) -> Path:
    """
    Resolve a shared resource path.

    Priority:
    1. Resources/shared (packaged)
    2. Resources/app.asar/shared (packaged fallback)
    3. Dev repo root shared/
    """
    candidates: list[Path] = []

    # Packaged backend lives in .../Resources/backend/...
    resources_dir = Path(__file__).resolve().parents[2]
    candidates.append(resources_dir / "shared" / filename)
    candidates.append(resources_dir / "app.asar" / "shared" / filename)

    # Extra fallback via sys.executable (macOS layout)
    exe_resources = Path(sys.executable).resolve().parent.parent / "Resources" / "shared" / filename
    candidates.append(exe_resources)

    # Dev fallback: repo root/shared
    dev_root = Path(__file__).resolve().parents[3]
    candidates.append(dev_root / "shared" / filename)

    for path in candidates:
        if path.exists():
            return path

    raise FileNotFoundError(f"Cannot find shared resource: {filename}")

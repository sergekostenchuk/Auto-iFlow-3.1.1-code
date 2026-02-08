"""
Environment Reality Check
=========================

Runs preflight checks for project paths, permissions, and required binaries.
Generates a structured report used by the planning pipeline.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import os
import shutil
import sys
from typing import Any


@dataclass(frozen=True)
class BinaryCheck:
    name: str
    required: bool
    path: str | None
    found: bool
    reason: str | None = None


def _resolve_executable(name: str, env: dict[str, str]) -> str | None:
    path_env = env.get("PATH")
    return shutil.which(name, path=path_env) if path_env is not None else shutil.which(name)


def _normalize_env(env: dict[str, str] | None) -> dict[str, str]:
    if env is None:
        return dict(os.environ)
    return dict(env)


def _collect_languages(project_index: dict[str, Any]) -> set[str]:
    services = project_index.get("services", {}) or {}
    languages: set[str] = set()
    for service in services.values():
        language = (service.get("language") or "").lower()
        if language:
            languages.add(language)
    return languages


def _iflow_required(requirements: dict[str, Any] | None, env: dict[str, str]) -> bool:
    if requirements and requirements.get("requires_iflow_cli") is True:
        return True
    env_flag = env.get("AUTO_IFLOW_REQUIRE_IFLOW_CLI", "").lower()
    return env_flag in {"1", "true", "yes"}


def _detect_test_requirements(project_dir: Path) -> tuple[str | None, str | None]:
    backend_req = project_dir / "apps" / "backend" / "tests" / "requirements-test.txt"
    if backend_req.exists():
        return str(backend_req), "backend"
    project_req = project_dir / "tests" / "requirements-test.txt"
    if project_req.exists():
        return str(project_req), "project"
    return None, None


def _detect_backend_requirements(project_dir: Path) -> tuple[bool, str | None]:
    backend_req = project_dir / "apps" / "backend" / "requirements.txt"
    if backend_req.exists():
        return True, str(backend_req)
    return False, None


def run_env_reality_check(
    project_dir: Path,
    spec_dir: Path,
    project_index: dict[str, Any] | None = None,
    requirements: dict[str, Any] | None = None,
    env: dict[str, str] | None = None,
) -> dict[str, Any]:
    env = _normalize_env(env)
    project_index = project_index or {}

    errors: list[str] = []
    warnings: list[str] = []
    checks: dict[str, Any] = {}

    project_exists = project_dir.exists()
    project_is_dir = project_dir.is_dir()
    if not project_exists:
        errors.append("project_dir does not exist")
    if project_exists and not project_is_dir:
        errors.append("project_dir is not a directory")

    spec_exists = spec_dir.exists()
    spec_writable = os.access(spec_dir, os.W_OK) if spec_exists else False
    if not spec_exists:
        errors.append("spec_dir does not exist")
    if spec_exists and not spec_writable:
        errors.append("spec_dir is not writable")

    checks["paths"] = {
        "project_dir": str(project_dir),
        "project_exists": project_exists,
        "project_is_dir": project_is_dir,
        "spec_dir": str(spec_dir),
        "spec_exists": spec_exists,
        "spec_writable": spec_writable,
    }

    languages = _collect_languages(project_index)
    binaries: list[BinaryCheck] = []

    binaries.append(
        BinaryCheck(
            name="git",
            required=True,
            path=_resolve_executable("git", env),
            found=_resolve_executable("git", env) is not None,
            reason="git is required for worktrees and merge",
        )
    )

    requires_js = bool({"javascript", "typescript"} & languages)
    if requires_js:
        node_path = _resolve_executable("node", env)
        npm_path = _resolve_executable("npm", env)
        binaries.append(
            BinaryCheck(
                name="node",
                required=True,
                path=node_path,
                found=node_path is not None,
                reason="node is required for frontend tasks",
            )
        )
        binaries.append(
            BinaryCheck(
                name="npm",
                required=True,
                path=npm_path,
                found=npm_path is not None,
                reason="npm is required for frontend tasks",
            )
        )

    requires_python = bool("python" in languages) or True
    if requires_python:
        python_exec = sys.executable
        binaries.append(
            BinaryCheck(
                name="python",
                required=True,
                path=python_exec,
                found=bool(python_exec),
                reason="python is required for backend pipeline",
            )
        )

    iflow_path_override = env.get("AUTO_IFLOW_IFLOW_CLI_PATH") or env.get("IFLOW_CLI_PATH")
    if iflow_path_override:
        override_path = Path(iflow_path_override).expanduser()
        found_override = override_path.exists()
        binaries.append(
            BinaryCheck(
                name="iflow",
                required=_iflow_required(requirements, env),
                path=str(override_path),
                found=found_override,
                reason="iflow CLI path override",
            )
        )
    else:
        iflow_path = _resolve_executable("iflow", env)
        binaries.append(
            BinaryCheck(
                name="iflow",
                required=_iflow_required(requirements, env),
                path=iflow_path,
                found=iflow_path is not None,
                reason="iflow CLI on PATH",
            )
        )

    binary_payload: list[dict[str, Any]] = []
    for check in binaries:
        if check.required and not check.found:
            errors.append(f"required binary missing: {check.name}")
        elif not check.required and not check.found:
            warnings.append(f"optional binary missing: {check.name}")
        binary_payload.append(
            {
                "name": check.name,
                "required": check.required,
                "found": check.found,
                "path": check.path,
                "reason": check.reason,
            }
        )

    checks["binaries"] = binary_payload
    checks["languages"] = sorted(languages)

    requirements_path, requirements_source = _detect_test_requirements(project_dir)
    backend_requirements_ok, backend_requirements_path = _detect_backend_requirements(project_dir)
    if requirements_path is None:
        warnings.append("tests/requirements-test.txt not found (post-code tests may fail)")
    checks["test_requirements"] = {
        "found": requirements_path is not None,
        "path": requirements_path,
        "source": requirements_source,
        "note": "Used by post-code tests and Fix handler",
    }
    if not backend_requirements_ok:
        warnings.append("apps/backend/requirements.txt not found (backend deps may be missing)")
    checks["backend_requirements"] = {
        "found": backend_requirements_ok,
        "path": backend_requirements_path,
        "note": "Backend dependencies source",
    }

    status = "passed" if not errors else "failed"
    return {
        "status": status,
        "errors": errors,
        "warnings": warnings,
        "checks": checks,
        "created_at": datetime.now().isoformat(),
    }

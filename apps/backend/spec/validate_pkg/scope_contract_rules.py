"""
Scope Contract Rules
====================

Defines baseline rules for allowed/forbidden paths and default test plans.
These rules are used by pre-flight validation before coding begins.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


DEFAULT_FORBIDDEN_PATHS = [
    ".git/**",
    ".auto-iflow/**",
    ".venv/**",
    ".pytest_cache/**",
    "__pycache__/**",
    "node_modules/**",
    "dist/**",
    "build/**",
    "coverage/**",
    ".design-system/**",
]


@dataclass(frozen=True)
class ScopeRules:
    allowed_paths: list[str]
    forbidden_paths: list[str]
    test_plan: list[str]


def _normalize_path(path: str) -> str:
    cleaned = path.strip().replace("\\", "/")
    if cleaned.endswith("/"):
        cleaned = cleaned[:-1]
    return cleaned


def _strip_glob(path: str) -> str:
    cleaned = _normalize_path(path)
    if cleaned.endswith("/**"):
        return cleaned[:-3]
    return cleaned


def _dedupe(items: list[str]) -> list[str]:
    seen = set()
    result: list[str] = []
    for item in items:
        normalized = _normalize_path(item)
        if normalized and normalized not in seen:
            seen.add(normalized)
            result.append(normalized)
    return result


def _relativize_path(path: str, project_root: str | None) -> str | None:
    cleaned = _normalize_path(path)
    if not cleaned:
        return None
    if cleaned.startswith("/") and project_root:
        try:
            return str(Path(cleaned).relative_to(Path(project_root)))
        except ValueError:
            return None
    return cleaned


def derive_allowed_paths(project_index: dict) -> list[str]:
    services = project_index.get("services", {}) or {}
    allowed: list[str] = []
    project_root = project_index.get("project_root")

    for service_data in services.values():
        service_path = service_data.get("path")
        service_rel = _relativize_path(service_path, project_root)
        if service_rel:
            allowed.append(f"{service_rel}/**")
        key_dirs = service_data.get("key_directories", {}) or {}
        for entry in key_dirs.values():
            rel_path = entry.get("path")
            if service_rel and rel_path:
                allowed.append(f"{service_rel}/{rel_path}/**")

    if not allowed:
        top_level_dirs = project_index.get("top_level_dirs", []) or []
        for entry in top_level_dirs:
            entry_rel = _relativize_path(entry, project_root)
            if not entry_rel:
                continue
            if entry_rel.startswith("."):
                continue
            allowed.append(f"{entry_rel}/**")

    if not allowed:
        allowed.append("src/**")

    return _dedupe(allowed)


def derive_forbidden_paths(project_index: dict) -> list[str]:
    forbidden = list(DEFAULT_FORBIDDEN_PATHS)
    top_level_dirs = project_index.get("top_level_dirs", []) or []
    for entry in top_level_dirs:
        if entry in {"docs", "doc", "documentation"}:
            forbidden.append(f"{entry}/**")
    return _dedupe(forbidden)


def derive_test_plan(project_index: dict) -> list[str]:
    services = project_index.get("services", {}) or {}
    commands: list[str] = []

    for service_data in services.values():
        language = (service_data.get("language") or "").lower()
        if language == "python":
            commands.append("npm run test:backend")
        if language in {"javascript", "typescript"}:
            commands.append("npm test")

    if not commands:
        project_type = project_index.get("project_type", "single")
        if project_type == "monorepo":
            commands.extend(["npm test", "npm run test:backend"])
        else:
            commands.append("npm test")

    return _dedupe(commands)


def validate_scope_rules(
    allowed_paths: list[str], forbidden_paths: list[str]
) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    if not allowed_paths:
        errors.append("allowed_paths must not be empty")

    for path in allowed_paths:
        normalized = _normalize_path(path)
        if normalized.startswith("/"):
            errors.append(f"allowed_paths must be relative: {path}")

    forbidden_bases = [_strip_glob(path) for path in forbidden_paths]
    for allowed in allowed_paths:
        allowed_base = _strip_glob(allowed)
        for forbidden_base in forbidden_bases:
            if not forbidden_base:
                continue
            if allowed_base == forbidden_base or allowed_base.startswith(
                f"{forbidden_base}/"
            ):
                errors.append(
                    f"allowed_paths overlaps forbidden_paths: {allowed} -> {forbidden_base}"
                )

    if not forbidden_paths:
        warnings.append("forbidden_paths is empty")

    return errors, warnings


def derive_scope_rules(project_index: dict) -> ScopeRules:
    allowed = derive_allowed_paths(project_index)
    forbidden = derive_forbidden_paths(project_index)
    test_plan = derive_test_plan(project_index)
    return ScopeRules(allowed_paths=allowed, forbidden_paths=forbidden, test_plan=test_plan)

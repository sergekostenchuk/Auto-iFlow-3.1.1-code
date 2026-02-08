"""
Migration telemetry helpers.

Records migration and legacy fallback events to a global metrics log and
updates an aggregate summary for migration rollout tracking.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
from typing import Any

DEFAULT_DATA_DIRNAME = ".auto-iflow"

GLOBAL_MIGRATION_DIR = Path("~/.auto-iflow/migration").expanduser()
GLOBAL_METRICS_PATH = GLOBAL_MIGRATION_DIR / "metrics.jsonl"
GLOBAL_SUMMARY_PATH = GLOBAL_MIGRATION_DIR / "summary.json"

_EVENT_STATUS_MAP = {
    "legacy_fallback_used": "legacy",
    "legacy_fallback_blocked": "legacy",
    "migration_started": "legacy",
    "migration_failed": "legacy",
    "migration_success": "auto_iflow",
    "auto_iflow_used": "auto_iflow",
}

_SEEN_EVENTS: set[tuple[str | None, str]] = set()


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _telemetry_enabled() -> bool:
    return os.environ.get("AUTO_IFLOW_MIGRATION_TELEMETRY", "true").lower() != "false"


def _safe_load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def _append_json_line(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=True) + "\n")


def _project_metrics_path(project_dir: Path) -> Path | None:
    data_dir = project_dir / DEFAULT_DATA_DIRNAME
    if not data_dir.exists():
        return None
    migration_dir = data_dir / "migration"
    migration_dir.mkdir(parents=True, exist_ok=True)
    return migration_dir / "metrics.jsonl"


def _load_summary() -> dict[str, Any]:
    summary = _safe_load_json(GLOBAL_SUMMARY_PATH)
    if not summary:
        return {
            "version": 1,
            "projects": {},
            "counts": {"auto_iflow": 0, "legacy": 0, "total": 0},
            "events": {},
            "updated_at": None,
        }
    summary.setdefault("version", 1)
    summary.setdefault("projects", {})
    summary.setdefault("counts", {"auto_iflow": 0, "legacy": 0, "total": 0})
    summary.setdefault("events", {})
    summary.setdefault("updated_at", None)
    return summary


def _update_summary(project_path: str | None, event: str) -> None:
    summary = _load_summary()
    summary["events"][event] = summary["events"].get(event, 0) + 1

    if project_path:
        status = _EVENT_STATUS_MAP.get(event)
        if status:
            entry = summary["projects"].get(project_path, {})
            entry["status"] = status
            entry["last_event"] = event
            entry["last_seen"] = _utc_now()
            summary["projects"][project_path] = entry

    counts = {"auto_iflow": 0, "legacy": 0}
    for entry in summary["projects"].values():
        status = entry.get("status")
        if status == "auto_iflow":
            counts["auto_iflow"] += 1
        elif status == "legacy":
            counts["legacy"] += 1
    counts["total"] = counts["auto_iflow"] + counts["legacy"]
    summary["counts"] = counts
    summary["updated_at"] = _utc_now()

    GLOBAL_SUMMARY_PATH.parent.mkdir(parents=True, exist_ok=True)
    GLOBAL_SUMMARY_PATH.write_text(json.dumps(summary, ensure_ascii=True, indent=2), encoding="utf-8")


def record_migration_event(
    project_dir: Path | str | None,
    event: str,
    details: dict[str, Any] | None = None,
    *,
    dedupe: bool = True,
) -> None:
    if not _telemetry_enabled():
        return

    project_path = None
    if project_dir is not None:
        project_path = str(Path(project_dir).resolve())

    key = (project_path, event)
    if dedupe and key in _SEEN_EVENTS:
        return
    _SEEN_EVENTS.add(key)

    payload = {
        "timestamp": _utc_now(),
        "event": event,
        "project_path": project_path,
        "details": details or {},
    }

    try:
        _append_json_line(GLOBAL_METRICS_PATH, payload)
    except OSError:
        pass

    try:
        _update_summary(project_path, event)
    except OSError:
        pass

    if project_path:
        metrics_path = _project_metrics_path(Path(project_path))
        if metrics_path:
            try:
                _append_json_line(metrics_path, payload)
            except OSError:
                pass


def should_disable_legacy_fallback() -> bool:
    if os.environ.get("AUTO_IFLOW_FORCE_LEGACY_FALLBACK", "").lower() == "true":
        return False
    if os.environ.get("AUTO_IFLOW_DISABLE_LEGACY_FALLBACK", "").lower() == "true":
        return True

    summary = _load_summary()
    counts = summary.get("counts", {})
    total = int(counts.get("total", 0))
    auto_iflow = int(counts.get("auto_iflow", 0))
    if total == 0:
        return False

    try:
        threshold = float(os.environ.get("AUTO_IFLOW_FALLBACK_DISABLE_THRESHOLD", "0.95"))
    except ValueError:
        threshold = 0.95
    try:
        min_projects = int(os.environ.get("AUTO_IFLOW_FALLBACK_DISABLE_MIN_PROJECTS", "20"))
    except ValueError:
        min_projects = 20

    if total < min_projects:
        return False
    return (auto_iflow / total) >= threshold

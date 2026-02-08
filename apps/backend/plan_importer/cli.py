"""CLI wrapper for plan_importer to emit normalized tasks as JSON."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

from .parser import parse_task_plan
from .normalizer import normalize_sections
from .scheduler import schedule_tasks
from .agent_pipeline import run_agent_pipeline


def _read_file(path: Path) -> str:
    if not path.exists():
        raise FileNotFoundError(f"Plan file not found: {path}")
    return path.read_text(encoding="utf-8")


def _build_payload(plan_text: str, max_concurrency: int | None) -> dict:
    sections = parse_task_plan(plan_text)
    normalized = normalize_sections(sections)
    if max_concurrency is None:
        schedule = schedule_tasks(normalized)
    else:
        schedule = schedule_tasks(normalized, max_concurrency=max_concurrency)
    schedule_payload = [
        {
            "parallel": group.parallel,
            "tasks": [task.title for task in group.tasks],
        }
        for group in schedule
    ]

    return {
        "sections": [
            {
                "title": section.title,
                "tasks": [task.text for task in section.tasks],
            }
            for section in sections
        ],
        "tasks": [asdict(task) for task in normalized],
        "schedule": schedule_payload,
    }


def _parse_agent_profiles(raw: str | None) -> dict[str, str] | None:
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:  # noqa: PERF203
        raise ValueError("Invalid agent profiles JSON") from exc
    if not isinstance(data, dict):
        raise ValueError("Agent profiles JSON must be an object")
    return {str(k): str(v) for k, v in data.items()}


def main() -> int:
    parser = argparse.ArgumentParser(description="Parse and normalize a task plan")
    parser.add_argument("--file", required=True, help="Path to task plan markdown file")
    parser.add_argument("--max-concurrency", type=int, default=None)
    parser.add_argument("--agent-pipeline", action="store_true", help="Use agent-style pipeline stages")
    parser.add_argument("--agent-profiles", type=str, default=None, help="JSON map of agent profiles per stage")
    args = parser.parse_args()

    try:
        plan_text = _read_file(Path(args.file))
        if args.agent_pipeline:
            agent_profiles = _parse_agent_profiles(args.agent_profiles)
            payload = run_agent_pipeline(plan_text, args.max_concurrency, agent_profiles)
        else:
            payload = _build_payload(plan_text, args.max_concurrency)
    except Exception as exc:  # noqa: BLE001 - surface error to caller
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        return 1

    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

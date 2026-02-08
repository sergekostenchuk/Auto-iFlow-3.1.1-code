"""Agent-style pipeline for plan import (parse → decompose → normalize → schedule).

This is a deterministic placeholder pipeline that mirrors the intended agent stages.
It allows wiring UI selection and metadata while keeping behavior stable.
"""

from __future__ import annotations

from dataclasses import asdict
from typing import Any

from .parser import parse_task_plan
from .normalizer import normalize_sections
from .scheduler import schedule_tasks


def _build_schedule_payload(schedule) -> list[dict[str, Any]]:
    return [
        {"parallel": group.parallel, "tasks": [task.title for task in group.tasks]}
        for group in schedule
    ]


def run_agent_pipeline(
    plan_text: str,
    max_concurrency: int | None = None,
    agent_profiles: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Run a deterministic pipeline and return payload with pipeline metadata."""
    sections = parse_task_plan(plan_text)

    # Agent B (Decomposer) - placeholder noop for now.
    decomposed_sections = sections

    normalized = normalize_sections(decomposed_sections)
    if max_concurrency is None:
        schedule = schedule_tasks(normalized)
    else:
        schedule = schedule_tasks(normalized, max_concurrency=max_concurrency)

    return {
        "sections": [
            {"title": section.title, "tasks": [task.text for task in section.tasks]}
            for section in sections
        ],
        "tasks": [asdict(task) for task in normalized],
        "schedule": _build_schedule_payload(schedule),
        "pipeline": {
            "enabled": True,
            "mode": "agent",
            "agents": agent_profiles or {},
            "stages": ["parse", "decompose", "normalize", "schedule"],
            "notes": ["decompose:noop"],
        },
    }

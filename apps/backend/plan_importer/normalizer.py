"""Normalize parsed plan sections into Auto-iFlow task payloads."""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

from .parser import ParsedSection, ParsedTask


@dataclass
class NormalizedTask:
    title: str
    description: str
    parallel_allowed: Optional[bool]
    requirements: dict
    metadata: dict


def _build_description(section_title: str, task: ParsedTask) -> str:
    return (
        f"Section: {section_title}\n"
        f"Task: {task.text}\n"
        "Notes: Imported from task plan."
    )


def normalize_sections(sections: List[ParsedSection]) -> List[NormalizedTask]:
    tasks: List[NormalizedTask] = []
    for section in sections:
        for task in section.tasks:
            description = _build_description(section.title, task)
            requirements = {
                "title": task.text,
                "description": description,
                "files": [],
            }
            metadata = {
                "imported_from_plan": True,
                "plan_section": section.title,
                "parallel_allowed": task.parallel,
            }
            tasks.append(
                NormalizedTask(
                    title=task.text,
                    description=description,
                    parallel_allowed=task.parallel,
                    requirements=requirements,
                    metadata=metadata,
                )
            )
    return tasks

"""Markdown task plan parser."""

from __future__ import annotations

from dataclasses import dataclass
import re
from typing import List, Optional


HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")
TASK_RE = re.compile(r"^\s*[-*]\s*\[( |x|X)\]\s+(.*)$")
PARALLEL_RE = re.compile(r"\bparallel\s*:\s*(true|false)\b", re.IGNORECASE)


@dataclass
class ParsedTask:
    text: str
    checked: bool
    parallel: Optional[bool]


@dataclass
class ParsedSection:
    title: str
    tasks: List[ParsedTask]


def _extract_parallel(text: str) -> tuple[str, Optional[bool]]:
    match = PARALLEL_RE.search(text)
    if not match:
        return text.strip(), None
    value = match.group(1).lower() == "true"
    # Remove only the matched fragment to keep the task text clean.
    cleaned = (text[: match.start()] + text[match.end() :]).strip()
    # Remove empty parentheses left after stripping the flag.
    cleaned = re.sub(r"\(\s*\)", "", cleaned).strip()
    # Trim trailing separators left by removal.
    cleaned = cleaned.strip("-–—|: ")
    return cleaned, value


def parse_task_plan(markdown: str) -> List[ParsedSection]:
    """Parse Markdown plan into sections and tasks.

    Supported structure:
    - Headings (#/##/### ...) start new sections.
    - Task items use "- [ ]" or "- [x]" syntax.
    - Optional "parallel: true/false" hints inside task line.
    """

    sections: List[ParsedSection] = []
    current_section: Optional[ParsedSection] = None

    for raw_line in markdown.splitlines():
        line = raw_line.rstrip()
        if not line.strip():
            continue

        heading_match = HEADING_RE.match(line)
        if heading_match:
            title = heading_match.group(2).strip()
            if title:
                current_section = ParsedSection(title=title, tasks=[])
                sections.append(current_section)
            continue

        task_match = TASK_RE.match(line)
        if task_match:
            checked = task_match.group(1).lower() == "x"
            task_text = task_match.group(2).strip()
            task_text, parallel = _extract_parallel(task_text)
            if not current_section:
                # If tasks appear before any heading, place them in a default section.
                current_section = ParsedSection(title="General", tasks=[])
                sections.append(current_section)
            current_section.tasks.append(
                ParsedTask(text=task_text, checked=checked, parallel=parallel)
            )

    total_tasks = sum(len(section.tasks) for section in sections)
    if total_tasks == 0:
        raise ValueError("No tasks found in plan. Use markdown checklist items like '- [ ] Task'.")

    return sections

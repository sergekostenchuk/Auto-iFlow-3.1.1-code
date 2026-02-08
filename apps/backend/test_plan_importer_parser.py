import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_ROOT))

import pytest

from plan_importer.parser import parse_task_plan


def test_parse_simple_tasks():
    md = """
# Section A
- [ ] First task
- [x] Done task
"""
    sections = parse_task_plan(md)
    assert len(sections) == 1
    assert sections[0].title == "Section A"
    assert len(sections[0].tasks) == 2
    assert sections[0].tasks[0].text == "First task"
    assert sections[0].tasks[0].checked is False
    assert sections[0].tasks[1].checked is True


def test_parse_multiple_sections():
    md = """
# One
- [ ] Task 1

## Two
- [ ] Task 2
"""
    sections = parse_task_plan(md)
    assert [s.title for s in sections] == ["One", "Two"]
    assert sections[0].tasks[0].text == "Task 1"
    assert sections[1].tasks[0].text == "Task 2"


def test_parse_parallel_flags():
    md = """
# Parallel
- [ ] Run tests (parallel: true)
- [ ] Do X (parallel:false)
- [ ] No flag task
"""
    sections = parse_task_plan(md)
    tasks = sections[0].tasks
    assert tasks[0].parallel is True
    assert tasks[0].text == "Run tests"
    assert tasks[1].parallel is False
    assert tasks[1].text == "Do X"
    assert tasks[2].parallel is None


def test_parse_requires_tasks():
    md = """
# Empty Plan

Some introduction text without tasks.
"""
    with pytest.raises(ValueError, match="No tasks found"):
        parse_task_plan(md)

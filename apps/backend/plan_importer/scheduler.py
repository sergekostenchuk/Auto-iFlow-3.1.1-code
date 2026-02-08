"""Scheduler for plan-imported tasks."""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

from .normalizer import NormalizedTask


@dataclass
class TaskGroup:
    parallel: bool
    tasks: List[NormalizedTask]


def _chunk(items: List[NormalizedTask], size: int) -> List[List[NormalizedTask]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def schedule_tasks(
    tasks: List[NormalizedTask],
    default_parallel: bool = False,
    max_concurrency: int = 4,
) -> List[TaskGroup]:
    """Group tasks into parallel or sequential groups.

    - Tasks with parallel_allowed == True go into parallel groups.
    - Tasks with parallel_allowed == False go sequentially.
    - None uses default_parallel.
    """

    parallel_tasks: List[NormalizedTask] = []
    sequential_tasks: List[NormalizedTask] = []

    for task in tasks:
        if task.parallel_allowed is True:
            parallel_tasks.append(task)
        elif task.parallel_allowed is False:
            sequential_tasks.append(task)
        else:
            (parallel_tasks if default_parallel else sequential_tasks).append(task)

    groups: List[TaskGroup] = []

    if parallel_tasks:
        for chunk in _chunk(parallel_tasks, max(1, max_concurrency)):
            groups.append(TaskGroup(parallel=True, tasks=chunk))

    if sequential_tasks:
        for task in sequential_tasks:
            groups.append(TaskGroup(parallel=False, tasks=[task]))

    return groups

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_ROOT))

from plan_importer.normalizer import NormalizedTask
from plan_importer.scheduler import schedule_tasks


def _task(name: str, parallel: bool | None):
    return NormalizedTask(
        title=name,
        description=name,
        parallel_allowed=parallel,
        requirements={"title": name, "description": name, "files": []},
        metadata={"parallel_allowed": parallel},
    )


def test_schedule_groups_parallel_and_sequential():
    tasks = [_task("A", True), _task("B", False), _task("C", None)]
    groups = schedule_tasks(tasks, default_parallel=False, max_concurrency=2)
    # One parallel group with A, sequential groups for B and C
    assert groups[0].parallel is True
    assert [t.title for t in groups[0].tasks] == ["A"]
    assert groups[1].parallel is False
    assert groups[1].tasks[0].title == "B"
    assert groups[2].parallel is False
    assert groups[2].tasks[0].title == "C"


def test_schedule_parallel_chunks_respects_concurrency():
    tasks = [_task(str(i), True) for i in range(5)]
    groups = schedule_tasks(tasks, default_parallel=False, max_concurrency=2)
    parallel_groups = [g for g in groups if g.parallel]
    assert len(parallel_groups) == 3
    assert [len(g.tasks) for g in parallel_groups] == [2, 2, 1]

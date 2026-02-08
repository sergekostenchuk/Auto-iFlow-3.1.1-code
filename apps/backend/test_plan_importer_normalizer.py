import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_ROOT))

from plan_importer.parser import ParsedSection, ParsedTask
from plan_importer.normalizer import normalize_sections


def test_normalize_sections_creates_payloads():
    sections = [
        ParsedSection(
            title="Core",
            tasks=[
                ParsedTask(text="Do A", checked=False, parallel=True),
                ParsedTask(text="Do B", checked=True, parallel=None),
            ],
        )
    ]

    tasks = normalize_sections(sections)
    assert len(tasks) == 2
    assert tasks[0].title == "Do A"
    assert tasks[0].parallel_allowed is True
    assert tasks[0].requirements["title"] == "Do A"
    assert tasks[0].metadata["plan_section"] == "Core"
    assert tasks[1].parallel_allowed is None

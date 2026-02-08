import sys
from pathlib import Path

from dataclasses import dataclass

BACKEND_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_ROOT))

from spec.phases.models import PhaseResult
from spec.pipeline import orchestrator


@dataclass
class LoggedEntry:
    content: str
    detail: str


class DummyLogger:
    def __init__(self) -> None:
        self.entries: list[LoggedEntry] = []

    def log_with_detail(self, content, detail, *_args, **_kwargs) -> None:
        self.entries.append(LoggedEntry(content=content, detail=detail))


def test_log_phase_failure_records_reason_and_detail() -> None:
    logger = DummyLogger()
    result = PhaseResult(
        phase="preflight",
        success=False,
        output_files=["/tmp/report.json"],
        errors=["scope_contract.json not found"],
        retries=0,
    )

    orchestrator.log_phase_failure(logger, "SCOPE PREFLIGHT", result)

    assert logger.entries
    entry = logger.entries[0]
    assert entry.content.startswith("SCOPE PREFLIGHT failed: ")
    assert "scope_contract.json not found" in entry.content
    assert "Errors:" in entry.detail
    assert "- scope_contract.json not found" in entry.detail

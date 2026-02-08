import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_ROOT))

from spec.phases.models import PhaseResult
from spec.pipeline.error_payloads import build_phase_error_payload


def test_build_phase_error_payload_includes_reason_and_details() -> None:
    result = PhaseResult(
        phase="preflight",
        success=False,
        output_files=["/tmp/output.json"],
        errors=["Missing allowed_paths", "Second error"],
        retries=2,
    )

    content, detail = build_phase_error_payload("SCOPE PREFLIGHT", result)

    assert "SCOPE PREFLIGHT failed: Missing allowed_paths" == content
    assert "Errors:" in detail
    assert "- Missing allowed_paths" in detail
    assert "- Second error" in detail
    assert "Output files:" in detail
    assert "- /tmp/output.json" in detail
    assert "Retries: 2" in detail

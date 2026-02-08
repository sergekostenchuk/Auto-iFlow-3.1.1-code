"""
Standardized error payloads for pipeline failures.
"""

from __future__ import annotations

from spec.phases.models import PhaseResult


def build_phase_error_payload(
    display_name: str, result: PhaseResult
) -> tuple[str, str]:
    errors = result.errors or []
    reason = errors[0] if errors else "Unknown error"
    content = f"{display_name} failed: {reason}"

    detail_lines = [f"Phase: {display_name}"]
    if errors:
        detail_lines.append("Errors:")
        detail_lines.extend(f"- {item}" for item in errors)
    if result.output_files:
        detail_lines.append("")
        detail_lines.append("Output files:")
        detail_lines.extend(f"- {item}" for item in result.output_files)
    if result.retries:
        detail_lines.append("")
        detail_lines.append(f"Retries: {result.retries}")

    detail = "\n".join(detail_lines).strip()
    return content, detail

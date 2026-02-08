"""
QA Acceptance Criteria Handling
================================

Manages acceptance criteria validation and status tracking.
"""

import importlib
import json
from datetime import datetime, timezone
from pathlib import Path

from spec.post_code_tests import post_code_tests_passed
from spec.pipeline.preflight_scoper import load_task_intake

# =============================================================================
# IMPLEMENTATION PLAN I/O
# =============================================================================


def load_implementation_plan(spec_dir: Path) -> dict | None:
    """Load the implementation plan JSON."""
    plan_file = spec_dir / "implementation_plan.json"
    if not plan_file.exists():
        return None
    try:
        with open(plan_file) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def save_implementation_plan(spec_dir: Path, plan: dict) -> bool:
    """Save the implementation plan JSON."""
    plan_file = spec_dir / "implementation_plan.json"
    try:
        with open(plan_file, "w") as f:
            json.dump(plan, f, indent=2)
        return True
    except OSError:
        return False


# =============================================================================
# QA SIGN-OFF STATUS
# =============================================================================


def get_qa_signoff_status(spec_dir: Path) -> dict | None:
    """Get the current QA sign-off status from implementation plan."""
    plan = load_implementation_plan(spec_dir)
    if not plan:
        return None
    return plan.get("qa_signoff")


def sync_plan_status_after_qa(spec_dir: Path) -> bool:
    """
    Ensure plan status reflects QA approval so tasks don't remain in_progress.

    This is a safeguard when the QA agent updates qa_signoff but doesn't
    update status/planStatus fields.
    """
    plan = load_implementation_plan(spec_dir)
    if not plan:
        return False

    qa_status = plan.get("qa_signoff") or {}
    if qa_status.get("status") != "approved":
        return False

    progress = importlib.import_module("progress")
    if not progress.is_build_complete(spec_dir):
        return False

    if not post_code_tests_passed(spec_dir):
        # Keep task out of Human Review until post-code tests pass
        plan["status"] = "ai_review"
        plan["planStatus"] = "review"
        plan["updated_at"] = datetime.now(timezone.utc).isoformat()
        save_implementation_plan(spec_dir, plan)
        return False

    if plan.get("status") == "human_review" and plan.get("planStatus") == "review":
        return False

    if plan.get("status") == "done":
        return False

    plan["status"] = "human_review"
    plan["planStatus"] = "review"
    plan["updated_at"] = datetime.now(timezone.utc).isoformat()
    return save_implementation_plan(spec_dir, plan)


def is_qa_approved(spec_dir: Path) -> bool:
    """Check if QA has approved the build."""
    status = get_qa_signoff_status(spec_dir)
    if not status:
        return False
    return status.get("status") == "approved"


def is_qa_rejected(spec_dir: Path) -> bool:
    """Check if QA has rejected the build (needs fixes)."""
    status = get_qa_signoff_status(spec_dir)
    if not status:
        return False
    return status.get("status") == "rejected"


def is_fixes_applied(spec_dir: Path) -> bool:
    """Check if fixes have been applied and ready for re-validation."""
    status = get_qa_signoff_status(spec_dir)
    if not status:
        return False
    return status.get("status") == "fixes_applied" and status.get(
        "ready_for_qa_revalidation", False
    )


def get_qa_iteration_count(spec_dir: Path) -> int:
    """Get the number of QA iterations so far."""
    status = get_qa_signoff_status(spec_dir)
    if not status:
        return 0
    return status.get("qa_session", 0)


# =============================================================================
# QA READINESS CHECKS
# =============================================================================


def should_run_qa(spec_dir: Path) -> bool:
    """
    Determine if QA validation should run.

    QA should run when:
    - All subtasks are completed
    - QA has not yet approved
    """
    intake = load_task_intake(spec_dir) or {}
    if intake.get("task_type") and intake.get("task_type") != "code":
        return False

    progress = importlib.import_module("progress")
    if not progress.is_build_complete(spec_dir):
        return False

    if is_qa_approved(spec_dir):
        return False

    return True


def should_run_fixes(spec_dir: Path) -> bool:
    """
    Determine if QA fixes should run.

    Fixes should run when:
    - QA has rejected the build
    - Max iterations not reached
    """
    from .loop import MAX_QA_ITERATIONS

    if not is_qa_rejected(spec_dir):
        return False

    iterations = get_qa_iteration_count(spec_dir)
    if iterations >= MAX_QA_ITERATIONS:
        return False

    return True


# =============================================================================
# STATUS DISPLAY
# =============================================================================


def print_qa_status(spec_dir: Path) -> None:
    """Print the current QA status."""
    from .report import get_iteration_history, get_recurring_issue_summary

    status = get_qa_signoff_status(spec_dir)

    if not status:
        print("QA Status: Not started")
        return

    qa_status = status.get("status", "unknown")
    qa_session = status.get("qa_session", 0)
    timestamp = status.get("timestamp", "unknown")

    print(f"QA Status: {qa_status.upper()}")
    print(f"QA Sessions: {qa_session}")
    print(f"Last Updated: {timestamp}")

    if qa_status == "approved":
        tests = status.get("tests_passed", {})
        print(
            f"Tests: Unit {tests.get('unit', '?')}, Integration {tests.get('integration', '?')}, E2E {tests.get('e2e', '?')}"
        )
    elif qa_status == "rejected":
        issues = status.get("issues_found", [])
        print(f"Issues Found: {len(issues)}")
        for issue in issues[:3]:  # Show first 3
            print(
                f"  - {issue.get('title', 'Unknown')}: {issue.get('type', 'unknown')}"
            )
        if len(issues) > 3:
            print(f"  ... and {len(issues) - 3} more")

    # Show iteration history summary
    history = get_iteration_history(spec_dir)
    if history:
        summary = get_recurring_issue_summary(history)
        print("\nIteration History:")
        print(f"  Total iterations: {len(history)}")
        print(f"  Approved: {summary.get('iterations_approved', 0)}")
        print(f"  Rejected: {summary.get('iterations_rejected', 0)}")
        if summary.get("most_common"):
            print("  Most common issues:")
            for issue in summary["most_common"][:3]:
                print(f"    - {issue['title']} ({issue['occurrences']} occurrences)")

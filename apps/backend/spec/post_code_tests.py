"""
Post-Code Test Runner
=====================

Runs the scope_contract.json test plan after coding completes and
records results for QA gating and UI visibility.
"""

from __future__ import annotations

import asyncio
import json
import os
import shlex
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


REPORT_FILENAME = "post_code_tests.json"
DEFAULT_TIMEOUT_SEC = 1200.0
DEFAULT_OUTPUT_LIMIT = 8000
DEFAULT_SMART_CAP = 2


@dataclass
class CommandResult:
    command: str
    returncode: int | None
    status: str
    duration_sec: float
    stdout: str
    stderr: str
    timed_out: bool = False


@dataclass(frozen=True)
class TestSpec:
    cmd: str
    timeout: float
    parallel: bool = False


TEST_COMMANDS: dict[str, TestSpec] = {
    "PYTEST_SECURITY": TestSpec(
        "python3 -m pytest tests/test_security_hooks.py -v", 180.0, False
    ),
    "PYTEST_PIPELINE": TestSpec(
        "python3 -m pytest tests/integration/test_pipeline.py -v", 300.0, True
    ),
    "PYTEST_PROOF_GATE": TestSpec(
        "python3 -m pytest tests/test_proof_gate.py -v", 180.0, False
    ),
    "PYTEST_ROUTING": TestSpec(
        "python3 -m pytest tests/test_routing.py -v", 180.0, False
    ),
    "PYTEST_PROMPTS": TestSpec(
        "python3 -m pytest tests/test_prompts_syntax.py -v", 60.0, False
    ),
    "PYTEST_COLLECT": TestSpec("python3 -m pytest --collect-only", 60.0, False),
    "NPM_TEST": TestSpec("cd apps/frontend && npm test", 180.0, True),
}

_PRIORITY_COMMANDS = [
    TEST_COMMANDS["PYTEST_SECURITY"].cmd,
    TEST_COMMANDS["PYTEST_PIPELINE"].cmd,
    TEST_COMMANDS["PYTEST_PROOF_GATE"].cmd,
    TEST_COMMANDS["NPM_TEST"].cmd,
    TEST_COMMANDS["PYTEST_COLLECT"].cmd,
]
_PRIORITY_RANK = {cmd: index for index, cmd in enumerate(_PRIORITY_COMMANDS)}


def _load_json(path: Path) -> dict | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError:
        return None


def _load_scope_contract(spec_dir: Path) -> dict | None:
    return _load_json(spec_dir / "scope_contract.json")


def _load_task_intake(spec_dir: Path) -> dict | None:
    return _load_json(spec_dir / "task_intake.json")


def _coerce_test_spec(entry: object) -> TestSpec | None:
    if isinstance(entry, dict):
        cmd = entry.get("cmd")
        if not isinstance(cmd, str) or not cmd.strip():
            return None
        timeout = entry.get("timeout", DEFAULT_TIMEOUT_SEC)
        parallel = bool(entry.get("parallel", False))
        return TestSpec(cmd=cmd.strip(), timeout=float(timeout), parallel=parallel)
    if isinstance(entry, str):
        alias = entry.strip()
        if not alias:
            return None
        if alias in TEST_COMMANDS:
            return TEST_COMMANDS[alias]
        return TestSpec(cmd=alias, timeout=DEFAULT_TIMEOUT_SEC, parallel=False)
    return None


def _dedupe_specs(specs: list[TestSpec]) -> list[TestSpec]:
    seen: set[str] = set()
    result: list[TestSpec] = []
    for spec in specs:
        if spec.cmd in seen:
            continue
        seen.add(spec.cmd)
        result.append(spec)
    return result


def _collect_direct_match_cmds(files_to_modify: list[str]) -> set[str]:
    direct: set[str] = set()
    for file_path in files_to_modify:
        normalized = file_path.lower()
        if "security/" in normalized:
            direct.add(TEST_COMMANDS["PYTEST_SECURITY"].cmd)
        if "qa/" in normalized:
            direct.add(TEST_COMMANDS["PYTEST_PROOF_GATE"].cmd)
        if "spec/pipeline" in normalized or "pipeline/" in normalized:
            direct.add(TEST_COMMANDS["PYTEST_PIPELINE"].cmd)
    return direct


def _apply_priority_filter(specs: list[TestSpec], max_count: int) -> list[TestSpec]:
    indexed = list(enumerate(specs))
    indexed.sort(
        key=lambda item: (_PRIORITY_RANK.get(item[1].cmd, len(_PRIORITY_RANK)), item[0])
    )
    return [spec for _, spec in indexed[:max_count]]


def _apply_smart_cap(
    specs: list[TestSpec], files_to_modify: list[str], max_count: int
) -> list[TestSpec]:
    if max_count <= 0 or len(specs) <= max_count:
        return specs
    if not files_to_modify:
        return _apply_priority_filter(specs, max_count)

    direct_cmds = _collect_direct_match_cmds(files_to_modify)
    direct = [spec for spec in specs if spec.cmd in direct_cmds]
    indirect = [spec for spec in specs if spec.cmd not in direct_cmds]

    remaining = max(0, max_count - len(direct))
    if remaining and indirect:
        indirect = _apply_priority_filter(indirect, remaining)
    else:
        indirect = []

    return _dedupe_specs(direct + indirect)


def get_test_plan_specs(spec_dir: Path) -> list[TestSpec]:
    intake = _load_task_intake(spec_dir) or {}
    intake_plan = intake.get("tests_to_run")
    files_to_modify = intake.get("files_to_modify")
    if not isinstance(files_to_modify, list):
        files_to_modify = []
    specs: list[TestSpec] = []

    if isinstance(intake_plan, list) and intake_plan:
        for entry in intake_plan:
            spec = _coerce_test_spec(entry)
            if spec:
                specs.append(spec)
        specs = _dedupe_specs(specs)
        cap = int(os.environ.get("IFLOW_POST_CODE_TEST_CAP", DEFAULT_SMART_CAP))
        if cap > 0:
            specs = _apply_smart_cap(specs, files_to_modify, cap)
        return specs

    payload = _load_scope_contract(spec_dir) or {}
    raw_plan = payload.get("test_plan", [])
    if not isinstance(raw_plan, list):
        return []
    for entry in raw_plan:
        spec = _coerce_test_spec(entry)
        if spec:
            specs.append(spec)
    specs = _dedupe_specs(specs)
    cap = int(os.environ.get("IFLOW_POST_CODE_TEST_CAP", DEFAULT_SMART_CAP))
    if cap > 0:
        specs = _apply_smart_cap(specs, files_to_modify, cap)
    return specs


def get_test_plan(spec_dir: Path) -> list[str]:
    return [spec.cmd for spec in get_test_plan_specs(spec_dir)]


def _get_latest_commit(project_dir: Path) -> str | None:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=project_dir,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode != 0:
        return None
    return result.stdout.strip() or None


def _truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + "\n...[truncated]"


def _should_use_shell(command: str) -> bool:
    return any(token in command for token in ["&&", "||", "|", ">", "<", ";"])


async def _run_command(
    command: str,
    cwd: Path,
    timeout_sec: float,
) -> CommandResult:
    start = time.monotonic()
    timed_out = False
    returncode: int | None = None
    stdout_text = ""
    stderr_text = ""

    if _should_use_shell(command):
        process = await asyncio.create_subprocess_shell(
            command,
            cwd=str(cwd),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    else:
        args = shlex.split(command)
        if not args:
            return CommandResult(
                command=command,
                returncode=1,
                status="failed",
                duration_sec=0.0,
                stdout="",
                stderr="Empty command",
            )
        process = await asyncio.create_subprocess_exec(
            *args,
            cwd=str(cwd),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

    try:
        stdout, stderr = await asyncio.wait_for(
            process.communicate(), timeout=timeout_sec
        )
        returncode = process.returncode
    except asyncio.TimeoutError:
        timed_out = True
        process.kill()
        stdout, stderr = await process.communicate()
        returncode = process.returncode

    stdout_text = (stdout or b"").decode(errors="replace")
    stderr_text = (stderr or b"").decode(errors="replace")
    duration_sec = time.monotonic() - start

    status = "passed" if returncode == 0 and not timed_out else "failed"
    if timed_out:
        status = "timed_out"

    return CommandResult(
        command=command,
        returncode=returncode,
        status=status,
        duration_sec=duration_sec,
        stdout=stdout_text,
        stderr=stderr_text,
        timed_out=timed_out,
    )


def load_post_code_report(spec_dir: Path) -> dict | None:
    return _load_json(spec_dir / REPORT_FILENAME)


def get_post_code_test_status(spec_dir: Path) -> str | None:
    report = load_post_code_report(spec_dir)
    if report:
        return report.get("status")
    plan_file = spec_dir / "implementation_plan.json"
    plan = _load_json(plan_file) or {}
    status = (plan.get("post_code_tests") or {}).get("status")
    return status


def _get_task_type(spec_dir: Path) -> str:
    """Get task_type from task_intake.json or scope_contract.json."""
    intake = _load_task_intake(spec_dir) or {}
    task_type = intake.get("task_type")
    if isinstance(task_type, str) and task_type:
        return task_type
    scope = _load_scope_contract(spec_dir) or {}
    task_type = scope.get("task_type")
    if isinstance(task_type, str) and task_type:
        return task_type
    return "code"


def post_code_tests_passed(spec_dir: Path) -> bool:
    return get_post_code_test_status(spec_dir) == "passed"


def should_run_post_code_tests(spec_dir: Path, project_dir: Path) -> bool:
    task_type = _get_task_type(spec_dir)
    if task_type != "code":
        return False
    test_plan = get_test_plan(spec_dir)
    report = load_post_code_report(spec_dir)
    if not report:
        return True

    if not test_plan:
        latest_commit = _get_latest_commit(project_dir)
        report_commit = report.get("commit")
        if latest_commit and report_commit and latest_commit == report_commit:
            return False
        return True

    latest_commit = _get_latest_commit(project_dir)
    report_commit = report.get("commit")

    if latest_commit and report_commit and latest_commit == report_commit:
        return False

    return True


def _summarize_results(results: list[CommandResult]) -> dict:
    total = len(results)
    passed = sum(1 for result in results if result.status == "passed")
    failed = total - passed
    return {"total": total, "passed": passed, "failed": failed}


def _write_report(spec_dir: Path, payload: dict) -> None:
    report_file = spec_dir / REPORT_FILENAME
    report_file.write_text(json.dumps(payload, indent=2))


def _update_plan(spec_dir: Path, report: dict, summary: dict) -> None:
    plan_file = spec_dir / "implementation_plan.json"
    if not plan_file.exists():
        return
    try:
        plan = json.loads(plan_file.read_text())
    except json.JSONDecodeError:
        return

    plan["post_code_tests"] = {
        "status": report.get("status"),
        "summary": summary,
        "commit": report.get("commit"),
        "report_file": REPORT_FILENAME,
        "updated_at": report.get("completed_at"),
    }
    plan["updated_at"] = datetime.now(timezone.utc).isoformat()
    plan_file.write_text(json.dumps(plan, indent=2))


async def run_post_code_tests(
    spec_dir: Path,
    project_dir: Path,
    task_logger=None,
) -> dict:
    from task_logger import LogEntryType, LogPhase

    test_plan_specs = get_test_plan_specs(spec_dir)
    started_at = datetime.now(timezone.utc).isoformat()
    timeout = float(os.environ.get("IFLOW_POST_CODE_TEST_TIMEOUT_SEC", DEFAULT_TIMEOUT_SEC))
    output_limit = int(os.environ.get("IFLOW_POST_CODE_TEST_OUTPUT_LIMIT", DEFAULT_OUTPUT_LIMIT))

    if not test_plan_specs:
        task_type = _get_task_type(spec_dir)
        if task_type != "code":
            report = {
                "status": "skipped",
                "reason": f"Non-code task (task_type={task_type})",
                "started_at": started_at,
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "commit": _get_latest_commit(project_dir),
                "test_plan": [],
                "results": [],
                "summary": {"total": 0, "passed": 0, "failed": 0},
            }
            _write_report(spec_dir, report)
            _update_plan(spec_dir, report, report["summary"])
            if task_logger:
                task_logger.log(
                    f"Post-code tests skipped: non-code task ({task_type})",
                    LogEntryType.INFO,
                    LogPhase.VALIDATION,
                )
            return report
        report = {
            "status": "failed",
            "started_at": started_at,
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "commit": _get_latest_commit(project_dir),
            "test_plan": [],
            "results": [],
            "summary": {"total": 0, "passed": 0, "failed": 0},
            "reason": "No test_plan entries in scope_contract.json",
        }
        _write_report(spec_dir, report)
        _update_plan(spec_dir, report, report["summary"])
        if task_logger:
            task_logger.log(
                "Post-code tests failed: missing test_plan entries",
                LogEntryType.ERROR,
                LogPhase.VALIDATION,
            )
        return report

    if task_logger:
        task_logger.log(
            "Running post-code test plan...",
            LogEntryType.INFO,
            LogPhase.VALIDATION,
        )

    results: list[CommandResult] = []
    for spec in test_plan_specs:
        command = spec.cmd
        if task_logger:
            task_logger.log(
                f"Running: {command}",
                LogEntryType.INFO,
                LogPhase.VALIDATION,
            )
        result = await _run_command(command, project_dir, spec.timeout or timeout)
        results.append(result)

        stdout_excerpt = _truncate(result.stdout, output_limit)
        stderr_excerpt = _truncate(result.stderr, output_limit)
        detail = (
            f"$ {command}\n\n"
            f"Exit code: {result.returncode}\n"
            f"Duration: {result.duration_sec:.1f}s\n\n"
            f"STDOUT:\n{stdout_excerpt}\n\n"
            f"STDERR:\n{stderr_excerpt}\n"
        )

        if task_logger:
            entry_type = (
                LogEntryType.SUCCESS if result.status == "passed" else LogEntryType.ERROR
            )
            task_logger.log_with_detail(
                f"{command} → {result.status.upper()}",
                detail=detail,
                entry_type=entry_type,
                phase=LogPhase.VALIDATION,
                subphase="POST-CODE TESTS",
                collapsed=True,
            )

    summary = _summarize_results(results)
    status = "passed" if summary["failed"] == 0 else "failed"

    report = {
        "status": status,
        "started_at": started_at,
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "commit": _get_latest_commit(project_dir),
        "test_plan": [spec.cmd for spec in test_plan_specs],
        "results": [
            {
                "command": result.command,
                "status": result.status,
                "returncode": result.returncode,
                "duration_sec": result.duration_sec,
                "timed_out": result.timed_out,
                "stdout": _truncate(result.stdout, output_limit),
                "stderr": _truncate(result.stderr, output_limit),
            }
            for result in results
        ],
        "summary": summary,
    }

    _write_report(spec_dir, report)
    _update_plan(spec_dir, report, summary)

    if task_logger:
        message = (
            "Post-code tests passed" if status == "passed" else "Post-code tests failed"
        )
        entry_type = LogEntryType.SUCCESS if status == "passed" else LogEntryType.ERROR
        task_logger.log(message, entry_type, LogPhase.VALIDATION)

    return report


async def run_post_code_tests_if_needed(
    spec_dir: Path,
    project_dir: Path,
    task_logger=None,
) -> dict | None:
    if not should_run_post_code_tests(spec_dir, project_dir):
        return None
    return await run_post_code_tests(spec_dir, project_dir, task_logger=task_logger)

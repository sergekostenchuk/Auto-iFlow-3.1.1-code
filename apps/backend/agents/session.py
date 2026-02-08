"""
Agent Session Management
========================

Handles running agent sessions and post-session processing including
memory updates, recovery tracking, and Linear integration.
"""

import asyncio
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from debug import debug, debug_detailed, debug_error, debug_section, debug_success
from insight_extractor import extract_session_insights
from linear_updater import (
    linear_subtask_completed,
    linear_subtask_failed,
)
from progress import (
    count_subtasks_detailed,
    is_build_complete,
)
from recovery import RecoveryManager
from security.tool_input_validator import get_safe_tool_input
from task_logger import (
    LogEntryType,
    LogPhase,
    get_task_logger,
)
from qa.proof_writer import append_acceptance_proofs
from spec.post_code_tests import run_post_code_tests_if_needed
from ui import (
    StatusManager,
    muted,
    print_key_value,
    print_status,
)
from core.iflow_client import iter_agent_messages, send_agent_message

from .memory_manager import save_session_memory
from .utils import (
    find_subtask_in_plan,
    get_commit_count,
    get_latest_commit,
    load_implementation_plan,
    sync_spec_to_source,
)

logger = logging.getLogger(__name__)


def _append_build_progress(spec_dir: Path, message: str) -> None:
    progress_path = spec_dir / "build-progress.txt"
    timestamp = datetime.now(timezone.utc).isoformat()
    header = (
        "# Build Progress\n"
        "# Timestamp (UTC) | Message\n"
    )
    try:
        if not progress_path.exists():
            progress_path.write_text(header)
        with progress_path.open("a", encoding="utf-8") as handle:
            handle.write(f"{timestamp} | {message}\n")
    except Exception as exc:
        logger.debug(f"Failed to append build-progress.txt: {exc}")


def _get_timeout_seconds(env_key: str, default_seconds: float) -> float | None:
    raw = os.environ.get(env_key)
    if raw is None:
        return default_seconds
    try:
        value = float(raw)
    except ValueError:
        return default_seconds
    if value <= 0:
        return None
    return value


async def _await_with_timeout(coro: Any, timeout_seconds: float | None) -> Any:
    if timeout_seconds is None:
        return await coro
    return await asyncio.wait_for(coro, timeout=timeout_seconds)


STREAM_IDLE_TIMEOUT_SEC = _get_timeout_seconds("IFLOW_STREAM_IDLE_TIMEOUT_SEC", 300.0)
INSIGHTS_TIMEOUT_SEC = _get_timeout_seconds("POST_SESSION_INSIGHTS_TIMEOUT_SEC", 60.0)
MEMORY_TIMEOUT_SEC = _get_timeout_seconds("POST_SESSION_MEMORY_TIMEOUT_SEC", 60.0)


def _is_scope_guard_violation(message: str) -> bool:
    lowered = message.lower()
    keywords = [
        "file access",
        "not in allowed",
        "not allowed",
        "outside allowed",
        "permission denied",
        "access denied",
        "allowed dirs",
        "allowed directories",
    ]
    return any(keyword in lowered for keyword in keywords)


async def post_session_processing(
    spec_dir: Path,
    project_dir: Path,
    subtask_id: str,
    session_num: int,
    commit_before: str | None,
    commit_count_before: int,
    recovery_manager: RecoveryManager,
    linear_enabled: bool = False,
    status_manager: StatusManager | None = None,
    source_spec_dir: Path | None = None,
) -> bool:
    """
    Process session results and update memory automatically.

    This runs in Python (100% reliable) instead of relying on agent compliance.

    Args:
        spec_dir: Spec directory containing memory/
        project_dir: Project root for git operations
        subtask_id: The subtask that was being worked on
        session_num: Current session number
        commit_before: Git commit hash before session
        commit_count_before: Number of commits before session
        recovery_manager: Recovery manager instance
        linear_enabled: Whether Linear integration is enabled
        status_manager: Optional status manager for ccstatusline
        source_spec_dir: Original spec directory (for syncing back from worktree)

    Returns:
        True if subtask was completed successfully
    """
    print()
    print(muted("--- Post-Session Processing ---"))
    task_logger = get_task_logger(spec_dir)

    # Sync implementation plan back to source (for worktree mode)
    if sync_spec_to_source(spec_dir, source_spec_dir):
        print_status("Implementation plan synced to main project", "success")

    # Check if implementation plan was updated
    plan = load_implementation_plan(spec_dir)
    if not plan:
        print("  Warning: Could not load implementation plan")
        return False

    subtask = find_subtask_in_plan(plan, subtask_id)
    if not subtask:
        print(f"  Warning: Subtask {subtask_id} not found in plan")
        return False

    subtask_status = subtask.get("status", "pending")

    # Check for new commits
    commit_after = get_latest_commit(project_dir)
    commit_count_after = get_commit_count(project_dir)
    new_commits = commit_count_after - commit_count_before

    print_key_value("Subtask status", subtask_status)
    print_key_value("New commits", str(new_commits))
    status_message = (
        f"subtask {subtask_id} status={subtask_status} new_commits={new_commits}"
    )
    if commit_after:
        status_message += f" latest_commit={commit_after[:8]}"

    if subtask_status == "completed":
        # Success! Record the attempt and good commit
        print_status(f"Subtask {subtask_id} completed successfully", "success")
        _append_build_progress(spec_dir, f"{status_message} outcome=completed")

        try:
            appended = append_acceptance_proofs(spec_dir, project_dir)
            if appended and task_logger:
                task_logger.log(
                    f"Appended {appended} proof entries",
                    LogEntryType.INFO,
                    LogPhase.CODING,
                )
        except Exception as exc:
            if task_logger:
                task_logger.log_error(
                    f"Proof write failed: {exc}", LogPhase.CODING
                )

        # Update status file
        if status_manager:
            subtasks = count_subtasks_detailed(spec_dir)
            status_manager.update_subtasks(
                completed=subtasks["completed"],
                total=subtasks["total"],
                in_progress=0,
            )

        # Record successful attempt
        recovery_manager.record_attempt(
            subtask_id=subtask_id,
            session=session_num,
            success=True,
            approach=f"Implemented: {subtask.get('description', 'subtask')[:100]}",
        )

        # Record good commit for rollback safety
        if commit_after and commit_after != commit_before:
            recovery_manager.record_good_commit(commit_after, subtask_id)
            print_status(f"Recorded good commit: {commit_after[:8]}", "success")

        # Record Linear session result (if enabled)
        if linear_enabled:
            # Get progress counts for the comment
            subtasks_detail = count_subtasks_detailed(spec_dir)
            await linear_subtask_completed(
                spec_dir=spec_dir,
                subtask_id=subtask_id,
                completed_count=subtasks_detail["completed"],
                total_count=subtasks_detail["total"],
            )
            print_status("Linear progress recorded", "success")

        # Extract rich insights from session (LLM-powered analysis)
        try:
            extracted_insights = await _await_with_timeout(
                extract_session_insights(
                    spec_dir=spec_dir,
                    project_dir=project_dir,
                    subtask_id=subtask_id,
                    session_num=session_num,
                    commit_before=commit_before,
                    commit_after=commit_after,
                    success=True,
                    recovery_manager=recovery_manager,
                ),
                INSIGHTS_TIMEOUT_SEC,
            )
            if extracted_insights:
                insight_count = len(extracted_insights.get("file_insights", []))
                pattern_count = len(extracted_insights.get("patterns_discovered", []))
                if insight_count > 0 or pattern_count > 0:
                    print_status(
                        f"Extracted {insight_count} file insights, {pattern_count} patterns",
                        "success",
                    )
        except asyncio.TimeoutError:
            message = (
                f"Insight extraction timed out after {INSIGHTS_TIMEOUT_SEC:.0f}s"
            )
            logger.warning(message)
            if task_logger:
                task_logger.log_error(message, LogPhase.CODING)
            extracted_insights = None
        except Exception as e:
            logger.warning(f"Insight extraction failed: {e}")
            extracted_insights = None

        # Save session memory (Graphiti=primary, file-based=fallback)
        try:
            save_success, storage_type = await _await_with_timeout(
                save_session_memory(
                    spec_dir=spec_dir,
                    project_dir=project_dir,
                    subtask_id=subtask_id,
                    session_num=session_num,
                    success=True,
                    subtasks_completed=[subtask_id],
                    discoveries=extracted_insights,
                ),
                MEMORY_TIMEOUT_SEC,
            )
            if save_success:
                if storage_type == "graphiti":
                    print_status("Session saved to Graphiti memory", "success")
                else:
                    print_status(
                        "Session saved to file-based memory (fallback)", "info"
                    )
            else:
                print_status("Failed to save session memory", "warning")
        except asyncio.TimeoutError:
            message = f"Session memory save timed out after {MEMORY_TIMEOUT_SEC:.0f}s"
            logger.warning(message)
            if task_logger:
                task_logger.log_error(message, LogPhase.CODING)
            print_status("Memory save timed out", "warning")
        except Exception as e:
            logger.warning(f"Error saving session memory: {e}")
            print_status("Memory save failed", "warning")

        if is_build_complete(spec_dir):
            # Skip post-code tests for non-code tasks
            task_type = plan.get("task_type", "code")
            if task_type == "code":
                test_report = await run_post_code_tests_if_needed(
                    spec_dir=spec_dir,
                    project_dir=project_dir,
                    task_logger=task_logger,
                )
                if test_report and test_report.get("status") == "failed":
                    print_status(
                        "Post-code tests failed; blocking Human Review", "error"
                    )
                    if task_logger:
                        task_logger.log_error(
                            "Post-code tests failed; Human Review blocked",
                            LogPhase.VALIDATION,
                        )
                    for result in test_report.get("results", []) or []:
                        status = result.get("status")
                        if status == "passed":
                            continue
                        command = result.get("command", "unknown")
                        returncode = result.get("returncode")
                        stderr = (result.get("stderr") or "").strip()
                        stderr_excerpt = stderr.splitlines()[0] if stderr else ""
                        _append_build_progress(
                            spec_dir,
                            (
                                "post_code_tests_failed "
                                f"cmd={command} status={status} exit={returncode} "
                                f"stderr={stderr_excerpt}"
                            ),
                        )
            else:
                if task_logger:
                    task_logger.log(
                        f"Post-code tests skipped: non-code task (task_type={task_type})",
                        LogEntryType.INFO,
                        LogPhase.VALIDATION,
                    )

        return True

    elif subtask_status == "in_progress":
        # Session ended without completion
        print_status(f"Subtask {subtask_id} still in progress", "warning")
        _append_build_progress(spec_dir, f"{status_message} outcome=in_progress")

        recovery_manager.record_attempt(
            subtask_id=subtask_id,
            session=session_num,
            success=False,
            approach="Session ended with subtask in_progress",
            error="Subtask not marked as completed",
        )

        # Still record commit if one was made (partial progress)
        if commit_after and commit_after != commit_before:
            recovery_manager.record_good_commit(commit_after, subtask_id)
            print_status(
                f"Recorded partial progress commit: {commit_after[:8]}", "info"
            )

        # Record Linear session result (if enabled)
        if linear_enabled:
            attempt_count = recovery_manager.get_attempt_count(subtask_id)
            await linear_subtask_failed(
                spec_dir=spec_dir,
                subtask_id=subtask_id,
                attempt=attempt_count,
                error_summary="Session ended without completion",
            )

        # Extract insights even from failed sessions (valuable for future attempts)
        try:
            extracted_insights = await _await_with_timeout(
                extract_session_insights(
                    spec_dir=spec_dir,
                    project_dir=project_dir,
                    subtask_id=subtask_id,
                    session_num=session_num,
                    commit_before=commit_before,
                    commit_after=commit_after,
                    success=False,
                    recovery_manager=recovery_manager,
                ),
                INSIGHTS_TIMEOUT_SEC,
            )
        except asyncio.TimeoutError:
            message = (
                f"Insight extraction timed out after {INSIGHTS_TIMEOUT_SEC:.0f}s"
            )
            logger.warning(message)
            if task_logger:
                task_logger.log_error(message, LogPhase.CODING)
            extracted_insights = None
        except Exception as e:
            logger.debug(f"Insight extraction failed for incomplete session: {e}")
            extracted_insights = None

        # Save failed session memory (to track what didn't work)
        try:
            await _await_with_timeout(
                save_session_memory(
                    spec_dir=spec_dir,
                    project_dir=project_dir,
                    subtask_id=subtask_id,
                    session_num=session_num,
                    success=False,
                    subtasks_completed=[],
                    discoveries=extracted_insights,
                ),
                MEMORY_TIMEOUT_SEC,
            )
        except asyncio.TimeoutError:
            message = f"Session memory save timed out after {MEMORY_TIMEOUT_SEC:.0f}s"
            logger.warning(message)
            if task_logger:
                task_logger.log_error(message, LogPhase.CODING)
        except Exception as e:
            logger.debug(f"Failed to save incomplete session memory: {e}")

        return False

    else:
        # Subtask still pending or failed
        print_status(
            f"Subtask {subtask_id} not completed (status: {subtask_status})", "error"
        )
        _append_build_progress(spec_dir, f"{status_message} outcome={subtask_status}")

        recovery_manager.record_attempt(
            subtask_id=subtask_id,
            session=session_num,
            success=False,
            approach="Session ended without progress",
            error=f"Subtask status is {subtask_status}",
        )

        # Record Linear session result (if enabled)
        if linear_enabled:
            attempt_count = recovery_manager.get_attempt_count(subtask_id)
            await linear_subtask_failed(
                spec_dir=spec_dir,
                subtask_id=subtask_id,
                attempt=attempt_count,
                error_summary=f"Subtask status: {subtask_status}",
            )

        # Extract insights even from completely failed sessions
        try:
            extracted_insights = await _await_with_timeout(
                extract_session_insights(
                    spec_dir=spec_dir,
                    project_dir=project_dir,
                    subtask_id=subtask_id,
                    session_num=session_num,
                    commit_before=commit_before,
                    commit_after=commit_after,
                    success=False,
                    recovery_manager=recovery_manager,
                ),
                INSIGHTS_TIMEOUT_SEC,
            )
        except asyncio.TimeoutError:
            message = (
                f"Insight extraction timed out after {INSIGHTS_TIMEOUT_SEC:.0f}s"
            )
            logger.warning(message)
            if task_logger:
                task_logger.log_error(message, LogPhase.CODING)
            extracted_insights = None
        except Exception as e:
            logger.debug(f"Insight extraction failed for failed session: {e}")
            extracted_insights = None

        # Save failed session memory (to track what didn't work)
        try:
            await _await_with_timeout(
                save_session_memory(
                    spec_dir=spec_dir,
                    project_dir=project_dir,
                    subtask_id=subtask_id,
                    session_num=session_num,
                    success=False,
                    subtasks_completed=[],
                    discoveries=extracted_insights,
                ),
                MEMORY_TIMEOUT_SEC,
            )
        except asyncio.TimeoutError:
            message = f"Session memory save timed out after {MEMORY_TIMEOUT_SEC:.0f}s"
            logger.warning(message)
            if task_logger:
                task_logger.log_error(message, LogPhase.CODING)
        except Exception as e:
            logger.debug(f"Failed to save failed session memory: {e}")

        return False


async def run_agent_session(
    client: Any,
    message: str,
    spec_dir: Path,
    verbose: bool = False,
    phase: LogPhase = LogPhase.CODING,
) -> tuple[str, str]:
    """
    Run a single agent session using the configured agent client.

    Args:
        client: Agent client
        message: The prompt to send
        spec_dir: Spec directory path
        verbose: Whether to show detailed output
        phase: Current execution phase for logging

    Returns:
        (status, response_text) where status is:
        - "continue" if agent should continue working
        - "complete" if all subtasks complete
        - "error" if an error occurred
    """
    debug_section("session", f"Agent Session - {phase.value}")
    debug(
        "session",
        "Starting agent session",
        spec_dir=str(spec_dir),
        phase=phase.value,
        prompt_length=len(message),
        prompt_preview=message[:200] + "..." if len(message) > 200 else message,
    )
    print("Sending prompt to agent...\n")

    # Get task logger for this spec
    task_logger = get_task_logger(spec_dir)
    current_tool = None
    message_count = 0
    tool_count = 0

    try:
        # Send the query
        debug("session", "Sending query to agent...")
        await send_agent_message(client, message)
        debug_success("session", "Query sent successfully")

        # Collect response text and show tool use
        response_text = ""
        debug("session", "Starting to receive response stream...")
        stream_iter = iter_agent_messages(client).__aiter__()
        while True:
            try:
                if STREAM_IDLE_TIMEOUT_SEC is None:
                    msg = await stream_iter.__anext__()
                else:
                    msg = await asyncio.wait_for(
                        stream_iter.__anext__(), timeout=STREAM_IDLE_TIMEOUT_SEC
                    )
            except StopAsyncIteration:
                break
            except asyncio.TimeoutError:
                timeout_display = int(STREAM_IDLE_TIMEOUT_SEC)
                message = (
                    f"No agent output for {timeout_display}s; aborting session"
                )
                debug_error(
                    "session",
                    "Agent response timeout",
                    timeout_seconds=STREAM_IDLE_TIMEOUT_SEC,
                )
                if task_logger:
                    task_logger.log_error(message, phase)
                return "error", message

            msg_type = type(msg).__name__
            message_count += 1
            debug_detailed(
                "session",
                f"Received message #{message_count}",
                msg_type=msg_type,
            )

            # Handle AssistantMessage (text and tool use)
            if msg_type == "AssistantMessage":
                # Claude SDK message format
                if hasattr(msg, "content") and isinstance(msg.content, list):
                    for block in msg.content:
                        block_type = type(block).__name__

                        if block_type == "TextBlock" and hasattr(block, "text"):
                            response_text += block.text
                            print(block.text, end="", flush=True)
                            # Log text to task logger (persist without double-printing)
                            if task_logger and block.text.strip():
                                task_logger.log(
                                    block.text,
                                    LogEntryType.TEXT,
                                    phase,
                                    print_to_console=False,
                                )
                        elif block_type == "ToolUseBlock" and hasattr(block, "name"):
                            tool_name = block.name
                            tool_input_display = None
                            tool_count += 1

                            # Safely extract tool input (handles None, non-dict, etc.)
                            inp = get_safe_tool_input(block)

                            # Extract meaningful tool input for display
                            if inp:
                                if "pattern" in inp:
                                    tool_input_display = f"pattern: {inp['pattern']}"
                                elif "file_path" in inp:
                                    fp = inp["file_path"]
                                    if len(fp) > 50:
                                        fp = "..." + fp[-47:]
                                    tool_input_display = fp
                                elif "command" in inp:
                                    cmd = inp["command"]
                                    if len(cmd) > 50:
                                        cmd = cmd[:47] + "..."
                                    tool_input_display = cmd
                                elif "path" in inp:
                                    tool_input_display = inp["path"]

                            debug(
                                "session",
                                f"Tool call #{tool_count}: {tool_name}",
                                tool_input=tool_input_display,
                                full_input=str(inp)[:500] if inp else None,
                            )

                            # Log tool start (handles printing too)
                            if task_logger:
                                task_logger.tool_start(
                                    tool_name,
                                    tool_input_display,
                                    phase,
                                    print_to_console=True,
                                )
                            else:
                                print(f"\n[Tool: {tool_name}]", flush=True)

                            if verbose and hasattr(block, "input"):
                                input_str = str(block.input)
                                if len(input_str) > 300:
                                    print(
                                        f"   Input: {input_str[:300]}...",
                                        flush=True,
                                    )
                                else:
                                    print(f"   Input: {input_str}", flush=True)
                            current_tool = tool_name
                else:
                    # iFlow SDK message format
                    text_chunk = None
                    if hasattr(msg, "chunk") and msg.chunk:
                        text_chunk = (
                            msg.chunk.text
                            if hasattr(msg.chunk, "text")
                            else str(msg.chunk)
                        )
                    elif hasattr(msg, "content") and msg.content:
                        text_chunk = (
                            msg.content
                            if isinstance(msg.content, str)
                            else str(msg.content)
                        )

                    if text_chunk:
                        response_text += text_chunk
                        print(text_chunk, end="", flush=True)
                        if task_logger and text_chunk.strip():
                            task_logger.log(
                                text_chunk,
                                LogEntryType.TEXT,
                                phase,
                                print_to_console=False,
                            )

            # Handle iFlow tool calls
            elif msg_type == "ToolCallMessage":
                tool_name = getattr(msg, "tool_name", None) or getattr(msg, "name", None)
                tool_count += 1
                tool_args = getattr(msg, "args", None)
                if tool_args is None:
                    tool_args = getattr(msg, "input", None)

                def format_tool_input(inp: Any) -> str | None:
                    if isinstance(inp, dict):
                        if "pattern" in inp:
                            return f"pattern: {inp['pattern']}"
                        if "file_path" in inp:
                            fp = inp["file_path"]
                            if len(fp) > 50:
                                fp = "..." + fp[-47:]
                            return fp
                        if "command" in inp:
                            cmd = inp["command"]
                            if len(cmd) > 50:
                                cmd = cmd[:47] + "..."
                            return cmd
                        if "path" in inp:
                            return inp["path"]
                    if inp is None:
                        return None
                    inp_str = str(inp)
                    if len(inp_str) > 50:
                        return inp_str[:47] + "..."
                    return inp_str

                tool_input_display = format_tool_input(tool_args)
                debug(
                    "session",
                    f"Tool call #{tool_count}: {tool_name}",
                    tool_input=tool_input_display,
                )

                if task_logger and tool_name:
                    task_logger.tool_start(
                        tool_name,
                        tool_input_display,
                        phase,
                        print_to_console=True,
                    )
                elif tool_name:
                    print(f"\n[Tool: {tool_name}]", flush=True)

                current_tool = tool_name

                tool_output = getattr(msg, "output", None)
                tool_status = getattr(msg, "status", None)
                is_error = getattr(msg, "is_error", False)

                if tool_output is not None or tool_status:
                    output_str = str(tool_output) if tool_output is not None else ""
                    failed = is_error or (tool_status in ("error", "failed", "blocked"))
                    if failed:
                        print(f"   [Error] {output_str[:500]}", flush=True)
                    else:
                        print("   [Done]", flush=True)
                    if task_logger and tool_name:
                        task_logger.tool_end(
                            tool_name,
                            success=not failed,
                            detail=output_str if output_str else None,
                            phase=phase,
                        )
                    current_tool = None

            # Handle UserMessage (tool results)
            elif msg_type == "UserMessage" and hasattr(msg, "content"):
                for block in msg.content:
                    block_type = type(block).__name__

                    if block_type == "ToolResultBlock":
                        result_content = getattr(block, "content", "")
                        is_error = getattr(block, "is_error", False)

                        # Check for scope enforcement blocks (file access restriction)
                        if is_error and _is_scope_guard_violation(str(result_content)):
                            debug_error(
                                "session",
                                f"Scope guard BLOCKED: {current_tool}",
                                result=str(result_content)[:300],
                            )
                            print(f"   [BLOCKED] {result_content}", flush=True)
                            if task_logger and current_tool:
                                task_logger.log_error(
                                    f"Scope enforcement blocked: {result_content}",
                                    phase,
                                )
                                task_logger.tool_end(
                                    current_tool,
                                    success=False,
                                    result="BLOCKED",
                                    detail=str(result_content),
                                    phase=phase,
                                )
                        # Check if this is an error (not just content containing "blocked")
                        elif is_error and "blocked" in str(result_content).lower():
                            # Actual blocked command by security hook
                            debug_error(
                                "session",
                                f"Tool BLOCKED: {current_tool}",
                                result=str(result_content)[:300],
                            )
                            print(f"   [BLOCKED] {result_content}", flush=True)
                            if task_logger and current_tool:
                                task_logger.tool_end(
                                    current_tool,
                                    success=False,
                                    result="BLOCKED",
                                    detail=str(result_content),
                                    phase=phase,
                                )
                        elif is_error:
                            # Show errors (truncated)
                            error_str = str(result_content)[:500]
                            debug_error(
                                "session",
                                f"Tool error: {current_tool}",
                                error=error_str[:200],
                            )
                            print(f"   [Error] {error_str}", flush=True)
                            if task_logger and current_tool:
                                # Store full error in detail for expandable view
                                task_logger.tool_end(
                                    current_tool,
                                    success=False,
                                    result=error_str[:100],
                                    detail=str(result_content),
                                    phase=phase,
                                )
                        else:
                            # Tool succeeded
                            debug_detailed(
                                "session",
                                f"Tool success: {current_tool}",
                                result_length=len(str(result_content)),
                            )
                            if verbose:
                                result_str = str(result_content)[:200]
                                print(f"   [Done] {result_str}", flush=True)
                            else:
                                print("   [Done]", flush=True)
                            if task_logger and current_tool:
                                # Store full result in detail for expandable view (only for certain tools)
                                # Skip storing for very large outputs like Glob results
                                detail_content = None
                                if current_tool in (
                                    "Read",
                                    "Grep",
                                    "Bash",
                                    "Edit",
                                    "Write",
                                ):
                                    result_str = str(result_content)
                                    # Only store if not too large (detail truncation happens in logger)
                                    if (
                                        len(result_str) < 50000
                                    ):  # 50KB max before truncation
                                        detail_content = result_str
                                task_logger.tool_end(
                                    current_tool,
                                    success=True,
                                    detail=detail_content,
                                    phase=phase,
                                )

                        current_tool = None

            elif msg_type == "TaskFinishMessage":
                debug_success("session", "Agent finished turn", stop_reason=getattr(msg, "stop_reason", None))
                break

        print("\n" + "-" * 70 + "\n")

        # Check if build is complete
        if is_build_complete(spec_dir):
            debug_success(
                "session",
                "Session completed - build is complete",
                message_count=message_count,
                tool_count=tool_count,
                response_length=len(response_text),
            )
            return "complete", response_text

        debug_success(
            "session",
            "Session completed - continuing",
            message_count=message_count,
            tool_count=tool_count,
            response_length=len(response_text),
        )
        return "continue", response_text

    except Exception as e:
        debug_error(
            "session",
            f"Session error: {e}",
            exception_type=type(e).__name__,
            message_count=message_count,
            tool_count=tool_count,
        )
        print(f"Error during agent session: {e}")
        if task_logger:
            task_logger.log_error(f"Session error: {e}", phase)
        return "error", str(e)

"""
Agent Runner
============

Handles the execution of AI agents for the spec creation pipeline.
"""

import asyncio
import os
from pathlib import Path

# Configure safe encoding before any output (fixes Windows encoding errors)
from ui.capabilities import configure_safe_encoding

configure_safe_encoding()

from core.iflow_client import create_iflow_client, iter_agent_messages, send_agent_message
from debug import debug, debug_detailed, debug_error, debug_section, debug_success
from security.tool_input_validator import get_safe_tool_input
from task_logger import (
    LogEntryType,
    LogPhase,
    TaskLogger,
)


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


STREAM_IDLE_TIMEOUT_SEC = _get_timeout_seconds("IFLOW_STREAM_IDLE_TIMEOUT_SEC", 300.0)


class AgentRunner:
    """Manages agent execution with logging and error handling."""

    def __init__(
        self,
        project_dir: Path,
        spec_dir: Path,
        model: str,
        task_logger: TaskLogger | None = None,
    ):
        """Initialize the agent runner.

        Args:
            project_dir: The project root directory
            spec_dir: The spec directory
            model: The model to use for agent execution
            task_logger: Optional task logger for tracking progress
        """
        self.project_dir = project_dir
        self.spec_dir = spec_dir
        self.model = model
        self.task_logger = task_logger

    async def run_agent(
        self,
        prompt_file: str,
        additional_context: str = "",
        interactive: bool = False,
        thinking_budget: int | None = None,
        prior_phase_summaries: str | None = None,
        model: str | None = None,
    ) -> tuple[bool, str]:
        """Run an agent with the given prompt.

        Args:
            prompt_file: The prompt file to use (relative to prompts directory)
            additional_context: Additional context to add to the prompt
            interactive: Whether to run in interactive mode
            thinking_budget: Token budget for extended thinking (None = disabled)
            prior_phase_summaries: Summaries from previous phases for context

        Returns:
            Tuple of (success, response_text)
        """
        debug_section("agent_runner", f"Spec Agent - {prompt_file}")
        model_to_use = model or self.model

        debug(
            "agent_runner",
            "Running spec creation agent",
            prompt_file=prompt_file,
            spec_dir=str(self.spec_dir),
            model=model_to_use,
            interactive=interactive,
        )

        prompt_path = Path(__file__).parent.parent.parent / "prompts" / prompt_file

        if not prompt_path.exists():
            debug_error("agent_runner", f"Prompt file not found: {prompt_path}")
            return False, f"Prompt not found: {prompt_path}"

        # Load prompt
        prompt = prompt_path.read_text()
        debug_detailed(
            "agent_runner",
            "Loaded prompt file",
            prompt_length=len(prompt),
        )

        # Add context
        prompt += f"\n\n---\n\n**Spec Directory**: {self.spec_dir}\n"
        prompt += f"**Project Directory**: {self.project_dir}\n"

        # Add summaries from previous phases (compaction)
        if prior_phase_summaries:
            prompt += f"\n{prior_phase_summaries}\n"
            debug_detailed(
                "agent_runner",
                "Added prior phase summaries",
                summaries_length=len(prior_phase_summaries),
            )

        if additional_context:
            prompt += f"\n{additional_context}\n"
            debug_detailed(
                "agent_runner",
                "Added additional context",
                context_length=len(additional_context),
            )

        # Create client with thinking budget
        debug(
            "agent_runner",
            "Creating iFlow client...",
            thinking_budget=thinking_budget,
        )
        client = create_iflow_client(
            self.project_dir,
            model_to_use,
            enable_thinking=thinking_budget is not None,
        )

        current_tool = None
        message_count = 0
        tool_count = 0

        try:
            async with client:
                debug("agent_runner", "Sending query to agent...")
                await send_agent_message(client, prompt)
                debug_success("agent_runner", "Query sent successfully")

                response_text = ""
                debug("agent_runner", "Starting to receive response stream...")
                stream_iter = iter_agent_messages(client).__aiter__()
                while True:
                    try:
                        if STREAM_IDLE_TIMEOUT_SEC is None:
                            msg = await stream_iter.__anext__()
                        else:
                            msg = await asyncio.wait_for(
                                stream_iter.__anext__(),
                                timeout=STREAM_IDLE_TIMEOUT_SEC,
                            )
                    except StopAsyncIteration:
                        break
                    except asyncio.TimeoutError:
                        timeout_display = int(STREAM_IDLE_TIMEOUT_SEC)
                        message = (
                            f"No agent output for {timeout_display}s; aborting phase"
                        )
                        debug_error(
                            "agent_runner",
                            "Agent response timeout",
                            timeout_seconds=STREAM_IDLE_TIMEOUT_SEC,
                        )
                        if self.task_logger:
                            self.task_logger.log_error(message, LogPhase.PLANNING)
                        return False, message

                    msg_type = type(msg).__name__
                    message_count += 1
                    debug_detailed(
                        "agent_runner",
                        f"Received message #{message_count}",
                        msg_type=msg_type,
                    )

                    if msg_type == "AssistantMessage":
                        if hasattr(msg, "content") and isinstance(msg.content, list):
                            for block in msg.content:
                                block_type = type(block).__name__
                                if block_type == "TextBlock" and hasattr(block, "text"):
                                    response_text += block.text
                                    print(block.text, end="", flush=True)
                                    if self.task_logger and block.text.strip():
                                        self.task_logger.log(
                                            block.text,
                                            LogEntryType.TEXT,
                                            LogPhase.PLANNING,
                                            print_to_console=False,
                                        )
                                elif block_type == "ToolUseBlock" and hasattr(
                                    block, "name"
                                ):
                                    tool_name = block.name
                                    tool_count += 1

                                    # Safely extract tool input (handles None, non-dict, etc.)
                                    inp = get_safe_tool_input(block)
                                    tool_input_display = (
                                        self._extract_tool_input_display(inp)
                                    )

                                    debug(
                                        "agent_runner",
                                        f"Tool call #{tool_count}: {tool_name}",
                                        tool_input=tool_input_display,
                                    )

                                    if self.task_logger:
                                        self.task_logger.tool_start(
                                            tool_name,
                                            tool_input_display,
                                            LogPhase.PLANNING,
                                            print_to_console=True,
                                        )
                                    else:
                                        print(f"\n[Tool: {tool_name}]", flush=True)
                                    current_tool = tool_name
                        else:
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
                                if self.task_logger and text_chunk.strip():
                                    self.task_logger.log(
                                        text_chunk,
                                        LogEntryType.TEXT,
                                        LogPhase.PLANNING,
                                        print_to_console=False,
                                    )

                    elif msg_type == "ToolCallMessage":
                        tool_name = getattr(msg, "tool_name", None) or getattr(
                            msg, "name", None
                        )
                        tool_count += 1
                        tool_args = getattr(msg, "args", None)
                        if tool_args is None:
                            tool_args = getattr(msg, "input", None)
                        tool_input_display = self._extract_tool_input_display(tool_args)

                        debug(
                            "agent_runner",
                            f"Tool call #{tool_count}: {tool_name}",
                            tool_input=tool_input_display,
                        )

                        if self.task_logger and tool_name:
                            self.task_logger.tool_start(
                                tool_name,
                                tool_input_display,
                                LogPhase.PLANNING,
                                print_to_console=True,
                            )
                        elif tool_name:
                            print(f"\n[Tool: {tool_name}]", flush=True)
                        current_tool = tool_name

                        tool_output = getattr(msg, "output", None)
                        tool_status = getattr(msg, "status", None)
                        is_error = getattr(msg, "is_error", False)
                        if tool_output is not None or tool_status:
                            output_str = str(tool_output) if tool_output else ""
                            failed = is_error or (
                                tool_status in ("error", "failed", "blocked")
                            )
                            if self.task_logger and tool_name:
                                detail_content = self._get_tool_detail_content(
                                    tool_name, tool_output
                                )
                                self.task_logger.tool_end(
                                    tool_name,
                                    success=not failed,
                                    detail=detail_content,
                                    phase=LogPhase.PLANNING,
                                )
                            current_tool = None

                    elif msg_type == "UserMessage" and hasattr(msg, "content"):
                        for block in msg.content:
                            block_type = type(block).__name__
                            if block_type == "ToolResultBlock":
                                is_error = getattr(block, "is_error", False)
                                result_content = getattr(block, "content", "")
                                if is_error:
                                    debug_error(
                                        "agent_runner",
                                        f"Tool error: {current_tool}",
                                        error=str(result_content)[:200],
                                    )
                                else:
                                    debug_detailed(
                                        "agent_runner",
                                        f"Tool success: {current_tool}",
                                        result_length=len(str(result_content)),
                                    )
                                if self.task_logger and current_tool:
                                    detail_content = self._get_tool_detail_content(
                                        current_tool, result_content
                                    )
                                    self.task_logger.tool_end(
                                        current_tool,
                                        success=not is_error,
                                        detail=detail_content,
                                        phase=LogPhase.PLANNING,
                                    )
                                current_tool = None

                    elif msg_type == "TaskFinishMessage":
                        debug_success(
                            "agent_runner",
                            "Agent finished turn",
                            stop_reason=getattr(msg, "stop_reason", None),
                        )
                        break

                print()
                debug_success(
                    "agent_runner",
                    "Agent session completed successfully",
                    message_count=message_count,
                    tool_count=tool_count,
                    response_length=len(response_text),
                )
                return True, response_text

        except Exception as e:
            debug_error(
                "agent_runner",
                f"Agent session error: {e}",
                exception_type=type(e).__name__,
            )
            if self.task_logger:
                self.task_logger.log_error(f"Agent error: {e}", LogPhase.PLANNING)
            return False, str(e)

    @staticmethod
    def _extract_tool_input_display(inp: dict) -> str | None:
        """Extract meaningful tool input for display.

        Args:
            inp: The tool input dictionary

        Returns:
            A formatted string for display, or None
        """
        if not isinstance(inp, dict):
            return None

        if "pattern" in inp:
            return f"pattern: {inp['pattern']}"
        elif "file_path" in inp:
            fp = inp["file_path"]
            if len(fp) > 50:
                fp = "..." + fp[-47:]
            return fp
        elif "command" in inp:
            cmd = inp["command"]
            if len(cmd) > 50:
                cmd = cmd[:47] + "..."
            return cmd
        elif "path" in inp:
            return inp["path"]

        return None

    @staticmethod
    def _get_tool_detail_content(tool_name: str, result_content: str) -> str | None:
        """Get detail content for specific tools.

        Args:
            tool_name: The name of the tool
            result_content: The result content from the tool

        Returns:
            Detail content if relevant, otherwise None
        """
        if tool_name not in ("Read", "Grep", "Bash", "Edit", "Write"):
            return None

        result_str = str(result_content)
        if len(result_str) < 50000:
            return result_str

        return None

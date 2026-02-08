#!/usr/bin/env python3
"""
Insights Runner - AI chat for codebase insights using iFlow

This script provides an AI-powered chat interface for asking questions
about a codebase. It can also suggest tasks based on the conversation.
"""

import argparse
import asyncio
import json
import sys
import os
from pathlib import Path

# Add backend package to path
sys.path.insert(0, str(Path(__file__).parent.parent))

# Load .env file with centralized error handling
from cli.utils import import_dotenv

load_dotenv = import_dotenv()

env_file = Path(__file__).parent.parent / ".env"
if env_file.exists():
    load_dotenv(env_file)

from core.auth import ensure_iflow_auth_env, has_iflow_auth
from core.simple_client import create_simple_client
from debug import (
    debug,
    debug_detailed,
    debug_error,
    debug_section,
    debug_success,
)
from init import resolve_auto_build_dir
from phase_config import get_thinking_budget, resolve_model_id

try:
    import iflow_sdk  # noqa: F401

    IFLOW_SDK_AVAILABLE = True
except ImportError:
    IFLOW_SDK_AVAILABLE = False


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


def load_project_context(project_dir: str) -> str:
    """Load project context for the AI."""
    context_parts = []

    data_dir = resolve_auto_build_dir(Path(project_dir))

    # Load project index if available (from data directory)
    index_path = data_dir / "project_index.json"
    if index_path.exists():
        try:
            with open(index_path) as f:
                index = json.load(f)
            # Summarize the index for context
            summary = {
                "project_root": index.get("project_root", ""),
                "project_type": index.get("project_type", "unknown"),
                "services": list(index.get("services", {}).keys()),
                "infrastructure": index.get("infrastructure", {}),
            }
            context_parts.append(
                f"## Project Structure\n```json\n{json.dumps(summary, indent=2)}\n```"
            )
        except Exception:
            pass

    # Load roadmap if available
    roadmap_path = data_dir / "roadmap" / "roadmap.json"
    if roadmap_path.exists():
        try:
            with open(roadmap_path) as f:
                roadmap = json.load(f)
            # Summarize roadmap
            features = roadmap.get("features", [])
            feature_summary = [
                {"title": f.get("title", ""), "status": f.get("status", "")}
                for f in features[:10]
            ]
            context_parts.append(
                f"## Roadmap Features\n```json\n{json.dumps(feature_summary, indent=2)}\n```"
            )
        except Exception:
            pass

    # Load existing tasks
    tasks_path = data_dir / "specs"
    if tasks_path.exists():
        try:
            task_dirs = [d for d in tasks_path.iterdir() if d.is_dir()]
            task_names = [d.name for d in task_dirs[:10]]
            if task_names:
                context_parts.append(
                    "## Existing Tasks/Specs\n- " + "\n- ".join(task_names)
                )
        except Exception:
            pass

    return (
        "\n\n".join(context_parts)
        if context_parts
        else "No project context available yet."
    )


def build_system_prompt(project_dir: str) -> str:
    """Build the system prompt for the insights agent."""
    context = load_project_context(project_dir)

    return f"""You are an AI assistant helping developers understand and work with their codebase.
You have access to the following project context:

{context}

Your capabilities:
1. Answer questions about the codebase structure, patterns, and architecture
2. Suggest improvements, features, or bug fixes based on the code
3. Help plan implementation of new features
4. Provide code examples and explanations

When the user asks you to create a task, wants to turn the conversation into a task, or when you believe creating a task would be helpful, output a task suggestion in this exact format on a SINGLE LINE:
__TASK_SUGGESTION__:{{"title": "Task title here", "description": "Detailed description of what the task involves", "metadata": {{"category": "feature", "complexity": "medium", "impact": "medium"}}}}

Valid categories: feature, bug_fix, refactoring, documentation, security, performance, ui_ux, infrastructure, testing
Valid complexity: trivial, small, medium, large, complex
Valid impact: low, medium, high, critical

Be conversational and helpful. Focus on providing actionable insights and clear explanations.
Keep responses concise but informative."""


async def run_with_sdk(
    project_dir: str,
    message: str,
    history: list,
    model: str = "sonnet",  # Shorthand - resolved via API Profile if configured
    thinking_level: str = "medium",
) -> None:
    """Run the chat using iFlow with streaming."""
    if not IFLOW_SDK_AVAILABLE:
        print("iFlow SDK not available. Install iflow-sdk to use insights.", file=sys.stderr)
        run_simple(project_dir, message, history)
        return

    if not has_iflow_auth():
        print(
            "No authentication found, falling back to simple mode",
            file=sys.stderr,
        )
        run_simple(project_dir, message, history)
        return

    # Ensure SDK can find the token
    ensure_iflow_auth_env()

    system_prompt = build_system_prompt(project_dir)
    project_path = Path(project_dir).resolve()

    # Build conversation context from history
    conversation_context = ""
    for msg in history[:-1]:  # Exclude the latest message
        role = "User" if msg.get("role") == "user" else "Assistant"
        conversation_context += f"\n{role}: {msg['content']}\n"

    # Build the full prompt with conversation history
    full_prompt = message
    if conversation_context.strip():
        full_prompt = f"""Previous conversation:
{conversation_context}

Current question: {message}"""

    debug(
        "insights_runner",
        "Using model configuration",
        model=model,
        thinking_level=thinking_level,
    )

    try:
        thinking_budget = get_thinking_budget(thinking_level)
        client = create_simple_client(
            agent_type="insights",
            model=resolve_model_id(model),
            system_prompt=system_prompt,
            cwd=project_path,
            max_turns=30,
            max_thinking_tokens=thinking_budget,
        )

        async with client:
            await client.query(full_prompt)

            response_text = ""
            current_tool = None

            stream_iter = client.receive_response().__aiter__()
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
                    print(
                        f"__ERROR__:No agent output for {timeout_display}s; aborting",
                        flush=True,
                    )
                    return

                msg_type = type(msg).__name__
                debug_detailed("insights_runner", "Received message", msg_type=msg_type)

                if msg_type == "AssistantMessage" and hasattr(msg, "content"):
                    for block in msg.content:
                        block_type = type(block).__name__
                        debug_detailed(
                            "insights_runner", "Processing block", block_type=block_type
                        )
                        if block_type == "TextBlock" and hasattr(block, "text"):
                            text = block.text
                            debug_detailed(
                                "insights_runner", "Text block", text_length=len(text)
                            )
                            print(text, flush=True)
                            response_text += text
                        elif block_type == "ToolUseBlock" and hasattr(block, "name"):
                            tool_name = block.name
                            tool_input = ""

                            if hasattr(block, "input") and block.input:
                                inp = block.input
                                if isinstance(inp, dict):
                                    if "pattern" in inp:
                                        tool_input = f"pattern: {inp['pattern']}"
                                    elif "file_path" in inp:
                                        fp = inp["file_path"]
                                        if len(fp) > 50:
                                            fp = "..." + fp[-47:]
                                        tool_input = fp
                                    elif "path" in inp:
                                        tool_input = inp["path"]

                            current_tool = tool_name
                            print(
                                f"__TOOL_START__:{json.dumps({'name': tool_name, 'input': tool_input})}",
                                flush=True,
                            )

                elif msg_type == "UserMessage" and hasattr(msg, "content"):
                    for block in msg.content:
                        block_type = type(block).__name__
                        if block_type == "ToolResultBlock":
                            tool_name = getattr(block, "tool_name", None) or current_tool
                            if tool_name:
                                print(
                                    f"__TOOL_END__:{json.dumps({'name': tool_name})}",
                                    flush=True,
                                )
                            current_tool = None
                elif msg_type == "TaskFinishMessage":
                    break

            # Ensure we have a newline at the end
            if response_text and not response_text.endswith("\n"):
                print()

            debug(
                "insights_runner",
                "Response complete",
                response_length=len(response_text),
            )

    except Exception as e:
        print(f"Error using iFlow: {e}", file=sys.stderr)
        import traceback

        traceback.print_exc(file=sys.stderr)
        run_simple(project_dir, message, history)


def run_simple(project_dir: str, message: str, history: list) -> None:
    """Fallback mode when iFlow SDK/auth is unavailable."""
    _ = project_dir
    _ = history
    print(
        "iFlow is not available for Insights. Install iflow-sdk and configure auth.\n\n"
        f"Your question was: {message}"
    )


def main():
    parser = argparse.ArgumentParser(description="Insights AI Chat Runner")
    parser.add_argument("--project-dir", required=True, help="Project directory path")
    parser.add_argument("--message", required=True, help="User message")
    parser.add_argument("--history", default="[]", help="JSON conversation history")
    parser.add_argument(
        "--history-file", help="Path to JSON file containing conversation history"
    )
    parser.add_argument(
        "--model",
        default="sonnet",
        help="Model to use (haiku, sonnet, opus, or full model ID)",
    )
    parser.add_argument(
        "--thinking-level",
        default="medium",
        choices=["none", "low", "medium", "high", "ultrathink"],
        help="Thinking level for extended reasoning (default: medium)",
    )
    args = parser.parse_args()

    debug_section("insights_runner", "Starting Insights Chat")

    project_dir = args.project_dir
    user_message = args.message
    model = args.model
    thinking_level = args.thinking_level

    debug(
        "insights_runner",
        "Arguments",
        project_dir=project_dir,
        message_length=len(user_message),
        model=model,
        thinking_level=thinking_level,
    )

    # Load history from file if provided, otherwise parse inline JSON
    try:
        if args.history_file:
            debug(
                "insights_runner", "Loading history from file", file=args.history_file
            )
            with open(args.history_file, encoding="utf-8") as f:
                history = json.load(f)
            debug_detailed(
                "insights_runner",
                "Loaded history from file",
                history_length=len(history),
            )
        else:
            history = json.loads(args.history)
            debug_detailed(
                "insights_runner", "Parsed inline history", history_length=len(history)
            )
    except (json.JSONDecodeError, FileNotFoundError, OSError) as e:
        debug_error("insights_runner", f"Failed to load history: {e}")
        history = []

    # Run the async SDK function
    debug("insights_runner", "Running SDK query")
    asyncio.run(run_with_sdk(project_dir, user_message, history, model, thinking_level))
    debug_success("insights_runner", "Query completed")


if __name__ == "__main__":
    main()

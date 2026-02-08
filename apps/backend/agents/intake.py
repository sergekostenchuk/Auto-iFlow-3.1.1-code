"""
Intake Agent
============

Runs LLM-based intake analysis for Strict Intake.
Produces structured JSON describing clarity, questions, risks, and suggested title.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, TypedDict

from core.auth import ensure_iflow_auth_env, has_iflow_auth
from core.simple_client import create_simple_client

logger = logging.getLogger(__name__)


class ClarifyingQuestion(TypedDict, total=False):
    id: str
    question: str
    type: str
    options: list[str]


class IntakeResult(TypedDict, total=False):
    clarity_level: str
    clarifying_questions: list[ClarifyingQuestion]
    suggested_title: str
    risks: list[str]
    assumptions: list[str]
    notes: str
    intake_model: str


def _get_prompt_path(use_v2: bool) -> Path:
    prompt_name = "intake_analysis_v2.md" if use_v2 else "intake_analysis.md"
    return Path(__file__).resolve().parents[1] / "prompts" / prompt_name


def _load_prompt(use_v2: bool) -> str:
    prompt_path = _get_prompt_path(use_v2)
    return prompt_path.read_text(encoding="utf-8")


def _strip_code_fences(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = stripped.strip("`")
        # Remove optional language tag line
        lines = stripped.splitlines()
        if lines and lines[0].strip().startswith(("json", "JSON")):
            lines = lines[1:]
        stripped = "\n".join(lines)
    return stripped.strip()


def _parse_json_response(text: str) -> dict:
    cleaned = _strip_code_fences(text)
    try:
        data = json.loads(cleaned)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass

    # Fallback: extract first JSON object
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            data = json.loads(cleaned[start:end + 1])
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            pass

    raise ValueError("Intake response is not valid JSON")


def _build_user_prompt(
    description: str,
    attachments: list[str] | None,
    answers: dict[str, Any] | None,
    reanalyze: bool,
) -> str:
    payload = {
        "description": description,
        "attachments": attachments or [],
        "answers": answers or {},
        "reanalyze": reanalyze,
    }
    return (
        "INPUT:\n"
        + json.dumps(payload, ensure_ascii=False, indent=2)
        + "\n\nReturn JSON only."
    )


async def run_intake_analysis(
    *,
    description: str,
    model: str,
    attachments: list[str] | None = None,
    answers: dict[str, Any] | None = None,
    reanalyze: bool = False,
    use_v2: bool = False,
) -> IntakeResult:
    if not has_iflow_auth():
        raise RuntimeError("No iFlow auth found for intake analysis")
    ensure_iflow_auth_env()

    system_prompt = _load_prompt(use_v2)
    user_prompt = _build_user_prompt(description, attachments, answers, reanalyze)

    client = create_simple_client(
        agent_type="batch_analysis",
        model=model,
        system_prompt=system_prompt,
        max_turns=1,
    )

    response_text = ""
    async with client:
        await client.query(user_prompt)
        async for msg in client.receive_response():
            msg_type = type(msg).__name__
            if msg_type == "AssistantMessage" and hasattr(msg, "content"):
                for block in msg.content:
                    if type(block).__name__ == "TextBlock" and hasattr(block, "text"):
                        if block.text:
                            response_text += block.text
            if msg_type == "TaskFinishMessage":
                break

    if not response_text.strip():
        raise RuntimeError("Intake response empty")

    parsed = _parse_json_response(response_text)
    parsed.setdefault("clarifying_questions", [])
    parsed["intake_model"] = model
    return parsed  # type: ignore[return-value]

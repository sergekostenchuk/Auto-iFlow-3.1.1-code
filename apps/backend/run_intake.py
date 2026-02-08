#!/usr/bin/env python3
"""
Run Intake Analysis
===================

CLI entry point for Strict Intake. Runs LLM-based intake analysis and prints JSON to stdout.

Usage:
  python apps/backend/run_intake.py --description "..." --model glm-4.7
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from typing import Any

from agents.intake import run_intake_analysis


def _parse_json(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


def _parse_attachments(value: str | None) -> list[str]:
    if not value:
        return []
    parsed = _parse_json(value, None)
    if isinstance(parsed, list):
        return [str(item) for item in parsed if str(item).strip()]
    # Fallback: comma-separated list
    return [item.strip() for item in value.split(",") if item.strip()]


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run intake analysis and return JSON result.")
    parser.add_argument("--description", required=True, help="Task description text")
    parser.add_argument("--model", default="glm-4.7", help="Model to use for intake analysis")
    parser.add_argument("--attachments", help="JSON array or comma-separated attachment list")
    parser.add_argument("--reanalyze", action="store_true", help="Re-analyze with clarifying answers")
    parser.add_argument("--answers", help="JSON object of clarifying answers")
    parser.add_argument("--intake-v2", action="store_true", help="Use Intake V2 prompt and normalization contract")
    return parser


async def _run(args: argparse.Namespace) -> int:
    attachments = _parse_attachments(args.attachments)
    answers = _parse_json(args.answers, {})
    if not isinstance(answers, dict):
        answers = {}

    result = await run_intake_analysis(
        description=args.description,
        model=args.model,
        attachments=attachments,
        answers=answers,
        reanalyze=bool(args.reanalyze),
        use_v2=bool(args.intake_v2),
    )

    print(json.dumps(result, ensure_ascii=False))
    return 0


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()
    try:
        return asyncio.run(_run(args))
    except Exception as exc:
        print(f"[intake] error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

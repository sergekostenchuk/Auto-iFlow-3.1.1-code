"""CLI for running post-code tests on demand."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from spec.post_code_tests import run_post_code_tests, run_post_code_tests_if_needed


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run post-code tests for a spec directory.")
    parser.add_argument("--spec-dir", required=True, help="Path to the spec directory")
    parser.add_argument("--project-dir", required=True, help="Path to the project root")
    parser.add_argument("--force", action="store_true", help="Force rerun even if report is up to date")
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    spec_dir = Path(args.spec_dir)
    project_dir = Path(args.project_dir)

    try:
        if args.force:
            report = asyncio.run(run_post_code_tests(spec_dir, project_dir))
        else:
            report = asyncio.run(run_post_code_tests_if_needed(spec_dir, project_dir))
            if report is None:
                report = {
                    "status": "skipped",
                    "reason": "Post-code tests already up to date",
                }
        print(json.dumps(report, indent=2))
        return 0
    except Exception as exc:  # noqa: BLE001
        error_payload = {
            "status": "failed",
            "error": str(exc),
        }
        print(json.dumps(error_payload, indent=2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

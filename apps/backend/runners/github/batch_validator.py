"""
Batch Validation Agent
======================

AI layer that validates issue batching using iFlow with extended thinking.
Reviews whether semantically grouped issues actually belong together.
"""

from __future__ import annotations

import importlib.util
import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from init import resolve_auto_build_dir
from phase_config import resolve_model

logger = logging.getLogger(__name__)

# Check for iFlow SDK availability without importing (avoids unused import warning)
IFLOW_SDK_AVAILABLE = importlib.util.find_spec("iflow_sdk") is not None

# Default model and thinking configuration
DEFAULT_THINKING_BUDGET = 10000  # Medium thinking


@dataclass
class BatchValidationResult:
    """Result of batch validation."""

    batch_id: str
    is_valid: bool
    confidence: float  # 0.0 - 1.0
    reasoning: str
    suggested_splits: list[list[int]] | None  # If invalid, suggest how to split
    common_theme: str  # Refined theme description

    def to_dict(self) -> dict[str, Any]:
        return {
            "batch_id": self.batch_id,
            "is_valid": self.is_valid,
            "confidence": self.confidence,
            "reasoning": self.reasoning,
            "suggested_splits": self.suggested_splits,
            "common_theme": self.common_theme,
        }


VALIDATION_PROMPT = """You are reviewing a batch of GitHub issues that were grouped together by semantic similarity.
Your job is to validate whether these issues truly belong together for a SINGLE combined fix/PR.

Issues should be batched together ONLY if:
1. They describe the SAME root cause or closely related symptoms
2. They can realistically be fixed together in ONE pull request
3. Fixing one would naturally address the others
4. They affect the same component/area of the codebase

Issues should NOT be batched together if:
1. They are merely topically similar but have different root causes
2. They require separate, unrelated fixes
3. One is a feature request and another is a bug fix
4. They affect completely different parts of the codebase

## Batch to Validate

Batch ID: {batch_id}
Primary Issue: #{primary_issue}
Detected Themes: {themes}

### Issues in this batch:

{issues_formatted}

## Your Task

Analyze whether these issues truly belong together. Consider:
- Do they share a common root cause?
- Could a single PR reasonably fix all of them?
- Are there any outliers that don't fit?

Respond with a JSON object:
```json
{{
  "is_valid": true/false,
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation of your decision",
  "suggested_splits": null or [[issue_numbers], [issue_numbers]] if invalid,
  "common_theme": "Refined description of what ties valid issues together"
}}
```

Only output the JSON, no other text."""


class BatchValidator:
    """
    Validates issue batches using iFlow with extended thinking.

    Usage:
        validator = BatchValidator(project_dir=Path("."))
        result = await validator.validate_batch(batch)

        if not result.is_valid:
            # Split the batch according to suggestions
            new_batches = result.suggested_splits
    """

    def __init__(
        self,
        project_dir: Path | None = None,
        model: str | None = None,
        thinking_budget: int | None = None,
    ):
        self.project_dir = project_dir or Path.cwd()
        auto_build_path = resolve_auto_build_dir(self.project_dir).name
        resolved_model, _, resolved_budget = resolve_model(
            feature="github",
            role="batch",
            project_dir=self.project_dir,
            auto_build_path=auto_build_path,
            cli_model=model,
        )
        self.model = resolved_model
        if thinking_budget is None:
            thinking_budget = resolved_budget or DEFAULT_THINKING_BUDGET
        self.thinking_budget = thinking_budget

        if not IFLOW_SDK_AVAILABLE:
            logger.warning(
                "iflow-sdk not available. Batch validation will be skipped."
            )

    def _format_issues(self, issues: list[dict[str, Any]]) -> str:
        """Format issues for the prompt."""
        formatted = []
        for issue in issues:
            labels = ", ".join(issue.get("labels", [])) or "none"
            body = issue.get("body", "")[:500]  # Truncate long bodies
            if len(issue.get("body", "")) > 500:
                body += "..."

            formatted.append(f"""
**Issue #{issue["issue_number"]}**: {issue["title"]}
- Labels: {labels}
- Similarity to primary: {issue.get("similarity_to_primary", 1.0):.0%}
- Body: {body}
""")
        return "\n---\n".join(formatted)

    async def validate_batch(
        self,
        batch_id: str,
        primary_issue: int,
        issues: list[dict[str, Any]],
        themes: list[str],
    ) -> BatchValidationResult:
        """
        Validate a batch of issues.

        Args:
            batch_id: Unique batch identifier
            primary_issue: The primary/anchor issue number
            issues: List of issue dicts with issue_number, title, body, labels, similarity_to_primary
            themes: Detected common themes

        Returns:
            BatchValidationResult with validation decision
        """
        # Single issue batches are always valid
        if len(issues) <= 1:
            return BatchValidationResult(
                batch_id=batch_id,
                is_valid=True,
                confidence=1.0,
                reasoning="Single issue batch - no validation needed",
                suggested_splits=None,
                common_theme=themes[0] if themes else "single issue",
            )

        # Check if SDK/auth is available
        if not IFLOW_SDK_AVAILABLE:
            logger.warning("iFlow SDK not available, assuming batch is valid")
            return BatchValidationResult(
                batch_id=batch_id,
                is_valid=True,
                confidence=0.5,
                reasoning="Validation skipped - iFlow SDK not available",
                suggested_splits=None,
                common_theme=themes[0] if themes else "",
            )
        from core.auth import has_iflow_auth

        if not has_iflow_auth():
            logger.warning("iFlow auth not configured, assuming batch is valid")
            return BatchValidationResult(
                batch_id=batch_id,
                is_valid=True,
                confidence=0.5,
                reasoning="Validation skipped - iFlow auth not configured",
                suggested_splits=None,
                common_theme=themes[0] if themes else "",
            )

        # Format the prompt
        prompt = VALIDATION_PROMPT.format(
            batch_id=batch_id,
            primary_issue=primary_issue,
            themes=", ".join(themes) if themes else "none detected",
            issues_formatted=self._format_issues(issues),
        )

        try:
            # Create iFlow client with extended thinking
            from core.simple_client import create_simple_client
            from phase_config import resolve_model_id

            client = create_simple_client(
                agent_type="batch_validation",
                model=resolve_model_id(self.model),
                system_prompt="You are an expert at analyzing GitHub issues and determining if they should be grouped together for a combined fix.",
                cwd=self.project_dir,
                max_thinking_tokens=self.thinking_budget,  # Extended thinking
            )

            async with client:
                await client.query(prompt)
                result_text = await self._collect_response(client)

            # Parse JSON response
            result_json = self._parse_json_response(result_text)

            return BatchValidationResult(
                batch_id=batch_id,
                is_valid=result_json.get("is_valid", True),
                confidence=result_json.get("confidence", 0.5),
                reasoning=result_json.get("reasoning", "No reasoning provided"),
                suggested_splits=result_json.get("suggested_splits"),
                common_theme=result_json.get("common_theme", ""),
            )

        except Exception as e:
            logger.error(f"Batch validation failed: {e}")
            # On error, assume valid to not block the flow
            return BatchValidationResult(
                batch_id=batch_id,
                is_valid=True,
                confidence=0.5,
                reasoning=f"Validation error (assuming valid): {str(e)}",
                suggested_splits=None,
                common_theme=themes[0] if themes else "",
            )

    async def _collect_response(self, client: Any) -> str:
        """Collect text response from iFlow client."""
        response_text = ""

        async for msg in client.receive_response():
            msg_type = type(msg).__name__

            if msg_type == "AssistantMessage":
                for content in msg.content:
                    if hasattr(content, "text"):
                        response_text += content.text

        return response_text

    def _parse_json_response(self, text: str) -> dict[str, Any]:
        """Parse JSON from the response, handling markdown code blocks."""
        # Try to extract JSON from markdown code block
        if "```json" in text:
            start = text.find("```json") + 7
            end = text.find("```", start)
            if end > start:
                text = text[start:end].strip()
        elif "```" in text:
            start = text.find("```") + 3
            end = text.find("```", start)
            if end > start:
                text = text[start:end].strip()

        try:
            return json.loads(text)
        except json.JSONDecodeError:
            # Try to find JSON object in text
            start = text.find("{")
            end = text.rfind("}") + 1
            if start >= 0 and end > start:
                return json.loads(text[start:end])
            raise


async def validate_batches(
    batches: list[dict[str, Any]],
    project_dir: Path | None = None,
    model: str = DEFAULT_MODEL,
    thinking_budget: int = DEFAULT_THINKING_BUDGET,
) -> list[BatchValidationResult]:
    """
    Validate multiple batches.

    Args:
        batches: List of batch dicts with batch_id, primary_issue, issues, common_themes
        project_dir: Project directory for iFlow
        model: Model to use for validation
        thinking_budget: Token budget for extended thinking

    Returns:
        List of BatchValidationResult
    """
    validator = BatchValidator(
        project_dir=project_dir,
        model=model,
        thinking_budget=thinking_budget,
    )
    results = []

    for batch in batches:
        result = await validator.validate_batch(
            batch_id=batch["batch_id"],
            primary_issue=batch["primary_issue"],
            issues=batch["issues"],
            themes=batch.get("common_themes", []),
        )
        results.append(result)
        logger.info(
            f"Batch {batch['batch_id']}: valid={result.is_valid}, "
            f"confidence={result.confidence:.0%}, theme='{result.common_theme}'"
        )

    return results

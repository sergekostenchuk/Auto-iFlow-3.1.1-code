"""
Requirements and Research Phase Implementations
================================================

Phases for requirements gathering, historical context, and research.
"""

import json
import re
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING

from task_logger import LogEntryType, LogPhase

from .. import env_reality_check, requirements, validator
from ..validate_pkg.scope_contract_rules import derive_scope_rules
from .models import MAX_RETRIES, PhaseResult

if TYPE_CHECKING:
    pass


class RequirementsPhaseMixin:
    """Mixin for requirements and research phase methods."""

    _TASK_TYPE_KEYWORDS = {
        "analysis": ["analysis", "analyze", "investigate", "root cause", "diagnose"],
        "audit": ["audit", "compliance", "security review", "risk review"],
        "plan": ["plan", "roadmap", "strategy", "proposal", "design doc"],
        "content": ["docs", "documentation", "readme", "changelog", "write"],
    }

    def _infer_intent(self, task_description: str, workflow_type: str | None) -> str:
        """Infer intent for scope contract based on workflow type and task text."""
        workflow = (workflow_type or "").lower()
        if workflow in {"investigation", "research"}:
            return "investigate"
        if workflow in {"migration"}:
            return "change"
        if workflow in {"bugfix", "bug_fix", "fix"}:
            return "change"
        if workflow in {"feature"}:
            return "change"

        lowered = (task_description or "").lower()
        if any(word in lowered for word in ["create", "add", "build", "introduce"]):
            return "create"
        if any(word in lowered for word in ["delete", "remove", "drop"]):
            return "delete"
        if any(word in lowered for word in ["investigate", "research", "analyze"]):
            return "investigate"
        return "change"

    def _infer_task_type(self, task_description: str, workflow_type: str | None) -> str:
        workflow = (workflow_type or "").lower().strip()
        if workflow in {"docs", "documentation", "content"}:
            return "content"
        if workflow in {"audit"}:
            return "audit"
        if workflow in {"analysis", "investigation", "research"}:
            return "analysis"
        if workflow in {"plan", "planning"}:
            return "plan"

        lowered = (task_description or "").lower()
        for task_type, keywords in self._TASK_TYPE_KEYWORDS.items():
            if any(keyword in lowered for keyword in keywords):
                return task_type
        return "code"

    def _extract_task_paths(self, task_description: str) -> list[str]:
        if not task_description:
            return []
        matches = re.findall(r"/[^\\s]+", task_description)
        results: list[str] = []
        for raw in matches:
            cleaned = raw.rstrip(").,;\"'")
            try:
                path = Path(cleaned).resolve()
            except OSError:
                continue
            try:
                rel = path.relative_to(Path(self.project_dir).resolve())
            except (ValueError, OSError):
                continue
            results.append(str(rel))
        return results

    def _get_noncode_allowed_paths(self, task_description: str) -> list[str]:
        allowed = ["NEW-PLANS/**", "CODEX-*.md", "docs/**", "README.md"]
        allowed.extend(self._extract_task_paths(task_description))
        # Deduplicate while preserving order
        seen = set()
        result: list[str] = []
        for item in allowed:
            if item and item not in seen:
                seen.add(item)
                result.append(item)
        return result

    def _load_project_index(self) -> dict:
        """Load project_index.json from spec directory if available."""
        project_index_file = self.spec_dir / "project_index.json"
        if project_index_file.exists():
            try:
                return json.loads(project_index_file.read_text())
            except json.JSONDecodeError:
                return {}
        return {}

    def _coerce_list(self, value) -> list[str]:
        """Normalize a value into a list of strings."""
        if value is None:
            return []
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        if isinstance(value, str) and value.strip():
            return [value.strip()]
        return []

    def _infer_acceptance(self, task_description: str) -> list[str]:
        """Infer acceptance criteria from task description when missing."""
        if not task_description:
            return []

        lines = [line.strip() for line in task_description.splitlines()]
        start_idx = None
        for idx, line in enumerate(lines):
            lowered = line.lower()
            if "acceptance criteria" in lowered or "success criteria" in lowered:
                start_idx = idx + 1
                break

        if start_idx is None:
            return []

        items: list[str] = []
        for line in lines[start_idx:]:
            if not line:
                if items:
                    break
                continue
            if line.startswith(('-', '*')):
                candidate = line.lstrip('-* ').strip()
                if candidate:
                    items.append(candidate)
                continue
            if items:
                break

        return items

    def _write_preflight_report(
        self,
        status: str,
        errors: list[str],
        warnings: list[str],
        fixes: list[str],
        scope_file: str | None,
    ) -> str | None:
        """Persist scope preflight failure details for UI visibility."""
        report_file = self.spec_dir / "scope_preflight_report.json"
        payload = {
            "status": status,
            "errors": errors,
            "warnings": warnings,
            "fixes": fixes,
            "scope_file": scope_file,
            "created_at": datetime.now().isoformat(),
        }
        try:
            report_file.write_text(json.dumps(payload, indent=2))
            return str(report_file)
        except OSError as exc:
            self.task_logger.log_error(
                f"Failed to write scope preflight report: {exc}", LogPhase.PLANNING
            )
        return None

    async def phase_env_reality_check(self) -> PhaseResult:
        """Validate project paths, permissions, and required binaries before preflight."""
        report_file = self.spec_dir / "env_reality_check.json"

        req = requirements.load_requirements(self.spec_dir) or {}
        project_index = self._load_project_index()

        result = env_reality_check.run_env_reality_check(
            project_dir=self.project_dir,
            spec_dir=self.spec_dir,
            project_index=project_index,
            requirements=req,
        )

        try:
            report_file.write_text(json.dumps(result, indent=2))
        except OSError as exc:
            self.task_logger.log_with_detail(
                "Env reality check failed while writing report",
                str(exc),
                LogEntryType.ERROR,
                LogPhase.PLANNING,
                subphase="ENV REALITY CHECK",
            )
            return PhaseResult("env_reality_check", False, [], [str(exc)], 0)

        if result.get("status") == "passed":
            self.ui.print_status("Environment reality check passed", "success")
            return PhaseResult("env_reality_check", True, [str(report_file)], [], 0)

        detail_lines = []
        errors = result.get("errors") or []
        warnings = result.get("warnings") or []
        if errors:
            detail_lines.append("Errors:")
            detail_lines.extend(f"- {item}" for item in errors)
        if warnings:
            detail_lines.append("Warnings:")
            detail_lines.extend(f"- {item}" for item in warnings)
        detail_lines.append(f"Report: {report_file}")

        self.task_logger.log_with_detail(
            "Env reality check failed",
            "\n".join(detail_lines),
            LogEntryType.ERROR,
            LogPhase.PLANNING,
            subphase="ENV REALITY CHECK",
        )
        self.ui.print_status("Environment reality check failed", "error")
        return PhaseResult("env_reality_check", False, [str(report_file)], errors, 0)

    async def phase_preflight(self) -> PhaseResult:
        """Create scope_contract.json with guardrails before planning."""
        scope_file = self.spec_dir / "scope_contract.json"

        if scope_file.exists():
            result = self.spec_validator.validate_scope_contract()
            if result.valid:
                self.ui.print_status("scope_contract.json already exists", "success")
                return PhaseResult("preflight", True, [str(scope_file)], [], 0)

        req = requirements.load_requirements(self.spec_dir) or {}
        task_description = req.get("task_description", self.task_description or "")
        workflow_type = req.get("workflow_type")
        user_requirements = self._coerce_list(req.get("user_requirements", []))
        acceptance = self._coerce_list(req.get("acceptance_criteria", []))
        if not acceptance:
            acceptance = self._infer_acceptance(task_description)
        if not acceptance:
            acceptance = ["Define acceptance criteria during planning."]

        project_index = self._load_project_index()
        scope_rules = derive_scope_rules(project_index)
        task_type = self._infer_task_type(task_description, workflow_type)
        noncode_allowed_paths: list[str] = []
        if task_type != "code":
            noncode_allowed_paths = self._get_noncode_allowed_paths(task_description)

        allowed_paths = list(scope_rules.allowed_paths)
        test_plan = list(scope_rules.test_plan)
        candidate_files: list[str] = []
        if task_type != "code":
            test_plan = []
            allowed_paths.extend(noncode_allowed_paths)
            candidate_files = noncode_allowed_paths

        contract = {
            "intent": self._infer_intent(task_description, workflow_type),
            "outcome": task_description or "Define the intended outcome for this task.",
            "where": ", ".join(allowed_paths),
            "why": user_requirements[0] if user_requirements else "Derived from requirements.json",
            "when": "During implementation and runtime.",
            "acceptance": acceptance,
            "test_plan": test_plan,
            "allowed_paths": allowed_paths,
            "forbidden_paths": scope_rules.forbidden_paths,
            "candidate_files": candidate_files,
            "task_type": task_type,
        }

        try:
            scope_file.write_text(json.dumps(contract, indent=2))
        except OSError as exc:
            report_path = self._write_preflight_report(
                "failed",
                [str(exc)],
                [],
                ["Ensure spec directory is writable"],
                str(scope_file),
            )
            self.task_logger.log_with_detail(
                "Scope preflight failed while writing scope_contract.json",
                str(exc),
                LogEntryType.ERROR,
                LogPhase.PLANNING,
                subphase="SCOPE PREFLIGHT",
            )
            output_files = [str(scope_file)]
            if report_path:
                output_files.append(report_path)
            return PhaseResult("preflight", False, output_files, [str(exc)], 0)

        result = self.spec_validator.validate_scope_contract()
        if result.valid:
            # Also generate task_intake.json via preflight scoper
            from ..pipeline.preflight_scoper import run_preflight_scoper

            try:
                run_preflight_scoper(
                    spec_dir=self.spec_dir,
                    project_dir=self.project_dir,
                    task_description=task_description,
                )
            except Exception as exc:  # pragma: no cover - defensive
                report_path = self._write_preflight_report(
                    "failed",
                    [str(exc)],
                    [],
                    ["Ensure task_intake.json can be written"],
                    str(scope_file),
                )
                self.task_logger.log_with_detail(
                    "Preflight scoper failed while writing task_intake.json",
                    str(exc),
                    LogEntryType.ERROR,
                    LogPhase.PLANNING,
                    subphase="SCOPE PREFLIGHT",
                )
                output_files = [str(scope_file)]
                if report_path:
                    output_files.append(report_path)
                return PhaseResult("preflight", False, output_files, [str(exc)], 0)

            self.ui.print_status("Created scope_contract.json", "success")
            output_files = [str(scope_file), str(self.spec_dir / "task_intake.json")]
            return PhaseResult("preflight", True, output_files, [], 0)

        report_path = self._write_preflight_report(
            "failed",
            result.errors,
            result.warnings,
            result.fixes,
            str(scope_file),
        )
        detail_lines = [str(result)]
        if report_path:
            detail_lines.append("")
            detail_lines.append(f"Report: {report_path}")
        self.task_logger.log_with_detail(
            "Scope preflight failed: scope_contract.json did not pass validation",
            "\n".join(detail_lines),
            LogEntryType.ERROR,
            LogPhase.PLANNING,
            subphase="SCOPE PREFLIGHT",
        )
        output_files = [str(scope_file)]
        if report_path:
            output_files.append(report_path)
        return PhaseResult("preflight", False, output_files, result.errors, 0)

    async def phase_senior_review(self) -> PhaseResult:
        """Validate scope contract and write review result."""
        review_file = self.spec_dir / "scope_review.json"
        scope_file = self.spec_dir / "scope_contract.json"

        result = self.spec_validator.validate_scope_contract()
        review_payload = {
            "approved": result.valid,
            "errors": result.errors,
            "warnings": result.warnings,
            "scope_file": str(scope_file),
            "created_at": datetime.now().isoformat(),
        }
        try:
            review_file.write_text(json.dumps(review_payload, indent=2))
        except OSError as exc:
            return PhaseResult("senior_review", False, [], [str(exc)], 0)

        if result.valid:
            self.ui.print_status("Scope contract approved", "success")
            return PhaseResult("senior_review", True, [str(review_file)], [], 0)

        self.ui.print_status("Scope contract requires clarification", "error")
        return PhaseResult("senior_review", False, [], result.errors, 0)

    async def phase_historical_context(self) -> PhaseResult:
        """Retrieve historical context from Graphiti knowledge graph (if enabled)."""
        from graphiti_providers import get_graph_hints, is_graphiti_enabled

        hints_file = self.spec_dir / "graph_hints.json"

        if hints_file.exists():
            self.ui.print_status("graph_hints.json already exists", "success")
            self.task_logger.log(
                "Historical context already available",
                LogEntryType.SUCCESS,
                LogPhase.PLANNING,
            )
            return PhaseResult("historical_context", True, [str(hints_file)], [], 0)

        if not is_graphiti_enabled():
            self.ui.print_status(
                "Graphiti not enabled, skipping historical context", "info"
            )
            self.task_logger.log(
                "Knowledge graph not configured, skipping",
                LogEntryType.INFO,
                LogPhase.PLANNING,
            )
            validator.create_empty_hints(
                self.spec_dir,
                enabled=False,
                reason="Graphiti not configured",
            )
            return PhaseResult("historical_context", True, [str(hints_file)], [], 0)

        # Get graph hints for this task
        task_query = self.task_description or ""

        # If we have requirements, use the full task description
        req = requirements.load_requirements(self.spec_dir)
        if req:
            task_query = req.get("task_description", task_query)

        if not task_query:
            self.ui.print_status(
                "No task description for graph query, skipping", "warning"
            )
            validator.create_empty_hints(
                self.spec_dir,
                enabled=True,
                reason="No task description available",
            )
            return PhaseResult("historical_context", True, [str(hints_file)], [], 0)

        self.ui.print_status("Querying Graphiti knowledge graph...", "progress")
        self.task_logger.log(
            "Searching knowledge graph for relevant context...",
            LogEntryType.INFO,
            LogPhase.PLANNING,
        )

        try:
            hints = await get_graph_hints(
                query=task_query,
                project_id=str(self.project_dir),
                max_results=10,
            )

            # Save hints to file
            with open(hints_file, "w") as f:
                json.dump(
                    {
                        "enabled": True,
                        "query": task_query,
                        "hints": hints,
                        "hint_count": len(hints),
                        "created_at": datetime.now().isoformat(),
                    },
                    f,
                    indent=2,
                )

            if hints:
                self.ui.print_status(f"Retrieved {len(hints)} graph hints", "success")
                self.task_logger.log(
                    f"Found {len(hints)} relevant insights from past sessions",
                    LogEntryType.SUCCESS,
                    LogPhase.PLANNING,
                )
            else:
                self.ui.print_status("No relevant graph hints found", "info")

            return PhaseResult("historical_context", True, [str(hints_file)], [], 0)

        except Exception as e:
            self.ui.print_status(f"Graph query failed: {e}", "warning")
            validator.create_empty_hints(
                self.spec_dir,
                enabled=True,
                reason=f"Error: {str(e)}",
            )
            return PhaseResult(
                "historical_context", True, [str(hints_file)], [str(e)], 0
            )

    async def phase_requirements(self, interactive: bool = True) -> PhaseResult:
        """Gather requirements from user or task description."""
        requirements_file = self.spec_dir / "requirements.json"

        if requirements_file.exists():
            self.ui.print_status("requirements.json already exists", "success")
            return PhaseResult("requirements", True, [str(requirements_file)], [], 0)

        # Non-interactive mode with task description
        if self.task_description and not interactive:
            req = requirements.create_requirements_from_task(self.task_description)
            requirements.save_requirements(self.spec_dir, req)
            self.ui.print_status(
                "Created requirements.json from task description", "success"
            )
            task_preview = (
                self.task_description[:100] + "..."
                if len(self.task_description) > 100
                else self.task_description
            )
            self.task_logger.log(
                f"Task: {task_preview}",
                LogEntryType.SUCCESS,
                LogPhase.PLANNING,
            )
            return PhaseResult("requirements", True, [str(requirements_file)], [], 0)

        # Interactive mode
        if interactive:
            try:
                self.task_logger.log(
                    "Gathering requirements interactively...",
                    LogEntryType.INFO,
                    LogPhase.PLANNING,
                )
                req = requirements.gather_requirements_interactively(self.ui)

                # Update task description for subsequent phases
                self.task_description = req["task_description"]

                requirements.save_requirements(self.spec_dir, req)
                self.ui.print_status("Created requirements.json", "success")
                return PhaseResult(
                    "requirements", True, [str(requirements_file)], [], 0
                )
            except (KeyboardInterrupt, EOFError):
                print()
                self.ui.print_status("Requirements gathering cancelled", "warning")
                return PhaseResult("requirements", False, [], ["User cancelled"], 0)

        # Fallback: create minimal requirements
        req = requirements.create_requirements_from_task(
            self.task_description or "Unknown task"
        )
        requirements.save_requirements(self.spec_dir, req)
        self.ui.print_status("Created minimal requirements.json", "success")
        return PhaseResult("requirements", True, [str(requirements_file)], [], 0)

    async def phase_research(self) -> PhaseResult:
        """Research external integrations and validate assumptions."""
        research_file = self.spec_dir / "research.json"
        requirements_file = self.spec_dir / "requirements.json"

        if research_file.exists():
            self.ui.print_status("research.json already exists", "success")
            return PhaseResult("research", True, [str(research_file)], [], 0)

        if not requirements_file.exists():
            self.ui.print_status(
                "No requirements.json - skipping research phase", "warning"
            )
            validator.create_minimal_research(
                self.spec_dir,
                reason="No requirements file available",
            )
            return PhaseResult("research", True, [str(research_file)], [], 0)

        errors = []
        for attempt in range(MAX_RETRIES):
            self.ui.print_status(
                f"Running research agent (attempt {attempt + 1})...", "progress"
            )

            context_str = f"""
**Requirements File**: {requirements_file}
**Research Output**: {research_file}

Read the requirements.json to understand what integrations/libraries are needed.
Research each external dependency to validate:
- Correct package names
- Actual API patterns
- Configuration requirements
- Known issues or gotchas

Output your findings to research.json.
"""
            success, output = await self.run_agent_fn(
                "spec_researcher.md",
                additional_context=context_str,
                phase_name="research",
            )

            if success and research_file.exists():
                self.ui.print_status("Created research.json", "success")
                return PhaseResult("research", True, [str(research_file)], [], attempt)

            if success and not research_file.exists():
                validator.create_minimal_research(
                    self.spec_dir,
                    reason="Agent completed but created no findings",
                )
                return PhaseResult("research", True, [str(research_file)], [], attempt)

            errors.append(f"Attempt {attempt + 1}: Research agent failed")

        validator.create_minimal_research(
            self.spec_dir,
            reason="Research agent failed after retries",
        )
        return PhaseResult("research", True, [str(research_file)], errors, MAX_RETRIES)

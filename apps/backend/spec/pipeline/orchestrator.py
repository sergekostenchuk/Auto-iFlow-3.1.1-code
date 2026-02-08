"""
Spec Orchestrator
=================

Main orchestration logic for spec creation with dynamic complexity adaptation.
"""

import json
import asyncio
import inspect
import os
from collections.abc import Callable
from pathlib import Path

from analysis.analyzers import analyze_project
from core.workspace.models import SpecNumberLock
from init import resolve_auto_build_dir
from phase_config import get_thinking_budget, resolve_model
from prompts_pkg.project_context import should_refresh_project_index
from review import run_review_checkpoint
from security.constants import (
    NOISE_PROFILE_ENV_VAR,
    SPEC_DIR_ENV_VAR,
    TASK_TYPE_ENV_VAR,
)
from task_logger import (
    LogEntryType,
    LogPhase,
    get_task_logger,
)
from ui import (
    Icons,
    box,
    highlight,
    icon,
    muted,
    print_key_value,
    print_section,
    print_status,
)

from .. import complexity, phases, requirements
from ..compaction import (
    format_phase_summaries,
    gather_phase_outputs,
    summarize_phase_output,
)
from ..validate_pkg.spec_validator import SpecValidator
from ..pipeline.preflight_scoper import load_task_intake, run_preflight_scoper
from .agent_runner import AgentRunner
from .error_payloads import build_phase_error_payload
from .models import (
    PHASE_DISPLAY,
    cleanup_orphaned_pending_folders,
    create_spec_dir,
    get_specs_dir,
    rename_spec_dir_from_requirements,
)


def log_phase_failure(task_logger, display_name: str, result: phases.PhaseResult) -> None:
    content, detail = build_phase_error_payload(display_name, result)
    task_logger.log_with_detail(
        content,
        detail,
        LogEntryType.ERROR,
        LogPhase.PLANNING,
        subphase=display_name,
        collapsed=False,
    )


class SpecOrchestrator:
    """Orchestrates the spec creation process with dynamic complexity adaptation."""

    def __init__(
        self,
        project_dir: Path,
        task_description: str | None = None,
        spec_name: str | None = None,
        spec_dir: Path
        | None = None,  # Use existing spec directory (for UI integration)
        model: str | None = None,
        thinking_level: str | None = None,  # Thinking level for extended thinking
        complexity_override: str | None = None,  # Force a specific complexity
        use_ai_assessment: bool = True,  # Use AI for complexity assessment (vs heuristics)
    ):
        """Initialize the spec orchestrator.

        Args:
            project_dir: The project root directory
            task_description: Optional task description
            spec_name: Optional spec name (for existing specs)
            spec_dir: Optional existing spec directory (for UI integration)
            model: The model to use for agent execution
            thinking_level: Thinking level (none, low, medium, high, ultrathink)
            complexity_override: Force a specific complexity level
            use_ai_assessment: Whether to use AI for complexity assessment
        """
        self.project_dir = Path(project_dir)
        self.task_description = task_description
        self.model = model
        self.thinking_level = thinking_level
        self.complexity_override = complexity_override
        self.use_ai_assessment = use_ai_assessment

        # Get the appropriate specs directory (within the project)
        self.specs_dir = get_specs_dir(self.project_dir, ensure_write=True)

        # Clean up orphaned pending folders before creating new spec
        cleanup_orphaned_pending_folders(self.specs_dir)

        # Complexity assessment (populated during run)
        self.assessment: complexity.ComplexityAssessment | None = None

        # Create/use spec directory
        if spec_dir:
            # Use provided spec directory (from UI)
            self.spec_dir = Path(spec_dir)
            self.spec_dir.mkdir(parents=True, exist_ok=True)
        elif spec_name:
            self.spec_dir = self.specs_dir / spec_name
            self.spec_dir.mkdir(parents=True, exist_ok=True)
        else:
            # Use lock for coordinated spec numbering across worktrees
            with SpecNumberLock(self.project_dir) as lock:
                self.spec_dir = create_spec_dir(self.specs_dir, lock)
                # Create directory inside lock to ensure atomicity
                self.spec_dir.mkdir(parents=True, exist_ok=True)
        auto_build_path = resolve_auto_build_dir(self.project_dir).name
        resolved_model, resolved_thinking, _ = resolve_model(
            phase="spec",
            spec_dir=self.spec_dir,
            project_dir=self.project_dir,
            auto_build_path=auto_build_path,
            cli_model=model,
            cli_thinking=thinking_level,
        )
        self.model = resolved_model
        self.thinking_level = resolved_thinking

        self.validator = SpecValidator(self.spec_dir)

        # Agent runner (initialized when needed)
        self._agent_runner: AgentRunner | None = None

        # Phase summaries for conversation compaction
        # Stores summaries from completed phases to provide context to subsequent phases
        self._phase_summaries: dict[str, str] = {}

    def _get_agent_runner(self) -> AgentRunner:
        """Get or create the agent runner.

        Returns:
            The agent runner instance
        """
        if self._agent_runner is None:
            task_logger = get_task_logger(self.spec_dir)
            self._agent_runner = AgentRunner(
                self.project_dir, self.spec_dir, self.model, task_logger
            )
        return self._agent_runner

    def _load_task_intake(self) -> dict:
        intake = load_task_intake(self.spec_dir)
        return intake if isinstance(intake, dict) else {}

    def _ensure_task_intake(self) -> dict:
        intake = self._load_task_intake()
        if intake:
            return intake
        try:
            intake = run_preflight_scoper(
                spec_dir=self.spec_dir,
                project_dir=self.project_dir,
                task_description=self.task_description or "",
            )
        except Exception:
            intake = {}
        return intake if isinstance(intake, dict) else {}

    def _format_task_intake_context(self, intake: dict) -> str:
        if not intake:
            return ""
        acceptance_map = intake.get("acceptance_map", [])
        output_files = intake.get("output_files", [])
        noise_profile = intake.get("noise_profile")
        task_type = intake.get("task_type", "code")
        tests_to_run = intake.get("tests_to_run", [])

        return (
            "## TASK INTAKE (Preflight)\n"
            f"- task_type: {task_type}\n"
            f"- noise_profile: {noise_profile}\n"
            f"- output_files: {output_files}\n"
            f"- acceptance_map: {acceptance_map}\n"
            f"- tests_to_run: {tests_to_run}\n"
        )

    async def _run_agent(
        self,
        prompt_file: str,
        additional_context: str = "",
        interactive: bool = False,
        phase_name: str | None = None,
    ) -> tuple[bool, str]:
        """Run an agent with the given prompt.

        Args:
            prompt_file: The prompt file to use
            additional_context: Additional context to add
            interactive: Whether to run in interactive mode
            phase_name: Name of the phase (for thinking budget lookup)

        Returns:
            Tuple of (success, response_text)
        """
        runner = self._get_agent_runner()

        # Use user's configured thinking level for all spec phases
        thinking_budget = get_thinking_budget(self.thinking_level)

        # Format prior phase summaries for context
        prior_summaries = format_phase_summaries(self._phase_summaries)

        intake_context = self._format_task_intake_context(self._load_task_intake())
        if intake_context:
            if additional_context:
                additional_context = f"{additional_context}\n{intake_context}"
            else:
                additional_context = intake_context

        return await runner.run_agent(
            prompt_file,
            additional_context,
            interactive,
            thinking_budget=thinking_budget,
            prior_phase_summaries=prior_summaries if prior_summaries else None,
            model=self.model,
        )

    async def _store_phase_summary(self, phase_name: str) -> None:
        """Summarize and store phase output for subsequent phases.

        Args:
            phase_name: Name of the completed phase
        """
        try:
            # Gather outputs from this phase
            phase_output = gather_phase_outputs(self.spec_dir, phase_name)
            if not phase_output:
                return

            # Summarize the output
            summary = await asyncio.wait_for(
                summarize_phase_output(
                    phase_name,
                    phase_output,
                    model=self.model,
                    target_words=500,
                    project_dir=self.project_dir,
                ),
                timeout=60,
            )

            if summary:
                self._phase_summaries[phase_name] = summary

        except asyncio.TimeoutError:
            task_logger = get_task_logger(self.spec_dir)
            task_logger.log(
                "Phase summarization timed out; continuing without summary",
                LogEntryType.INFO,
                LogPhase.PLANNING,
            )
        except Exception as e:
            # Don't fail the pipeline if summarization fails
            print_status(f"Phase summarization skipped: {e}", "warning")

    async def _ensure_fresh_project_index(self) -> None:
        """Ensure project_index.json is up-to-date before spec creation.

        Uses smart caching: only regenerates if dependency files (package.json,
        pyproject.toml, etc.) have been modified since the last index generation.
        This ensures QA agents receive accurate project capability information
        for dynamic MCP tool injection.
        """
        index_file = resolve_auto_build_dir(self.project_dir) / "project_index.json"

        if should_refresh_project_index(self.project_dir):
            if index_file.exists():
                print_status(
                    "Project dependencies changed, refreshing index...", "progress"
                )
            else:
                print_status("Generating project index...", "progress")

            try:
                # Regenerate project index
                analyze_project(self.project_dir, index_file)
                print_status("Project index updated", "success")
            except Exception as e:
                print_status(f"Project index refresh failed: {e}", "warning")
                # Don't fail spec creation if indexing fails - continue with cached/missing
        else:
            if index_file.exists():
                print_status("Using cached project index", "info")
            # If no index exists and no refresh needed, that's fine - capabilities will be empty

    async def _run_noncode_pipeline(
        self,
        phase_executor: phases.PhaseExecutor,
        run_phase: Callable,
        results: list[phases.PhaseResult],
        phases_executed: list[str],
        auto_approve: bool,
        task_logger,
    ) -> bool:
        """Run the non-code pipeline (quick_spec + validation) and return review checkpoint."""
        noncode_phases = ["quick_spec", "validation"]
        phase_map = {
            "quick_spec": phase_executor.phase_quick_spec,
            "validation": phase_executor.phase_validation,
        }

        for phase_name in noncode_phases:
            phase_fn = phase_map.get(phase_name)
            if not phase_fn:
                continue
            result = await run_phase(phase_name, phase_fn)
            results.append(result)
            phases_executed.append(phase_name)

            if result.success:
                await self._store_phase_summary(phase_name)
            else:
                print()
                print_status(
                    f"Phase '{phase_name}' failed after {result.retries} retries",
                    "error",
                )
                if task_logger:
                    task_logger.end_phase(
                        LogPhase.PLANNING,
                        success=False,
                        message=f"Phase {phase_name} failed",
                    )
                return False

        # Ensure proof exists for non-code tasks
        try:
            from qa.proof_writer import ensure_noncode_proof

            ensure_noncode_proof(self.spec_dir, self.project_dir)
        except Exception as exc:
            if task_logger:
                task_logger.log_error(
                    f"Failed to write non-code proof: {exc}", LogPhase.PLANNING
                )

        self._print_completion_summary(results, phases_executed)
        if task_logger:
            task_logger.end_phase(
                LogPhase.PLANNING, success=True, message="Spec creation complete"
            )
        return self._run_review_checkpoint(auto_approve)

    async def run(self, interactive: bool = True, auto_approve: bool = False) -> bool:
        """Run the spec creation process with dynamic phase selection.

        Args:
            interactive: Whether to run in interactive mode for requirements gathering
            auto_approve: Whether to skip human review checkpoint and auto-approve

        Returns:
            True if spec creation and review completed successfully, False otherwise
        """
        # Import UI module for use in phases
        import ui

        # Initialize task logger for planning phase
        task_logger = get_task_logger(self.spec_dir)
        task_logger.start_phase(LogPhase.PLANNING, "Starting spec creation process")

        print(
            box(
                f"Spec Directory: {self.spec_dir}\n"
                f"Project: {self.project_dir}"
                + (f"\nTask: {self.task_description}" if self.task_description else ""),
                title="SPEC CREATION ORCHESTRATOR",
                style="heavy",
            )
        )

        # Smart cache: refresh project index if dependency files have changed
        await self._ensure_fresh_project_index()

        # Create phase executor
        phase_executor = phases.PhaseExecutor(
            project_dir=self.project_dir,
            spec_dir=self.spec_dir,
            task_description=self.task_description,
            spec_validator=self.validator,
            run_agent_fn=self._run_agent,
            task_logger=task_logger,
            ui_module=ui,
        )

        results = []
        phase_num = 0

        async def run_phase(name: str, phase_fn: Callable) -> phases.PhaseResult:
            """Run a phase with proper numbering and display.

            Args:
                name: The phase name
                phase_fn: The phase function to execute

            Returns:
                The phase result
            """
            nonlocal phase_num
            phase_num += 1
            display_name, display_icon = PHASE_DISPLAY.get(
                name, (name.upper(), Icons.GEAR)
            )
            print_section(f"PHASE {phase_num}: {display_name}", display_icon)
            task_logger.log(
                f"Starting phase {phase_num}: {display_name}", LogEntryType.INFO
            )
            result = phase_fn()
            if inspect.isawaitable(result):
                result = await result
            if not result.success:
                log_phase_failure(task_logger, display_name, result)
            return result

        # === PHASE 1: DISCOVERY ===
        result = await run_phase("discovery", phase_executor.phase_discovery)
        results.append(result)
        if not result.success:
            print_status("Discovery failed", "error")
            task_logger.end_phase(
                LogPhase.PLANNING, success=False, message="Discovery failed"
            )
            return False
        # Store summary for subsequent phases (compaction)
        await self._store_phase_summary("discovery")

        # === PHASE 2: REQUIREMENTS GATHERING ===
        result = await run_phase(
            "requirements", lambda: phase_executor.phase_requirements(interactive)
        )
        results.append(result)
        if not result.success:
            print_status("Requirements gathering failed", "error")
            task_logger.end_phase(
                LogPhase.PLANNING,
                success=False,
                message="Requirements gathering failed",
            )
            return False
        # Store summary for subsequent phases (compaction)
        await self._store_phase_summary("requirements")

        # Rename spec folder with better name from requirements
        rename_spec_dir_from_requirements(self.spec_dir)

        # Update task description from requirements
        req = requirements.load_requirements(self.spec_dir)
        if req:
            self.task_description = req.get("task_description", self.task_description)
            # Update phase executor's task description
            phase_executor.task_description = self.task_description

        # === CREATE LINEAR TASK (if enabled) ===
        await self._create_linear_task_if_enabled()

        # === PHASE 3: ENV REALITY CHECK ===
        result = await run_phase(
            "env_reality_check", phase_executor.phase_env_reality_check
        )
        results.append(result)
        if not result.success:
            print_status("Environment reality check failed", "error")
            task_logger.end_phase(
                LogPhase.PLANNING,
                success=False,
                message="Environment reality check failed",
            )
            return False
        await self._store_phase_summary("env_reality_check")

        # === PHASE 4: SCOPE PREFLIGHT ===
        result = await run_phase("preflight", phase_executor.phase_preflight)
        results.append(result)
        if not result.success:
            print_status("Scope preflight failed", "error")
            task_logger.end_phase(
                LogPhase.PLANNING, success=False, message="Scope preflight failed"
            )
            return False
        await self._store_phase_summary("preflight")

        # === PHASE 5: SENIOR REVIEW ===
        result = await run_phase("senior_review", phase_executor.phase_senior_review)
        results.append(result)
        if not result.success:
            print_status("Scope review failed", "error")
            task_logger.end_phase(
                LogPhase.PLANNING, success=False, message="Scope review failed"
            )
            return False
        await self._store_phase_summary("senior_review")

        # === PHASE 6: AI COMPLEXITY ASSESSMENT ===
        result = await run_phase(
            "complexity_assessment",
            lambda: self._phase_complexity_assessment_with_requirements(),
        )
        results.append(result)
        if not result.success:
            print_status("Complexity assessment failed", "error")
            task_logger.end_phase(
                LogPhase.PLANNING, success=False, message="Complexity assessment failed"
            )
            return False

        task_intake = self._ensure_task_intake()
        task_type = (task_intake or {}).get("task_type", "code")
        os.environ[SPEC_DIR_ENV_VAR] = str(self.spec_dir)
        os.environ[TASK_TYPE_ENV_VAR] = str(task_type)
        os.environ[NOISE_PROFILE_ENV_VAR] = str(
            (task_intake or {}).get("noise_profile", "medium")
        )

        # Map of all available phases
        all_phases = {
            "historical_context": phase_executor.phase_historical_context,
            "research": phase_executor.phase_research,
            "context": phase_executor.phase_context,
            "spec_writing": phase_executor.phase_spec_writing,
            "self_critique": phase_executor.phase_self_critique,
            "planning": phase_executor.phase_planning,
            "validation": phase_executor.phase_validation,
            "quick_spec": phase_executor.phase_quick_spec,
        }

        if task_type != "code":
            phases_executed = [
                "discovery",
                "requirements",
                "preflight",
                "senior_review",
                "complexity_assessment",
            ]
            return await self._run_noncode_pipeline(
                phase_executor,
                run_phase,
                results,
                phases_executed,
                auto_approve,
                task_logger,
            )

        # Get remaining phases to run based on complexity
        all_phases_to_run = self.assessment.phases_to_run()
        phases_to_run = [
            p
            for p in all_phases_to_run
            if p
            not in [
                "discovery",
                "requirements",
                "preflight",
                "senior_review",
            ]
        ]

        print()
        print(
            f"  Running {highlight(self.assessment.complexity.value.upper())} workflow"
        )
        print(f"  {muted('Remaining phases:')} {', '.join(phases_to_run)}")
        print()

        phases_executed = [
            "discovery",
            "requirements",
            "preflight",
            "senior_review",
            "complexity_assessment",
        ]
        for phase_name in phases_to_run:
            if phase_name not in all_phases:
                print_status(f"Unknown phase: {phase_name}, skipping", "warning")
                continue

            result = await run_phase(phase_name, all_phases[phase_name])
            results.append(result)
            phases_executed.append(phase_name)

            # Store summary for subsequent phases (compaction)
            if result.success:
                await self._store_phase_summary(phase_name)

            if not result.success:
                print()
                print_status(
                    f"Phase '{phase_name}' failed after {result.retries} retries",
                    "error",
                )
                print(f"  {muted('Errors:')}")
                for err in result.errors:
                    print(f"    {icon(Icons.ARROW_RIGHT)} {err}")
                print()
                print_status(
                    "Spec creation incomplete. Fix errors and retry.", "warning"
                )
                task_logger.log(
                    f"Phase '{phase_name}' failed: {'; '.join(result.errors)}",
                    LogEntryType.ERROR,
                )
                task_logger.end_phase(
                    LogPhase.PLANNING,
                    success=False,
                    message=f"Phase {phase_name} failed",
                )
                return False

        # Summary
        self._print_completion_summary(results, phases_executed)

        # End planning phase successfully
        task_logger.end_phase(
            LogPhase.PLANNING, success=True, message="Spec creation complete"
        )

        # === HUMAN REVIEW CHECKPOINT ===
        return self._run_review_checkpoint(auto_approve)

    async def _create_linear_task_if_enabled(self) -> None:
        """Create a Linear task if Linear integration is enabled."""
        from linear_updater import create_linear_task, is_linear_enabled

        if not is_linear_enabled():
            return

        print_status("Creating Linear task...", "progress")
        linear_state = await create_linear_task(
            spec_dir=self.spec_dir,
            title=self.task_description or self.spec_dir.name,
            description=f"Auto-build spec: {self.spec_dir.name}",
        )
        if linear_state:
            print_status(f"Linear task created: {linear_state.task_id}", "success")
        else:
            print_status("Linear task creation failed (continuing without)", "warning")

    async def _phase_complexity_assessment_with_requirements(
        self,
    ) -> phases.PhaseResult:
        """Assess complexity after requirements are gathered (with full context).

        Returns:
            The phase result
        """
        task_logger = get_task_logger(self.spec_dir)
        assessment_file = self.spec_dir / "complexity_assessment.json"
        requirements_file = self.spec_dir / "requirements.json"

        # Load requirements for full context
        requirements_context = self._load_requirements_context(requirements_file)

        if self.complexity_override:
            # Manual override
            self.assessment = self._create_override_assessment()
        elif self.use_ai_assessment:
            # Run AI assessment
            self.assessment = await self._run_ai_assessment(task_logger)
        else:
            # Use heuristic assessment
            self.assessment = self._heuristic_assessment()
            self._print_assessment_info()

        # Show what phases will run
        self._print_phases_to_run()

        # Save assessment
        if not assessment_file.exists():
            complexity.save_assessment(self.spec_dir, self.assessment)

        return phases.PhaseResult(
            "complexity_assessment", True, [str(assessment_file)], [], 0
        )

    def _load_requirements_context(self, requirements_file: Path) -> str:
        """Load requirements context from file.

        Args:
            requirements_file: Path to the requirements file

        Returns:
            Formatted requirements context string
        """
        if not requirements_file.exists():
            return ""

        with open(requirements_file) as f:
            req = json.load(f)
            self.task_description = req.get("task_description", self.task_description)
            return f"""
**Task Description**: {req.get("task_description", "Not provided")}
**Workflow Type**: {req.get("workflow_type", "Not specified")}
**Services Involved**: {", ".join(req.get("services_involved", []))}
**User Requirements**:
{chr(10).join(f"- {r}" for r in req.get("user_requirements", []))}
**Acceptance Criteria**:
{chr(10).join(f"- {c}" for c in req.get("acceptance_criteria", []))}
**Constraints**:
{chr(10).join(f"- {c}" for c in req.get("constraints", []))}
"""

    def _create_override_assessment(self) -> complexity.ComplexityAssessment:
        """Create a complexity assessment from manual override.

        Returns:
            The complexity assessment
        """
        comp = complexity.Complexity(self.complexity_override)
        assessment = complexity.ComplexityAssessment(
            complexity=comp,
            confidence=1.0,
            reasoning=f"Manual override: {self.complexity_override}",
        )
        print_status(f"Complexity override: {comp.value.upper()}", "success")
        return assessment

    async def _run_ai_assessment(self, task_logger) -> complexity.ComplexityAssessment:
        """Run AI-based complexity assessment.

        Args:
            task_logger: The task logger instance

        Returns:
            The complexity assessment
        """
        print_status("Running AI complexity assessment...", "progress")
        task_logger.log(
            "Analyzing task complexity with AI...",
            LogEntryType.INFO,
            LogPhase.PLANNING,
        )
        assessment = await complexity.run_ai_complexity_assessment(
            self.spec_dir,
            self.task_description,
            self._run_agent,
        )

        if assessment:
            self._print_assessment_info(assessment)
            return assessment
        else:
            # Fall back to heuristic assessment
            print_status(
                "AI assessment failed, falling back to heuristics...", "warning"
            )
            return self._heuristic_assessment()

    def _print_assessment_info(
        self, assessment: complexity.ComplexityAssessment | None = None
    ) -> None:
        """Print complexity assessment information.

        Args:
            assessment: The assessment to print (defaults to self.assessment)
        """
        if assessment is None:
            assessment = self.assessment

        print_status(
            f"AI assessed complexity: {highlight(assessment.complexity.value.upper())}",
            "success",
        )
        print_key_value("Confidence", f"{assessment.confidence:.0%}")
        print_key_value("Reasoning", assessment.reasoning)

        if assessment.needs_research:
            print(f"  {muted(icon(Icons.ARROW_RIGHT) + ' Research phase enabled')}")
        if assessment.needs_self_critique:
            print(
                f"  {muted(icon(Icons.ARROW_RIGHT) + ' Self-critique phase enabled')}"
            )

    def _print_phases_to_run(self) -> None:
        """Print the list of phases that will be executed."""
        phase_list = self.assessment.phases_to_run()
        print()
        print(f"  Phases to run ({highlight(str(len(phase_list)))}):")
        for i, phase in enumerate(phase_list, 1):
            print(f"    {i}. {phase}")

    def _heuristic_assessment(self) -> complexity.ComplexityAssessment:
        """Fall back to heuristic-based complexity assessment.

        Returns:
            The complexity assessment
        """
        project_index = {}
        auto_build_index = self.project_dir / ".auto-iflow" / "project_index.json"
        if auto_build_index.exists():
            with open(auto_build_index) as f:
                project_index = json.load(f)

        analyzer = complexity.ComplexityAnalyzer(project_index)
        return analyzer.analyze(self.task_description or "")

    def _print_completion_summary(
        self, results: list[phases.PhaseResult], phases_executed: list[str]
    ) -> None:
        """Print the completion summary.

        Args:
            results: List of phase results
            phases_executed: List of executed phase names
        """
        files_created = []
        for r in results:
            for f in r.output_files:
                files_created.append(Path(f).name)

        print(
            box(
                f"Complexity: {self.assessment.complexity.value.upper()}\n"
                f"Phases run: {len(phases_executed) + 1}\n"
                f"Spec saved to: {self.spec_dir}\n\n"
                f"Files created:\n"
                + "\n".join(f"  {icon(Icons.SUCCESS)} {f}" for f in files_created),
                title=f"{icon(Icons.SUCCESS)} SPEC CREATION COMPLETE",
                style="heavy",
            )
        )

    def _run_review_checkpoint(self, auto_approve: bool) -> bool:
        """Run the human review checkpoint.

        Args:
            auto_approve: Whether to auto-approve without human review

        Returns:
            True if approved, False otherwise
        """
        print()
        print_section("HUMAN REVIEW CHECKPOINT", Icons.SEARCH)

        try:
            review_state = run_review_checkpoint(
                spec_dir=self.spec_dir,
                auto_approve=auto_approve,
            )

            if not review_state.is_approved():
                print()
                print_status("Build will not proceed without approval.", "warning")
                return False

        except SystemExit as e:
            if e.code != 0:
                return False
            return False
        except KeyboardInterrupt:
            print()
            print_status("Review interrupted. Run again to continue.", "info")
            return False

        return True

    # Backward compatibility methods for tests
    def _generate_spec_name(self, task_description: str) -> str:
        """Generate a spec name from task description (backward compatibility).

        This method is kept for backward compatibility with existing tests.
        The functionality has been moved to models.generate_spec_name.

        Args:
            task_description: The task description

        Returns:
            Generated spec name
        """
        from .models import generate_spec_name

        return generate_spec_name(task_description)

    def _rename_spec_dir_from_requirements(self) -> bool:
        """Rename spec directory from requirements (backward compatibility).

        This method is kept for backward compatibility with existing tests.
        The functionality has been moved to models.rename_spec_dir_from_requirements.

        Returns:
            True if successful or not needed, False on error
        """
        result = rename_spec_dir_from_requirements(self.spec_dir)
        # Update self.spec_dir if it was renamed
        if result and self.spec_dir.name.endswith("-pending"):
            # Find the renamed directory
            parent = self.spec_dir.parent
            prefix = self.spec_dir.name[:4]  # e.g., "001-"
            for candidate in parent.iterdir():
                if (
                    candidate.name.startswith(prefix)
                    and "pending" not in candidate.name
                ):
                    self.spec_dir = candidate
                    break
        return result

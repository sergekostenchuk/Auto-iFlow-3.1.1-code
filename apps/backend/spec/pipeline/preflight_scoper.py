"""
Preflight Scoper
================

Generates task_intake.json for routing, noise control, and proof gating.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from init import resolve_auto_build_dir

from .. import complexity as spec_complexity
from .. import requirements

TASK_TYPE_VALUES = ("code", "analysis", "plan", "audit", "content")

_TASK_TYPE_KEYWORDS = {
    "analysis": ["analysis", "analyze", "investigate", "root cause", "diagnose"],
    "audit": ["audit", "compliance", "security review", "risk review"],
    "plan": ["plan", "roadmap", "strategy", "proposal", "design doc"],
    "content": ["docs", "documentation", "readme", "changelog", "write"],
}

_HIGH_RISK_KEYWORDS = [
    "auth",
    "oauth",
    "payment",
    "payments",
    "pii",
    "personal data",
    "credit card",
    "token",
    "crypto",
    "security",
]

_IPC_MARKERS = ("ipcRenderer.invoke(", "ipcMain.handle(")
_PROMPT_RUNTIME_PREFIXES = (
    "apps/backend/prompts/",
    "apps/backend/prompts_pkg/",
)
_RUNTIME_CONFIG_NAMES = {
    "pytest.ini",
    "pyproject.toml",
    "package.json",
    "dockerfile",
}
_RUNTIME_CONFIG_PREFIXES = (
    ".env",
    "vite.config.",
    "electron-builder.",
)
_RUNTIME_CONFIG_PATHS = (".github/workflows/",)
_DOC_PREFIXES = ("new-plans/",)


def load_task_intake(spec_dir: Path) -> dict | None:
    intake_path = spec_dir / "task_intake.json"
    if not intake_path.exists():
        return None
    try:
        with intake_path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def write_task_intake(spec_dir: Path, intake: dict) -> Path:
    intake_path = spec_dir / "task_intake.json"
    with intake_path.open("w", encoding="utf-8") as handle:
        json.dump(intake, handle, indent=2)
    return intake_path


def determine_pipeline(task_intake: dict) -> str:
    task_type = (task_intake or {}).get("task_type", "code")
    return "non-code" if task_type != "code" else "code"


def _load_project_index(project_dir: Path) -> dict:
    index_path = resolve_auto_build_dir(project_dir) / "project_index.json"
    if not index_path.exists():
        return {}
    try:
        with index_path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _load_scope_contract(spec_dir: Path) -> dict:
    scope_path = spec_dir / "scope_contract.json"
    if not scope_path.exists():
        return {}
    try:
        with scope_path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _load_requirements_intake(requirements_data: dict | None) -> dict | None:
    if not isinstance(requirements_data, dict):
        return None
    intake = requirements_data.get("intake")
    return intake if isinstance(intake, dict) else None


def _render_intake_report(intake: dict) -> str:
    timestamp = datetime.utcnow().isoformat() + "Z"
    lines = [
        "# Intake Report",
        "",
        f"- Generated: {timestamp}",
        f"- Clarity: {intake.get('clarity_level', 'unknown')}",
        f"- Model: {intake.get('intake_model', 'unknown')}",
        "",
    ]
    suggested_title = intake.get("suggested_title")
    if suggested_title:
        lines.append(f"## Suggested Title\n\n{suggested_title}\n")
    risks = intake.get("risks") or []
    if risks:
        lines.append("## Risks")
        lines.extend([f"- {risk}" for risk in risks])
        lines.append("")
    assumptions = intake.get("assumptions") or []
    if assumptions:
        lines.append("## Assumptions")
        lines.extend([f"- {assumption}" for assumption in assumptions])
        lines.append("")
    notes = intake.get("notes")
    if notes:
        lines.append("## Notes\n")
        lines.append(str(notes))
        lines.append("")
    questions = intake.get("clarifying_questions") or []
    if questions:
        lines.append("## Clarifying Questions")
        for question in questions:
            if isinstance(question, dict):
                lines.append(f"- {question.get('question', '').strip()}")
            else:
                lines.append(f"- {str(question).strip()}")
        lines.append("")
    return "\n".join(lines).strip() + "\n"


def _write_versioned_intake_report(spec_dir: Path, intake: dict) -> None:
    report_path = spec_dir / "intake_report.md"
    if report_path.exists():
        existing = list(spec_dir.glob("intake_report.v*.md"))
        versions = []
        for candidate in existing:
            try:
                suffix = candidate.stem.split(".v")[-1]
                versions.append(int(suffix))
            except (ValueError, IndexError):
                continue
        next_version = max(versions, default=0) + 1
        report_path.rename(spec_dir / f"intake_report.v{next_version}.md")
    report_path.write_text(_render_intake_report(intake), encoding="utf-8")


def _infer_task_type(task_description: str, workflow_type: str | None) -> str:
    workflow = (workflow_type or "").lower().strip()
    if workflow in ("docs", "documentation"):
        return "content"
    if workflow in ("audit", "analysis"):
        return "analysis"
    if workflow in ("plan", "planning"):
        return "plan"

    description = task_description.lower()
    for task_type, keywords in _TASK_TYPE_KEYWORDS.items():
        if any(keyword in description for keyword in keywords):
            return task_type
    return "code"


def _infer_risk(task_description: str) -> str:
    description = task_description.lower()
    if any(keyword in description for keyword in _HIGH_RISK_KEYWORDS):
        return "high"
    return "low"


def _infer_acceptance(task_description: str, scope_contract: dict) -> list[str]:
    acceptance = scope_contract.get("acceptance")
    if isinstance(acceptance, list) and acceptance:
        return [str(item) for item in acceptance if str(item).strip()]
    if task_description:
        return [f"Deliver: {task_description.strip()}"]
    return []


def _normalize_path(path: str) -> str:
    return path.replace("\\", "/").lstrip("./")


def _is_concrete_file(path: str) -> bool:
    if not path:
        return False
    normalized = _normalize_path(path)
    if normalized.endswith("/"):
        return False
    if any(token in normalized for token in ("*", "?", "[")):
        return False
    return True


def _is_prompt_runtime(normalized: str) -> bool:
    return normalized.startswith(_PROMPT_RUNTIME_PREFIXES)


def _is_doc_file(normalized: str) -> bool:
    name = Path(normalized).name
    if normalized.startswith(_DOC_PREFIXES):
        return True
    if name.startswith("CODEX-") and name.lower().endswith(".md"):
        return True
    if normalized.lower().endswith(".md") and not _is_prompt_runtime(normalized):
        return True
    return False


def _is_runtime_config(normalized: str) -> bool:
    name = Path(normalized).name
    if name.lower() in _RUNTIME_CONFIG_NAMES:
        return True
    if any(name.startswith(prefix) for prefix in _RUNTIME_CONFIG_PREFIXES):
        return True
    if any(segment in normalized for segment in _RUNTIME_CONFIG_PATHS):
        return True
    return False


def _file_has_ipc_marker(project_dir: Path, file_path: str) -> bool:
    normalized = _normalize_path(file_path)
    if "apps/frontend/src/main/ipc-handlers/" in normalized:
        return True
    try:
        target = project_dir / normalized
        if not target.exists() or not target.is_file():
            return False
        content = target.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return False
    return any(marker in content for marker in _IPC_MARKERS)


def _get_tests_for_file(
    project_dir: Path, file_path: str, *, has_ipc_change: bool
) -> list[str]:
    normalized = _normalize_path(file_path)
    normalized_lower = normalized.lower()

    if _is_prompt_runtime(normalized_lower):
        return ["PYTEST_PIPELINE", "PYTEST_PROMPTS"]

    if _is_doc_file(normalized_lower):
        return []

    if _is_runtime_config(normalized_lower):
        smoke_script = project_dir / "scripts" / "smoke-build.sh"
        if "dockerfile" in normalized_lower or ".github/workflows/" in normalized_lower:
            if smoke_script.exists():
                return ["scripts/smoke-build.sh"]
        return ["PYTEST_COLLECT"]

    if normalized_lower.startswith("apps/backend/"):
        matches = []
        if "apps/backend/security/" in normalized_lower:
            matches.append("PYTEST_SECURITY")
        if "apps/backend/spec/pipeline/" in normalized_lower:
            matches.extend(["PYTEST_PIPELINE", "PYTEST_ROUTING"])
        if "apps/backend/qa/" in normalized_lower:
            matches.append("PYTEST_PROOF_GATE")
        if "apps/backend/ipc/" in normalized_lower:
            matches.extend(["PYTEST_PIPELINE", "NPM_TEST"])
        if "apps/backend/agents/" in normalized_lower:
            matches.append("PYTEST_PIPELINE")
        if "apps/backend/prompts_pkg/" in normalized_lower:
            matches.append("PYTEST_PIPELINE")
        if matches:
            return matches
        return ["PYTEST_PIPELINE"]

    if normalized_lower.startswith("apps/frontend/"):
        tests = ["NPM_TEST"]
        if has_ipc_change:
            tests.append("PYTEST_PIPELINE")
        return tests

    if normalized_lower.startswith("apps/shared/"):
        return ["NPM_TEST", "PYTEST_PIPELINE"]

    if "/types/" in normalized_lower or normalized_lower.endswith(".d.ts"):
        return ["NPM_TEST", "PYTEST_PIPELINE"]

    return []


def _apply_priority_filter(tests: list[str], max_count: int) -> list[str]:
    priorities = [
        "PYTEST_SECURITY",
        "PYTEST_PIPELINE",
        "PYTEST_PROOF_GATE",
        "NPM_TEST",
        "PYTEST_COLLECT",
    ]
    rank = {alias: index for index, alias in enumerate(priorities)}
    indexed = list(enumerate(tests))
    indexed.sort(key=lambda item: (rank.get(item[1], len(rank)), item[0]))
    return [alias for _, alias in indexed[:max_count]]


def _apply_smart_cap(tests: list[str], files_to_modify: list[str], max_count: int) -> list[str]:
    if max_count <= 0 or len(tests) <= max_count:
        return tests
    if not files_to_modify:
        return _apply_priority_filter(tests, max_count)

    direct = []
    for alias in tests:
        if alias in ("PYTEST_SECURITY", "PYTEST_PROOF_GATE", "PYTEST_PIPELINE"):
            direct.append(alias)

    direct_set = set(direct)
    indirect = [alias for alias in tests if alias not in direct_set]

    remaining = max(0, max_count - len(direct))
    if remaining > 0 and indirect:
        indirect = _apply_priority_filter(indirect, remaining)
    else:
        indirect = []

    return direct + indirect


def _determine_tests_to_run(
    task_type: str,
    files_to_modify: list[str],
    project_dir: Path,
    clarifying_questions: list[str],
) -> list[str]:
    if task_type != "code":
        return []
    if not files_to_modify:
        if "Какие файлы будут изменены?" not in clarifying_questions:
            clarifying_questions.append("Какие файлы будут изменены?")
        return []

    tests: list[str] = []
    tests_seen: set[str] = set()
    has_ipc_change = any(
        _file_has_ipc_marker(project_dir, path) for path in files_to_modify
    )

    for file_path in files_to_modify:
        for alias in _get_tests_for_file(
            project_dir, file_path, has_ipc_change=has_ipc_change
        ):
            if alias not in tests_seen:
                tests.append(alias)
                tests_seen.add(alias)

    if len(tests) > 2:
        tests = _apply_smart_cap(tests, files_to_modify, max_count=2)

    return tests


def _resolve_files_to_modify(
    task_type: str,
    requirements_data: dict,
    scope_contract: dict,
    clarifying_questions: list[str],
) -> tuple[list[str], str, bool]:
    explicit = requirements_data.get("files_to_modify")
    if isinstance(explicit, list) and explicit:
        return explicit, "requirements.json", False

    if task_type != "code":
        return [], "none", False

    candidate_files = scope_contract.get("candidate_files")
    if not isinstance(candidate_files, list):
        candidate_files = []

    concrete = [path for path in candidate_files if _is_concrete_file(path)]
    if 0 < len(concrete) <= 2:
        clarifying_questions.append(
            "Подтверди список файлов для изменения: "
            + ", ".join(concrete)
        )
        return concrete, "scope_contract", True

    if candidate_files:
        clarifying_questions.append(
            "Уточни конкретные файлы для изменения (candidate_files слишком общий)."
        )
    else:
        clarifying_questions.append("Какие файлы будут изменены?")

    return [], "missing", True


def _build_acceptance_map(acceptance: list[str], output_files: list[str]) -> list[dict]:
    mapped_file = output_files[0] if len(output_files) == 1 else ""
    return [
        {"criterion": criterion, "file": mapped_file}
        for criterion in acceptance
        if criterion
    ]


def _determine_noise_profile(task_type: str, complexity_level: str) -> str:
    if task_type != "code":
        return "low"
    if complexity_level == "simple":
        return "low"
    if complexity_level == "medium":
        return "medium"
    return "high"


def _calculate_complexity(
    project_dir: Path, task_description: str, requirements_data: dict | None
) -> tuple[str, int]:
    analyzer = spec_complexity.ComplexityAnalyzer(_load_project_index(project_dir))
    assessment = analyzer.analyze(task_description, requirements_data)
    if assessment.complexity == spec_complexity.Complexity.SIMPLE:
        level = "simple"
    elif assessment.complexity == spec_complexity.Complexity.STANDARD:
        level = "medium"
    else:
        level = "complex"

    score = 0
    if assessment.estimated_files <= 2:
        score += 1
    elif assessment.estimated_files <= 6:
        score += 2
    else:
        score += 3
    if assessment.estimated_services > 1:
        score += 1
    if assessment.external_integrations:
        score += 2
    if assessment.infrastructure_changes:
        score += 2
    return level, score


def run_preflight_scoper(
    *,
    spec_dir: Path,
    project_dir: Path,
    task_description: str | None,
) -> dict:
    """Create task_intake.json based on task description and requirements."""
    requirements_data = requirements.load_requirements(spec_dir) or {}
    requirements_intake = _load_requirements_intake(requirements_data)
    scope_contract = _load_scope_contract(spec_dir)

    task_desc = task_description or requirements_data.get("task_description", "")
    workflow_type = requirements_data.get("workflow_type")

    task_type = _infer_task_type(task_desc, workflow_type)
    risk = _infer_risk(task_desc)
    complexity_level, complexity_score = _calculate_complexity(
        project_dir, task_desc, requirements_data
    )
    noise_profile = _determine_noise_profile(task_type, complexity_level)

    clarifying_questions = []
    if task_type not in TASK_TYPE_VALUES:
        clarifying_questions.append(
            "Clarify task_type (code | analysis | plan | audit | content)."
        )

    acceptance = _infer_acceptance(task_desc, scope_contract)
    if not acceptance:
        clarifying_questions.append("Provide explicit acceptance criteria.")

    input_files = requirements_data.get("input_files")
    if not isinstance(input_files, list):
        input_files = []

    output_files = scope_contract.get("candidate_files")
    if not isinstance(output_files, list):
        output_files = []

    files_to_modify, files_source, files_inferred = _resolve_files_to_modify(
        task_type, requirements_data, scope_contract, clarifying_questions
    )

    acceptance_map = _build_acceptance_map(acceptance, output_files)

    tests_to_run = _determine_tests_to_run(
        task_type, files_to_modify, project_dir, clarifying_questions
    )

    ralph_loop = task_type == "code" and noise_profile == "high"

    intake = {
        "task_type": task_type,
        "complexity": complexity_level,
        "complexity_score": complexity_score,
        "risk": risk,
        "noise_profile": noise_profile,
        "input_files": input_files,
        "output_files": output_files,
        "files_to_modify": files_to_modify,
        "files_to_modify_source": files_source,
        "files_to_modify_inferred": files_inferred,
        "tests_to_run": tests_to_run,
        "acceptance_map": acceptance_map,
        "clarifying_questions": clarifying_questions,
        "ralphLoop": ralph_loop,
        "ralphLoopMax": 3,
    }

    if requirements_intake:
        intake["intake_result"] = requirements_intake
        _write_versioned_intake_report(spec_dir, requirements_intake)

    write_task_intake(spec_dir, intake)
    return intake

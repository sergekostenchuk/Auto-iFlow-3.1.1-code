"""
Consilium Orchestrator: The Multi-Agent Council
===============================================

Orchestrates the "Council" interaction for product discovery.
Manages the lifecycle of the 3-Persona Interview:
Innovator -> Realist -> Facilitator.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Callable, Dict, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from iflow_sdk import IFlowClient

try:
    from iflow_sdk import TaskFinishMessage
except ImportError:  # pragma: no cover - optional in older SDKs
    TaskFinishMessage = None

from core.iflow_client import create_iflow_client
from phase_config import resolve_model

from .consilium_prompts import (
    FACILITATOR_PROMPT,
    FINAL_SYNTHESIS_PROMPT,
    INNOVATOR_PROMPT,
    REALIST_PROMPT,
    SEARCH_PROMPT,
)

logger = logging.getLogger(__name__)

class InterviewStep(Enum):
    INIT = "init"
    WHAT = "ЧТО? (Product Definition)"
    WHY = "ЗАЧЕМ? (Pain Points)"
    WHERE = "ГДЕ? (Market/Geo)"
    WHEN = "КОГДА? (Timeline)"
    METRICS = "ОЖИДАНИЯ? (Metrics)"
    WHO = "КТО? (Target Audience)"
    JOURNEY = "ПУТЬ? (User Journey)"
    VALUE = "ВЫГОДА? (Value Prop)"
    SYNTHESIS = "SYNTHESIS"

STEPS_ORDER = [
    InterviewStep.WHAT,
    InterviewStep.WHY,
    InterviewStep.WHERE,
    InterviewStep.WHEN,
    InterviewStep.METRICS,
    InterviewStep.WHO,
    InterviewStep.JOURNEY,
    InterviewStep.VALUE
]

@dataclass
class StepRecord:
    step: InterviewStep
    user_input: str
    research: str
    innovator: str
    realist: str
    facilitator: str

STEP_RESEARCH_HINTS: Dict[InterviewStep, str] = {
    InterviewStep.WHAT: "Конкуренты, альтернативы, позиционирование, уникальные отличия.",
    InterviewStep.WHY: "Боли и проблемы аудитории, подтвержденные статистикой и примерами.",
    InterviewStep.WHERE: "Географии рынка, объемы и тренды по регионам.",
    InterviewStep.WHEN: "Сроки разработки аналогов, time-to-market, частота запусков.",
    InterviewStep.METRICS: "Бенчмарки CAC/LTV/Retention, конверсии, unit-экономика.",
    InterviewStep.WHO: "Целевая аудитория, демография, сегменты и персоны.",
    InterviewStep.JOURNEY: "Путь пользователя, UX-паттерны у конкурентов.",
    InterviewStep.VALUE: "Ценообразование, монетизация, value prop.",
}

class ConsiliumOrchestrator:
    def __init__(
        self,
        workspace_dir: str,
        session_id: str,
        debug: bool = False,
        permission_mode: str = "auto",
        project_name: Optional[str] = None,
        project_dir: Optional[str] = None,
    ):
        self.workspace_dir = workspace_dir
        self.session_id = session_id
        self.debug = debug
        self.permission_mode = permission_mode
        self.client: Optional[IFlowClient] = None
        self.innovator_client: Optional[IFlowClient] = None
        self.realist_client: Optional[IFlowClient] = None
        self._on_output: Optional[Callable[[str], None]] = None
        self._task_finish_class = TaskFinishMessage

        self.project_name = project_name or "Новая идея"
        self.project_dir = Path(project_dir) if project_dir else Path(workspace_dir)
        self.docs_dir = self.project_dir / ".iflow" / "docs"
        self.concept_path = self.docs_dir / "concept.md"
        
        # State
        self.current_step_idx = 0
        self.concept_draft = ""
        self.idea_seed = ""
        self.step_records: Dict[InterviewStep, StepRecord] = {}
        self.search_summaries: Dict[InterviewStep, str] = {}
        self.user_answers: Dict[InterviewStep, str] = {}
        self.final_summary = ""

    def set_output_handler(self, handler: Callable[[str], None]):
        self._on_output = handler

    def _emit(self, text: str):
        if self._on_output:
            self._on_output(text)
        print(text, end='', flush=True)

    async def start(self):
        """Starts the Consilium session."""
        self._emit(f"\n{'='*60}\n")
        self._emit("  🚀 CONSILIUM: СОВЕТ ДИРЕКТОРОВ (v2.0)\n")
        self._emit(f"{'='*60}\n\n")
        self._emit("Загрузка персон:\n")
        self._emit("  • 🚀 Innovator (Креатор)\n")
        self._emit("  • ⚠️ Realist (Критик)\n")
        self._emit("  • 📊 Facilitator (Аналитик)\n\n")
        self._emit(f"Проект: {self.project_name}\n")
        self._emit(f"Папка проекта: {self.project_dir}\n")
        self._emit(f"Артефакт: {self.concept_path}\n\n")

        self.docs_dir.mkdir(parents=True, exist_ok=True)
        
        innovator_model, _, _ = resolve_model(
            feature="consilium",
            role="innovator",
            project_dir=self.project_dir,
            auto_build_path=".auto-iflow",
        )
        realist_model, _, _ = resolve_model(
            feature="consilium",
            role="realist",
            project_dir=self.project_dir,
            auto_build_path=".auto-iflow",
        )
        facilitator_model, _, _ = resolve_model(
            feature="consilium",
            role="facilitator",
            project_dir=self.project_dir,
            auto_build_path=".auto-iflow",
        )

        log_level = "DEBUG" if self.debug else "INFO"
        workspace_path = Path(self.workspace_dir)

        self.client = create_iflow_client(
            workspace_path,
            facilitator_model,
            permission_mode=self.permission_mode,
            log_level=log_level,
        )
        self.innovator_client = create_iflow_client(
            workspace_path,
            innovator_model,
            permission_mode=self.permission_mode,
            log_level=log_level,
        )
        self.realist_client = create_iflow_client(
            workspace_path,
            realist_model,
            permission_mode=self.permission_mode,
            log_level=log_level,
        )
        try:
            await asyncio.gather(
                self.client.connect(),
                self.innovator_client.connect(),
                self.realist_client.connect(),
            )
            self._emit("✓ Готов к работе. Начинаем интервью.\n\n")
        except Exception as e:
            self._emit(f"✗ Ошибка подключения: {e}\n")
            raise

    async def stop(self):
        clients = [self.client, self.innovator_client, self.realist_client]
        for client in clients:
            if client:
                await client.disconnect()

    async def run_task(self, initial_input: str) -> str:
        """Starts the Interview Process."""
        if not self.client:
            raise RuntimeError("Not connected")

        self.current_step_idx = 0
        self.idea_seed = initial_input.strip()
        self.step_records = {}
        self.search_summaries = {}
        self.user_answers = {}
        self.final_summary = ""
        current_step = STEPS_ORDER[self.current_step_idx]
        
        self._emit(f"\n🌀 Этап 1/8: {current_step.value}\n")
        self._emit(f"📝 Тема: {initial_input}\n\n")
        
        return await self._run_council_cycle(initial_input, current_step)

    async def continue_dialog(self, user_input: str) -> str:
        """Proceeds to the next step or refines current one."""
        # Move to next step
        self.current_step_idx += 1
        
        if self.current_step_idx >= len(STEPS_ORDER):
            return await self._finalize_concept()
            
        current_step = STEPS_ORDER[self.current_step_idx]
        
        self._emit(f"\n\n{'='*40}\n")
        self._emit(f"🌀 Этап {self.current_step_idx + 1}/8: {current_step.value}\n")
        self._emit(f"{'='*40}\n\n")
        
        return await self._run_council_cycle(user_input, current_step)

    async def _run_council_cycle(self, user_input: str, step: InterviewStep) -> str:
        """Runs the 3-Persona Cycle for a given step."""
        if not self.client or not self.innovator_client or not self.realist_client:
            raise RuntimeError("Not connected")

        normalized_input = user_input.strip()
        self.user_answers[step] = normalized_input

        context_summary = self._format_context(step)
        search_hint = STEP_RESEARCH_HINTS.get(step, "")

        self._emit("🔎 iFlow Search: собираю контекст...\n")
        search_summary = await self._run_search(step, normalized_input, context_summary, search_hint)
        self.search_summaries[step] = search_summary

        if search_summary:
            self._emit("\n🔎 Краткий обзор поиска:\n")
            self._emit(self._truncate(search_summary, 900) + "\n\n")

        search_context = self._truncate(search_summary, 1500)

        self._emit("🚀 Креатор генерирует идеи...\n")
        innovator_prompt = f"""
{INNOVATOR_PROMPT}

ТЕКУЩИЙ ЭТАП: {step.value}
КОНТЕКСТ ИНТЕРВЬЮ:
{context_summary}

ОБЗОР ПОИСКА:
{search_context}

ВВОДНЫЕ ОТ ПОЛЬЗОВАТЕЛЯ: "{normalized_input}"

Предложи смелое видение именно для этого этапа.
"""

        self._emit("\n⚠️ Реалист ищет риски...\n")
        realist_prompt = f"""
{REALIST_PROMPT}

ТЕКУЩИЙ ЭТАП: {step.value}
КОНТЕКСТ ИНТЕРВЬЮ:
{context_summary}

ОБЗОР ПОИСКА:
{search_context}

ВВОДНЫЕ ОТ ПОЛЬЗОВАТЕЛЯ: "{normalized_input}"

Разнеси идею. Найди слабые места и рынки, где это не полетит.
"""

        innovator_task = asyncio.create_task(
            self._send_request(innovator_prompt, client=self.innovator_client)
        )
        realist_task = asyncio.create_task(
            self._send_request(realist_prompt, client=self.realist_client)
        )
        innovator_response, realist_response = await asyncio.gather(
            innovator_task,
            realist_task,
        )

        self._emit("\n📊 Аналитик синтезирует решение...\n")
        facilitator_prompt = f"""
{FACILITATOR_PROMPT}

ТЕКУЩИЙ ЭТАП: {step.value}
КОНТЕКСТ ИНТЕРВЬЮ:
{context_summary}

ОБЗОР ПОИСКА:
{search_context}

МНЕНИЕ КРЕАТОРА:
{innovator_response}

МНЕНИЕ РЕАЛИСТА:
{realist_response}

Твоя задача:
1. Синтезируй оба мнения.
2. Обратись к пользователю.
3. Задай вопрос для следующего этапа (или заверши, если это последний).
"""
        facilitator_response = await self._send_request(
            facilitator_prompt,
            stream=True,
            client=self.client,
        )

        self.step_records[step] = StepRecord(
            step=step,
            user_input=normalized_input,
            research=search_summary,
            innovator=innovator_response,
            realist=realist_response,
            facilitator=facilitator_response,
        )

        self._emit("\n[CONSILIUM_WAITING_FOR_USER]\n")
        return facilitator_response

    async def _finalize_concept(self) -> str:
        """Final synthesis step."""
        self._emit("\n✅ Интервью завершено. Формирую концепцию...\n")
        self.final_summary = await self._build_final_summary()

        concept_text = self._render_concept()
        self.concept_path.write_text(concept_text, encoding="utf-8")

        final_msg = f"Спасибо! Концепция сохранена: {self.concept_path}"
        self._emit(final_msg + "\n")
        return final_msg

    async def _send_request(
        self,
        prompt: str,
        stream: bool = False,
        client: Optional[IFlowClient] = None,
    ) -> str:
        """Helper to send prompt and get response."""
        active_client = client or self.client
        if not active_client:
            raise RuntimeError("Client not connected")

        await active_client.send_message(prompt)

        response_text = ""
        async for msg in active_client.receive_messages():
            text = ""
            if hasattr(msg, "text") and msg.text:
                text = msg.text
            elif hasattr(msg, "chunk") and msg.chunk:
                text = msg.chunk.text if hasattr(msg.chunk, "text") else str(msg.chunk)

            response_text += text
            if stream and text:
                self._emit(text)

            if self._is_finish_message(msg):
                break

        return response_text

    def _is_finish_message(self, msg: object) -> bool:
        if self._task_finish_class and isinstance(msg, self._task_finish_class):
            return True
        if getattr(msg, "type", "") == "finish":
            return True
        stop_reason = getattr(msg, "stop_reason", None)
        return stop_reason not in (None, "")

    def _format_context(self, current_step: InterviewStep) -> str:
        if not self.user_answers:
            return "Пока нет ответов."
        lines = []
        for step in STEPS_ORDER:
            if step == current_step:
                break
            answer = self.user_answers.get(step, "").strip()
            if answer:
                lines.append(f"- {step.value}: {self._truncate(answer, 220)}")
        return "\n".join(lines) if lines else "Пока нет ответов."

    def _truncate(self, text: str, limit: int) -> str:
        cleaned = (text or "").strip()
        if len(cleaned) <= limit:
            return cleaned
        shortened = cleaned[:limit].rsplit(" ", 1)[0]
        return (shortened or cleaned[:limit]) + "..."

    async def _run_search(
        self,
        step: InterviewStep,
        user_input: str,
        context_summary: str,
        hint: str,
    ) -> str:
        prompt = f"""
{SEARCH_PROMPT}

ЭТАП: {step.value}
ИДЕЯ: {self.idea_seed or self.project_name}
КОНТЕКСТ ИНТЕРВЬЮ:
{context_summary}

ФОКУС ПОИСКА: {hint}
ВВОДНЫЕ ОТ ПОЛЬЗОВАТЕЛЯ: "{user_input}"
"""
        return await self._send_request(prompt, client=self.client)

    async def _build_final_summary(self) -> str:
        prompt = f"""
{FINAL_SYNTHESIS_PROMPT}

ИДЕЯ: {self.idea_seed or self.project_name}

КОНТЕКСТ ИНТЕРВЬЮ:
{self._format_step_summary()}
"""
        return await self._send_request(prompt, client=self.client)

    def _format_step_summary(self) -> str:
        parts = []
        for step in STEPS_ORDER:
            record = self.step_records.get(step)
            if not record:
                continue
            parts.append(
                "\n".join(
                    [
                        f"{step.value}",
                        f"Ответ пользователя: {self._truncate(record.user_input, 400)}",
                        f"Поиск: {self._truncate(record.research, 400)}",
                        f"Креатор: {self._truncate(record.innovator, 400)}",
                        f"Реалист: {self._truncate(record.realist, 400)}",
                        f"Аналитик: {self._truncate(record.facilitator, 400)}",
                    ]
                )
            )
        return "\n\n".join(parts) if parts else "Нет данных."

    def _render_concept(self) -> str:
        timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
        lines = [
            f"# Концепция: {self.project_name}",
            "",
            f"_Сгенерировано: {timestamp}_",
            "",
            "## Исходная идея",
            self.idea_seed or "-",
            "",
        ]
        if self.final_summary:
            lines.extend(
                [
                    "## Executive Summary",
                    self.final_summary.strip() or "-",
                    "",
                ]
            )

        for step in STEPS_ORDER:
            record = self.step_records.get(step)
            if not record:
                continue
            lines.extend(
                [
                    f"## {step.value}",
                    "",
                    "**Ответ пользователя:**",
                    record.user_input.strip() or "-",
                    "",
                    "**iFlow Search (кратко):**",
                    record.research.strip() or "-",
                    "",
                    "**Мнение Креатора:**",
                    record.innovator.strip() or "-",
                    "",
                    "**Мнение Реалиста:**",
                    record.realist.strip() or "-",
                    "",
                    "**Вердикт Аналитика:**",
                    record.facilitator.strip() or "-",
                    "",
                ]
            )

        return "\n".join(lines)

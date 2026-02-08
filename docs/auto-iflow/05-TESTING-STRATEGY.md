# 🧪 Стратегия тестирования

**Цель:** Определить критерии готовности для каждого этапа и сценарии нагрузочного тестирования.

---

## 📊 Пирамида тестирования

```
                    ┌─────────────────┐
                    │   E2E Tests     │  ← 5-10 сценариев
                    │   (Playwright)  │
                    └────────┬────────┘
                             │
                    ┌────────┴────────┐
                    │  Integration    │  ← 20-30 тестов
                    │  Tests          │
                    └────────┬────────┘
                             │
           ┌─────────────────┴─────────────────┐
           │         Unit Tests                │  ← 100+ тестов
           │      (pytest, >80% coverage)      │
           └───────────────────────────────────┘
```

---

## ✅ Критерии готовности (Definition of Done)

### Phase 0: Research & PoC

| Критерий | Метрика | Проходной балл |
|----------|---------|----------------|
| SDK работает | hello_agent.py успешен | ✅ Pass |
| События приходят | Все 4 типа событий получены | ≥ 3 типа |
| Параллелизм | 12 агентов одновременно | ≥ 8 агентов |
| Нагрузочный тест | Успешность запросов | ≥ 80% |
| Документация | Technical Spike report | ✅ Создан |

### Phase 1: Core Migration

| Критерий | Метрика | Проходной балл |
|----------|---------|----------------|
| IFlowWrapper | Unit tests pass | ≥ 90% |
| Single agent | Создает файл, коммитит | ✅ Pass |
| Multi-agent | 12 агентов параллельно | ≥ 10 агентов |
| Event streaming | UI получает events | Latency < 500ms |
| Worktree isolation | Нет конфликтов | 0 конфликтов |
| Git operations | Merge без ошибок | ≥ 95% |
| Unit test coverage | Backend coverage | ≥ 80% |

### Phase 2: Planning Module

| Критерий | Метрика | Проходной балл |
|----------|---------|----------------|
| 3-agent council | Все роли работают | ✅ All 3 |
| Search integration | Результаты приходят | Avg < 3s |
| Source verification | Trust scores calculated | ✅ Pass |
| Interview flow | 8 вопросов задано | ✅ All 8 |
| Concept generation | concept.md создан | ✅ Valid format |
| Anti-hallucination | Facts grounded | ≥ 90% grounded |
| Unit test coverage | Planning module | ≥ 85% |

### Phase 3: Integration & Polish

| Критерий | Метрика | Проходной балл |
|----------|---------|----------------|
| UI Planning tab | Renders correctly | ✅ Pass |
| Event visualization | 3 цвета для агентов | ✅ Pass |
| Full E2E flow | Idea → concept.md → tasks.json → code | ✅ Pass |
| Performance | Full cycle < 30 min | ≤ 30 min |
| Error handling | Graceful degradation | No crashes |
| Documentation | User guide created | ✅ Pass |

---

## 🔬 Unit Tests

### Backend Tests Structure

```
tests/
├── unit/
│   ├── core/
│   │   ├── test_iflow_wrapper.py
│   │   ├── test_orchestrator.py
│   │   ├── test_event_bus.py
│   │   └── test_session_manager.py
│   ├── planning/
│   │   ├── test_brainstorming_module.py
│   │   ├── test_search_adapter.py
│   │   ├── test_trust_scorer.py
│   │   └── test_fact_checker.py
│   ├── security/
│   │   ├── test_tool_validator.py
│   │   ├── test_sandbox.py
│   │   └── test_security_logger.py
│   └── storage/
│       ├── test_session_db.py
│       ├── test_event_log.py
│       └── test_artifact_store.py
├── integration/
│   ├── test_full_agent_cycle.py
│   ├── test_multi_agent_orchestration.py
│   ├── test_planning_flow.py
│   └── test_git_operations.py
└── e2e/
    ├── test_complete_workflow.py
    └── test_ui_interactions.py
```

### Example Unit Tests

```python
# tests/unit/core/test_iflow_wrapper.py
import pytest
from unittest.mock import AsyncMock, MagicMock
from auto_iflow.core.iflow_wrapper import IFlowWrapper, IFlowConfig

class TestIFlowWrapper:
    
    @pytest.fixture
    def wrapper(self):
        config = IFlowConfig(
            approval_mode="AUTO_EDIT",
            working_directory="/tmp/test"
        )
        return IFlowWrapper(config)
    
    @pytest.mark.asyncio
    async def test_send_message_returns_events(self, wrapper):
        """Проверяем что send_message возвращает события"""
        wrapper._client = AsyncMock()
        wrapper._client.query.return_value = [
            MagicMock(content="Hello"),
            MagicMock(tool_name="write_file", args={"path": "test.py"})
        ]
        
        events = []
        async for event in wrapper.send_message("Create a file"):
            events.append(event)
        
        assert len(events) == 2
        assert events[0].content == "Hello"
    
    @pytest.mark.asyncio
    async def test_handles_connection_error(self, wrapper):
        """Проверяем обработку ошибок подключения"""
        wrapper._client = AsyncMock()
        wrapper._client.query.side_effect = ConnectionError("Failed to connect")
        
        with pytest.raises(IFlowConnectionError):
            async for _ in wrapper.send_message("Test"):
                pass
    
    @pytest.mark.asyncio
    async def test_cleanup_on_context_exit(self, wrapper):
        """Проверяем очистку ресурсов"""
        wrapper._client = AsyncMock()
        
        async with wrapper:
            pass
        
        wrapper._client.close.assert_called_once()


# tests/unit/security/test_tool_validator.py
import pytest
from auto_iflow.security.tool_validator import ToolValidator, SecurityConfig

class TestToolValidator:
    
    @pytest.fixture
    def validator(self):
        config = SecurityConfig(
            blocked_patterns=["rm -rf", "sudo"],
            allowed_commands=["python", "pip", "git"],
            blocked_paths=[".env", "*.pem"]
        )
        return ToolValidator(config)
    
    def test_blocks_dangerous_command(self, validator):
        """Проверяем блокировку опасных команд"""
        result = validator.validate_tool_call(
            tool_name="execute",
            args={"command": "rm -rf /"},
            approval_mode="YOLO"
        )
        
        assert result.allowed is False
        assert "blocked pattern" in result.reason.lower()
    
    def test_allows_safe_command(self, validator):
        """Проверяем разрешение безопасных команд"""
        result = validator.validate_tool_call(
            tool_name="execute",
            args={"command": "python test.py"},
            approval_mode="AUTO_EDIT"
        )
        
        assert result.allowed is True
    
    def test_blocks_write_to_env_file(self, validator):
        """Проверяем блокировку записи в .env"""
        result = validator.validate_tool_call(
            tool_name="write_file",
            args={"path": "/project/.env"},
            approval_mode="YOLO"
        )
        
        assert result.allowed is False


# tests/unit/planning/test_trust_scorer.py
import pytest
from datetime import datetime, timedelta
from auto_iflow.planning.trust_scorer import TrustScorer, SearchResult

class TestTrustScorer:
    
    @pytest.fixture
    def scorer(self):
        return TrustScorer()
    
    def test_official_docs_get_high_score(self, scorer):
        """Официальная документация должна получать высокий балл"""
        result = SearchResult(
            url="https://docs.python.org/3/tutorial/",
            published_date=datetime.utcnow(),
            citation_count=1000
        )
        
        score = scorer.calculate_trust_score(result)
        
        assert score >= 0.90
    
    def test_old_sources_get_lower_score(self, scorer):
        """Старые источники должны получать более низкий балл"""
        recent = SearchResult(
            url="https://example.com/article",
            published_date=datetime.utcnow() - timedelta(days=30),
            citation_count=100
        )
        
        old = SearchResult(
            url="https://example.com/old-article",
            published_date=datetime.utcnow() - timedelta(days=730),
            citation_count=100
        )
        
        recent_score = scorer.calculate_trust_score(recent)
        old_score = scorer.calculate_trust_score(old)
        
        assert recent_score > old_score
```

---

## 🔗 Integration Tests

```python
# tests/integration/test_full_agent_cycle.py
import pytest
import tempfile
import shutil
from pathlib import Path
from auto_iflow.core import Orchestrator, SessionConfig

class TestFullAgentCycle:
    
    @pytest.fixture
    def temp_project(self):
        """Создает временный проект для теста"""
        temp_dir = Path(tempfile.mkdtemp())
        
        # Инициализируем git
        subprocess.run(["git", "init"], cwd=temp_dir, check=True)
        subprocess.run(["git", "config", "user.email", "test@test.com"], cwd=temp_dir)
        subprocess.run(["git", "config", "user.name", "Test"], cwd=temp_dir)
        
        # Создаем initial commit
        (temp_dir / "README.md").write_text("# Test Project")
        subprocess.run(["git", "add", "."], cwd=temp_dir)
        subprocess.run(["git", "commit", "-m", "Initial"], cwd=temp_dir)
        
        yield temp_dir
        
        shutil.rmtree(temp_dir)
    
    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_single_agent_creates_file(self, temp_project):
        """Один агент создает файл и коммитит"""
        config = SessionConfig(
            project_path=temp_project,
            max_agents=1,
            approval_mode="YOLO"
        )
        
        orchestrator = Orchestrator(config)
        
        async with orchestrator:
            result = await orchestrator.run_task(
                "Create a Python file called hello.py with a hello_world function"
            )
        
        # Проверяем что файл создан
        hello_py = temp_project / "hello.py"
        assert hello_py.exists()
        
        content = hello_py.read_text()
        assert "def hello_world" in content
        
        # Проверяем что есть коммит
        log = subprocess.run(
            ["git", "log", "--oneline"],
            cwd=temp_project,
            capture_output=True,
            text=True
        )
        assert len(log.stdout.strip().split("\n")) > 1


# tests/integration/test_multi_agent_orchestration.py
@pytest.mark.asyncio
@pytest.mark.integration
async def test_12_agents_parallel_no_conflicts(temp_project):
    """12 агентов работают параллельно без конфликтов"""
    config = SessionConfig(
        project_path=temp_project,
        max_agents=12,
        approval_mode="YOLO"
    )
    
    orchestrator = Orchestrator(config)
    
    tasks = [
        f"Create a Python module called module_{i}.py with a function func_{i}"
        for i in range(12)
    ]
    
    async with orchestrator:
        results = await orchestrator.run_parallel_tasks(tasks)
    
    # Проверяем что все 12 файлов созданы
    for i in range(12):
        module_file = temp_project / f"module_{i}.py"
        assert module_file.exists(), f"module_{i}.py not found"
    
    # Проверяем что нет неразрешенных конфликтов
    status = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=temp_project,
        capture_output=True,
        text=True
    )
    assert "UU" not in status.stdout  # UU = unmerged


# tests/integration/test_planning_flow.py
@pytest.mark.asyncio
@pytest.mark.integration
async def test_planning_generates_concept_md(temp_project):
    """Planning module генерирует concept.md"""
    config = PlanningConfig(
        project_path=temp_project,
        search_enabled=True,
        min_sources=2
    )
    
    planning = BrainstormingModule(config)
    
    # Симулируем ответы пользователя
    answers = [
        "A task management app for developers",
        "Existing tools are too complex",
        "Global, starting with English-speaking markets",
        "MVP in 3 months",
        "1000 daily active users in 6 months",
        "Individual developers and small teams",
        "Sign up -> Create project -> Add tasks -> Track progress",
        "Simple, fast, and developer-focused"
    ]
    
    result = await planning.run_interview(answers)
    
    # Проверяем что concept.md создан
    concept_file = temp_project / ".iflow" / "docs" / "concept.md"
    assert concept_file.exists()
    
    content = concept_file.read_text()
    assert "## Executive Summary" in content
    assert "## Target Audience" in content
    assert "## Value Proposition" in content
```

---

## 🚀 E2E Tests

```python
# tests/e2e/test_complete_workflow.py
import pytest
from playwright.async_api import async_playwright

class TestCompleteWorkflow:
    
    @pytest.fixture
    async def app(self):
        """Запускает Electron приложение"""
        async with async_playwright() as p:
            # Запускаем Electron
            app = await p.electron.launch(
                args=["./apps/frontend/dist/main.js"]
            )
            yield app
            await app.close()
    
    @pytest.mark.asyncio
    @pytest.mark.e2e
    async def test_full_planning_to_code_cycle(self, app, temp_project):
        """Полный цикл: идея -> планирование -> код"""
        
        window = await app.first_window()
        
        # 1. Открываем проект
        await window.click('[data-testid="open-project"]')
        await window.fill('[data-testid="project-path"]', str(temp_project))
        await window.click('[data-testid="confirm-open"]')
        
        # 2. Переключаемся на вкладку Planning
        await window.click('[data-testid="tab-planning"]')
        
        # 3. Начинаем интервью
        await window.click('[data-testid="start-interview"]')
        
        # 4. Отвечаем на вопросы
        questions_count = 8
        for i in range(questions_count):
            await window.wait_for_selector(f'[data-testid="question-{i}"]')
            await window.fill(
                '[data-testid="answer-input"]',
                f"Test answer for question {i}"
            )
            await window.click('[data-testid="submit-answer"]')
        
        # 5. Ждем генерации concept.md
        await window.wait_for_selector('[data-testid="concept-ready"]', timeout=60000)
        
        # 6. Проверяем что агенты предоставили мнения
        innovator = await window.text_content('[data-testid="innovator-opinion"]')
        realist = await window.text_content('[data-testid="realist-opinion"]')
        facilitator = await window.text_content('[data-testid="facilitator-opinion"]')
        
        assert len(innovator) > 100
        assert len(realist) > 100
        assert len(facilitator) > 100
        
        # 7. Генерируем tasks.json
        await window.click('[data-testid="generate-tasks"]')
        await window.wait_for_selector('[data-testid="tasks-ready"]')
        
        # 8. Переключаемся на Execution
        await window.click('[data-testid="tab-execution"]')
        
        # 9. Запускаем агентов
        await window.click('[data-testid="start-execution"]')
        
        # 10. Ждем завершения (с большим timeout)
        await window.wait_for_selector(
            '[data-testid="execution-complete"]',
            timeout=300000  # 5 minutes
        )
        
        # 11. Проверяем что код создан
        files_created = await window.text_content('[data-testid="files-created-count"]')
        assert int(files_created) > 0
```

---

## 📊 Нагрузочный сценарий: 12 агентов × 3 итерации

```python
# tests/load/test_parallel_agents_stress.py
import asyncio
import time
import json
from dataclasses import dataclass, asdict
from typing import List
from pathlib import Path

@dataclass
class LoadTestMetrics:
    total_agents: int
    total_iterations: int
    successful: int
    failed: int
    avg_duration_ms: float
    max_duration_ms: float
    min_duration_ms: float
    p95_duration_ms: float
    p99_duration_ms: float
    total_messages: int
    errors: List[str]
    timestamp: str

async def run_load_test(
    num_agents: int = 12,
    iterations: int = 3,
    output_dir: Path = Path("./test_reports")
) -> LoadTestMetrics:
    """
    Нагрузочный тест: N агентов × M итераций
    
    Критерии успеха:
    - Успешность ≥ 80%
    - P95 latency < 60s
    - Нет memory leaks
    - Нет deadlocks
    """
    
    all_results = []
    
    for iteration in range(iterations):
        print(f"\n🔄 Iteration {iteration + 1}/{iterations}")
        
        # Создаем изолированные рабочие директории
        workdirs = [
            Path(f"/tmp/load_test/iter_{iteration}/agent_{i}")
            for i in range(num_agents)
        ]
        
        for wd in workdirs:
            wd.mkdir(parents=True, exist_ok=True)
            # Git init
            subprocess.run(["git", "init"], cwd=wd, capture_output=True)
        
        # Запускаем агентов параллельно
        tasks = [
            run_single_agent_with_metrics(i, workdirs[i], LOAD_TEST_TASKS[i % len(LOAD_TEST_TASKS)])
            for i in range(num_agents)
        ]
        
        start_time = time.time()
        results = await asyncio.gather(*tasks, return_exceptions=True)
        iteration_time = time.time() - start_time
        
        print(f"   Iteration time: {iteration_time:.2f}s")
        all_results.extend(results)
    
    # Агрегируем метрики
    metrics = aggregate_metrics(all_results)
    
    # Сохраняем отчет
    output_dir.mkdir(parents=True, exist_ok=True)
    report_path = output_dir / f"load_test_{int(time.time())}.json"
    
    with open(report_path, "w") as f:
        json.dump(asdict(metrics), f, indent=2)
    
    # Генерируем markdown отчет
    generate_markdown_report(metrics, output_dir / "load_test_report.md")
    
    return metrics

def aggregate_metrics(results: List) -> LoadTestMetrics:
    """Агрегирует метрики из результатов тестов"""
    
    successful = [r for r in results if isinstance(r, AgentResult) and r.success]
    failed = [r for r in results if not isinstance(r, AgentResult) or not r.success]
    
    durations = sorted([r.duration_ms for r in successful])
    
    return LoadTestMetrics(
        total_agents=len(results),
        total_iterations=3,
        successful=len(successful),
        failed=len(failed),
        avg_duration_ms=sum(durations) / len(durations) if durations else 0,
        max_duration_ms=max(durations) if durations else 0,
        min_duration_ms=min(durations) if durations else 0,
        p95_duration_ms=durations[int(len(durations) * 0.95)] if durations else 0,
        p99_duration_ms=durations[int(len(durations) * 0.99)] if durations else 0,
        total_messages=sum(r.messages_count for r in successful),
        errors=[str(r) for r in failed][:10],  # First 10 errors
        timestamp=datetime.utcnow().isoformat()
    )

LOAD_TEST_TASKS = [
    "Create a Python function that calculates fibonacci numbers recursively",
    "Create a simple REST API endpoint using FastAPI",
    "Write pytest unit tests for a Calculator class",
    "Create a YAML configuration parser",
    "Implement a memoization decorator",
    "Create a rotating file logger",
    "Write a file watcher using watchdog",
    "Implement exponential backoff retry decorator",
    "Create a simple finite state machine",
    "Write a JSON schema validator",
    "Create a CLI argument parser using argparse",
    "Implement a simple in-memory LRU cache"
]

# Запуск теста
if __name__ == "__main__":
    metrics = asyncio.run(run_load_test(num_agents=12, iterations=3))
    
    print(f"\n📊 Load Test Summary:")
    print(f"   Success rate: {metrics.successful}/{metrics.total_agents} ({metrics.successful/metrics.total_agents*100:.1f}%)")
    print(f"   Avg duration: {metrics.avg_duration_ms:.0f}ms")
    print(f"   P95 duration: {metrics.p95_duration_ms:.0f}ms")
    
    # Проверка критериев
    assert metrics.successful / metrics.total_agents >= 0.8, "Success rate < 80%"
    assert metrics.p95_duration_ms < 60000, "P95 latency > 60s"
```

---

## 📝 Test Report Template

```markdown
# 🧪 Load Test Report

**Date:** {{ timestamp }}
**Configuration:** {{ num_agents }} agents × {{ iterations }} iterations

## Summary

| Metric | Value | Status |
|--------|-------|--------|
| Success Rate | {{ success_rate }}% | {{ "✅" if success_rate >= 80 else "❌" }} |
| Avg Duration | {{ avg_duration }}ms | {{ "✅" if avg_duration < 30000 else "⚠️" }} |
| P95 Duration | {{ p95_duration }}ms | {{ "✅" if p95_duration < 60000 else "❌" }} |
| Total Messages | {{ total_messages }} | - |

## Timing Distribution

```

     Min   P50   P75   P95   P99   Max
    ─────────────────────────────────
     {{ min }}ms  {{ p50 }}ms  {{ p75 }}ms  {{ p95 }}ms  {{ p99 }}ms  {{ max }}ms

```

## Errors (Top 10)

{{ errors_table }}

## Recommendations

{{ recommendations }}
```

---

## ✅ Test Coverage Requirements

| Module | Minimum Coverage | Target Coverage |
|--------|-----------------|-----------------|
| `core/` | 80% | 90% |
| `planning/` | 85% | 95% |
| `security/` | 90% | 98% |
| `storage/` | 75% | 85% |
| **Total** | **80%** | **90%** |

### Running Coverage

```bash
# Run with coverage
pytest --cov=auto_iflow --cov-report=html --cov-fail-under=80

# Generate badge
coverage-badge -o coverage.svg
```

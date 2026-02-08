# 🧪 Technical Spike: iFlow SDK Integration

**Цель:** Провести технический эксперимент для валидации возможностей iflow-cli-sdk  
**Длительность:** 1-2 дня  
**Статус:** 📋 Планируется

---

## 📋 Задачи спайка

### 1. Hello Agent (День 1, 2-3 часа)

**Цель:** Минимальный работающий агент с iflow-cli-sdk

```python
# hello_agent.py
from iflow_cli_sdk import IFlowClient, IFlowOptions

async def main():
    options = IFlowOptions(
        approval_mode="AUTO_EDIT",
        working_directory="./test_project"
    )
    
    async with IFlowClient(options) as client:
        async for message in client.query("Create a simple Python hello world file"):
            print(f"[{type(message).__name__}] {message}")

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
```

**Критерии успеха:**

- [ ] SDK устанавливается без ошибок
- [ ] iFlow CLI автоматически запускается
- [ ] Агент создает файл `hello.py`
- [ ] События приходят в real-time

### 2. Event → UI Prototype (День 1-2, 3-4 часа)

**Цель:** Проверить, какие события можно получить и как их отображать

```python
# event_inspector.py
from iflow_cli_sdk import IFlowClient, IFlowOptions, RawDataClient
from iflow_cli_sdk.messages import (
    AssistantMessage, 
    ToolCallMessage, 
    PlanMessage, 
    TaskFinishMessage
)

async def inspect_events():
    options = IFlowOptions(
        approval_mode="AUTO_EDIT",
        working_directory="./test_project"
    )
    
    async with IFlowClient(options) as client:
        async for message in client.query("List all files in current directory"):
            if isinstance(message, AssistantMessage):
                print(f"🤖 ASSISTANT: {message.content[:100]}...")
                if message.agent_info:
                    print(f"   Agent ID: {message.agent_info.agent_id}")
                    
            elif isinstance(message, ToolCallMessage):
                print(f"🔧 TOOL: {message.tool_name}")
                print(f"   Args: {message.args}")
                print(f"   Output: {message.output[:200] if message.output else 'N/A'}...")
                
            elif isinstance(message, PlanMessage):
                print(f"📋 PLAN: Priority={message.priority}, Status={message.status}")
                
            elif isinstance(message, TaskFinishMessage):
                print(f"✅ FINISH: Reason={message.stop_reason}")

if __name__ == "__main__":
    import asyncio
    asyncio.run(inspect_events())
```

**Критерии успеха:**

- [ ] AssistantMessage содержит agent_info
- [ ] ToolCallMessage имеет tool_name, args, output
- [ ] События приходят в правильном порядке
- [ ] Можно отличить разных агентов

### 3. Parallel Agents Test (День 2, 4-5 часов)

**Цель:** Проверить поведение при 12 параллельных агентах

```python
# parallel_stress_test.py
import asyncio
import time
from dataclasses import dataclass
from typing import List
from iflow_cli_sdk import IFlowClient, IFlowOptions

@dataclass
class AgentResult:
    agent_id: int
    start_time: float
    end_time: float
    messages_count: int
    errors: List[str]
    success: bool

async def run_single_agent(agent_id: int, task: str) -> AgentResult:
    """Запускает одного агента и собирает метрики"""
    start_time = time.time()
    messages_count = 0
    errors = []
    success = True
    
    try:
        options = IFlowOptions(
            approval_mode="YOLO",
            working_directory=f"./test_agents/agent_{agent_id}"
        )
        
        async with IFlowClient(options) as client:
            async for message in client.query(task):
                messages_count += 1
                
    except Exception as e:
        errors.append(str(e))
        success = False
    
    return AgentResult(
        agent_id=agent_id,
        start_time=start_time,
        end_time=time.time(),
        messages_count=messages_count,
        errors=errors,
        success=success
    )

async def run_parallel_test(num_agents: int, iterations: int):
    """Нагрузочный тест: N агентов × M итераций"""
    
    tasks = [
        "Create a Python function that calculates fibonacci",
        "Create a simple REST API endpoint",
        "Write unit tests for a calculator class",
        "Create a configuration parser",
        "Implement a simple cache decorator",
        "Create a logging utility",
        "Write a file watcher script",
        "Implement retry logic decorator",
        "Create a simple state machine",
        "Write a data validation module",
        "Create a command parser",
        "Implement a simple queue"
    ]
    
    all_results = []
    
    for iteration in range(iterations):
        print(f"\n🔄 Iteration {iteration + 1}/{iterations}")
        
        # Запускаем всех агентов параллельно
        agent_tasks = [
            run_single_agent(i, tasks[i % len(tasks)])
            for i in range(num_agents)
        ]
        
        results = await asyncio.gather(*agent_tasks, return_exceptions=True)
        all_results.extend(results)
        
        # Пауза между итерациями (если нужна)
        await asyncio.sleep(1)
    
    return all_results

def generate_report(results: List[AgentResult]) -> str:
    """Генерирует отчет о нагрузочном тесте"""
    
    total = len(results)
    successful = sum(1 for r in results if r.success)
    failed = total - successful
    
    durations = [r.end_time - r.start_time for r in results if r.success]
    avg_duration = sum(durations) / len(durations) if durations else 0
    max_duration = max(durations) if durations else 0
    min_duration = min(durations) if durations else 0
    
    total_messages = sum(r.messages_count for r in results)
    
    report = f"""
# 📊 Parallel Agents Stress Test Report

## Summary
| Metric | Value |
|--------|-------|
| Total agents | {total} |
| Successful | {successful} ({successful/total*100:.1f}%) |
| Failed | {failed} ({failed/total*100:.1f}%) |

## Timing
| Metric | Value |
|--------|-------|
| Avg duration | {avg_duration:.2f}s |
| Min duration | {min_duration:.2f}s |
| Max duration | {max_duration:.2f}s |

## Messages
| Metric | Value |
|--------|-------|
| Total messages | {total_messages} |
| Avg per agent | {total_messages/total:.1f} |

## Errors
"""
    
    errors = [e for r in results for e in r.errors]
    if errors:
        for error in set(errors):
            count = errors.count(error)
            report += f"- ({count}x) {error}\n"
    else:
        report += "No errors recorded.\n"
    
    return report

async def main():
    print("🚀 Starting parallel agents stress test...")
    print("🔧 Configuration: 12 agents × 3 iterations")
    
    results = await run_parallel_test(num_agents=12, iterations=3)
    report = generate_report(results)
    
    print(report)
    
    # Сохраняем отчет
    with open("stress_test_report.md", "w") as f:
        f.write(report)
    
    print("\n📄 Report saved to stress_test_report.md")

if __name__ == "__main__":
    asyncio.run(main())
```

**Критерии успеха:**

- [ ] 12 агентов запускаются параллельно
- [ ] Нет deadlocks или race conditions
- [ ] Успешность > 80%
- [ ] Среднее время выполнения < 60s

---

## 📊 Метрики для сбора

### Производительность

| Метрика | Ожидание | Минимум |
|---------|----------|---------|
| Время холодного старта | < 5s | < 10s |
| Время отклика (первое сообщение) | < 2s | < 5s |
| Пропускная способность | 12 агентов | 6 агентов |
| Утилизация памяти | < 2GB | < 4GB |

### Надежность

| Метрика | Ожидание | Минимум |
|---------|----------|---------|
| Успешность запросов | > 95% | > 80% |
| Частота таймаутов | < 2% | < 10% |
| Частота крашей SDK | 0% | < 1% |

---

## 🔍 Вопросы для исследования

1. **Rate Limits:**
   - Есть ли лимиты на количество запросов?
   - Как SDK обрабатывает 429 ошибки?

2. **Session Management:**
   - Как работает agent_id?
   - Можно ли переиспользовать сессии?

3. **Error Handling:**
   - Какие исключения бросает SDK?
   - Есть ли retry-механизм?

4. **Resource Cleanup:**
   - Корректно ли освобождаются ресурсы?
   - Утечки памяти при длительной работе?

---

## 📁 Структура директории для тестов

```
spikes/
├── hello_agent.py
├── event_inspector.py
├── parallel_stress_test.py
├── test_project/
│   └── .gitkeep
├── test_agents/
│   ├── agent_0/
│   ├── agent_1/
│   └── ...
└── reports/
    └── stress_test_report.md
```

---

## ✅ Checklist завершения спайка

- [ ] hello_agent.py работает
- [ ] Все типы событий документированы
- [ ] Нагрузочный тест проведен
- [ ] Отчет сгенерирован
- [ ] Rate limits определены (или подтверждено отсутствие)
- [ ] Решение о продолжении принято (GO / NO-GO)

---

## 🚦 GO / NO-GO Критерии

### GO (продолжаем проект)

- SDK работает стабильно
- 12 агентов параллельно возможны
- Events достаточно информативны для UI
- Нет критических лимитов API

### NO-GO (пересматриваем подход)

- SDK нестабилен (успешность < 50%)
- Жесткие rate limits (< 6 агентов)
- Events не содержат нужной информации
- Критические баги в SDK

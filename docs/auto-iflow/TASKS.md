# Auto-iFlow Task Tracker

## Current Phase: Phase 0 - Research & PoC

---

## Phase 0: Research & PoC (3-4 дня)

### Day 1

- [x] Создать приватный репозиторий `auto-code-iFlow`
- [x] Исследовать iflow-cli-sdk (документация, возможности)
- [x] Исследовать Auto-iFlow (архитектура, код)
- [x] Создать `00-PROJECT-CANVAS.md` - обзор проекта
- [x] Создать `01-TECHNICAL-SPIKE.md` - план PoC
- [x] Создать `02-CONTRACTS.md` - event schema, session state
- [x] Создать `03-SECURITY-MODEL.md` - sandbox, permissions
- [x] Создать `04-SOURCE-TRUST-MODEL.md` - верификация источников
- [x] Создать `05-TESTING-STRATEGY.md` - стратегия тестирования
- [x] Создать `06-ARTIFACT-VERSIONING.md` - версионирование артефактов
- [x] Создать `README.md`
- [ ] Создать базовую структуру директорий
- [ ] Создать `hello_agent.py` - минимальный PoC

### Day 2

- [ ] Запустить `hello_agent.py` - проверить что SDK работает
- [ ] Создать `event_inspector.py` - изучить типы событий
- [ ] Документировать все типы событий SDK
- [ ] Проверить agent_id tracking

### Day 3

- [ ] Создать `parallel_stress_test.py`
- [ ] Запустить нагрузочный тест: 12 агентов × 3 итерации
- [ ] Собрать метрики: latency, success rate, errors
- [ ] Сгенерировать отчет о тесте

### Day 4

- [ ] Проанализировать результаты тестов
- [ ] Принять решение GO / NO-GO
- [ ] Обновить документацию с реальными данными
- [ ] Подготовить план Phase 1

---

## Phase 1: Core Migration (12-15 дней)

### Week 1

- [ ] Форкнуть Auto-iFlow
- [ ] Очистить зависимости от Claude CLI
- [ ] Создать `backend/core/iflow_wrapper.py`
- [ ] Написать unit tests для wrapper
- [ ] Запустить первый агент через wrapper

### Week 2

- [ ] Рефакторинг Orchestrator
- [ ] Перевести с subprocess на asyncio
- [ ] Реализовать EventBus
- [ ] Интегрировать с Frontend через WebSocket

### Week 3

- [ ] Тест параллельных агентов (12)
- [ ] Интеграция с Git worktrees
- [ ] Merge и conflict resolution
- [ ] Integration tests

---

## Phase 2: Planning Module (10-12 дней)

### Week 1

- [ ] Реализовать `BrainstormingModule`
- [ ] Создать промпты для 3 агентов (Innovator, Realist, Facilitator)
- [ ] Интегрировать поиск (Perplexity / Tavily)
- [ ] Реализовать Trust Scoring

### Week 2

- [ ] Реализовать Interview Flow (8 вопросов)
- [ ] Source verification
- [ ] Anti-hallucination measures
- [ ] Генерация concept.md

### Week 3

- [ ] Генерация tasks.json
- [ ] Версионирование артефактов
- [ ] Unit tests для Planning module

---

## Phase 3: Integration (8-10 дней)

### Week 1

- [ ] UI: Planning tab
- [ ] Визуализация 3 агентов
- [ ] History panel
- [ ] Diff view

### Week 2

- [ ] E2E тесты полного цикла
- [ ] Performance optimization
- [ ] User documentation
- [ ] Release preparation

---

## Backlog (Future)

- [ ] Telegram bot integration
- [ ] CI/CD pipeline для агентов
- [ ] Custom agent templates
- [ ] Multi-project support
- [ ] Team collaboration features

---

## Blockers

*Нет активных блокеров*

---

## Notes

- iflow-cli-sdk v0.2.0 доступен на PyPI
- Auto-iFlow использует AGPL-3.0 лицензию
- Требуется iFlow CLI 0.2.24+
- SDK поддерживает async/await и SubAgent tracking

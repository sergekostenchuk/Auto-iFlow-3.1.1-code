# 📜 Контракты между слоями

**Цель:** Определить четкие границы ответственности и форматы обмена данными между компонентами системы.

---

## 🏗 Архитектура слоев

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Electron/Vue)                  │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│   │ Kanban View │  │ Agent View  │  │ Planning View           │ │
│   └─────────────┘  └─────────────┘  └─────────────────────────┘ │
└───────────────────────────────┬─────────────────────────────────┘
                                │ IPC / WebSocket
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                        API GATEWAY (FastAPI)                     │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│   │ Session API │  │ Event API   │  │ Planning API            │ │
│   └─────────────┘  └─────────────┘  └─────────────────────────┘ │
└───────────────────────────────┬─────────────────────────────────┘
                                │ Internal calls
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                        ORCHESTRATOR (Python)                     │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│   │ AgentPool   │  │ EventBus    │  │ BrainstormingModule     │ │
│   └─────────────┘  └─────────────┘  └─────────────────────────┘ │
└───────────────────────────────┬─────────────────────────────────┘
                                │ SDK calls
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                        iFlow SDK Layer                           │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│   │ IFlowClient │  │ EventStream │  │ ToolExecutor            │ │
│   └─────────────┘  └─────────────┘  └─────────────────────────┘ │
└───────────────────────────────┬─────────────────────────────────┘
                                │ ACP Protocol
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                        STORAGE (SQLite + Git)                    │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│   │ SessionDB   │  │ EventLog    │  │ ArtifactStore (Git)     │ │
│   └─────────────┘  └─────────────┘  └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📊 Event Schema

### Base Event

```typescript
interface BaseEvent {
  event_id: string;           // UUID
  timestamp: string;          // ISO 8601
  session_id: string;         // Session UUID
  agent_id: string | null;    // Agent identifier (null for system events)
  event_type: EventType;
}

type EventType = 
  | "session.started"
  | "session.ended"
  | "agent.spawned"
  | "agent.message"
  | "agent.thought"
  | "agent.tool_call"
  | "agent.tool_result"
  | "agent.plan"
  | "agent.finished"
  | "agent.error"
  | "file.created"
  | "file.modified"
  | "file.deleted"
  | "git.commit"
  | "git.merge"
  | "planning.question"
  | "planning.answer"
  | "planning.synthesis";
```

### Agent Events

```typescript
// Сообщение от агента
interface AgentMessageEvent extends BaseEvent {
  event_type: "agent.message";
  payload: {
    content: string;
    is_streaming: boolean;
    chunk_index?: number;
  };
}

// Вызов инструмента
interface AgentToolCallEvent extends BaseEvent {
  event_type: "agent.tool_call";
  payload: {
    tool_name: string;
    tool_id: string;
    args: Record<string, any>;
    status: "pending" | "running" | "completed" | "failed";
  };
}

// Результат инструмента
interface AgentToolResultEvent extends BaseEvent {
  event_type: "agent.tool_result";
  payload: {
    tool_id: string;
    output: string;
    error?: string;
    duration_ms: number;
  };
}

// Завершение агента
interface AgentFinishedEvent extends BaseEvent {
  event_type: "agent.finished";
  payload: {
    stop_reason: "end_turn" | "max_tokens" | "refusal" | "cancelled";
    total_tokens: number;
    duration_ms: number;
  };
}
```

### Planning Events

```typescript
// Вопрос консилиума
interface PlanningQuestionEvent extends BaseEvent {
  event_type: "planning.question";
  payload: {
    question_index: number;
    question_text: string;
    category: "WHAT" | "WHY" | "WHERE" | "WHEN" | "EXPECTATIONS" | "WHO" | "JOURNEY" | "VALUE";
    context_from_search: SearchContext[];
  };
}

interface SearchContext {
  source: string;
  url: string;
  snippet: string;
  trust_score: number;  // 0.0 - 1.0
}

// Ответ агента консилиума
interface PlanningAgentOpinionEvent extends BaseEvent {
  event_type: "planning.synthesis";
  payload: {
    agent_role: "innovator" | "realist" | "facilitator";
    opinion: string;
    supporting_facts: string[];
    concerns: string[];
  };
}
```

---

## 📂 Session State Model

```typescript
interface Session {
  id: string;                    // UUID
  created_at: string;            // ISO 8601
  updated_at: string;            // ISO 8601
  status: SessionStatus;
  project_path: string;
  git_branch: string;
  
  // Настройки
  config: SessionConfig;
  
  // Состояние
  agents: AgentState[];
  planning: PlanningState | null;
  
  // Метаданные
  metadata: Record<string, any>;
}

type SessionStatus = 
  | "initializing"
  | "planning"
  | "executing"
  | "reviewing"
  | "merging"
  | "completed"
  | "failed"
  | "cancelled";

interface SessionConfig {
  max_agents: number;            // Default: 12
  approval_mode: "DEFAULT" | "AUTO_EDIT" | "YOLO" | "PLAN";
  timeout_seconds: number;       // Default: 3600
  auto_commit: boolean;
  auto_merge: boolean;
}

interface AgentState {
  agent_id: string;
  task_id: string;
  status: "idle" | "running" | "completed" | "failed";
  worktree_path: string;
  current_tool: string | null;
  messages_count: number;
  tokens_used: number;
  started_at: string | null;
  finished_at: string | null;
}

interface PlanningState {
  phase: "interviewing" | "synthesizing" | "completed";
  current_question: number;      // 0-7 for 8 questions
  answers: PlanningAnswer[];
  concept_draft: string | null;
  
  // Мнения агентов
  innovator_opinion: string | null;
  realist_opinion: string | null;
  facilitator_opinion: string | null;
}

interface PlanningAnswer {
  question_index: number;
  user_answer: string;
  search_context: SearchContext[];
  agent_analyses: AgentAnalysis[];
}

interface AgentAnalysis {
  role: "innovator" | "realist" | "facilitator";
  analysis: string;
  recommendations: string[];
}
```

---

## 💾 Storage Model

### SQLite Tables

```sql
-- Сессии
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL,
  project_path TEXT NOT NULL,
  git_branch TEXT NOT NULL,
  config_json TEXT NOT NULL,
  metadata_json TEXT
);

-- Агенты
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  task_id TEXT NOT NULL,
  status TEXT NOT NULL,
  worktree_path TEXT NOT NULL,
  current_tool TEXT,
  messages_count INTEGER DEFAULT 0,
  tokens_used INTEGER DEFAULT 0,
  started_at TEXT,
  finished_at TEXT
);

-- События (append-only log)
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  agent_id TEXT REFERENCES agents(id),
  event_type TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

-- Индексы
CREATE INDEX idx_events_session ON events(session_id, timestamp);
CREATE INDEX idx_events_agent ON events(agent_id, timestamp);
CREATE INDEX idx_events_type ON events(event_type);

-- Planning артефакты
CREATE TABLE planning_artifacts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  artifact_type TEXT NOT NULL,  -- 'concept', 'tasks', 'research'
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  git_commit TEXT
);

CREATE INDEX idx_artifacts_session ON planning_artifacts(session_id, artifact_type);
```

### Git Artifact Store

```
.iflow/
├── config.yaml              # Проектные настройки
├── prompts/                 # Кастомные промпты
│   ├── system.md
│   ├── innovator.md
│   ├── realist.md
│   └── facilitator.md
├── docs/                    # Сгенерированные документы
│   ├── concept.md           # ← Версионируется в Git
│   ├── tasks.json           # ← Версионируется в Git
│   └── research/
│       ├── competitors.md
│       └── market.md
├── history/                 # История изменений (SQLite backup)
│   └── events.db
└── cache/                   # Кеш поисковых запросов
    └── search_cache.json
```

---

## 🔄 Синхронизация UI ↔ Backend

### Стратегия: Event Sourcing + CQRS

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│   Frontend  │◄──────│  EventBus   │◄──────│ Orchestrator│
│   (Vue)     │       │ (WebSocket) │       │  (Python)   │
└─────────────┘       └─────────────┘       └─────────────┘
       │                     │                     │
       │  Subscribe          │                     │
       │────────────────────►│                     │
       │                     │                     │
       │                     │     Emit event      │
       │                     │◄────────────────────│
       │   Push event        │                     │
       │◄────────────────────│                     │
       │                     │                     │
       │  Query state        │                     │
       │────────────────────►│                     │
       │                     │     Get state       │
       │                     │────────────────────►│
       │                     │     Return state    │
       │   Return state      │◄────────────────────│
       │◄────────────────────│                     │
```

### Принципы

1. **Single Source of Truth:** Backend (Orchestrator + SQLite)
2. **Frontend:** Read-only view + command dispatch
3. **Синхронизация:** Event push через WebSocket
4. **Reconnection:** Запрос полного state при reconnect
5. **Optimistic UI:** Не используется (слишком сложно для агентов)

### WebSocket Protocol

```typescript
// Client → Server
interface ClientMessage {
  type: "subscribe" | "unsubscribe" | "command";
  payload: any;
}

interface SubscribePayload {
  session_id: string;
  event_types?: EventType[];  // null = all
}

interface CommandPayload {
  command: "start_session" | "stop_agent" | "cancel_session" | "answer_question";
  session_id: string;
  args: Record<string, any>;
}

// Server → Client
interface ServerMessage {
  type: "event" | "state_snapshot" | "error";
  payload: any;
}

interface StateSnapshotPayload {
  session: Session;
  recent_events: BaseEvent[];  // Last 100 events
}
```

---

## 🔒 Границы ответственности

### Frontend

| Область | Ответственность |
|---------|-----------------|
| UI rendering | ✅ Полная |
| Event display | ✅ Полная |
| User input | ✅ Полная |
| State management | ❌ Только кеш UI |
| Business logic | ❌ Нет |
| Agent control | ❌ Только команды |

### API Gateway

| Область | Ответственность |
|---------|-----------------|
| Auth/AuthZ | ✅ Полная |
| Rate limiting | ✅ Полная |
| Request validation | ✅ Полная |
| Response formatting | ✅ Полная |
| Business logic | ❌ Делегирует Orchestrator |

### Orchestrator

| Область | Ответственность |
|---------|-----------------|
| Agent lifecycle | ✅ Полная |
| Event emission | ✅ Полная |
| State management | ✅ Полная |
| SDK integration | ✅ Полная |
| Storage | ❌ Делегирует Storage Layer |

### Storage

| Область | Ответственность |
|---------|-----------------|
| Persistence | ✅ Полная |
| Transactions | ✅ Полная |
| Indexing | ✅ Полная |
| Git integration | ✅ Полная |
| Business logic | ❌ Нет |

---

## ⚠️ Предотвращение рассинхронизации

### Проблема: Двойной источник истины

```
❌ Антипаттерн:
Frontend держит свою копию state
Backend держит свою копию state
→ Рассинхрон при сетевых сбоях
```

### Решение: Event Sourcing

```
✅ Правильный подход:
Backend = Source of Truth (events + derived state)
Frontend = Projection (derived from events)

При disconnect:
1. Frontend показывает "Reconnecting..."
2. При reconnect: запрос StateSnapshot
3. Frontend полностью заменяет свой state
```

### Checklist для каждого нового event type

- [ ] Добавлен в EventType enum
- [ ] Создан TypeScript interface
- [ ] Создана Python dataclass
- [ ] Добавлен handler в EventBus
- [ ] Добавлен handler в Frontend store
- [ ] Добавлен в events table insert
- [ ] Добавлен в state derivation logic
- [ ] Написаны тесты

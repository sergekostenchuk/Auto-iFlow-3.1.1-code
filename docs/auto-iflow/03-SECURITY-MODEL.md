# 🔒 Модель безопасности

**Цель:** Определить механизмы защиты для tool_use, файловых операций и изоляции агентов.

---

## 🎯 Принципы безопасности

1. **Principle of Least Privilege** — агенты получают минимальные необходимые права
2. **Defense in Depth** — многоуровневая защита
3. **Fail Secure** — при ошибках система блокирует, а не разрешает
4. **Audit Trail** — все действия логируются

---

## 🏗 Архитектура безопасности (3+1 уровня)

```
┌─────────────────────────────────────────────────────────────────┐
│  LEVEL 0: User Approval Mode                                    │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ DEFAULT | AUTO_EDIT | YOLO | PLAN                           ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  LEVEL 1: Tool Allowlist                                        │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Разрешенные инструменты на основе типа проекта              ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  LEVEL 2: Filesystem Sandbox                                    │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Операции только в project_dir и worktree                    ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  LEVEL 3: OS Sandbox (Optional)                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Docker / Bubblewrap / macOS Sandbox                          ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

---

## 🎚 Level 0: Approval Modes

| Mode | Описание | Риск | Использование |
|------|----------|------|---------------|
| `DEFAULT` | Пользователь подтверждает каждое действие | 🟢 Низкий | Первый запуск, критичные проекты |
| `AUTO_EDIT` | Авто-подтверждение редактирования файлов | 🟡 Средний | Обычная разработка |
| `YOLO` | Авто-подтверждение всех действий | 🔴 Высокий | Только в sandbox/isolated env |
| `PLAN` | Только планирование, без выполнения | 🟢 Низкий | Ревью, анализ |

### Рекомендации по выбору

```python
# Логика выбора approval mode
def get_recommended_mode(project: Project, user_trust_level: int) -> ApprovalMode:
    if project.is_production:
        return ApprovalMode.DEFAULT
    
    if user_trust_level < 3:  # Новый пользователь
        return ApprovalMode.DEFAULT
    
    if project.has_sensitive_data:
        return ApprovalMode.AUTO_EDIT
    
    if project.is_sandbox:
        return ApprovalMode.YOLO
    
    return ApprovalMode.AUTO_EDIT
```

---

## 🔧 Level 1: Tool Allowlist

### Категории инструментов

```python
class ToolCategory(Enum):
    READ = "read"           # Чтение файлов, ls, grep
    WRITE = "write"         # Запись файлов
    EXECUTE = "execute"     # Выполнение команд
    NETWORK = "network"     # Сетевые запросы
    GIT = "git"             # Git операции
    SYSTEM = "system"       # Системные вызовы
```

### Матрица разрешений по типу проекта

| Tool Category | Python | Node.js | Rust | Generic |
|---------------|--------|---------|------|---------|
| READ | ✅ All | ✅ All | ✅ All | ✅ All |
| WRITE | ✅ .py, .txt, ... | ✅ .js, .ts, ... | ✅ .rs, .toml, ... | ✅ Common files |
| EXECUTE | `python`, `pip`, `pytest` | `npm`, `node`, `yarn` | `cargo`, `rustc` | `ls`, `cat`, `grep` |
| NETWORK | `pip install` | `npm install` | `cargo build` | ❌ No |
| GIT | ✅ All | ✅ All | ✅ All | ✅ All |
| SYSTEM | ❌ No | ❌ No | ❌ No | ❌ No |

### Allowlist конфигурация

```yaml
# .iflow/security.yaml
tool_allowlist:
  read:
    enabled: true
    extensions: ["*"]
    
  write:
    enabled: true
    extensions:
      - ".py"
      - ".md"
      - ".yaml"
      - ".json"
      - ".txt"
    blocked_paths:
      - ".env"
      - ".env.*"
      - "*.pem"
      - "*.key"
      - "**/secrets/**"
      
  execute:
    enabled: true
    allowed_commands:
      - "python"
      - "pip"
      - "pytest"
      - "black"
      - "ruff"
      - "git"
    blocked_patterns:
      - "rm -rf"
      - "sudo"
      - "chmod 777"
      - "curl.*|.*bash"
      - "wget.*|.*sh"
      
  network:
    enabled: false  # Disabled by default
    allowed_hosts: []
    
  git:
    enabled: true
    allowed_operations:
      - "status"
      - "add"
      - "commit"
      - "branch"
      - "checkout"
      - "merge"
      - "push"  # Только если явно разрешено
```

### Валидация инструментов

```python
from dataclasses import dataclass
from typing import Optional

@dataclass
class ToolValidationResult:
    allowed: bool
    reason: Optional[str] = None
    requires_approval: bool = False

class ToolValidator:
    def __init__(self, config: SecurityConfig):
        self.config = config
    
    def validate_tool_call(
        self, 
        tool_name: str, 
        args: dict, 
        approval_mode: ApprovalMode
    ) -> ToolValidationResult:
        
        # 1. Проверка категории
        category = self._get_tool_category(tool_name)
        if not self.config.is_category_enabled(category):
            return ToolValidationResult(
                allowed=False,
                reason=f"Category {category} is disabled"
            )
        
        # 2. Проверка конкретного инструмента
        if tool_name in self.config.blocked_tools:
            return ToolValidationResult(
                allowed=False,
                reason=f"Tool {tool_name} is explicitly blocked"
            )
        
        # 3. Проверка аргументов (для execute)
        if category == ToolCategory.EXECUTE:
            cmd = args.get("command", "")
            validation = self._validate_command(cmd)
            if not validation.allowed:
                return validation
        
        # 4. Проверка путей (для read/write)
        if category in (ToolCategory.READ, ToolCategory.WRITE):
            path = args.get("path", "")
            validation = self._validate_path(path, category)
            if not validation.allowed:
                return validation
        
        # 5. Проверка approval mode
        if category in self.config.requires_approval_categories:
            if approval_mode == ApprovalMode.DEFAULT:
                return ToolValidationResult(
                    allowed=True,
                    requires_approval=True
                )
        
        return ToolValidationResult(allowed=True)
    
    def _validate_command(self, cmd: str) -> ToolValidationResult:
        """Валидация команды на опасные паттерны"""
        for pattern in self.config.blocked_patterns:
            if re.search(pattern, cmd, re.IGNORECASE):
                return ToolValidationResult(
                    allowed=False,
                    reason=f"Command matches blocked pattern: {pattern}"
                )
        
        # Проверка первой команды в пайпе
        first_cmd = cmd.split("|")[0].strip().split()[0]
        if first_cmd not in self.config.allowed_commands:
            return ToolValidationResult(
                allowed=False,
                reason=f"Command {first_cmd} is not in allowlist"
            )
        
        return ToolValidationResult(allowed=True)
    
    def _validate_path(self, path: str, category: ToolCategory) -> ToolValidationResult:
        """Валидация пути файла"""
        abs_path = Path(path).resolve()
        
        # Проверка sandbox
        if not self._is_in_sandbox(abs_path):
            return ToolValidationResult(
                allowed=False,
                reason=f"Path {path} is outside sandbox"
            )
        
        # Проверка blocked paths
        for pattern in self.config.blocked_paths:
            if fnmatch.fnmatch(str(abs_path), pattern):
                return ToolValidationResult(
                    allowed=False,
                    reason=f"Path matches blocked pattern: {pattern}"
                )
        
        # Проверка расширений (для write)
        if category == ToolCategory.WRITE:
            ext = abs_path.suffix
            if ext not in self.config.allowed_extensions:
                return ToolValidationResult(
                    allowed=False,
                    reason=f"Extension {ext} is not allowed for writing"
                )
        
        return ToolValidationResult(allowed=True)
```

---

## 📁 Level 2: Filesystem Sandbox

### Границы sandbox

```
project_root/               ← Корень проекта
├── .iflow/                 ← Конфигурация (read-only для агентов)
├── .git/                   ← Git данные (read-only, операции через git)
├── src/                    ← Исходный код (read-write)
├── tests/                  ← Тесты (read-write)
├── docs/                   ← Документация (read-write)
├── node_modules/           ← Зависимости (read-only)
├── .venv/                  ← Python venv (read-only)
└── worktrees/              ← Git worktrees для агентов
    ├── agent_0/            ← Sandbox агента 0
    ├── agent_1/            ← Sandbox агента 1
    └── ...
```

### Правила доступа

```python
@dataclass
class SandboxConfig:
    project_root: Path
    worktree_root: Path
    
    # Разрешенные операции
    read_paths: List[str] = field(default_factory=lambda: ["**/*"])
    write_paths: List[str] = field(default_factory=lambda: [
        "src/**/*",
        "tests/**/*",
        "docs/**/*"
    ])
    
    # Запрещенные пути
    blocked_read: List[str] = field(default_factory=lambda: [
        ".env",
        ".env.*",
        "**/*.pem",
        "**/*.key",
        "**/secrets/**"
    ])
    
    blocked_write: List[str] = field(default_factory=lambda: [
        ".git/**/*",
        ".iflow/**/*",
        "node_modules/**/*",
        ".venv/**/*",
        "**/__pycache__/**/*"
    ])

class FilesystemSandbox:
    def __init__(self, config: SandboxConfig, agent_id: str):
        self.config = config
        self.agent_id = agent_id
        self.worktree = config.worktree_root / f"agent_{agent_id}"
    
    def can_read(self, path: Path) -> bool:
        abs_path = self._resolve_path(path)
        
        # Проверка что внутри sandbox
        if not self._is_in_sandbox(abs_path):
            return False
        
        # Проверка blocked
        for pattern in self.config.blocked_read:
            if fnmatch.fnmatch(str(abs_path.relative_to(self.worktree)), pattern):
                return False
        
        return True
    
    def can_write(self, path: Path) -> bool:
        abs_path = self._resolve_path(path)
        
        # Проверка что внутри sandbox
        if not self._is_in_sandbox(abs_path):
            return False
        
        # Проверка blocked
        for pattern in self.config.blocked_write:
            if fnmatch.fnmatch(str(abs_path.relative_to(self.worktree)), pattern):
                return False
        
        # Проверка allowed
        for pattern in self.config.write_paths:
            if fnmatch.fnmatch(str(abs_path.relative_to(self.worktree)), pattern):
                return True
        
        return False
    
    def _is_in_sandbox(self, path: Path) -> bool:
        try:
            path.resolve().relative_to(self.worktree)
            return True
        except ValueError:
            return False
    
    def _resolve_path(self, path: Path) -> Path:
        if path.is_absolute():
            return path.resolve()
        return (self.worktree / path).resolve()
```

---

## 🐳 Level 3: OS-Level Sandbox (Optional)

### Docker-based isolation

```yaml
# docker-compose.agent.yml
version: "3.8"
services:
  agent:
    image: auto-iflow-agent:latest
    read_only: true
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    cap_add:
      - CHOWN
      - DAC_OVERRIDE
      - FOWNER
    volumes:
      - type: bind
        source: ${WORKTREE_PATH}
        target: /workspace
        read_only: false
      - type: bind
        source: ${PROJECT_ROOT}/.iflow
        target: /config
        read_only: true
    networks:
      - agent-network
    deploy:
      resources:
        limits:
          cpus: "2"
          memory: 4G
        reservations:
          memory: 1G

networks:
  agent-network:
    driver: bridge
    internal: true  # No internet access
```

### macOS Sandbox Profile

```scheme
;; agent.sb - macOS sandbox profile
(version 1)
(deny default)

;; Allow read access to worktree
(allow file-read*
    (subpath "${WORKTREE_PATH}"))

;; Allow write access to worktree (except sensitive)
(allow file-write*
    (subpath "${WORKTREE_PATH}")
    (require-not (subpath "${WORKTREE_PATH}/.git"))
    (require-not (regex #"\.env.*")))

;; Allow process execution for allowed commands
(allow process-exec
    (literal "/usr/bin/python3")
    (literal "/usr/local/bin/pip")
    (literal "/usr/bin/git"))

;; Deny network access
(deny network*)

;; Allow minimal system access
(allow sysctl-read)
(allow mach-lookup (global-name "com.apple.system.logger"))
```

---

## 📝 Audit Trail

### Event logging

```python
@dataclass
class SecurityEvent:
    timestamp: datetime
    event_type: str  # "tool_call", "validation_failed", "sandbox_violation"
    agent_id: str
    session_id: str
    details: dict
    severity: str  # "info", "warning", "critical"

class SecurityLogger:
    def __init__(self, log_path: Path):
        self.log_path = log_path
        self.logger = logging.getLogger("security")
    
    def log_tool_call(self, agent_id: str, tool_name: str, args: dict, result: ToolValidationResult):
        event = SecurityEvent(
            timestamp=datetime.utcnow(),
            event_type="tool_call",
            agent_id=agent_id,
            session_id=self._get_session_id(),
            details={
                "tool": tool_name,
                "args": self._sanitize_args(args),
                "allowed": result.allowed,
                "reason": result.reason
            },
            severity="info" if result.allowed else "warning"
        )
        self._write_event(event)
    
    def log_sandbox_violation(self, agent_id: str, path: str, operation: str):
        event = SecurityEvent(
            timestamp=datetime.utcnow(),
            event_type="sandbox_violation",
            agent_id=agent_id,
            session_id=self._get_session_id(),
            details={
                "path": path,
                "operation": operation
            },
            severity="critical"
        )
        self._write_event(event)
        self._alert_admin(event)
    
    def _sanitize_args(self, args: dict) -> dict:
        """Убираем чувствительные данные из логов"""
        sensitive_keys = {"password", "token", "secret", "key", "api_key"}
        return {
            k: "***REDACTED***" if k.lower() in sensitive_keys else v
            for k, v in args.items()
        }
```

---

## ✅ Security Checklist

### Перед запуском агента

- [ ] Проверен approval mode
- [ ] Загружена security config
- [ ] Создан sandbox (worktree)
- [ ] Инициализирован logger

### На каждый tool call

- [ ] Валидация категории инструмента
- [ ] Валидация аргументов
- [ ] Проверка sandbox boundaries
- [ ] Логирование события
- [ ] Запрос approval (если нужно)

### После сессии

- [ ] Ревью security log
- [ ] Cleanup worktree
- [ ] Проверка на anomalies

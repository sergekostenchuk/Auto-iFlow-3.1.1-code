# 📦 Версионирование артефактов Planning

**Цель:** Обеспечить долговременное хранение, версионирование и отслеживание изменений для артефактов модуля Planning.

---

## 🎯 Проблема

Артефакты Planning (`concept.md`, `tasks.json`, исследования) могут:

1. Изменяться в ходе итераций
2. Требовать отката к предыдущим версиям
3. Создавать конфликты при параллельной работе
4. Терять историю изменений

---

## 🏗 Архитектура версионирования

### Двойное хранение: SQLite + Git

```
┌─────────────────────────────────────────────────────────────────┐
│  PLANNING MODULE                                                 │
└────────────────────────────┬────────────────────────────────────┘
                             │
         ┌───────────────────┴───────────────────┐
         ▼                                       ▼
┌─────────────────────┐               ┌─────────────────────┐
│  SQLite (Metadata)  │               │  Git (Content)      │
│  - Version numbers  │               │  - Full history     │
│  - Timestamps       │               │  - Diffs            │
│  - Authors          │               │  - Branches         │
│  - Tags             │               │  - Merge tracking   │
└─────────────────────┘               └─────────────────────┘
```

### Зачем оба?

| Хранилище | Назначение |
|-----------|------------|
| **SQLite** | Быстрый поиск метаданных, фильтрация, статистика |
| **Git** | Полная история изменений, дифы, атомарные коммиты |

---

## 📁 Структура артефактов

```
project_root/
├── .iflow/
│   ├── config.yaml              # Конфигурация проекта
│   ├── docs/                    # Артефакты Planning (версионируются)
│   │   ├── concept.md           # ← Git-tracked
│   │   ├── tasks.json           # ← Git-tracked
│   │   └── research/
│   │       ├── competitors.md   # ← Git-tracked
│   │       ├── market.md        # ← Git-tracked
│   │       └── sources.json     # ← Git-tracked (кеш источников)
│   ├── history/
│   │   └── planning.db          # SQLite с метаданными версий
│   └── cache/
│       └── search_cache.json    # Не версионируется
```

---

## 📊 SQLite Schema

```sql
-- Артефакты
CREATE TABLE artifacts (
    id TEXT PRIMARY KEY,
    artifact_type TEXT NOT NULL,  -- 'concept', 'tasks', 'research'
    file_path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    current_version INTEGER NOT NULL DEFAULT 1,
    is_deleted INTEGER NOT NULL DEFAULT 0
);

-- Версии артефактов
CREATE TABLE artifact_versions (
    id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL REFERENCES artifacts(id),
    version_number INTEGER NOT NULL,
    git_commit TEXT NOT NULL,     -- SHA коммита
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL,     -- 'user', 'innovator', 'realist', 'facilitator', 'system'
    change_type TEXT NOT NULL,    -- 'create', 'update', 'major_update', 'rollback'
    change_summary TEXT,
    content_hash TEXT NOT NULL,   -- SHA256 контента для быстрого сравнения
    
    UNIQUE(artifact_id, version_number)
);

-- Теги версий
CREATE TABLE version_tags (
    id TEXT PRIMARY KEY,
    artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
    tag_name TEXT NOT NULL,       -- 'approved', 'draft', 'needs-review', 'archived'
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL
);

-- Связи между артефактами
CREATE TABLE artifact_relations (
    id TEXT PRIMARY KEY,
    source_artifact_id TEXT NOT NULL REFERENCES artifacts(id),
    target_artifact_id TEXT NOT NULL REFERENCES artifacts(id),
    relation_type TEXT NOT NULL,  -- 'derived_from', 'updates', 'replaces'
    created_at TEXT NOT NULL
);

-- Индексы
CREATE INDEX idx_versions_artifact ON artifact_versions(artifact_id);
CREATE INDEX idx_versions_commit ON artifact_versions(git_commit);
CREATE INDEX idx_tags_version ON version_tags(artifact_version_id);
CREATE INDEX idx_relations_source ON artifact_relations(source_artifact_id);
```

---

## 🔄 Операции версионирования

### 1. Создание артефакта

```python
from dataclasses import dataclass
from datetime import datetime
import hashlib
import uuid

@dataclass
class ArtifactVersion:
    version_number: int
    git_commit: str
    created_at: datetime
    created_by: str
    change_type: str
    change_summary: str
    content_hash: str

class ArtifactStore:
    def __init__(self, project_path: Path, db: ArtifactDB, git: GitWrapper):
        self.project_path = project_path
        self.db = db
        self.git = git
        self.docs_path = project_path / ".iflow" / "docs"
    
    async def create_artifact(
        self,
        artifact_type: str,
        file_name: str,
        content: str,
        created_by: str = "system"
    ) -> ArtifactVersion:
        """Создает новый артефакт с первой версией"""
        
        artifact_id = str(uuid.uuid4())
        file_path = self.docs_path / file_name
        
        # 1. Записываем файл
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(content, encoding="utf-8")
        
        # 2. Git commit
        commit_sha = await self.git.commit(
            file_path,
            message=f"[iflow] Create {artifact_type}: {file_name}",
            author=created_by
        )
        
        # 3. Сохраняем в SQLite
        content_hash = hashlib.sha256(content.encode()).hexdigest()
        
        self.db.execute("""
            INSERT INTO artifacts (id, artifact_type, file_path, created_at, updated_at, current_version)
            VALUES (?, ?, ?, ?, ?, 1)
        """, (artifact_id, artifact_type, str(file_path.relative_to(self.project_path)), 
              datetime.utcnow().isoformat(), datetime.utcnow().isoformat()))
        
        version_id = str(uuid.uuid4())
        self.db.execute("""
            INSERT INTO artifact_versions 
            (id, artifact_id, version_number, git_commit, created_at, created_by, change_type, change_summary, content_hash)
            VALUES (?, ?, 1, ?, ?, ?, 'create', 'Initial creation', ?)
        """, (version_id, artifact_id, commit_sha, datetime.utcnow().isoformat(), created_by, content_hash))
        
        self.db.commit()
        
        return ArtifactVersion(
            version_number=1,
            git_commit=commit_sha,
            created_at=datetime.utcnow(),
            created_by=created_by,
            change_type="create",
            change_summary="Initial creation",
            content_hash=content_hash
        )
```

### 2. Обновление артефакта

```python
    async def update_artifact(
        self,
        artifact_id: str,
        new_content: str,
        change_summary: str,
        updated_by: str = "system",
        is_major: bool = False
    ) -> ArtifactVersion:
        """Обновляет артефакт и создает новую версию"""
        
        # 1. Получаем текущую информацию
        artifact = self.db.fetchone(
            "SELECT file_path, current_version FROM artifacts WHERE id = ?",
            (artifact_id,)
        )
        
        if not artifact:
            raise ArtifactNotFoundError(artifact_id)
        
        file_path = self.project_path / artifact["file_path"]
        current_version = artifact["current_version"]
        new_version = current_version + 1
        
        # 2. Проверяем что есть реальные изменения
        current_content = file_path.read_text(encoding="utf-8")
        new_hash = hashlib.sha256(new_content.encode()).hexdigest()
        current_hash = hashlib.sha256(current_content.encode()).hexdigest()
        
        if new_hash == current_hash:
            raise NoChangesError("Content is identical to current version")
        
        # 3. Записываем файл
        file_path.write_text(new_content, encoding="utf-8")
        
        # 4. Git commit
        change_type = "major_update" if is_major else "update"
        commit_sha = await self.git.commit(
            file_path,
            message=f"[iflow] {change_type}: {change_summary}",
            author=updated_by
        )
        
        # 5. Обновляем SQLite
        self.db.execute("""
            UPDATE artifacts 
            SET current_version = ?, updated_at = ?
            WHERE id = ?
        """, (new_version, datetime.utcnow().isoformat(), artifact_id))
        
        version_id = str(uuid.uuid4())
        self.db.execute("""
            INSERT INTO artifact_versions 
            (id, artifact_id, version_number, git_commit, created_at, created_by, change_type, change_summary, content_hash)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (version_id, artifact_id, new_version, commit_sha, 
              datetime.utcnow().isoformat(), updated_by, change_type, change_summary, new_hash))
        
        self.db.commit()
        
        return ArtifactVersion(
            version_number=new_version,
            git_commit=commit_sha,
            created_at=datetime.utcnow(),
            created_by=updated_by,
            change_type=change_type,
            change_summary=change_summary,
            content_hash=new_hash
        )
```

### 3. Откат к версии

```python
    async def rollback_artifact(
        self,
        artifact_id: str,
        target_version: int,
        rolled_back_by: str = "user"
    ) -> ArtifactVersion:
        """Откатывает артефакт к указанной версии"""
        
        # 1. Получаем целевую версию
        target = self.db.fetchone("""
            SELECT git_commit, content_hash 
            FROM artifact_versions 
            WHERE artifact_id = ? AND version_number = ?
        """, (artifact_id, target_version))
        
        if not target:
            raise VersionNotFoundError(artifact_id, target_version)
        
        # 2. Получаем контент из Git
        content = await self.git.show_file(target["git_commit"], artifact["file_path"])
        
        # 3. Записываем как новую версию (с типом 'rollback')
        artifact = self.db.fetchone(
            "SELECT file_path, current_version FROM artifacts WHERE id = ?",
            (artifact_id,)
        )
        
        file_path = self.project_path / artifact["file_path"]
        file_path.write_text(content, encoding="utf-8")
        
        new_version = artifact["current_version"] + 1
        
        commit_sha = await self.git.commit(
            file_path,
            message=f"[iflow] Rollback to v{target_version}",
            author=rolled_back_by
        )
        
        # 4. Обновляем SQLite
        self.db.execute("""
            UPDATE artifacts 
            SET current_version = ?, updated_at = ?
            WHERE id = ?
        """, (new_version, datetime.utcnow().isoformat(), artifact_id))
        
        version_id = str(uuid.uuid4())
        self.db.execute("""
            INSERT INTO artifact_versions 
            (id, artifact_id, version_number, git_commit, created_at, created_by, change_type, change_summary, content_hash)
            VALUES (?, ?, ?, ?, ?, ?, 'rollback', ?, ?)
        """, (version_id, artifact_id, new_version, commit_sha,
              datetime.utcnow().isoformat(), rolled_back_by, 
              f"Rollback to version {target_version}", target["content_hash"]))
        
        self.db.commit()
        
        return ArtifactVersion(
            version_number=new_version,
            git_commit=commit_sha,
            created_at=datetime.utcnow(),
            created_by=rolled_back_by,
            change_type="rollback",
            change_summary=f"Rollback to version {target_version}",
            content_hash=target["content_hash"]
        )
```

### 4. Получение истории

```python
    def get_artifact_history(
        self,
        artifact_id: str,
        limit: int = 50
    ) -> List[ArtifactVersion]:
        """Возвращает историю версий артефакта"""
        
        rows = self.db.fetchall("""
            SELECT version_number, git_commit, created_at, created_by, 
                   change_type, change_summary, content_hash
            FROM artifact_versions
            WHERE artifact_id = ?
            ORDER BY version_number DESC
            LIMIT ?
        """, (artifact_id, limit))
        
        return [
            ArtifactVersion(
                version_number=row["version_number"],
                git_commit=row["git_commit"],
                created_at=datetime.fromisoformat(row["created_at"]),
                created_by=row["created_by"],
                change_type=row["change_type"],
                change_summary=row["change_summary"],
                content_hash=row["content_hash"]
            )
            for row in rows
        ]
    
    async def get_diff(
        self,
        artifact_id: str,
        from_version: int,
        to_version: int
    ) -> str:
        """Возвращает diff между версиями"""
        
        from_ver = self.db.fetchone("""
            SELECT git_commit FROM artifact_versions 
            WHERE artifact_id = ? AND version_number = ?
        """, (artifact_id, from_version))
        
        to_ver = self.db.fetchone("""
            SELECT git_commit FROM artifact_versions 
            WHERE artifact_id = ? AND version_number = ?
        """, (artifact_id, to_version))
        
        artifact = self.db.fetchone(
            "SELECT file_path FROM artifacts WHERE id = ?",
            (artifact_id,)
        )
        
        return await self.git.diff(
            from_ver["git_commit"],
            to_ver["git_commit"],
            artifact["file_path"]
        )
```

---

## 🔀 Разрешение конфликтов

### Сценарий конфликта

```
User A:  concept.md v1 ──► v2 (добавил секцию "Features")
                    │
User B:  concept.md v1 ──► v2' (изменил "Target Audience")
                    │
                    ▼
              CONFLICT!
```

### Стратегия разрешения

```python
class ConflictResolver:
    
    async def resolve_conflict(
        self,
        artifact_id: str,
        local_commit: str,
        remote_commit: str,
        strategy: str = "auto"  # 'auto', 'manual', 'ours', 'theirs'
    ) -> ConflictResolution:
        """Разрешает конфликт между версиями"""
        
        if strategy == "ours":
            return await self._keep_local(artifact_id, local_commit)
        
        if strategy == "theirs":
            return await self._accept_remote(artifact_id, remote_commit)
        
        if strategy == "auto":
            # Пытаемся 3-way merge
            base_commit = await self.git.merge_base(local_commit, remote_commit)
            
            try:
                merged = await self.git.merge_file(
                    base_commit,
                    local_commit,
                    remote_commit,
                    artifact["file_path"]
                )
                return ConflictResolution(
                    status="auto_merged",
                    content=merged,
                    conflicts=[]
                )
            except MergeConflictError as e:
                # Не удалось автоматически, нужно ручное разрешение
                return ConflictResolution(
                    status="manual_required",
                    content=e.conflicted_content,
                    conflicts=e.conflict_markers
                )
        
        # strategy == "manual"
        return await self._prepare_manual_resolution(
            artifact_id, local_commit, remote_commit
        )
    
    async def _prepare_manual_resolution(
        self,
        artifact_id: str,
        local_commit: str,
        remote_commit: str
    ) -> ConflictResolution:
        """Подготавливает данные для ручного разрешения"""
        
        artifact = self.db.fetchone(
            "SELECT file_path FROM artifacts WHERE id = ?",
            (artifact_id,)
        )
        
        local_content = await self.git.show_file(local_commit, artifact["file_path"])
        remote_content = await self.git.show_file(remote_commit, artifact["file_path"])
        base_commit = await self.git.merge_base(local_commit, remote_commit)
        base_content = await self.git.show_file(base_commit, artifact["file_path"])
        
        # Генерируем side-by-side diff для UI
        diff_data = generate_three_way_diff(base_content, local_content, remote_content)
        
        return ConflictResolution(
            status="manual_required",
            local_version={
                "commit": local_commit,
                "content": local_content
            },
            remote_version={
                "commit": remote_commit,
                "content": remote_content
            },
            base_version={
                "commit": base_commit,
                "content": base_content
            },
            diff_visualization=diff_data
        )
```

---

## 🏷 Теги и статусы

### Доступные теги

| Тег | Значение | Применение |
|-----|----------|------------|
| `draft` | Черновик | Автоматически при создании |
| `needs-review` | Требует ревью | После генерации агентами |
| `approved` | Одобрено | После ревью пользователем |
| `archived` | Архивировано | При создании новой major версии |
| `baseline` | Базовый | Точка отсчета для сравнений |

### Управление тегами

```python
    def add_tag(
        self,
        artifact_id: str,
        version_number: int,
        tag_name: str,
        tagged_by: str
    ):
        """Добавляет тег к версии"""
        
        version = self.db.fetchone("""
            SELECT id FROM artifact_versions 
            WHERE artifact_id = ? AND version_number = ?
        """, (artifact_id, version_number))
        
        if not version:
            raise VersionNotFoundError(artifact_id, version_number)
        
        self.db.execute("""
            INSERT INTO version_tags (id, artifact_version_id, tag_name, created_at, created_by)
            VALUES (?, ?, ?, ?, ?)
        """, (str(uuid.uuid4()), version["id"], tag_name, 
              datetime.utcnow().isoformat(), tagged_by))
        
        self.db.commit()
    
    def remove_tag(self, artifact_id: str, version_number: int, tag_name: str):
        """Удаляет тег с версии"""
        
        self.db.execute("""
            DELETE FROM version_tags 
            WHERE artifact_version_id IN (
                SELECT id FROM artifact_versions 
                WHERE artifact_id = ? AND version_number = ?
            ) AND tag_name = ?
        """, (artifact_id, version_number, tag_name))
        
        self.db.commit()
    
    def get_versions_by_tag(self, artifact_id: str, tag_name: str) -> List[ArtifactVersion]:
        """Возвращает все версии с указанным тегом"""
        
        rows = self.db.fetchall("""
            SELECT av.* FROM artifact_versions av
            JOIN version_tags vt ON av.id = vt.artifact_version_id
            WHERE av.artifact_id = ? AND vt.tag_name = ?
            ORDER BY av.version_number DESC
        """, (artifact_id, tag_name))
        
        return [self._row_to_version(row) for row in rows]
```

---

## 📊 UI для истории версий

### Version History Panel

```markdown
## 📜 Version History: concept.md

| Version | Date | Author | Type | Summary | Tags |
|---------|------|--------|------|---------|------|
| v4 | Jan 7, 15:30 | user | update | Added pricing strategy | ✅ approved |
| v3 | Jan 7, 14:45 | facilitator | update | Synthesized agent feedback | 🔍 needs-review |
| v2 | Jan 7, 14:00 | realist | update | Added competitor analysis | |
| v1 | Jan 7, 12:00 | system | create | Initial creation | 📌 baseline |

### Actions
- [Compare v3 → v4] [Rollback to v3] [View Diff]
```

### Diff View

```diff
--- concept.md (v3)
+++ concept.md (v4)
@@ -45,6 +45,15 @@
 ## Value Proposition
 Simple, fast, developer-focused task management.

+## Pricing Strategy
+
+| Tier | Price | Features |
+|------|-------|----------|
+| Free | $0 | Basic tasks, 3 projects |
+| Pro | $9/mo | Unlimited projects, API access |
+| Team | $19/user/mo | Collaboration, analytics |
+
 ## Competitive Analysis
```

---

## ✅ Checklist для каждого артефакта

- [ ] Файл создан в `.iflow/docs/`
- [ ] Git commit выполнен
- [ ] Запись в SQLite добавлена
- [ ] Тег `draft` установлен
- [ ] При updates: проверено наличие изменений
- [ ] При updates: change_summary заполнен
- [ ] При конфликтах: стратегия разрешения выбрана

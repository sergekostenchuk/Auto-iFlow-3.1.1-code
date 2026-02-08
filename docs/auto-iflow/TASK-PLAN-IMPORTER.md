# Task Plan Importer (Plan Loader)

This document describes the markdown format for importing task plans into Auto‑iFlow, plus the limitations and examples.

## What it does

- Parses a markdown plan file into structured tasks.
- Creates Auto‑iFlow tasks in the selected project.
- Optionally auto‑starts tasks after import.
- Supports parallel groups using `parallel: true/false` hints.

## Supported structure

### Sections

Use markdown headings to create sections:

```
# Section Title
## Subsection Title
```

Sections are optional but recommended. If tasks appear before any heading, they are placed in a default `General` section.

### Tasks (required)

Tasks must use checklist syntax:

```
- [ ] Task title
- [x] Completed task (ignored by importer, treated as task with checked=true)
```

### Parallel hints

You can mark tasks as parallel or sequential using a `parallel: true/false` hint anywhere in the line:

```
- [ ] Run unit tests (parallel: true)
- [ ] Deploy release (parallel: false)
```

When omitted, `parallel` is `null` and the scheduler will decide grouping based on other tasks.

### Example file

See: `docs/auto-iflow/examples/TASK-PLAN.md`

## Output behavior

The importer returns a summary with:

- `createdTaskIds`
- `skipped` (e.g., missing title)
- `errors`
- `totalTasks`

## Limitations

- At least one checklist task is required. Files with no tasks fail import.
- Task titles must be non‑empty. Empty titles are skipped.
- Markdown outside checklist items is ignored.
- `parallel` flags are hints; concurrency is still limited by `maxConcurrency`.
- Auto‑start only runs for tasks successfully created.

## Quick start

1. Prepare a markdown plan file.
2. Open **Settings → Project → Import Task Plan**.
3. Select the file and choose `Auto‑start` if needed.
4. Review the import summary.


# Crow Tasks

First-class to-do list bundle for [Crow](https://github.com/kh0pp/crow). Each Crow instance owns its own tasks — no federation.

## Features

- Tasks with title, description, status, priority (1-5), due date, phase, owner, tags.
- **Subtasks** via self-referential parent_id with cascade delete.
- **Recurring tasks** with daily / weekly / monthly / yearly patterns and configurable interval. On complete, the next occurrence is materialized automatically.
- **Crow-project linkage** via `project_id` (soft link to the Crow `projects` table — no FK constraint, safe on instances without projects).
- **Briefings history** — daily briefings computed from pending tasks land in `tasks_briefings` (one row per day, overwrites on re-run).

## Tables

- `tasks_items` — the task rows.
- `tasks_recurrence` — recurrence rules (pattern, interval, until_date, next_occurrence).
- `tasks_briefings` — daily briefing snapshots (UNIQUE on `briefing_date`).

All tables are created automatically on first start via `CREATE TABLE IF NOT EXISTS` (idempotent).

## MCP tools

| Tool | Purpose |
|------|---------|
| `tasks_list` | Query tasks with filters (status, due_within_days, overdue, project_id, parent_id). |
| `tasks_get` | Fetch one task + its recurrence row. |
| `tasks_create` | Create a task; pass `recurrence` to make it recurring. |
| `tasks_update` | Patch fields on an existing task. |
| `tasks_complete` | Mark done; materializes next recurrence if applicable. |
| `tasks_reopen` | Move done/cancelled back to pending. |
| `tasks_delete` | Delete (cascades subtasks). |
| `tasks_add_subtask` | Convenience: create a task with `parent_id` preset. |
| `tasks_set_recurrence` | Attach/replace/remove a recurrence rule. |
| `tasks_briefing_snapshot` | Compute today's briefing markdown (pure read). |
| `tasks_store_briefing` | Persist a briefing snapshot. |
| `tasks_list_briefings` | List stored briefings newest-first. |
| `tasks_get_briefing` | Read one briefing by id or date. |

## Installation

Via the Crow Extensions panel, or manually:

```bash
cd ~/.crow/bundles        # or ~/.crow-mpa/bundles for alternate instances
ln -s /path/to/crow-addons/tasks .
cd tasks && npm install
```

Register the MCP server in `<instance-home>/mcp-addons.json`:

```json
{
  "tasks": {
    "command": "node",
    "args": ["server/index.js"]
  }
}
```

Restart the gateway.

## Author

Published by [Maestro Press](https://maestro.press).

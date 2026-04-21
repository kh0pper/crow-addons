---
name: tasks
description: First-class to-do list with due dates, subtasks, and recurring tasks. Use tasks_* MCP tools to create, update, and complete work items on the active Crow instance.
triggers:
  - add a task
  - make a todo
  - add to my to-do list
  - mark task done
  - show my tasks
  - what's due today
  - what's overdue
  - add a subtask
  - recurring task
  - today's briefing
tools:
  - tasks_list
  - tasks_get
  - tasks_create
  - tasks_update
  - tasks_complete
  - tasks_reopen
  - tasks_delete
  - tasks_add_subtask
  - tasks_set_recurrence
  - tasks_briefing_snapshot
  - tasks_store_briefing
  - tasks_list_briefings
  - tasks_get_briefing
---

# Tasks Skill

First-class to-do list for the active Crow instance. Each instance owns its own tasks — there is no federation.

## When to use

- The user wants to add, view, update, or complete a to-do item.
- The user asks what's due, what's overdue, or what's upcoming.
- The user wants to break a task into subtasks or set a recurrence rule.
- The user asks about the daily briefing (today's list or the history).

Do **not** store to-dos as memories with `category="strategy-task"` anymore — that pattern has been replaced by this bundle.

## Quick reference

### Adding a task

```
tasks_create({
  title: "Finalize capstone proposal draft",
  due_date: "2026-04-23",
  priority: 4,
  phase: "proposal",
  owner: "kevin",
  tags: "capstone"
})
```

### Adding a subtask

```
tasks_add_subtask({ parent_id: 12, title: "Outline intro section", due_date: "2026-04-22" })
```

### Adding a recurring task

```
tasks_create({
  title: "Weekly research log entry",
  due_date: "2026-04-22",
  recurrence: { pattern: "weekly", interval: 1 }
})
```

On complete, `tasks_complete` automatically creates the next occurrence.

### Listing

```
tasks_list({ status: "open" })                           # pending + in_progress
tasks_list({ due_within_days: 3 })                       # upcoming
tasks_list({ overdue: true })                            # overdue only
tasks_list({ project_id: 42 })                           # scoped to a project
tasks_list({ parent_id: 12 })                            # subtasks of task 12
tasks_list({ parent_id: null })                          # top-level only
```

### Completing / reopening

```
tasks_complete({ id: 12 })     # sets status=done, completed_at, materializes next recurrence
tasks_reopen({ id: 12 })       # back to pending
```

### Updating

Pass only the fields you're changing. Omitted fields are untouched.

```
tasks_update({ id: 12, status: "in_progress", priority: 5 })
tasks_update({ id: 12, due_date: null })    # clear a field with explicit null
```

## Briefings

The `mpa-daily-briefing` pipeline calls:

1. `tasks_briefing_snapshot({ today, window_days: 3 })` → returns pre-rendered markdown content and counts.
2. `tasks_store_briefing({ briefing_date: today, content })` → persists (UNIQUE on date — re-runs overwrite).
3. `crow_create_notification({ action_url: "/dashboard/tasks?briefing=<id>", ... })`.

Historical briefings are readable via `tasks_list_briefings` and `tasks_get_briefing`.

## Status values

`pending` (default), `in_progress`, `done`, `cancelled`. `tasks_list` defaults to `status="open"` which matches `pending` + `in_progress`.

## Priorities

1 (low) .. 5 (critical). Default 3.

## Dates

All dates are `YYYY-MM-DD` strings. `tasks_briefing_snapshot` defaults to UTC today; pass an explicit `today` to override.

/**
 * Crow Tasks — MCP tool handlers.
 *
 * Registered on the MCP server in server/index.js. Each handler returns
 * {content: [{type: "text", text: <json-string>}]} per MCP convention.
 * Errors set isError:true and embed a `message` field.
 */

import { z } from "zod";
import { advanceDate, isExhausted } from "./recurrence.js";

function ok(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}
function err(message) {
  return { content: [{ type: "text", text: JSON.stringify({ error: message }, null, 2) }], isError: true };
}

function rowToItem(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    title: r.title,
    description: r.description,
    status: r.status,
    priority: Number(r.priority),
    due_date: r.due_date,
    phase: r.phase,
    owner: r.owner,
    tags: r.tags,
    project_id: r.project_id != null ? Number(r.project_id) : null,
    parent_id: r.parent_id != null ? Number(r.parent_id) : null,
    recurrence_id: r.recurrence_id != null ? Number(r.recurrence_id) : null,
    created_at: r.created_at,
    updated_at: r.updated_at,
    completed_at: r.completed_at,
  };
}

async function getItem(db, id) {
  const { rows } = await db.execute({ sql: "SELECT * FROM tasks_items WHERE id = ?", args: [id] });
  return rowToItem(rows[0]);
}

async function getRecurrence(db, id) {
  if (id == null) return null;
  const { rows } = await db.execute({ sql: "SELECT * FROM tasks_recurrence WHERE id = ?", args: [id] });
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    id: Number(r.id),
    pattern: r.pattern,
    interval: Number(r.interval),
    until_date: r.until_date,
    next_occurrence: r.next_occurrence,
    last_occurrence: r.last_occurrence,
  };
}

function todayIsoUtc() {
  return new Date().toISOString().slice(0, 10);
}

function bucketByDue(items, todayIso, windowDays) {
  const within = [];
  const overdue = [];
  const other = [];
  for (const it of items) {
    if (!it.due_date) { other.push(it); continue; }
    if (it.due_date < todayIso) { overdue.push(it); continue; }
    const deltaDays = Math.floor((new Date(it.due_date + "T00:00:00Z") - new Date(todayIso + "T00:00:00Z")) / 86400000);
    if (deltaDays <= windowDays) within.push(it);
    else other.push(it);
  }
  within.sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""));
  overdue.sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""));
  return { within, overdue, other };
}

function renderBriefingMarkdown({ within, overdue }, windowDays) {
  const lines = [];
  lines.push(`## Due within ${windowDays * 24}h`);
  if (within.length === 0) lines.push("- (nothing)");
  else for (const it of within) lines.push(`- [due:${it.due_date}] ${it.title}`);
  lines.push("");
  lines.push("## Overdue");
  if (overdue.length === 0) lines.push("- (nothing)");
  else for (const it of overdue) lines.push(`- [due:${it.due_date}] ${it.title}`);
  return lines.join("\n");
}

export function registerTasksTools(server, db) {
  // ─── tasks_list ─────────────────────────────────────────────────────────
  server.tool(
    "tasks_list",
    "List tasks with optional filters. Returns an array of task items (newest first by due_date asc, then updated_at desc).",
    {
      status: z.enum(["pending", "in_progress", "done", "cancelled", "open", "any"]).optional().describe("Filter by status. 'open' = pending+in_progress. 'any' = no filter. Default: open."),
      due_within_days: z.number().int().min(0).max(365).optional().describe("Only include tasks with due_date today..today+N."),
      overdue: z.boolean().optional().describe("If true, include only tasks with due_date < today and not done."),
      project_id: z.number().int().optional().describe("Filter by Crow project_id."),
      parent_id: z.number().int().nullable().optional().describe("Pass a number for subtasks of that parent; pass null to restrict to top-level tasks."),
      limit: z.number().int().min(1).max(500).optional().describe("Max rows (default 100)."),
    },
    async (args) => {
      try {
        const clauses = [];
        const params = [];
        const status = args.status || "open";
        if (status === "open") {
          clauses.push("status IN ('pending','in_progress')");
        } else if (status !== "any") {
          clauses.push("status = ?");
          params.push(status);
        }
        if (args.due_within_days != null) {
          const today = todayIsoUtc();
          const end = advanceDate(today, "daily", args.due_within_days);
          clauses.push("due_date IS NOT NULL AND due_date >= ? AND due_date <= ?");
          params.push(today, end);
        }
        if (args.overdue) {
          clauses.push("due_date IS NOT NULL AND due_date < ? AND status IN ('pending','in_progress')");
          params.push(todayIsoUtc());
        }
        if (args.project_id != null) {
          clauses.push("project_id = ?");
          params.push(args.project_id);
        }
        if (args.parent_id === null) {
          clauses.push("parent_id IS NULL");
        } else if (args.parent_id != null) {
          clauses.push("parent_id = ?");
          params.push(args.parent_id);
        }
        const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
        const limit = args.limit || 100;
        const { rows } = await db.execute({
          sql: `SELECT * FROM tasks_items ${where}
                ORDER BY (due_date IS NULL), due_date ASC, updated_at DESC
                LIMIT ?`,
          args: [...params, limit],
        });
        return ok({ count: rows.length, items: rows.map(rowToItem) });
      } catch (e) {
        return err(e.message);
      }
    }
  );

  // ─── tasks_get ──────────────────────────────────────────────────────────
  server.tool(
    "tasks_get",
    "Fetch a single task by id, with its recurrence row inlined if any.",
    { id: z.number().int().describe("Task id.") },
    async ({ id }) => {
      try {
        const item = await getItem(db, id);
        if (!item) return err(`task ${id} not found`);
        const recurrence = await getRecurrence(db, item.recurrence_id);
        return ok({ item, recurrence });
      } catch (e) { return err(e.message); }
    }
  );

  // ─── tasks_create ───────────────────────────────────────────────────────
  server.tool(
    "tasks_create",
    "Create a new task. If `recurrence` is passed, a tasks_recurrence row is created and linked.",
    {
      title: z.string().min(1).max(500),
      description: z.string().max(10000).optional(),
      status: z.enum(["pending", "in_progress"]).optional().describe("Default: pending."),
      priority: z.number().int().min(1).max(5).optional().describe("1=low, 5=critical. Default 3."),
      due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD."),
      phase: z.string().max(100).optional(),
      owner: z.string().max(100).optional(),
      tags: z.string().max(500).optional().describe("Free-form, comma-separated."),
      project_id: z.number().int().optional().describe("Link to Crow projects.id."),
      parent_id: z.number().int().optional().describe("Make this a subtask of another task."),
      recurrence: z
        .object({
          pattern: z.enum(["daily", "weekly", "monthly", "yearly"]),
          interval: z.number().int().min(1).max(365).optional().describe("Default 1."),
          until_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        })
        .optional(),
    },
    async (args) => {
      try {
        let recurrenceId = null;
        if (args.recurrence) {
          const next = args.due_date ? advanceDate(args.due_date, args.recurrence.pattern, args.recurrence.interval || 1) : null;
          const rec = await db.execute({
            sql: `INSERT INTO tasks_recurrence (pattern, interval, until_date, next_occurrence) VALUES (?, ?, ?, ?)`,
            args: [
              args.recurrence.pattern,
              args.recurrence.interval || 1,
              args.recurrence.until_date || null,
              next,
            ],
          });
          recurrenceId = Number(rec.lastInsertRowid);
        }
        const result = await db.execute({
          sql: `INSERT INTO tasks_items (title, description, status, priority, due_date, phase, owner, tags, project_id, parent_id, recurrence_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            args.title,
            args.description || null,
            args.status || "pending",
            args.priority || 3,
            args.due_date || null,
            args.phase || null,
            args.owner || null,
            args.tags || null,
            args.project_id ?? null,
            args.parent_id ?? null,
            recurrenceId,
          ],
        });
        const item = await getItem(db, Number(result.lastInsertRowid));
        return ok({ item });
      } catch (e) { return err(e.message); }
    }
  );

  // ─── tasks_update ───────────────────────────────────────────────────────
  server.tool(
    "tasks_update",
    "Update fields on an existing task. Omitted fields are left unchanged.",
    {
      id: z.number().int(),
      title: z.string().min(1).max(500).optional(),
      description: z.string().max(10000).nullable().optional(),
      status: z.enum(["pending", "in_progress", "done", "cancelled"]).optional(),
      priority: z.number().int().min(1).max(5).optional(),
      due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      phase: z.string().max(100).nullable().optional(),
      owner: z.string().max(100).nullable().optional(),
      tags: z.string().max(500).nullable().optional(),
      project_id: z.number().int().nullable().optional(),
      parent_id: z.number().int().nullable().optional(),
    },
    async (args) => {
      try {
        const existing = await getItem(db, args.id);
        if (!existing) return err(`task ${args.id} not found`);
        const fields = [];
        const params = [];
        const setIf = (key) => {
          if (Object.prototype.hasOwnProperty.call(args, key)) {
            fields.push(`${key} = ?`);
            params.push(args[key] === undefined ? null : args[key]);
          }
        };
        ["title", "description", "status", "priority", "due_date", "phase", "owner", "tags", "project_id", "parent_id"].forEach(setIf);
        if (fields.length === 0) return ok({ item: existing, unchanged: true });
        fields.push("updated_at = datetime('now')");
        if (args.status === "done" && existing.status !== "done") {
          fields.push("completed_at = datetime('now')");
        } else if (args.status && args.status !== "done" && existing.completed_at) {
          fields.push("completed_at = NULL");
        }
        params.push(args.id);
        await db.execute({
          sql: `UPDATE tasks_items SET ${fields.join(", ")} WHERE id = ?`,
          args: params,
        });
        return ok({ item: await getItem(db, args.id) });
      } catch (e) { return err(e.message); }
    }
  );

  // ─── tasks_complete ─────────────────────────────────────────────────────
  server.tool(
    "tasks_complete",
    "Mark a task done. If the task has a recurrence, a new pending task is created with the next occurrence as its due_date (and the recurrence link moves to the new task).",
    { id: z.number().int() },
    async ({ id }) => {
      try {
        const existing = await getItem(db, id);
        if (!existing) return err(`task ${id} not found`);
        if (existing.status === "done") return ok({ item: existing, already_done: true });
        await db.execute({
          sql: "UPDATE tasks_items SET status='done', completed_at=datetime('now'), updated_at=datetime('now') WHERE id = ?",
          args: [id],
        });
        let next = null;
        const recurrence = await getRecurrence(db, existing.recurrence_id);
        if (recurrence && existing.due_date) {
          const nextDue = advanceDate(existing.due_date, recurrence.pattern, recurrence.interval);
          if (!isExhausted(nextDue, recurrence.until_date)) {
            await db.execute({
              sql: "UPDATE tasks_recurrence SET last_occurrence = ?, next_occurrence = ? WHERE id = ?",
              args: [existing.due_date, nextDue, recurrence.id],
            });
            await db.execute({
              sql: "UPDATE tasks_items SET recurrence_id = NULL WHERE id = ?",
              args: [id],
            });
            const ins = await db.execute({
              sql: `INSERT INTO tasks_items (title, description, status, priority, due_date, phase, owner, tags, project_id, parent_id, recurrence_id)
                    VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`,
              args: [
                existing.title,
                existing.description,
                existing.priority,
                nextDue,
                existing.phase,
                existing.owner,
                existing.tags,
                existing.project_id,
                existing.parent_id,
                recurrence.id,
              ],
            });
            next = await getItem(db, Number(ins.lastInsertRowid));
          }
        }
        return ok({ item: await getItem(db, id), next_occurrence: next });
      } catch (e) { return err(e.message); }
    }
  );

  // ─── tasks_reopen ───────────────────────────────────────────────────────
  server.tool(
    "tasks_reopen",
    "Move a done/cancelled task back to pending.",
    { id: z.number().int() },
    async ({ id }) => {
      try {
        const existing = await getItem(db, id);
        if (!existing) return err(`task ${id} not found`);
        await db.execute({
          sql: "UPDATE tasks_items SET status='pending', completed_at=NULL, updated_at=datetime('now') WHERE id = ?",
          args: [id],
        });
        return ok({ item: await getItem(db, id) });
      } catch (e) { return err(e.message); }
    }
  );

  // ─── tasks_delete ───────────────────────────────────────────────────────
  server.tool(
    "tasks_delete",
    "Delete a task. Subtasks cascade. Recurrence rows are preserved (set NULL on any other linked task).",
    { id: z.number().int() },
    async ({ id }) => {
      try {
        const existing = await getItem(db, id);
        if (!existing) return err(`task ${id} not found`);
        await db.execute({ sql: "DELETE FROM tasks_items WHERE id = ?", args: [id] });
        return ok({ deleted: id });
      } catch (e) { return err(e.message); }
    }
  );

  // ─── tasks_add_subtask ──────────────────────────────────────────────────
  server.tool(
    "tasks_add_subtask",
    "Add a subtask under an existing task. Convenience wrapper over tasks_create.",
    {
      parent_id: z.number().int(),
      title: z.string().min(1).max(500),
      description: z.string().max(10000).optional(),
      due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      priority: z.number().int().min(1).max(5).optional(),
      owner: z.string().max(100).optional(),
    },
    async (args) => {
      try {
        const parent = await getItem(db, args.parent_id);
        if (!parent) return err(`parent task ${args.parent_id} not found`);
        const result = await db.execute({
          sql: `INSERT INTO tasks_items (title, description, status, priority, due_date, owner, project_id, parent_id)
                VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)`,
          args: [
            args.title,
            args.description || null,
            args.priority || 3,
            args.due_date || null,
            args.owner || parent.owner || null,
            parent.project_id,
            args.parent_id,
          ],
        });
        return ok({ item: await getItem(db, Number(result.lastInsertRowid)) });
      } catch (e) { return err(e.message); }
    }
  );

  // ─── tasks_set_recurrence ───────────────────────────────────────────────
  server.tool(
    "tasks_set_recurrence",
    "Attach or replace a recurrence rule on a task. Pass pattern=null to remove.",
    {
      id: z.number().int(),
      pattern: z.enum(["daily", "weekly", "monthly", "yearly"]).nullable(),
      interval: z.number().int().min(1).max(365).optional(),
      until_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    },
    async (args) => {
      try {
        const existing = await getItem(db, args.id);
        if (!existing) return err(`task ${args.id} not found`);
        if (args.pattern === null) {
          await db.execute({
            sql: "UPDATE tasks_items SET recurrence_id = NULL, updated_at = datetime('now') WHERE id = ?",
            args: [args.id],
          });
          return ok({ item: await getItem(db, args.id), recurrence_removed: true });
        }
        const next = existing.due_date ? advanceDate(existing.due_date, args.pattern, args.interval || 1) : null;
        let recurrenceId = existing.recurrence_id;
        if (recurrenceId) {
          await db.execute({
            sql: "UPDATE tasks_recurrence SET pattern = ?, interval = ?, until_date = ?, next_occurrence = ? WHERE id = ?",
            args: [args.pattern, args.interval || 1, args.until_date || null, next, recurrenceId],
          });
        } else {
          const ins = await db.execute({
            sql: "INSERT INTO tasks_recurrence (pattern, interval, until_date, next_occurrence) VALUES (?, ?, ?, ?)",
            args: [args.pattern, args.interval || 1, args.until_date || null, next],
          });
          recurrenceId = Number(ins.lastInsertRowid);
          await db.execute({
            sql: "UPDATE tasks_items SET recurrence_id = ?, updated_at = datetime('now') WHERE id = ?",
            args: [recurrenceId, args.id],
          });
        }
        return ok({ item: await getItem(db, args.id), recurrence: await getRecurrence(db, recurrenceId) });
      } catch (e) { return err(e.message); }
    }
  );

  // ─── tasks_briefing_snapshot ────────────────────────────────────────────
  server.tool(
    "tasks_briefing_snapshot",
    "Compute today's briefing as markdown. Returns pre-formatted content with 'Due within Nh' and 'Overdue' buckets. Does not store — pair with tasks_store_briefing.",
    {
      today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD. Defaults to UTC today."),
      window_days: z.number().int().min(1).max(30).optional().describe("How many days ahead count as 'upcoming'. Default 3."),
    },
    async (args) => {
      try {
        const today = args.today || todayIsoUtc();
        const windowDays = args.window_days || 3;
        const { rows } = await db.execute({
          sql: "SELECT * FROM tasks_items WHERE status IN ('pending','in_progress') AND due_date IS NOT NULL",
          args: [],
        });
        const items = rows.map(rowToItem);
        const buckets = bucketByDue(items, today, windowDays);
        const content = renderBriefingMarkdown(buckets, windowDays);
        return ok({
          today,
          window_days: windowDays,
          content,
          counts: { within: buckets.within.length, overdue: buckets.overdue.length },
        });
      } catch (e) { return err(e.message); }
    }
  );

  // ─── tasks_store_briefing ───────────────────────────────────────────────
  server.tool(
    "tasks_store_briefing",
    "Persist a briefing snapshot. UNIQUE on briefing_date — re-runs for the same day overwrite the prior content.",
    {
      briefing_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      content: z.string().min(1).max(100000),
    },
    async ({ briefing_date, content }) => {
      try {
        await db.execute({
          sql: `INSERT INTO tasks_briefings (briefing_date, content) VALUES (?, ?)
                ON CONFLICT(briefing_date) DO UPDATE SET content = excluded.content, created_at = datetime('now')`,
          args: [briefing_date, content],
        });
        const { rows } = await db.execute({
          sql: "SELECT id, briefing_date, content, created_at FROM tasks_briefings WHERE briefing_date = ?",
          args: [briefing_date],
        });
        const r = rows[0];
        return ok({ id: Number(r.id), briefing_date: r.briefing_date, created_at: r.created_at });
      } catch (e) { return err(e.message); }
    }
  );

  // ─── tasks_list_briefings ───────────────────────────────────────────────
  server.tool(
    "tasks_list_briefings",
    "List stored briefings newest-first. Returns id, briefing_date, created_at, and a content preview.",
    {
      limit: z.number().int().min(1).max(365).optional(),
    },
    async ({ limit }) => {
      try {
        const { rows } = await db.execute({
          sql: `SELECT id, briefing_date, substr(content, 1, 200) as preview, created_at
                FROM tasks_briefings ORDER BY briefing_date DESC LIMIT ?`,
          args: [limit || 30],
        });
        return ok({
          count: rows.length,
          items: rows.map((r) => ({
            id: Number(r.id),
            briefing_date: r.briefing_date,
            preview: r.preview,
            created_at: r.created_at,
          })),
        });
      } catch (e) { return err(e.message); }
    }
  );

  // ─── tasks_get_briefing ─────────────────────────────────────────────────
  server.tool(
    "tasks_get_briefing",
    "Fetch one stored briefing by id or by briefing_date.",
    {
      id: z.number().int().optional(),
      briefing_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    },
    async ({ id, briefing_date }) => {
      try {
        if (id == null && !briefing_date) return err("pass id or briefing_date");
        const sql = id != null
          ? "SELECT id, briefing_date, content, created_at FROM tasks_briefings WHERE id = ?"
          : "SELECT id, briefing_date, content, created_at FROM tasks_briefings WHERE briefing_date = ?";
        const { rows } = await db.execute({ sql, args: [id != null ? id : briefing_date] });
        if (!rows[0]) return err("briefing not found");
        const r = rows[0];
        return ok({
          id: Number(r.id),
          briefing_date: r.briefing_date,
          content: r.content,
          created_at: r.created_at,
        });
      } catch (e) { return err(e.message); }
    }
  );
}

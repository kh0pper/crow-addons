/**
 * Tasks API Routes — Express router for the Tasks panel.
 *
 * All POSTs live here; GETs are served by the panel handler in tasks.js.
 *
 * Auth is path-scoped under /api so this router doesn't intercept
 * unmatched traffic destined for panels mounted after it (see the loud
 * warning in servers/gateway/index.js around panel-routes mounting).
 *
 * Each handler accepts a `return_to` hidden input and redirects there on
 * success via res.redirectAfterPost(); defaults to /dashboard/tasks.
 *
 * Completion materializes the next occurrence for recurring tasks by
 * importing the bundle's recurrence helpers directly. Bundle location
 * resolves via CROW_HOME → ~/.crow/bundles/tasks/ → repo fallback.
 */

import { Router } from "express";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { homedir } from "node:os";

function resolveBundleServer() {
  const crowDir = process.env.CROW_HOME || join(homedir(), ".crow");
  const installed = join(crowDir, "bundles", "tasks", "server");
  if (existsSync(installed)) return installed;
  return join(import.meta.dirname, "..", "server");
}

const serverDir = resolveBundleServer();
const { createDbClient } = await import(pathToFileURL(join(serverDir, "db.js")).href);
const { advanceDate, isExhausted } = await import(pathToFileURL(join(serverDir, "recurrence.js")).href);

function safeReturnTo(raw, fallback = "/dashboard/tasks") {
  if (!raw) return fallback;
  const s = String(raw);
  if (!s.startsWith("/dashboard/tasks")) return fallback;
  return s;
}

function cleanField(v) {
  if (v === undefined) return null;
  if (typeof v === "string") {
    const trimmed = v.trim();
    return trimmed === "" ? null : trimmed;
  }
  return v;
}

function parsePriority(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 3;
  return Math.min(5, Math.max(1, Math.round(n)));
}

function parseStatus(v) {
  const valid = new Set(["pending", "in_progress", "done", "cancelled"]);
  return valid.has(v) ? v : "pending";
}

async function upsertRecurrence(db, { existingId, pattern, interval, until, dueDate }) {
  const normalizedPattern = pattern && pattern !== "none" ? pattern : null;

  if (!normalizedPattern) {
    // Clear recurrence if the user chose "none". Leaves the row in place
    // for history; the task's recurrence_id just gets nulled.
    return null;
  }

  const validPatterns = new Set(["daily", "weekly", "monthly", "yearly"]);
  if (!validPatterns.has(normalizedPattern)) return null;

  const intervalN = Math.max(1, Math.round(Number(interval) || 1));
  const untilDate = cleanField(until);
  const anchor = dueDate || new Date().toISOString().slice(0, 10);
  const nextOccurrence = advanceDate(anchor, normalizedPattern, intervalN);

  if (existingId) {
    await db.execute({
      sql: `UPDATE tasks_recurrence
            SET pattern = ?, interval = ?, until_date = ?, next_occurrence = ?
            WHERE id = ?`,
      args: [normalizedPattern, intervalN, untilDate, nextOccurrence, existingId],
    });
    return existingId;
  }

  const result = await db.execute({
    sql: `INSERT INTO tasks_recurrence (pattern, interval, until_date, next_occurrence)
          VALUES (?, ?, ?, ?)`,
    args: [normalizedPattern, intervalN, untilDate, nextOccurrence],
  });
  return Number(result.lastInsertRowid);
}

export default function tasksRouter(authMiddleware) {
  const router = Router();
  const db = createDbClient();

  // Path-scoped auth — NEVER use router.use(authMiddleware) unscoped.
  router.use("/api", authMiddleware);

  // -------------------------------------------------------------
  // Create a task (optionally with recurrence, optionally a subtask)
  // -------------------------------------------------------------
  router.post("/api/tasks/create", async (req, res) => {
    try {
      const title = cleanField(req.body.title);
      if (!title) {
        return res.redirectAfterPost(safeReturnTo(req.body.return_to, "/dashboard/tasks?new=1"));
      }

      const description = cleanField(req.body.description);
      const status = parseStatus(req.body.status);
      const priority = parsePriority(req.body.priority);
      const due_date = cleanField(req.body.due_date);
      const phase = cleanField(req.body.phase);
      const owner = cleanField(req.body.owner);
      const tags = cleanField(req.body.tags);
      const project_id = cleanField(req.body.project_id);
      const parent_id = cleanField(req.body.parent_id);

      const recurrenceId = await upsertRecurrence(db, {
        existingId: null,
        pattern: req.body.recurrence_pattern,
        interval: req.body.recurrence_interval,
        until: req.body.recurrence_until,
        dueDate: due_date,
      });

      await db.execute({
        sql: `INSERT INTO tasks_items
                (title, description, status, priority, due_date, phase, owner, tags, project_id, parent_id, recurrence_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          title, description, status, priority,
          due_date, phase, owner, tags,
          project_id != null ? Number(project_id) : null,
          parent_id != null ? Number(parent_id) : null,
          recurrenceId,
        ],
      });

      return res.redirectAfterPost(safeReturnTo(req.body.return_to));
    } catch (err) {
      console.error("[tasks-routes] create failed:", err);
      return res.redirectAfterPost(safeReturnTo(req.body.return_to));
    }
  });

  // -------------------------------------------------------------
  // Update a task (all fields optional; only changed fields persist)
  // -------------------------------------------------------------
  router.post("/api/tasks/:id/update", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const existing = await db.execute({ sql: "SELECT * FROM tasks_items WHERE id = ?", args: [id] });
      if (!existing.rows[0]) return res.redirectAfterPost(safeReturnTo(req.body.return_to));
      const current = existing.rows[0];

      const updates = [];
      const args = [];
      const setField = (col, value) => { updates.push(`${col} = ?`); args.push(value); };

      if (req.body.title !== undefined) setField("title", cleanField(req.body.title) || current.title);
      if (req.body.description !== undefined) setField("description", cleanField(req.body.description));
      if (req.body.status !== undefined) {
        const newStatus = parseStatus(req.body.status);
        setField("status", newStatus);
        if (newStatus === "done" && current.status !== "done") {
          setField("completed_at", new Date().toISOString());
        } else if (newStatus !== "done") {
          setField("completed_at", null);
        }
      }
      if (req.body.priority !== undefined) setField("priority", parsePriority(req.body.priority));
      if (req.body.due_date !== undefined) setField("due_date", cleanField(req.body.due_date));
      if (req.body.phase !== undefined) setField("phase", cleanField(req.body.phase));
      if (req.body.owner !== undefined) setField("owner", cleanField(req.body.owner));
      if (req.body.tags !== undefined) setField("tags", cleanField(req.body.tags));
      if (req.body.project_id !== undefined) {
        const pid = cleanField(req.body.project_id);
        setField("project_id", pid != null ? Number(pid) : null);
      }

      // Recurrence is optional; only touch if the caller submitted a pattern field
      if (req.body.recurrence_pattern !== undefined) {
        const newRecurrenceId = await upsertRecurrence(db, {
          existingId: current.recurrence_id || null,
          pattern: req.body.recurrence_pattern,
          interval: req.body.recurrence_interval,
          until: req.body.recurrence_until,
          dueDate: cleanField(req.body.due_date) || current.due_date,
        });
        setField("recurrence_id", newRecurrenceId);
      }

      if (updates.length === 0) return res.redirectAfterPost(safeReturnTo(req.body.return_to));

      updates.push("updated_at = datetime('now')");
      args.push(id);
      await db.execute({ sql: `UPDATE tasks_items SET ${updates.join(", ")} WHERE id = ?`, args });

      return res.redirectAfterPost(safeReturnTo(req.body.return_to));
    } catch (err) {
      console.error("[tasks-routes] update failed:", err);
      return res.redirectAfterPost(safeReturnTo(req.body.return_to));
    }
  });

  // -------------------------------------------------------------
  // Complete — marks done, materializes next recurrence if applicable
  // -------------------------------------------------------------
  router.post("/api/tasks/:id/complete", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const existing = await db.execute({ sql: "SELECT * FROM tasks_items WHERE id = ?", args: [id] });
      if (!existing.rows[0]) return res.redirectAfterPost(safeReturnTo(req.body.return_to));
      const current = existing.rows[0];

      await db.execute({
        sql: "UPDATE tasks_items SET status = 'done', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
        args: [id],
      });

      // Materialize next occurrence for recurring tasks
      if (current.recurrence_id) {
        const rec = await db.execute({
          sql: "SELECT * FROM tasks_recurrence WHERE id = ?",
          args: [Number(current.recurrence_id)],
        });
        const r = rec.rows[0];
        if (r) {
          const anchor = current.due_date || new Date().toISOString().slice(0, 10);
          const nextDue = advanceDate(anchor, r.pattern, Number(r.interval) || 1);
          const exhausted = isExhausted(nextDue, r.until_date);
          if (!exhausted) {
            // Clone the task with the advanced due date
            await db.execute({
              sql: `INSERT INTO tasks_items
                      (title, description, status, priority, due_date, phase, owner, tags, project_id, parent_id, recurrence_id)
                    VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`,
              args: [
                current.title,
                current.description,
                Number(current.priority) || 3,
                nextDue,
                current.phase,
                current.owner,
                current.tags,
                current.project_id,
                current.parent_id,
                current.recurrence_id,
              ],
            });
            await db.execute({
              sql: `UPDATE tasks_recurrence
                    SET last_occurrence = ?, next_occurrence = ?
                    WHERE id = ?`,
              args: [anchor, advanceDate(nextDue, r.pattern, Number(r.interval) || 1), Number(current.recurrence_id)],
            });
          }
        }
      }

      return res.redirectAfterPost(safeReturnTo(req.body.return_to));
    } catch (err) {
      console.error("[tasks-routes] complete failed:", err);
      return res.redirectAfterPost(safeReturnTo(req.body.return_to));
    }
  });

  // -------------------------------------------------------------
  // Reopen — clears done state
  // -------------------------------------------------------------
  router.post("/api/tasks/:id/reopen", async (req, res) => {
    try {
      const id = Number(req.params.id);
      await db.execute({
        sql: "UPDATE tasks_items SET status = 'pending', completed_at = NULL, updated_at = datetime('now') WHERE id = ?",
        args: [id],
      });
      return res.redirectAfterPost(safeReturnTo(req.body.return_to));
    } catch (err) {
      console.error("[tasks-routes] reopen failed:", err);
      return res.redirectAfterPost(safeReturnTo(req.body.return_to));
    }
  });

  // -------------------------------------------------------------
  // Delete — cascades subtasks via FK
  // -------------------------------------------------------------
  router.post("/api/tasks/:id/delete", async (req, res) => {
    try {
      const id = Number(req.params.id);
      await db.execute({ sql: "DELETE FROM tasks_items WHERE id = ?", args: [id] });
      return res.redirectAfterPost(safeReturnTo(req.body.return_to));
    } catch (err) {
      console.error("[tasks-routes] delete failed:", err);
      return res.redirectAfterPost(safeReturnTo(req.body.return_to));
    }
  });

  // -------------------------------------------------------------
  // Add subtask — convenience 302 to new-task form with parent preset
  // -------------------------------------------------------------
  router.post("/api/tasks/:id/add-subtask", async (req, res) => {
    const id = Number(req.params.id);
    return res.redirectAfterPost(`/dashboard/tasks?new=1&parent_id=${id}`);
  });

  return router;
}

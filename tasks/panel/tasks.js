/**
 * Tasks Panel — Crow's Nest task manager.
 *
 * Dispatches GET views by query-string; POST actions live in
 * ./tasks-routes.js (mounted at /api/tasks/* by panel-registry).
 *
 * Views:
 *   /dashboard/tasks                         → Today (pending + overdue)
 *   /dashboard/tasks?view=all                → full list + filter/sort
 *   /dashboard/tasks?view=briefings          → briefing archive
 *   /dashboard/tasks?briefing=<id>[&instance=<uuid>]
 *                                            → briefing detail (federated)
 *   /dashboard/tasks?new=1[&parent_id=N]     → new-task form
 *   /dashboard/tasks?edit=<id>               → edit-task form
 *
 * Data layer: reads tasks_items / tasks_recurrence / tasks_briefings from
 * the injected `db` (crow.db). Federated briefing detail opens a peer's
 * crow.db directly (same-host only, mirrors the memory panel pattern).
 *
 * List chrome uses a <turbo-frame id="tasks-list"> so status/sort changes
 * swap the frame in place without a full page reload.
 */

export default {
  id: "tasks",
  name: "Tasks",
  icon: "check-square",
  route: "/dashboard/tasks",
  navOrder: 16,
  category: "core",

  async handler(req, res, { db, layout, lang, appRoot }) {
    const { pathToFileURL } = await import("node:url");
    const { join } = await import("node:path");
    const { existsSync } = await import("node:fs");
    const { hostname: osHostname } = await import("node:os");

    const componentsPath = join(appRoot, "servers/gateway/dashboard/shared/components.js");
    const { escapeHtml, section, dataTable, formatDate } = await import(pathToFileURL(componentsPath).href);

    const instanceRegistryPath = join(appRoot, "servers/gateway/instance-registry.js");
    const { getOrCreateLocalInstanceId } = await import(pathToFileURL(instanceRegistryPath).href);

    const rendererPath = join(appRoot, "servers/blog/renderer.js");
    const { renderMarkdown } = await import(pathToFileURL(rendererPath).href);

    const dbModulePath = join(appRoot, "servers/db.js");
    const { createDbClient } = await import(pathToFileURL(dbModulePath).href);

    // ===============================================================
    // Constants / helpers
    // ===============================================================
    const STATUS_COLORS = {
      pending: "#6b7280",
      in_progress: "#3b82f6",
      done: "#22c55e",
      cancelled: "#9ca3af",
    };
    const STATUS_LABELS = {
      pending: "Pending",
      in_progress: "In progress",
      done: "Done",
      cancelled: "Cancelled",
    };
    const VALID_STATUSES = Object.keys(STATUS_LABELS);
    const VALID_SORTS = new Set(["due_date", "priority", "created_at"]);
    const RECURRENCE_PATTERNS = ["none", "daily", "weekly", "monthly", "yearly"];

    function todayIsoUtc() {
      return new Date().toISOString().slice(0, 10);
    }

    function statusBadge(status) {
      const color = STATUS_COLORS[status] || "#6b7280";
      const label = STATUS_LABELS[status] || status;
      return `<span style="display:inline-block;padding:0.15rem 0.5rem;border-radius:10px;font-size:0.72rem;font-weight:500;background:${color}20;color:${color}">${escapeHtml(label)}</span>`;
    }

    function dueBadge(dueIso, todayIso) {
      if (!dueIso) return "";
      const days = Math.floor((new Date(dueIso + "T00:00:00Z") - new Date(todayIso + "T00:00:00Z")) / 86400000);
      let color = "var(--crow-text-muted)";
      let label = escapeHtml(dueIso);
      if (days < 0) { color = "#ef4444"; label = `${escapeHtml(dueIso)} (overdue ${Math.abs(days)}d)`; }
      else if (days === 0) { color = "#f59e0b"; label = `${escapeHtml(dueIso)} (today)`; }
      else if (days <= 3) { color = "#3b82f6"; label = `${escapeHtml(dueIso)} (${days}d)`; }
      return `<span style="display:inline-block;padding:0.1rem 0.45rem;border-radius:8px;font-size:0.72rem;background:${color}20;color:${color}">${label}</span>`;
    }

    function priorityDots(priority) {
      const p = Math.min(5, Math.max(1, Number(priority) || 3));
      let html = '<span title="Priority ' + p + '/5" style="display:inline-flex;gap:2px;vertical-align:middle">';
      for (let i = 1; i <= 5; i++) {
        const filled = i <= p;
        const bg = filled ? (p >= 4 ? "#ef4444" : p === 3 ? "#f59e0b" : "#9ca3af") : "var(--crow-border)";
        html += `<span style="width:6px;height:6px;border-radius:50%;background:${bg};display:inline-block"></span>`;
      }
      html += "</span>";
      return html;
    }

    function tagsChips(tagsCsv) {
      if (!tagsCsv) return "";
      return tagsCsv
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => `<span style="display:inline-block;padding:0.05rem 0.4rem;border-radius:6px;font-size:0.68rem;background:var(--crow-bg-elevated);color:var(--crow-text-secondary);margin-right:2px">${escapeHtml(t)}</span>`)
        .join("");
    }

    function softChip(label, value) {
      if (!value) return "";
      return `<span style="font-size:0.7rem;color:var(--crow-text-muted);margin-right:0.5rem"><span style="color:var(--crow-text-muted)">${escapeHtml(label)}:</span> ${escapeHtml(String(value))}</span>`;
    }

    function recurrenceBadge(recurrenceRow) {
      if (!recurrenceRow) return "";
      const interval = Number(recurrenceRow.interval) || 1;
      const pattern = recurrenceRow.pattern;
      const label = interval === 1 ? pattern : `every ${interval} ${pattern}`;
      return `<span title="Repeats ${escapeHtml(label)}" style="font-size:0.72rem;color:#a855f7">↻ ${escapeHtml(label)}</span>`;
    }

    async function tablesExist() {
      try {
        await db.execute({ sql: "SELECT 1 FROM tasks_items LIMIT 1", args: [] });
        return true;
      } catch {
        return false;
      }
    }

    async function emptyStateNoLocalTasks() {
      // Primary's panel is symlinked in so federated briefing taps land
      // somewhere renderable, but the addon (and its tables) only lives
      // on instances that registered the addon. List peers that advertise
      // a gateway_url so the user can jump straight to their Tasks UI.
      let peers = [];
      try {
        const localInstanceId = getOrCreateLocalInstanceId();
        const { rows } = await db.execute({
          sql: `SELECT id, name, gateway_url FROM crow_instances
                WHERE status != 'revoked' AND gateway_url IS NOT NULL AND id != ?
                ORDER BY name`,
          args: [localInstanceId],
        });
        peers = rows;
      } catch {}

      const peerList = peers.length > 0
        ? `<div style="margin-top:1rem;text-align:left;max-width:520px;margin-left:auto;margin-right:auto">
             <p style="margin:0 0 0.5rem;font-size:0.85rem;color:var(--crow-text-secondary)">Jump to another instance's Tasks:</p>
             <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:0.35rem">
               ${peers.map((p) => `<li><a href="${escapeHtml(p.gateway_url)}/dashboard/tasks" target="_blank" rel="noopener" style="display:inline-block;padding:0.35rem 0.75rem;background:var(--crow-bg-elevated);border:1px solid var(--crow-border);border-radius:6px;text-decoration:none;color:var(--crow-text);font-size:0.85rem">${escapeHtml(p.name)} <span style="color:var(--crow-text-muted);font-size:0.75rem">${escapeHtml(p.gateway_url)}</span></a></li>`).join("")}
             </ul>
           </div>`
        : "";

      return `<div class="empty-state" style="padding:2rem;text-align:center">
        <h3 style="margin:0 0 0.5rem">No tasks on this instance</h3>
        <p style="color:var(--crow-text-muted);margin:0">The <code>tasks_items</code> table isn't present here. This panel is available for rendering federated briefings from peers.</p>
        ${peerList}
      </div>`;
    }

    async function fetchRecurrence(recurrenceId) {
      if (recurrenceId == null) return null;
      try {
        const { rows } = await db.execute({
          sql: "SELECT id, pattern, interval, until_date, next_occurrence, last_occurrence FROM tasks_recurrence WHERE id = ?",
          args: [Number(recurrenceId)],
        });
        return rows[0] || null;
      } catch {
        return null;
      }
    }

    async function countSubtasks(parentId) {
      try {
        const { rows } = await db.execute({
          sql: "SELECT COUNT(*) as n FROM tasks_items WHERE parent_id = ?",
          args: [Number(parentId)],
        });
        return Number(rows[0]?.n || 0);
      } catch {
        return 0;
      }
    }

    // ===============================================================
    // Row renderer (shared between Today and All views)
    // ===============================================================
    function renderTaskRow(row, opts, todayIso, expandSet) {
      const isDone = row.status === "done" || row.status === "cancelled";
      const checkboxForm = `<form method="POST" action="/api/tasks/${row.id}/${isDone ? "reopen" : "complete"}" style="display:inline">
        <input type="hidden" name="return_to" value="${escapeHtml(opts.returnTo)}">
        <button type="submit" title="${isDone ? "Reopen" : "Mark complete"}" style="background:none;border:1.5px solid ${isDone ? STATUS_COLORS[row.status] : "var(--crow-border)"};border-radius:3px;width:16px;height:16px;padding:0;cursor:pointer;vertical-align:middle;${isDone ? `background:${STATUS_COLORS[row.status]};color:#fff` : ""}">${isDone ? "✓" : ""}</button>
      </form>`;

      const titleStyle = isDone ? "text-decoration:line-through;color:var(--crow-text-muted)" : "";
      const titleHtml = `<a href="/dashboard/tasks?edit=${row.id}" style="color:inherit;text-decoration:none;${titleStyle}">${escapeHtml(row.title || "(untitled)")}</a>`;

      const subtaskCount = Number(row.subtask_count || 0);
      const isExpanded = expandSet.has(Number(row.id));
      let disclosure = "";
      if (subtaskCount > 0) {
        const toggled = new Set(expandSet);
        if (isExpanded) toggled.delete(Number(row.id)); else toggled.add(Number(row.id));
        const expandParam = toggled.size > 0 ? `&expand=${[...toggled].join(",")}` : "";
        const href = opts.baseHref + expandParam;
        disclosure = `<a href="${escapeHtml(href)}" data-turbo-frame="tasks-list" style="color:var(--crow-text-muted);text-decoration:none;font-size:0.72rem;margin-right:0.25rem">${isExpanded ? "▼" : "▶"} ${subtaskCount}</a>`;
      }

      const overdueBorder = row.due_date && row.due_date < todayIso && !isDone
        ? "border-left:3px solid #ef4444;padding-left:0.5rem"
        : "padding-left:calc(0.5rem + 3px)";

      const metaBits = [
        dueBadge(row.due_date, todayIso),
        priorityDots(row.priority),
        softChip("owner", row.owner),
        softChip("phase", row.phase),
        tagsChips(row.tags),
        recurrenceBadge(row.recurrence_row),
      ].filter(Boolean).join(" ");

      const rowHtml = `
        <div style="display:grid;grid-template-columns:24px 1fr auto;gap:0.5rem;align-items:center;padding:0.4rem 0.25rem;${overdueBorder};${isDone ? "opacity:0.6" : ""}">
          <div>${checkboxForm}</div>
          <div>
            <div style="display:flex;align-items:center;gap:0.35rem;flex-wrap:wrap">
              ${disclosure}<span style="font-size:0.92rem">${titleHtml}</span>
            </div>
            <div style="margin-top:0.15rem;display:flex;align-items:center;flex-wrap:wrap;gap:0.15rem">
              ${metaBits}
            </div>
          </div>
          <div style="display:flex;gap:0.25rem;align-items:center">
            ${statusBadge(row.status)}
            <form method="POST" action="/api/tasks/${row.id}/add-subtask" style="display:inline">
              <input type="hidden" name="return_to" value="${escapeHtml(opts.returnTo)}">
              <button type="submit" title="Add subtask" style="background:none;border:1px solid var(--crow-border);border-radius:4px;padding:0 0.35rem;font-size:0.75rem;color:var(--crow-text-muted);cursor:pointer">+sub</button>
            </form>
          </div>
        </div>`;

      return rowHtml;
    }

    async function renderTaskRowsRecursive(rows, opts, todayIso, expandSet, depth = 0) {
      let html = "";
      for (const row of rows) {
        const indent = depth > 0 ? `<div style="margin-left:${depth * 1.25}rem;border-left:1px dashed var(--crow-border);padding-left:0.5rem">` : "";
        const endIndent = depth > 0 ? "</div>" : "";
        html += indent + renderTaskRow(row, opts, todayIso, expandSet) + endIndent;
        if (expandSet.has(Number(row.id)) && Number(row.subtask_count) > 0) {
          const { rows: children } = await db.execute({
            sql: `SELECT t.*, (SELECT COUNT(*) FROM tasks_items WHERE parent_id = t.id) as subtask_count
                  FROM tasks_items t WHERE parent_id = ?
                  ORDER BY CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date, priority DESC`,
            args: [Number(row.id)],
          });
          for (const child of children) {
            child.recurrence_row = await fetchRecurrence(child.recurrence_id);
          }
          html += await renderTaskRowsRecursive(children, opts, todayIso, expandSet, depth + 1);
        }
      }
      return html;
    }

    // ===============================================================
    // Form view (new + edit)
    // ===============================================================
    async function renderTaskForm({ existing, parentId }) {
      const isEdit = !!existing;
      const action = isEdit ? `/api/tasks/${existing.id}/update` : "/api/tasks/create";
      const title = isEdit ? `Edit task #${existing.id}` : "New task";

      let parentContext = "";
      if (parentId) {
        const { rows: parentRows } = await db.execute({
          sql: "SELECT id, title FROM tasks_items WHERE id = ?",
          args: [Number(parentId)],
        });
        if (parentRows[0]) {
          parentContext = `<div style="padding:0.5rem 0.75rem;background:var(--crow-bg-elevated);border-radius:6px;margin-bottom:1rem;font-size:0.85rem">
            Subtask of <strong>#${parentRows[0].id} ${escapeHtml(parentRows[0].title)}</strong>
          </div>`;
        }
      }

      let recurrence = null;
      if (isEdit && existing.recurrence_id) recurrence = await fetchRecurrence(existing.recurrence_id);

      const v = (x) => escapeHtml(x == null ? "" : String(x));
      const sel = (val, actual) => (val === actual ? " selected" : "");
      const effectiveParentId = isEdit ? existing.parent_id : parentId;

      const formHtml = `
        <form method="POST" action="${action}" style="display:grid;gap:0.75rem;max-width:720px">
          <input type="hidden" name="return_to" value="${isEdit ? "/dashboard/tasks?view=all" : "/dashboard/tasks"}">
          ${effectiveParentId ? `<input type="hidden" name="parent_id" value="${Number(effectiveParentId)}">` : ""}

          <label style="font-size:0.82rem;font-weight:500">
            Title *
            <input type="text" name="title" required value="${v(existing?.title)}"
              style="width:100%;margin-top:0.25rem;padding:0.5rem;border:1px solid var(--crow-border);border-radius:4px;background:var(--crow-bg);color:var(--crow-text);font-size:0.9rem">
          </label>

          <label style="font-size:0.82rem;font-weight:500">
            Description
            <textarea name="description" rows="4"
              style="width:100%;margin-top:0.25rem;padding:0.5rem;border:1px solid var(--crow-border);border-radius:4px;background:var(--crow-bg);color:var(--crow-text);font-size:0.9rem;font-family:inherit">${v(existing?.description)}</textarea>
          </label>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
            <label style="font-size:0.82rem;font-weight:500">
              Status
              <select name="status" style="width:100%;margin-top:0.25rem;padding:0.5rem;border:1px solid var(--crow-border);border-radius:4px;background:var(--crow-bg);color:var(--crow-text);font-size:0.9rem">
                ${VALID_STATUSES.map((s) => `<option value="${s}"${sel(s, existing?.status || "pending")}>${STATUS_LABELS[s]}</option>`).join("")}
              </select>
            </label>
            <label style="font-size:0.82rem;font-weight:500">
              Priority (1-5)
              <input type="number" name="priority" min="1" max="5" value="${v(existing?.priority ?? 3)}"
                style="width:100%;margin-top:0.25rem;padding:0.5rem;border:1px solid var(--crow-border);border-radius:4px;background:var(--crow-bg);color:var(--crow-text);font-size:0.9rem">
            </label>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
            <label style="font-size:0.82rem;font-weight:500">
              Due date
              <input type="date" name="due_date" value="${v(existing?.due_date)}"
                style="width:100%;margin-top:0.25rem;padding:0.5rem;border:1px solid var(--crow-border);border-radius:4px;background:var(--crow-bg);color:var(--crow-text);font-size:0.9rem">
            </label>
            <label style="font-size:0.82rem;font-weight:500">
              Phase
              <input type="text" name="phase" value="${v(existing?.phase)}"
                style="width:100%;margin-top:0.25rem;padding:0.5rem;border:1px solid var(--crow-border);border-radius:4px;background:var(--crow-bg);color:var(--crow-text);font-size:0.9rem">
            </label>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
            <label style="font-size:0.82rem;font-weight:500">
              Owner
              <input type="text" name="owner" value="${v(existing?.owner)}"
                style="width:100%;margin-top:0.25rem;padding:0.5rem;border:1px solid var(--crow-border);border-radius:4px;background:var(--crow-bg);color:var(--crow-text);font-size:0.9rem">
            </label>
            <label style="font-size:0.82rem;font-weight:500">
              Tags (comma-separated)
              <input type="text" name="tags" value="${v(existing?.tags)}"
                style="width:100%;margin-top:0.25rem;padding:0.5rem;border:1px solid var(--crow-border);border-radius:4px;background:var(--crow-bg);color:var(--crow-text);font-size:0.9rem">
            </label>
          </div>

          <label style="font-size:0.82rem;font-weight:500">
            Project ID <span style="color:var(--crow-text-muted);font-weight:normal">(optional — soft link to crow_projects)</span>
            <input type="number" name="project_id" value="${v(existing?.project_id)}"
              style="width:200px;margin-top:0.25rem;padding:0.5rem;border:1px solid var(--crow-border);border-radius:4px;background:var(--crow-bg);color:var(--crow-text);font-size:0.9rem">
          </label>

          <fieldset style="border:1px solid var(--crow-border);border-radius:6px;padding:0.75rem;margin:0">
            <legend style="font-size:0.82rem;font-weight:500;padding:0 0.4rem">Recurrence</legend>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.75rem">
              <label style="font-size:0.78rem">
                Pattern
                <select name="recurrence_pattern" style="width:100%;margin-top:0.25rem;padding:0.4rem;border:1px solid var(--crow-border);border-radius:4px;background:var(--crow-bg);color:var(--crow-text);font-size:0.85rem">
                  ${RECURRENCE_PATTERNS.map((p) => `<option value="${p}"${sel(p, recurrence?.pattern || "none")}>${p}</option>`).join("")}
                </select>
              </label>
              <label style="font-size:0.78rem">
                Interval
                <input type="number" name="recurrence_interval" min="1" value="${v(recurrence?.interval ?? 1)}"
                  style="width:100%;margin-top:0.25rem;padding:0.4rem;border:1px solid var(--crow-border);border-radius:4px;background:var(--crow-bg);color:var(--crow-text);font-size:0.85rem">
              </label>
              <label style="font-size:0.78rem">
                Until date
                <input type="date" name="recurrence_until" value="${v(recurrence?.until_date)}"
                  style="width:100%;margin-top:0.25rem;padding:0.4rem;border:1px solid var(--crow-border);border-radius:4px;background:var(--crow-bg);color:var(--crow-text);font-size:0.85rem">
              </label>
            </div>
            <p style="font-size:0.72rem;color:var(--crow-text-muted);margin:0.5rem 0 0">Set pattern to <code>none</code> to disable. Next occurrence materializes when this task is completed.</p>
          </fieldset>

          <div style="display:flex;gap:0.5rem;margin-top:0.5rem">
            <button type="submit" style="padding:0.55rem 1.1rem;background:var(--crow-accent);color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:500;font-size:0.9rem">
              ${isEdit ? "Save changes" : "Create task"}
            </button>
            <a href="/dashboard/tasks?view=all" class="btn btn-secondary" style="padding:0.55rem 1.1rem;border-radius:6px;text-decoration:none;font-size:0.9rem">Cancel</a>
            ${isEdit ? `<form method="POST" action="/api/tasks/${existing.id}/delete" style="margin-left:auto" onsubmit="return confirm('Delete this task and its subtasks?')">
              <input type="hidden" name="return_to" value="/dashboard/tasks?view=all">
              <button type="submit" style="padding:0.55rem 1.1rem;background:transparent;color:#ef4444;border:1px solid #ef4444;border-radius:6px;cursor:pointer;font-size:0.9rem">Delete</button>
            </form>` : ""}
          </div>
        </form>`;

      const header = `<div style="display:flex;align-items:center;gap:1rem;margin-bottom:1rem">
        <a href="/dashboard/tasks?view=all" style="color:var(--crow-accent);text-decoration:none">&larr; Back</a>
        <h1 style="margin:0;font-size:1.3rem">${escapeHtml(title)}</h1>
      </div>`;

      return layout({
        title,
        content: `<div style="max-width:800px;margin:0 auto;padding:1rem">${header}${parentContext}${formHtml}</div>`,
      });
    }

    // ===============================================================
    // Today view (default landing)
    // ===============================================================
    async function renderTodayView() {
      const todayIso = todayIsoUtc();
      const threshold = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
      const { rows } = await db.execute({
        sql: `SELECT t.*,
                     (SELECT COUNT(*) FROM tasks_items WHERE parent_id = t.id) as subtask_count
              FROM tasks_items t
              WHERE t.status IN ('pending','in_progress')
                AND t.parent_id IS NULL
                AND (t.due_date IS NULL OR t.due_date <= ?)
              ORDER BY
                CASE WHEN t.due_date IS NULL THEN 2
                     WHEN t.due_date < ? THEN 0
                     ELSE 1 END,
                t.due_date ASC,
                t.priority DESC`,
        args: [threshold, todayIso],
      });
      for (const row of rows) {
        row.recurrence_row = await fetchRecurrence(row.recurrence_id);
      }

      const expandSet = parseExpandParam(req.query.expand);
      const opts = {
        baseHref: "/dashboard/tasks?",
        returnTo: "/dashboard/tasks",
      };

      const overdueCount = rows.filter((r) => r.due_date && r.due_date < todayIso).length;
      const todayCount = rows.filter((r) => r.due_date === todayIso).length;
      const next3Count = rows.filter((r) => r.due_date && r.due_date > todayIso && r.due_date <= threshold).length;
      const noDueCount = rows.filter((r) => !r.due_date).length;

      const stats = `<div style="display:flex;gap:0.75rem;margin-bottom:1rem;flex-wrap:wrap">
        <div style="padding:0.35rem 0.75rem;border-radius:6px;background:#ef444420;color:#ef4444;font-size:0.82rem">${overdueCount} overdue</div>
        <div style="padding:0.35rem 0.75rem;border-radius:6px;background:#f59e0b20;color:#f59e0b;font-size:0.82rem">${todayCount} today</div>
        <div style="padding:0.35rem 0.75rem;border-radius:6px;background:#3b82f620;color:#3b82f6;font-size:0.82rem">${next3Count} next 3 days</div>
        <div style="padding:0.35rem 0.75rem;border-radius:6px;background:var(--crow-bg-elevated);color:var(--crow-text-muted);font-size:0.82rem">${noDueCount} no due date</div>
      </div>`;

      const tabs = renderTabs("today");
      const list = rows.length === 0
        ? `<div style="padding:2rem;text-align:center;color:var(--crow-text-muted)">
             <h3 style="margin:0 0 0.25rem">Nothing due</h3>
             <p style="margin:0;font-size:0.85rem">No open tasks due in the next 3 days.</p>
           </div>`
        : `<div style="border:1px solid var(--crow-border);border-radius:6px;padding:0.5rem;background:var(--crow-bg-surface)">
             ${await renderTaskRowsRecursive(rows, opts, todayIso, expandSet)}
           </div>`;

      const newBtn = `<a href="/dashboard/tasks?new=1" style="padding:0.45rem 0.9rem;background:var(--crow-accent);color:#fff;border-radius:6px;text-decoration:none;font-size:0.85rem;font-weight:500">+ New task</a>`;
      const header = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
        <h1 style="margin:0;font-size:1.4rem">Today — ${escapeHtml(todayIso)}</h1>
        ${newBtn}
      </div>`;

      return layout({
        title: "Tasks — Today",
        content: `<div style="max-width:1100px;margin:0 auto;padding:1rem">${header}${tabs}${stats}${list}</div>`,
      });
    }

    // ===============================================================
    // Full list view
    // ===============================================================
    async function renderAllView() {
      const todayIso = todayIsoUtc();
      const statusFilter = req.query.status || "open";
      const sort = VALID_SORTS.has(req.query.sort) ? req.query.sort : "due_date";
      const expandSet = parseExpandParam(req.query.expand);

      let whereSql = "WHERE t.parent_id IS NULL";
      const args = [];
      if (statusFilter === "open") {
        whereSql += " AND t.status IN ('pending','in_progress')";
      } else if (statusFilter !== "all" && VALID_STATUSES.includes(statusFilter)) {
        whereSql += " AND t.status = ?";
        args.push(statusFilter);
      }

      const orderSql = {
        due_date: "ORDER BY CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END, t.due_date ASC, t.priority DESC",
        priority: "ORDER BY t.priority DESC, CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END, t.due_date ASC",
        created_at: "ORDER BY t.created_at DESC",
      }[sort];

      const { rows } = await db.execute({
        sql: `SELECT t.*,
                     (SELECT COUNT(*) FROM tasks_items WHERE parent_id = t.id) as subtask_count
              FROM tasks_items t ${whereSql} ${orderSql}`,
        args,
      });
      for (const row of rows) {
        row.recurrence_row = await fetchRecurrence(row.recurrence_id);
      }

      const qs = new URLSearchParams({ view: "all", status: statusFilter, sort });
      const baseHref = "/dashboard/tasks?" + qs.toString() + "&";
      const opts = { baseHref, returnTo: "/dashboard/tasks?" + qs.toString() };

      // Filter form — GET, targets turbo-frame for in-place swap
      const statusOpt = (val, label) => `<option value="${val}"${val === statusFilter ? " selected" : ""}>${label}</option>`;
      const sortOpt = (val, label) => `<option value="${val}"${val === sort ? " selected" : ""}>${label}</option>`;
      const filterForm = `<form method="GET" action="/dashboard/tasks" data-turbo-frame="tasks-list" style="display:flex;gap:0.5rem;margin-bottom:1rem;flex-wrap:wrap;align-items:center">
        <input type="hidden" name="view" value="all">
        <label style="font-size:0.8rem;display:flex;align-items:center;gap:0.35rem">
          Status
          <select name="status" onchange="this.form.requestSubmit()" style="padding:0.35rem 0.5rem;border:1px solid var(--crow-border);border-radius:4px;background:var(--crow-bg);color:var(--crow-text);font-size:0.85rem">
            ${statusOpt("open", "Open (pending+in progress)")}
            ${statusOpt("pending", "Pending")}
            ${statusOpt("in_progress", "In progress")}
            ${statusOpt("done", "Done")}
            ${statusOpt("cancelled", "Cancelled")}
            ${statusOpt("all", "All")}
          </select>
        </label>
        <label style="font-size:0.8rem;display:flex;align-items:center;gap:0.35rem">
          Sort
          <select name="sort" onchange="this.form.requestSubmit()" style="padding:0.35rem 0.5rem;border:1px solid var(--crow-border);border-radius:4px;background:var(--crow-bg);color:var(--crow-text);font-size:0.85rem">
            ${sortOpt("due_date", "Due date")}
            ${sortOpt("priority", "Priority")}
            ${sortOpt("created_at", "Created")}
          </select>
        </label>
        <span style="font-size:0.75rem;color:var(--crow-text-muted);margin-left:0.5rem">${rows.length} task${rows.length === 1 ? "" : "s"}</span>
      </form>`;

      const list = rows.length === 0
        ? `<div style="padding:2rem;text-align:center;color:var(--crow-text-muted)">No tasks match this filter.</div>`
        : `<div style="border:1px solid var(--crow-border);border-radius:6px;padding:0.5rem;background:var(--crow-bg-surface)">
             ${await renderTaskRowsRecursive(rows, opts, todayIso, expandSet)}
           </div>`;

      // Wrap filter form + list in the turbo-frame so filter/sort changes
      // swap everything in place.
      const frame = `<turbo-frame id="tasks-list" data-turbo-action="advance">
        ${filterForm}
        ${list}
      </turbo-frame>`;

      const newBtn = `<a href="/dashboard/tasks?new=1" style="padding:0.45rem 0.9rem;background:var(--crow-accent);color:#fff;border-radius:6px;text-decoration:none;font-size:0.85rem;font-weight:500">+ New task</a>`;
      const header = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
        <h1 style="margin:0;font-size:1.4rem">All tasks</h1>
        ${newBtn}
      </div>`;

      return layout({
        title: "Tasks — All",
        content: `<div style="max-width:1100px;margin:0 auto;padding:1rem">${header}${renderTabs("all")}${frame}</div>`,
      });
    }

    // ===============================================================
    // Briefings list + detail (carried from Session A)
    // ===============================================================
    async function renderBriefingsList() {
      let rows = [];
      try {
        const resList = await db.execute({
          sql: "SELECT id, briefing_date, substr(content, 1, 200) as preview, created_at FROM tasks_briefings ORDER BY briefing_date DESC LIMIT 60",
          args: [],
        });
        rows = resList.rows;
      } catch {
        return layout({ title: "Tasks", content: section("Tasks", await emptyStateNoLocalTasks()) });
      }

      let body;
      if (rows.length === 0) {
        body = `<div class="empty-state" style="padding:2rem;text-align:center">
          <h3>No briefings yet</h3>
          <p style="color:var(--crow-text-muted)">The daily briefing pipeline hasn't stored anything here. Briefings arrive each weekday at 7 AM.</p>
        </div>`;
      } else {
        const tableRows = rows.map((r) => [
          `<a href="/dashboard/tasks?briefing=${Number(r.id)}">${escapeHtml(r.briefing_date)}</a>`,
          escapeHtml(r.preview || ""),
          `<span class="mono">${formatDate(r.created_at, lang)}</span>`,
        ]);
        body = dataTable(["Date", "Preview", "Stored"], tableRows);
      }

      const intro = `<p style="color:var(--crow-text-muted);font-size:0.9rem;margin-bottom:1rem">Daily briefing archive. Each briefing is a snapshot of tasks due in the next 72 hours.</p>`;
      const header = `<h1 style="margin:0 0 1rem;font-size:1.4rem">Briefings</h1>`;
      return layout({
        title: "Tasks — Briefings",
        content: `<div style="max-width:1100px;margin:0 auto;padding:1rem">${header}${renderTabs("briefings")}${intro}${body}</div>`,
      });
    }

    async function getInstanceRow(localDb, instanceId) {
      const { rows } = await localDb.execute({
        sql: "SELECT id, name, hostname, data_dir FROM crow_instances WHERE id = ?",
        args: [instanceId],
      });
      return rows[0] || null;
    }

    async function fetchRemoteBriefingDirectDb(instance, briefingId) {
      if (!instance.data_dir) return null;
      if (instance.hostname && instance.hostname !== osHostname()) return null;
      const dbPath = join(instance.data_dir, "crow.db");
      if (!existsSync(dbPath)) return null;
      const peerDb = createDbClient(dbPath);
      try {
        const { rows } = await peerDb.execute({
          sql: "SELECT id, briefing_date, content, created_at FROM tasks_briefings WHERE id = ?",
          args: [Number(briefingId)],
        });
        if (rows.length === 0) return null;
        const r = rows[0];
        return {
          briefing: {
            id: Number(r.id),
            briefing_date: r.briefing_date,
            content: r.content,
            created_at: r.created_at,
          },
          instanceName: instance.name,
        };
      } catch (err) {
        console.warn(`[tasks-panel] direct-db read failed (${instance.id}/briefing#${briefingId}): ${err.message}`);
        return null;
      } finally {
        try { peerDb.close(); } catch {}
      }
    }

    function renderBriefingView({ briefing, originName }) {
      const metaRows = [
        ["ID", `#${escapeHtml(String(briefing.id))}`],
        ["Date", escapeHtml(briefing.briefing_date)],
        ["Stored", escapeHtml(briefing.created_at || "")],
      ];
      if (originName) {
        metaRows.push([
          "Origin",
          `${escapeHtml(originName)} <span style="color:var(--crow-text-muted)">(federated — read-only)</span>`,
        ]);
      }
      const metaHtml = `<div style="display:grid;grid-template-columns:max-content 1fr;gap:0.5rem 1rem;margin-bottom:1rem;font-size:0.9rem">
        ${metaRows.map(([k, v]) => `<div style="color:var(--crow-text-muted)">${k}</div><div>${v}</div>`).join("")}
      </div>`;
      const body = `<div style="background:var(--crow-bg-elevated);padding:1rem 1.25rem;border-radius:0.5rem;line-height:1.55">${renderMarkdown(String(briefing.content || ""))}</div>`;
      const backBtn = `<a href="/dashboard/tasks?view=briefings" class="btn btn-secondary" style="margin-top:1rem">Back to briefings</a>`;
      const content = section(
        `Daily briefing — ${escapeHtml(briefing.briefing_date)}`,
        metaHtml + body + backBtn
      );
      return layout({ title: `Daily briefing — ${briefing.briefing_date}`, content });
    }

    // ===============================================================
    // Tab nav + misc
    // ===============================================================
    function renderTabs(active) {
      const tab = (id, href, label) => `<a href="${href}" style="padding:0.35rem 0.9rem;border-radius:6px;text-decoration:none;font-size:0.85rem;${active === id ? "background:var(--crow-accent);color:#fff" : "color:var(--crow-text-secondary);background:var(--crow-bg-elevated)"}">${label}</a>`;
      return `<div style="display:flex;gap:0.35rem;margin-bottom:1rem;flex-wrap:wrap">
        ${tab("today", "/dashboard/tasks", "Today")}
        ${tab("all", "/dashboard/tasks?view=all", "All")}
        ${tab("briefings", "/dashboard/tasks?view=briefings", "Briefings")}
      </div>`;
    }

    function parseExpandParam(raw) {
      if (!raw) return new Set();
      return new Set(String(raw).split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0));
    }

    // ===============================================================
    // Dispatch
    // ===============================================================
    const briefingId = req.query.briefing;
    const requestedInstance = req.query.instance;
    const view = req.query.view;
    const editId = req.query.edit;
    const isNew = req.query.new === "1";

    if (briefingId) {
      const localInstanceId = getOrCreateLocalInstanceId();
      if (requestedInstance && requestedInstance !== localInstanceId) {
        const inst = await getInstanceRow(db, requestedInstance);
        if (inst) {
          const remote = await fetchRemoteBriefingDirectDb(inst, briefingId);
          if (remote) return renderBriefingView({ briefing: remote.briefing, originName: remote.instanceName });
        }
      }
      let rows = [];
      try {
        const resLocal = await db.execute({
          sql: "SELECT id, briefing_date, content, created_at FROM tasks_briefings WHERE id = ?",
          args: [briefingId],
        });
        rows = resLocal.rows;
      } catch {}
      if (rows.length === 0) { res.redirect("/dashboard/tasks?view=briefings"); return; }
      const r = rows[0];
      return renderBriefingView({
        briefing: { id: Number(r.id), briefing_date: r.briefing_date, content: r.content, created_at: r.created_at },
        originName: null,
      });
    }

    if (!(await tablesExist())) {
      return layout({ title: "Tasks", content: section("Tasks", await emptyStateNoLocalTasks()) });
    }

    if (isNew) return renderTaskForm({ existing: null, parentId: req.query.parent_id });
    if (editId) {
      const { rows } = await db.execute({
        sql: "SELECT * FROM tasks_items WHERE id = ?",
        args: [Number(editId)],
      });
      if (!rows[0]) { res.redirect("/dashboard/tasks?view=all"); return; }
      return renderTaskForm({ existing: rows[0], parentId: null });
    }
    if (view === "briefings") return renderBriefingsList();
    if (view === "all") return renderAllView();
    return renderTodayView();
  },
};

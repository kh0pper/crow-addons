/**
 * Crow Tasks — Table Initialization
 *
 * Creates tasks_items, tasks_recurrence, and tasks_briefings in the
 * bundle's dedicated tasks.db file. Safe to re-run (CREATE TABLE IF NOT
 * EXISTS / CREATE INDEX IF NOT EXISTS everywhere).
 *
 * tasks_items.parent_id is a self-reference for subtasks (ON DELETE CASCADE).
 * tasks_items.project_id is a soft link to Crow's projects table — no FK
 * constraint since the projects table may not exist on every instance.
 * tasks_items.recurrence_id links to tasks_recurrence (ON DELETE SET NULL).
 */

async function initTable(db, label, sql) {
  try {
    await db.executeMultiple(sql);
  } catch (err) {
    console.error(`[tasks-init] ${label}:`, err.message);
    throw err;
  }
}

export async function initTasksTables(db) {
  await initTable(
    db,
    "tasks_recurrence",
    `
    CREATE TABLE IF NOT EXISTS tasks_recurrence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL CHECK (pattern IN ('daily','weekly','monthly','yearly')),
      interval INTEGER NOT NULL DEFAULT 1,
      until_date TEXT,
      next_occurrence TEXT,
      last_occurrence TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_recurrence_next ON tasks_recurrence(next_occurrence);
    `
  );

  await initTable(
    db,
    "tasks_items",
    `
    CREATE TABLE IF NOT EXISTS tasks_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','done','cancelled')),
      priority INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
      due_date TEXT,
      phase TEXT,
      owner TEXT,
      tags TEXT,
      project_id INTEGER,
      parent_id INTEGER REFERENCES tasks_items(id) ON DELETE CASCADE,
      recurrence_id INTEGER REFERENCES tasks_recurrence(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_items_status ON tasks_items(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_items_due ON tasks_items(due_date);
    CREATE INDEX IF NOT EXISTS idx_tasks_items_parent ON tasks_items(parent_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_items_project ON tasks_items(project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_items_recurrence ON tasks_items(recurrence_id);
    `
  );

  await initTable(
    db,
    "tasks_briefings",
    `
    CREATE TABLE IF NOT EXISTS tasks_briefings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      briefing_date TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_briefings_date ON tasks_briefings(briefing_date DESC);
    `
  );
}

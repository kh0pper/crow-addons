/**
 * Crow Tasks — Database Client Factory
 *
 * The tasks bundle lives on its own file (tasks.db) to avoid the
 * multi-writer wedge we hit when gateway + tasks subprocess + panel
 * routes all opened the same crow.db with independent libsql clients.
 *
 * Path resolution order:
 *   1. CROW_TASKS_DB_PATH  — explicit absolute path override
 *   2. CROW_DATA_DIR       — tasks.db inside that directory
 *   3. CROW_HOME           — {CROW_HOME}/data/tasks.db; picks up the per-
 *                            instance data dir Crow already sets
 *                            (~/.crow-mpa for MPA, ~/.crow for primary)
 *   4. CROW_DB_PATH        — legacy shared-DB mode (use only for rollback).
 *                            Accepted so existing deploys don't break, but
 *                            the tables still need to live in whatever
 *                            file this points at.
 *   5. ~/.crow/data/tasks.db if that directory exists
 *   6. ~/crow/data/tasks.db
 *
 * Foreign keys are enabled so subtasks cascade-delete with parents.
 */

import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

export function resolveDbPath() {
  if (process.env.CROW_TASKS_DB_PATH) return resolve(process.env.CROW_TASKS_DB_PATH);
  if (process.env.CROW_DATA_DIR) return resolve(process.env.CROW_DATA_DIR, "tasks.db");
  if (process.env.CROW_HOME) return resolve(process.env.CROW_HOME, "data", "tasks.db");
  if (process.env.CROW_DB_PATH) return resolve(process.env.CROW_DB_PATH);
  const home = homedir();
  const fallback = resolve(home, ".crow", "data", "tasks.db");
  if (existsSync(resolve(home, ".crow", "data"))) return fallback;
  return resolve(home, "crow", "data", "tasks.db");
}

function spreadArgs(args) {
  if (args == null) return [];
  return Array.isArray(args) ? args : [args];
}

function executeOne(db, sql, rawArgs) {
  const stmt = db.prepare(sql);
  const args = spreadArgs(rawArgs);
  if (stmt.reader) {
    const rows = stmt.all(...args);
    return {
      rows,
      columns: rows.length > 0 ? Object.keys(rows[0]) : [],
      rowsAffected: 0,
      lastInsertRowid: 0,
    };
  }
  const info = stmt.run(...args);
  return {
    rows: [],
    columns: [],
    rowsAffected: info.changes,
    lastInsertRowid: info.lastInsertRowid,
  };
}

export function createDbClient(dbPath) {
  const filePath = dbPath || resolveDbPath();
  const db = new Database(filePath);
  try {
    db.pragma("journal_mode = WAL");
  } catch (err) {
    console.warn("[tasks-db] journal_mode:", err.message);
  }
  try {
    db.pragma("busy_timeout = 5000");
  } catch (err) {
    console.warn("[tasks-db] busy_timeout:", err.message);
  }
  try {
    db.pragma("foreign_keys = ON");
  } catch (err) {
    console.warn("[tasks-db] foreign_keys:", err.message);
  }

  return {
    async execute(arg) {
      if (typeof arg === "string") return executeOne(db, arg, []);
      return executeOne(db, arg.sql, arg.args);
    },
    async batch(statements) {
      const txn = db.transaction((stmts) => stmts.map((s) => {
        if (typeof s === "string") return executeOne(db, s, []);
        return executeOne(db, s.sql, s.args);
      }));
      return txn(statements);
    },
    async executeMultiple(sql) {
      db["exec"](sql);
      return [];
    },
    close() {
      try { db.close(); } catch {}
    },
  };
}

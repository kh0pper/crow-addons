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

import { createClient } from "@libsql/client";
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

export function createDbClient(dbPath) {
  const filePath = dbPath || resolveDbPath();
  const client = createClient({ url: `file:${filePath}` });
  client.execute("PRAGMA busy_timeout = 5000").catch((err) =>
    console.warn("[tasks-db] busy_timeout:", err.message)
  );
  client.execute("PRAGMA foreign_keys = ON").catch((err) =>
    console.warn("[tasks-db] foreign_keys:", err.message)
  );
  return client;
}

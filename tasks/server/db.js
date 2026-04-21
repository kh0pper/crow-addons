/**
 * Crow Tasks — Database Client Factory
 *
 * Opens the active instance's crow.db. Honors CROW_DB_PATH (explicit
 * override) first, then CROW_DATA_DIR, then falls back to ~/.crow/data/.
 * Foreign keys are enabled so subtasks cascade-delete with parents.
 */

import { createClient } from "@libsql/client";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

export function resolveDbPath() {
  if (process.env.CROW_DB_PATH) return resolve(process.env.CROW_DB_PATH);
  if (process.env.CROW_DATA_DIR) return resolve(process.env.CROW_DATA_DIR, "crow.db");
  const home = homedir();
  const fallback = resolve(home, ".crow", "data", "crow.db");
  if (existsSync(fallback)) return fallback;
  return resolve(home, "crow", "data", "crow.db");
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

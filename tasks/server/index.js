#!/usr/bin/env node

/**
 * Crow Tasks — MCP bundle entry point (stdio transport).
 *
 * Each Crow instance owns its own tasks (no federation). The bundle reads
 * CROW_DB_PATH (or CROW_DATA_DIR) to locate the active crow.db, runs the
 * idempotent table init, and exposes the tasks_* tool surface.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDbClient, resolveDbPath } from "./db.js";
import { initTasksTables } from "./init-tables.js";
import { registerTasksTools } from "./tools.js";

const dbPath = resolveDbPath();
const db = createDbClient(dbPath);
await initTasksTables(db);

const server = new McpServer(
  { name: "crow-tasks", version: "1.0.0" },
  {
    instructions:
      "Crow Tasks — first-class to-do list. Use tasks_create / tasks_list / tasks_complete " +
      "/ tasks_reopen / tasks_update / tasks_delete for task CRUD. tasks_add_subtask and " +
      "tasks_set_recurrence manage hierarchy and recurrence. tasks_briefing_snapshot + " +
      "tasks_store_briefing drive the daily-briefing pipeline; tasks_list_briefings and " +
      "tasks_get_briefing expose the history.",
  }
);
registerTasksTools(server, db);

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write(`[crow-tasks] connected (db: ${dbPath})\n`);

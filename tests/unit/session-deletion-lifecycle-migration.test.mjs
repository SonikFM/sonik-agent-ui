import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync("packages/workspace-session/migrations/postgres/0011_session_deletion_lifecycle.sql", "utf8");
const runner = readFileSync("scripts/run-postgres-migrations.mjs", "utf8");

assert.match(sql, /alter table sonik_agent_ui\.agent_workspace_sessions[\s\S]*add column if not exists deleting_at timestamptz/i);
assert.match(runner, /version: "0011"[\s\S]*0011_session_deletion_lifecycle\.sql[\s\S]*column_name = 'deleting_at'/);

console.log("session deletion lifecycle migration contract tests passed");

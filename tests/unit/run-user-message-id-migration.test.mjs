import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync("packages/workspace-session/migrations/postgres/0009_run_user_message_id.sql", "utf8");
const provenanceSql = readFileSync("packages/workspace-session/migrations/postgres/0010_run_user_message_provenance.sql", "utf8");
const runner = readFileSync("scripts/run-postgres-migrations.mjs", "utf8");
assert.match(sql, /add column if not exists user_message_id text/i);
assert.match(sql, /foreign key \(organization_id, user_id, user_message_id\)[\s\S]*agent_workspace_messages/i);
assert.match(sql, /on delete set null \(user_message_id\)/i);
assert.match(sql, /nullable for legacy runs/i);
assert.match(sql, /message_id remains the assistant message id/i);
assert.match(runner, /version: "0008"[\s\S]*0008_agent_workspace_files\.sql/);
assert.match(runner, /version: "0009"[\s\S]*0009_run_user_message_id\.sql/);
assert.match(provenanceSql, /security invoker[\s\S]*set search_path = pg_catalog/i);
assert.match(provenanceSql, /message\.organization_id = new\.organization_id[\s\S]*message\.user_id = new\.user_id/i);
assert.match(provenanceSql, /new\.user_message_id is not null[\s\S]*message\.session_id = new\.session_id[\s\S]*message\.role = 'user'/i);
assert.match(provenanceSql, /before insert or update[\s\S]*execute function sonik_agent_ui\.enforce_run_user_message_provenance/i);
assert.match(provenanceSql, /user_message_id remains nullable[\s\S]*message_id remains the assistant id/i);
assert.match(runner, /version: "0010"[\s\S]*0010_run_user_message_provenance\.sql[\s\S]*trigger_function\.proconfig @> array\['search_path=pg_catalog'\]/);

console.log("run user message id migration contract tests passed");

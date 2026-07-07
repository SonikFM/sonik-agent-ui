import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const migrationPath = path.resolve("packages/workspace-session/migrations/postgres/0003_agent_run_lifecycle.sql");
const sql = readFileSync(migrationPath, "utf8");

const requiredTables = ["agent_workspace_runs", "agent_workspace_run_events"];

function tableBody(table) {
  const pattern = new RegExp(`create table if not exists\\s+sonik_agent_ui\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`, "i");
  const match = sql.match(pattern);
  assert.ok(match, `missing create table for ${table}`);
  return match[1];
}

for (const table of requiredTables) {
  const body = tableBody(table);
  assert.match(body, /organization_id\s+text\s+not\s+null/i, `${table} must be organization scoped`);
  assert.match(body, /user_id\s+text\s+not\s+null/i, `${table} must be user scoped`);
  assert.match(body, /primary key \(organization_id, user_id, id\)/i, `${table} primary key must be composite org/user/id`);
  assert.match(sql, new RegExp(`alter table\\s+sonik_agent_ui\\.${table}\\s+enable row level security`, "i"), `${table} must enable RLS`);
  assert.match(sql, new RegExp(`alter table\\s+sonik_agent_ui\\.${table}\\s+force row level security`, "i"), `${table} must force RLS`);
  assert.match(sql, new RegExp(`create policy\\s+${table}_scope\\s+on\\s+sonik_agent_ui\\.${table}`, "i"), `${table} needs a scope policy`);
}

// Runs carry the lifecycle contract: status enum, resumable, typed error codes, correlation ids.
const runsBody = tableBody("agent_workspace_runs");
assert.match(runsBody, /status\s+text\s+not\s+null\s+default 'running'\s+check \(status in \('running', 'succeeded', 'failed', 'canceled'\)\)/i, "runs must constrain status to the run lifecycle enum");
assert.match(runsBody, /resumable\s+boolean\s+not\s+null\s+default false/i, "runs must default resumable false");
assert.match(runsBody, /error_code\s+text\s+check \(error_code in \('MISSING_HOST_CONTEXT', 'RATE_LIMITED', 'STALE_DEPLOYMENT', 'AGENT_STREAM_FAILED', 'UNKNOWN'\)\)/i, "runs must constrain error_code to the typed error taxonomy");
assert.match(runsBody, /check \(\(status = 'running'\) = \(ended_at is null\)\)/i, "running runs must have null ended_at and terminal runs must set it");
assert.match(runsBody, /request_id\s+text/i, "runs must persist request correlation");
assert.match(runsBody, /traceparent\s+text/i, "runs must persist trace correlation");
assert.match(runsBody, /foreign key \(organization_id, user_id, session_id\)/i, "runs must use a composite session foreign key");
assert.match(runsBody, /on delete cascade/i, "deleting a session cascades to its runs");

// Run events are an ordered, kind-constrained mirror of the stream.
const eventsBody = tableBody("agent_workspace_run_events");
assert.match(eventsBody, /seq\s+integer\s+not\s+null\s+check \(seq >= 0\)/i, "run events must have a non-negative seq");
assert.match(eventsBody, /kind\s+text\s+not\s+null\s+check \(kind in \('status', 'text', 'reasoning', 'tool_use', 'tool_result', 'artifact', 'usage', 'error'\)\)/i, "run events must constrain kind to the persisted event union");
assert.match(eventsBody, /event\s+jsonb\s+not\s+null/i, "run events store the mapped event as jsonb");
assert.match(eventsBody, /unique \(organization_id, user_id, run_id, seq\)/i, "run event seq must be unique per run");
assert.match(eventsBody, /foreign key \(organization_id, user_id, run_id\)/i, "run events must use a composite run foreign key");
assert.match(eventsBody, /on delete set null \(session_id\)/i, "optional composite FK should set null only on session_id");

// Same RLS request-context discipline as the base migration.
assert.doesNotMatch(sql, /x-organization-id|localStorage|postMessage/i, "migration must not encode browser/org hint authority");
for (const table of requiredTables) {
  assert.match(sql, new RegExp(`create policy\\s+${table}_scope[\\s\\S]*?organization_id\\s*=\\s*sonik_agent_ui\\.current_organization_id\\(\\)`, "i"), `${table} policy must check organization context`);
  assert.match(sql, new RegExp(`create policy\\s+${table}_scope[\\s\\S]*?user_id\\s*=\\s*sonik_agent_ui\\.current_user_id\\(\\)`, "i"), `${table} policy must check user context`);
}

console.log("run lifecycle migration contract tests passed");

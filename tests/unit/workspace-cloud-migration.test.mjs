import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const migrationPath = path.resolve("packages/workspace-session/migrations/postgres/0001_agent_workspace_persistence.sql");
const sql = readFileSync(migrationPath, "utf8");

const requiredTables = [
  "agent_workspace_sessions",
  "agent_workspace_messages",
  "agent_workspace_documents",
  "agent_workspace_document_versions",
  "agent_workspace_artifacts",
  "agent_workspace_artifact_versions",
  "agent_workspace_tool_calls",
  "agent_workspace_layout_snapshots",
  "agent_workspace_page_context_snapshots",
  "agent_workspace_telemetry_events",
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tableBody(table) {
  const pattern = new RegExp(`create table if not exists\\s+sonik_agent_ui\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`, "i");
  const match = sql.match(pattern);
  assert.ok(match, `missing create table for ${table}`);
  return match[1];
}

function policyBody(table) {
  const policyName = `${table}_scope`;
  const pattern = new RegExp(`create policy\\s+${escapeRegExp(policyName)}\\s+on\\s+sonik_agent_ui\\.${escapeRegExp(table)}\\s+using\\s*\\(([^;]+?)\\)\\s+with check\\s*\\(([^;]+?)\\);`, "is");
  const match = sql.match(pattern);
  assert.ok(match, `missing scope policy for ${table}`);
  return `${match[1]} ${match[2]}`;
}

for (const table of requiredTables) {
  const body = tableBody(table);
  assert.match(body, /id\s+text\s+not\s+null/i, `${table} id should be tenant-local but required`);
  assert.match(body, /organization_id\s+text\s+not\s+null/i, `${table} must be organization scoped`);
  assert.match(body, /user_id\s+text\s+not\s+null/i, `${table} must be user scoped`);
  assert.match(body, /primary key \(organization_id, user_id, id\)/i, `${table} primary key must be composite org/user/id`);
  assert.match(sql, new RegExp(`alter table\\s+sonik_agent_ui\\.${table}\\s+enable row level security`, "i"), `${table} must enable RLS`);
  assert.match(sql, new RegExp(`alter table\\s+sonik_agent_ui\\.${table}\\s+force row level security`, "i"), `${table} must force RLS`);
  const policy = policyBody(table);
  assert.match(policy, /organization_id\s*=\s*sonik_agent_ui\.current_organization_id\(\)/i, `${table} policy must check organization context`);
  assert.match(policy, /user_id\s*=\s*sonik_agent_ui\.current_user_id\(\)/i, `${table} policy must check user context`);
}

assert.match(sql, /current_setting\('app\.organization_id',\s*true\)/i, "RLS helper must read request-scoped organization context");
assert.match(sql, /current_setting\('app\.user_id',\s*true\)/i, "RLS helper must read request-scoped user context");
assert.match(sql, /create or replace function sonik_agent_ui\.set_request_context\(/i, "migration must expose a blessed request-context helper");
assert.match(sql, /set_config\('app\.organization_id',\s*p_organization_id,\s*true\)/i, "request-context helper must set transaction-local organization context");
assert.match(sql, /set_config\('app\.user_id',\s*p_user_id,\s*true\)/i, "request-context helper must set transaction-local user context");
assert.match(sql, /requires organization id/i, "request-context helper must reject missing organization id");
assert.match(sql, /requires user id/i, "request-context helper must reject missing user id");
assert.doesNotMatch(sql, /x-organization-id|localStorage|postMessage/i, "migration must not encode browser/org hint authority");
assert.doesNotMatch(sql, /id\s+text\s+primary\s+key/i, "ids must not be globally primary-keyed outside organization/user scope");

assert.doesNotMatch(sql, /on delete set null(?!\s*\()/i, "composite optional foreign keys must only null the optional id column, not organization_id/user_id");
for (const optionalColumn of ["message_id", "artifact_id", "document_id", "active_artifact_id", "active_document_id"]) {
  assert.match(sql, new RegExp(`on delete set null \\(${optionalColumn}\\)`, "i"), `optional composite FK should set null only on ${optionalColumn}`);
}

const compositeFkTables = [
  "agent_workspace_messages",
  "agent_workspace_documents",
  "agent_workspace_document_versions",
  "agent_workspace_artifacts",
  "agent_workspace_artifact_versions",
  "agent_workspace_tool_calls",
  "agent_workspace_layout_snapshots",
  "agent_workspace_page_context_snapshots",
  "agent_workspace_telemetry_events",
];
for (const table of compositeFkTables) {
  assert.match(tableBody(table), /foreign key \(organization_id, user_id,/i, `${table} must use composite org/user foreign keys`);
}

const pageContextBody = tableBody("agent_workspace_page_context_snapshots");
assert.match(pageContextBody, /authority\s+text\s+not\s+null\s+default 'display-only'/i, "page context snapshots default to display-only authority");
assert.match(pageContextBody, /check \(source <> 'browser-page-context' or authority = 'display-only'\)/i, "browser page context must be display-only");
assert.match(pageContextBody, /check \(authority <> 'trusted-server-derived' or source in \('trusted-host-adapter', 'system'\)\)/i, "trusted authority must come from trusted host/system source");
assert.match(sql, /Browser page context is display-only/i, "page context authority boundary should be documented in the migration");
assert.match(sql, /agent_workspace_sessions_active_document_scope_fk/i, "sessions need scoped active document FK");
assert.match(sql, /agent_workspace_sessions_active_artifact_scope_fk/i, "sessions need scoped active artifact FK");

console.log("workspace cloud migration contract tests passed");

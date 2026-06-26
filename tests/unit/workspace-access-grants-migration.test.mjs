import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const migrationPath = path.resolve("packages/workspace-session/migrations/postgres/0002_agent_workspace_access_grants.sql");
const sql = readFileSync(migrationPath, "utf8");

function tableBody(table) {
  const pattern = new RegExp(`create table if not exists\\s+sonik_agent_ui\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`, "i");
  const match = sql.match(pattern);
  assert.ok(match, `missing create table for ${table}`);
  return match[1];
}

for (const table of ["agent_workspace_access_grants", "agent_workspace_access_grant_audit"]) {
  const body = tableBody(table);
  assert.match(body, /organization_id\s+text\s+not\s+null/i, `${table} must be resource-owner organization scoped`);
  assert.match(body, /user_id\s+text\s+not\s+null/i, `${table} must be resource-owner user scoped`);
  assert.match(body, /primary key \(organization_id, user_id, id\)/i, `${table} primary key must be composite org/user/id`);
  assert.match(sql, new RegExp(`alter table\\s+sonik_agent_ui\\.${table}\\s+enable row level security`, "i"), `${table} must enable RLS`);
  assert.match(sql, new RegExp(`alter table\\s+sonik_agent_ui\\.${table}\\s+force row level security`, "i"), `${table} must force RLS`);
}

const grants = tableBody("agent_workspace_access_grants");
assert.match(grants, /resource_type\s+text\s+not\s+null\s+check \(resource_type in \('session', 'document', 'artifact', 'workspace'\)\)/i, "grants must cover shared workspace resource types");
assert.match(grants, /grantee_type\s+text\s+not\s+null\s+check \(grantee_type in \('user', 'organization', 'external_identity'\)\)/i, "grants must distinguish user/org/external grantees");
assert.match(grants, /role\s+text\s+not\s+null\s+default 'viewer'\s+check \(role in \('viewer', 'commenter', 'editor', 'owner'\)\)/i, "grants must have role semantics");
assert.match(grants, /permissions\s+jsonb\s+not\s+null\s+default '\{\}'::jsonb/i, "grants must allow additive permission metadata");
assert.match(grants, /policy_snapshot\s+jsonb\s+not\s+null\s+default '\{\}'::jsonb/i, "grants must keep policy snapshot metadata");
assert.match(grants, /created_by_organization_id\s+text\s+not\s+null/i, "grants must audit creator org");
assert.match(grants, /created_by_user_id\s+text\s+not\s+null/i, "grants must audit creator user");

const audit = tableBody("agent_workspace_access_grant_audit");
assert.match(audit, /event\s+text\s+not\s+null\s+check/i, "audit must classify events");
for (const event of ["grant_created", "grant_updated", "grant_revoked", "accessed", "denied", "external_invite_sent", "external_invite_accepted"]) {
  assert.match(audit, new RegExp(`'${event}'`, "i"), `audit must include ${event}`);
}
assert.match(audit, /actor_organization_id\s+text/i, "audit must record actor org");
assert.match(audit, /actor_user_id\s+text/i, "audit must record actor user");
assert.match(audit, /before_state\s+jsonb/i, "audit must record before state");
assert.match(audit, /after_state\s+jsonb/i, "audit must record after state");
assert.match(audit, /retention_until\s+timestamptz/i, "audit must include retention planning field");

assert.match(sql, /create or replace function sonik_agent_ui\.current_principal_matches_grant/i, "migration must expose principal/grant matching helper");
assert.match(sql, /create or replace function sonik_agent_ui\.current_principal_has_active_resource_grant/i, "migration must expose active resource grant helper");
assert.match(sql, /create policy agent_workspace_access_grants_owner_or_grantee_scope/i, "grant rows must be visible to owner or active grantee");
assert.match(sql, /with check \(organization_id = sonik_agent_ui\.current_organization_id\(\) and user_id = sonik_agent_ui\.current_user_id\(\)\)/i, "grant mutations must be owner scoped");
assert.match(sql, /create policy agent_workspace_access_grant_audit_owner_or_actor_scope/i, "audit rows must be owner/actor scoped");
assert.match(sql, /current_principal_has_active_resource_grant\(organization_id, user_id, resource_type, resource_id\)/i, "non-owner audit inserts must require an active resource grant");
assert.doesNotMatch(sql, /postMessage|localStorage|x-organization-id/i, "sharing migration must not trust browser org hints");

console.log("workspace access grants migration contract tests passed");


const migrationRunnerSource = readFileSync("scripts/run-postgres-migrations.mjs", "utf8");
assert.equal(migrationRunnerSource.includes("assertRecordedMigrationMatches"), true, "migration runner should enforce recorded migration checksum drift instead of silently skipping changed files");
assert.equal(migrationRunnerSource.includes("Refusing to ignore migration drift"), true, "migration runner checksum drift failure should be explicit and operator-actionable");

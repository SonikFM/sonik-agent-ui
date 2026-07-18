import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [source, organizationScopeMigration] = await Promise.all([
  readFile("scripts/run-postgres-migrations.mjs", "utf8"),
  readFile("packages/workspace-session/migrations/postgres/0019_organization_scoped_workflow_versions.sql", "utf8"),
]);

function baseline(version) {
  const match = source.match(new RegExp('version: "' + version + '"[\\s\\S]*?baselineCheck: `([\\s\\S]*?)`'));
  assert.ok(match, `migration ${version} has a baseline predicate`);
  return match[1];
}

const requiredArtifacts = {
  "0015": [
    "agent_definition_drafts", "agent_definition_published_versions",
    "organization_id", "created_by_user_id", "updated_by_user_id", "legacy_quarantined_at",
    "agent_definition_drafts_tenant_agent_key", "agent_definition_published_versions_tenant_package_key",
    "agent_definition_drafts_authority_or_quarantine_check", "agent_definition_published_authority_or_quarantine_check",
    "agent_definition_drafts_tenant_scope", "agent_definition_published_versions_tenant_scope",
  ],
  "0016": [
    "workflow_definition_drafts", "workflow_definition_published_versions",
    "draft_revision", "workflow_version_id", "dependency_pins",
    "workflow_definition_drafts_owner_updated_idx", "workflow_definition_versions_owner_workflow_idx",
    "workflow_definition_versions_immutable", "workflow_definition_drafts_pkey", "workflow_definition_published_versions_pkey",
    "workflow_definition_drafts_scope", "workflow_definition_versions_scope",
  ],
  "0017": [
    "journal_revision", "journal_sequence", "canonical_snapshot", "compatibility_phase",
    "agent_workflow_run_events", "agent_workflow_run_leases", "agent_workflow_run_waitpoints", "agent_workflow_effect_claims",
    "lease_id", "owner_id", "lease_expires_at", "waitpoint_id", "logical_effect_id", "idempotency_key",
    "agent_workflow_runs_journal_position_check", "agent_workflow_run_leases_expiry_idx",
    "agent_workflow_run_events_scope", "agent_workflow_run_leases_scope", "agent_workflow_run_waitpoints_scope", "agent_workflow_effect_claims_scope",
  ],
};

for (const [version, artifacts] of Object.entries(requiredArtifacts)) {
  const sql = baseline(version);
  assert.match(sql, /not exists[\s\S]*information_schema\.columns/i, `${version} rejects missing columns`);
  assert.match(sql, /relrowsecurity[\s\S]*relforcerowsecurity/i, `${version} requires enabled and forced RLS`);
  assert.match(sql, /pg_policy/i, `${version} requires tenant policies`);
  for (const artifact of artifacts) assert.ok(sql.includes(artifact), `${version} baseline requires ${artifact}`);
}

for (const version of ["0015", "0016", "0017"]) {
  const sql = baseline(version);
  assert.match(sql, /pg_get_indexdef|pg_get_constraintdef/i, `${version} compares canonical artifact definitions`);
  assert.match(sql, /polpermissive[\s\S]*polcmd[\s\S]*polroles/i, `${version} compares canonical policy metadata`);
  assert.match(sql, /pg_get_expr[\s\S]*polqual[\s\S]*pg_get_expr[\s\S]*polwithcheck/i, `${version} compares canonical policy expressions`);
  assert.match(sql, /count\(\*\)[\s\S]*pg_policy/i, `${version} rejects extra same-table policies`);
}

const organizationScopedVersions = baseline("0019");
assert.match(organizationScopedVersions, /organization_id,workflow_version_id/, "0019 requires organization-scoped version identity");
assert.match(organizationScopedVersions, /pg_get_indexdef/i, "0019 compares the canonical lookup-index definition");
assert.match(organizationScopedVersions, /indisvalid[\s\S]*indisready/i, "0019 requires a valid and ready lookup index");
assert.match(organizationScopedVersions, /current_organization_id/, "0019 requires organization authority in the read policy");
assert.match(organizationScopedVersions, /current_user_id/, "0019 requires publisher authority in the write policy");
assert.match(organizationScopedVersions, /regexp_replace[\s\S]*qual/i, "0019 compares the normalized read-policy expression");
assert.match(organizationScopedVersions, /regexp_replace[\s\S]*(?:with_check|polwithcheck)/i, "0019 compares the normalized write-policy expression");
assert.match(organizationScopedVersions, /count\(\*\)[\s\S]*pg_policy[\s\S]*= 1/i, "0019 requires exactly one published-version policy");
assert.match(organizationScopedVersions, /tgenabled\s*=\s*'O'/i, "0019 requires an enabled immutability trigger");
assert.match(organizationScopedVersions, /tgtype\s*=\s*27/i, "0019 requires a BEFORE ROW UPDATE OR DELETE trigger");
assert.match(organizationScopedVersions, /tgqual\s+is\s+null/i, "0019 rejects an immutability trigger with a WHEN predicate");
assert.match(organizationScopedVersions, /tgattr\s*=\s*''::int2vector/i, "0019 rejects an UPDATE OF column-restricted trigger");
assert.match(organizationScopedVersions, /pg_proc[\s\S]*reject_published_workflow_mutation/i, "0019 binds the canonical trigger function");
assert.match(organizationScopedVersions, /pg_language[\s\S]*plpgsql/i, "0019 requires the canonical PL/pgSQL implementation");
assert.match(organizationScopedVersions, /prosrc[\s\S]*publishedworkflowversionsareimmutable/i, "0019 rejects a no-op canonical trigger function");
assert.match(organizationScopedVersions, /polpermissive/i, "0019 requires a permissive tenant policy");
assert.match(organizationScopedVersions, /polcmd\s*=\s*'\*'/i, "0019 requires an ALL-command tenant policy");
assert.match(organizationScopedVersions, /polroles\s*=\s*array\[0::oid\]/i, "0019 requires a PUBLIC tenant policy");
assert.match(source, /version: "0019"[\s\S]*?transactional: false/, "0019 uses the non-transactional migration lane");
assert.match(organizationScopeMigration, /create unique index concurrently workflow_definition_published_versions_organization_version_key/i, "0019 builds the replacement primary-key index without blocking writers");
assert.match(organizationScopeMigration, /primary key using index workflow_definition_published_versions_organization_version_key/i, "0019 attaches the prebuilt primary-key index");
assert.match(organizationScopeMigration, /drop index concurrently if exists sonik_agent_ui\.workflow_definition_versions_owner_workflow_idx/i, "0019 removes the legacy lookup index concurrently");
assert.match(organizationScopeMigration, /create index concurrently workflow_definition_versions_organization_workflow_idx/i, "0019 rebuilds the canonical lookup index concurrently");
assert.match(organizationScopeMigration, /alter table sonik_agent_ui\.workflow_definition_published_versions\s+enable row level security/i, "0019 repairs disabled RLS");
assert.match(organizationScopeMigration, /alter table sonik_agent_ui\.workflow_definition_published_versions\s+force row level security/i, "0019 repairs unforced RLS");
assert.match(organizationScopeMigration, /drop index concurrently if exists sonik_agent_ui\.workflow_definition_versions_organization_workflow_idx/i, "0019 removes a poisoned same-name lookup index without blocking writers");
assert.match(organizationScopeMigration, /pg_constraint[\s\S]*conindid[\s\S]*to_regclass\('sonik_agent_ui\.workflow_definition_versions_organization_workflow_idx'\)[\s\S]*workflow_definition_published_versions/i, "0019 removes a constraint-owned poisoned same-name lookup index only from the expected table");
assert.doesNotMatch(organizationScopeMigration, /create index if not exists workflow_definition_versions_organization_workflow_idx/i, "0019 recreates the canonical lookup index unconditionally");

console.log("postgres-migration-baselines.test.mjs OK");

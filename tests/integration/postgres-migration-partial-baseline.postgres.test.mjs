import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { buildPgEnv } from "../../scripts/lib/postgres-connection.mjs";

const sourceUrl = process.env.POSTGRES_TEST_URL;
if (!sourceUrl) throw new Error("POSTGRES_TEST_URL is required");

const adminUrl = new URL(sourceUrl);
adminUrl.pathname = "/postgres";
const database = `sonik_agent_ui_partial_baseline_${process.pid}_${Date.now()}`;
const testUrl = new URL(sourceUrl);
testUrl.pathname = `/${database}`;

function psql(url, sql) {
	return execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-X", "-At", "-c", sql], {
		encoding: "utf8",
		env: { ...process.env, ...buildPgEnv(url.toString()) },
	}).trim();
}

function runMigrations(url, { dryRun = false } = {}) {
	return execFileSync(process.execPath, ["scripts/run-postgres-migrations.mjs", ...(dryRun ? ["--dry-run"] : [])], {
		cwd: process.cwd(),
		encoding: "utf8",
		env: { ...process.env, DATABASE_URL: url.toString() },
	});
}

function assert0019Applies(url, message) {
	const output = runMigrations(url, { dryRun: true });
	assert.match(output, /\[db:migrate\] 0019 organization_scoped_workflow_versions: applying /, message);
	assert.doesNotMatch(output, /0019 organization_scoped_workflow_versions: existing schema detected; recording baseline/);
}

psql(adminUrl, `create database ${database}`);
try {
	psql(
		testUrl,
		`
			create schema sonik_agent_ui;

			create table sonik_agent_ui.agent_definition_drafts (
				organization_id text
			);
			create table sonik_agent_ui.agent_definition_published_versions (
				organization_id text
			);
			alter table sonik_agent_ui.agent_definition_drafts enable row level security;
			alter table sonik_agent_ui.agent_definition_drafts force row level security;

			create table sonik_agent_ui.workflow_definition_drafts (
				organization_id text
			);
			create table sonik_agent_ui.workflow_definition_published_versions (
				organization_id text
			);
			alter table sonik_agent_ui.workflow_definition_drafts enable row level security;
			alter table sonik_agent_ui.workflow_definition_drafts force row level security;

			create table sonik_agent_ui.agent_workflow_runs (
				journal_revision bigint
			);
			create table sonik_agent_ui.agent_workflow_run_events (
				organization_id text
			);
			create table sonik_agent_ui.agent_workflow_run_leases (
				organization_id text
			);
			create table sonik_agent_ui.agent_workflow_run_waitpoints (
				organization_id text
			);
			create table sonik_agent_ui.agent_workflow_effect_claims (
				organization_id text
			);
		`,
	);

	const output = runMigrations(testUrl, { dryRun: true });

	for (const [version, name] of [
		["0015", "agent_definition_tenant_authority"],
		["0016", "workflow_definitions"],
		["0017", "workflow_run_journal"],
	]) {
		assert.match(
			output,
			new RegExp(`\\[db:migrate\\] ${version} ${name}: applying `),
			`${version} must be applied when only its former weak baseline predicates exist`,
		);
		assert.doesNotMatch(
			output,
			new RegExp(`\\[db:migrate\\] ${version} ${name}: existing schema detected; recording baseline`),
			`${version} must not record a partial schema as complete`,
		);
	}

	assert.equal(
		psql(testUrl, "select to_regclass('sonik_agent_ui.schema_migrations') is null"),
		"t",
		"dry-run must not create the migration ledger",
	);
	assert.equal(
		psql(
			testUrl,
			"select count(*) from information_schema.columns where table_schema = 'sonik_agent_ui' and table_name = 'agent_definition_drafts'",
		),
		"1",
		"dry-run must not repair or otherwise mutate the partial schema",
	);

	console.log("postgres-migration-partial-baseline.postgres.test.mjs: all assertions passed");
} finally {
	psql(adminUrl, `drop database if exists ${database} with (force)`);
}

const canonicalityDatabase = `sonik_agent_ui_0019_canonicality_${process.pid}_${Date.now()}`;
const canonicalityUrl = new URL(sourceUrl);
canonicalityUrl.pathname = `/${canonicalityDatabase}`;
const policyRole = `sonik_agent_ui_0019_policy_${process.pid}`;

psql(adminUrl, `create database ${canonicalityDatabase}`);
psql(adminUrl, `create role ${policyRole} nologin`);
try {
	runMigrations(canonicalityUrl);

	const prepareRepair = (sql) => psql(canonicalityUrl, `${sql}; delete from sonik_agent_ui.schema_migrations where version = '0019'`);
	const repair = (sql, message) => {
		prepareRepair(sql);
		assert0019Applies(canonicalityUrl, message);
		runMigrations(canonicalityUrl);
	};
	const assertCanonicalTrigger = () => assert.equal(
		psql(canonicalityUrl, `
			select (tgqual is null and tgattr = ''::int2vector)::text
			from pg_trigger
			where tgrelid = 'sonik_agent_ui.workflow_definition_published_versions'::regclass
				and tgname = 'workflow_definition_versions_immutable'
		`),
		"true",
	);
	const assertCanonicalPolicy = () => assert.equal(
		psql(canonicalityUrl, `
			select (count(*) = 1 and bool_and(polpermissive and polcmd = '*' and polroles = array[0::oid]))::text
			from pg_policy
			where polrelid = 'sonik_agent_ui.workflow_definition_published_versions'::regclass
		`),
		"true",
	);
	const assertCanonicalIndex = () => assert.equal(
		psql(canonicalityUrl, `
			select regexp_replace(lower(pg_get_indexdef('sonik_agent_ui.workflow_definition_versions_organization_workflow_idx'::regclass)), '[[:space:]]', '', 'g')
		`),
		"createindexworkflow_definition_versions_organization_workflow_idxonsonik_agent_ui.workflow_definition_published_versionsusingbtree(organization_id,workflow_id,published_atdesc)",
	);

	repair(`
		drop index sonik_agent_ui.workflow_definition_versions_organization_workflow_idx;
		create index workflow_definition_versions_organization_workflow_idx
			on sonik_agent_ui.workflow_definition_published_versions (user_id)
	`, "a poisoned same-name lookup index invalidates the baseline");
	assertCanonicalIndex();

	repair(`
		drop index sonik_agent_ui.workflow_definition_versions_organization_workflow_idx;
		alter table sonik_agent_ui.workflow_definition_published_versions
			add constraint workflow_definition_versions_organization_workflow_idx unique (user_id)
	`, "a constraint-owned poisoned same-name lookup index invalidates the baseline");
	assert.equal(
		psql(canonicalityUrl, "select count(*) from sonik_agent_ui.schema_migrations where version = '0019'"),
		"1",
		"0019 records exactly one ledger row after repairing a constraint-owned collision",
	);
	assert.equal(
		psql(canonicalityUrl, `
			select count(*)
			from pg_constraint
			where conrelid = 'sonik_agent_ui.workflow_definition_published_versions'::regclass
				and conname = 'workflow_definition_versions_organization_workflow_idx'
		`),
		"0",
		"0019 removes the poison constraint",
	);
	assertCanonicalIndex();

	repair(`
		alter table sonik_agent_ui.workflow_definition_published_versions disable row level security;
		alter table sonik_agent_ui.workflow_definition_published_versions no force row level security
	`, "disabled and unforced RLS invalidates the baseline");
	assert.equal(
		psql(canonicalityUrl, `
			select (relrowsecurity and relforcerowsecurity)::text
			from pg_class
			where oid = 'sonik_agent_ui.workflow_definition_published_versions'::regclass
		`),
		"true",
		"0019 repairs enabled and forced RLS",
	);

	repair(`
		drop trigger workflow_definition_versions_immutable on sonik_agent_ui.workflow_definition_published_versions;
		create trigger workflow_definition_versions_immutable before update or delete
			on sonik_agent_ui.workflow_definition_published_versions for each row when (false)
			execute function sonik_agent_ui.reject_published_workflow_mutation()
	`, "a WHEN predicate invalidates the trigger baseline");
	assertCanonicalTrigger();

	repair(`
		drop trigger workflow_definition_versions_immutable on sonik_agent_ui.workflow_definition_published_versions;
		create trigger workflow_definition_versions_immutable before update of definition or delete
			on sonik_agent_ui.workflow_definition_published_versions for each row
			execute function sonik_agent_ui.reject_published_workflow_mutation()
	`, "an UPDATE OF restriction invalidates the trigger baseline");
	assertCanonicalTrigger();

	const canonicalPolicyExpressions = `
		using (organization_id = sonik_agent_ui.current_organization_id())
		with check (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id())
	`;
	for (const [metadata, message] of [
		[`as restrictive for all to public`, "a restrictive policy invalidates the baseline"],
		[`as permissive for update to public`, "a command-specific policy invalidates the baseline"],
		[`as permissive for all to ${policyRole}`, "a role-specific policy invalidates the baseline"],
	]) {
		repair(`
			drop policy workflow_definition_versions_scope on sonik_agent_ui.workflow_definition_published_versions;
			create policy workflow_definition_versions_scope on sonik_agent_ui.workflow_definition_published_versions
				${metadata} ${canonicalPolicyExpressions}
		`, message);
		assertCanonicalPolicy();
	}

	console.log("postgres-migration-partial-baseline.postgres.test.mjs: 0019 canonicality assertions passed");
} finally {
	psql(adminUrl, `drop database if exists ${canonicalityDatabase} with (force)`);
	psql(adminUrl, `drop role if exists ${policyRole}`);
}

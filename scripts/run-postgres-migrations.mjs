#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const databaseUrl = process.env.DATABASE_URL;
const dryRun = process.argv.includes("--dry-run");

const migrations = [
	{
		version: "0001",
		name: "agent_workspace_persistence",
		file: "packages/workspace-session/migrations/postgres/0001_agent_workspace_persistence.sql",
		baselineCheck: `
			select (
				to_regclass('sonik_agent_ui.agent_workspace_sessions') is not null
				and to_regclass('sonik_agent_ui.agent_workspace_messages') is not null
				and to_regclass('sonik_agent_ui.agent_workspace_documents') is not null
				and to_regclass('sonik_agent_ui.agent_workspace_artifacts') is not null
				and to_regclass('sonik_agent_ui.agent_workspace_telemetry_events') is not null
			)::text
		`,
	},
	{
		version: "0002",
		name: "agent_workspace_access_grants",
		file: "packages/workspace-session/migrations/postgres/0002_agent_workspace_access_grants.sql",
		baselineCheck: `
			select (
				to_regclass('sonik_agent_ui.agent_workspace_access_grants') is not null
				and to_regclass('sonik_agent_ui.agent_workspace_access_grant_audit') is not null
			)::text
		`,
	},
];

if (!databaseUrl) {
	console.error("DATABASE_URL is required. Example: DATABASE_URL='<postgres-url>' pnpm run db:migrate");
	process.exit(2);
}

function psql(args, options = {}) {
	return execFileSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", ...args], {
		cwd: repoRoot,
		encoding: "utf8",
		stdio: options.stdio ?? ["ignore", "pipe", "inherit"],
	});
}

function scalar(sql) {
	return psql(["-At", "-c", sql]).trim();
}

function sqlLiteral(value) {
	return `'${String(value).replaceAll("'", "''")}'`;
}

function checksum(filePath) {
	return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function ensureMigrationLedger() {
	psql([
		"-c",
		`
			create schema if not exists sonik_agent_ui;
			create table if not exists sonik_agent_ui.schema_migrations (
				version text primary key,
				name text not null,
				checksum text not null,
				applied_via text not null check (applied_via in ('runner', 'baseline')),
				applied_at timestamptz not null default now()
			);
		`,
	]);
}

function migrationLedgerExists() {
	return scalar("select (to_regclass('sonik_agent_ui.schema_migrations') is not null)::text") === "true";
}

function readRecordedMigration(version) {
	if (!migrationLedgerExists()) return null;
	const row = scalar(`select concat_ws(E'\t', checksum, applied_via) from sonik_agent_ui.schema_migrations where version = ${sqlLiteral(version)}`);
	if (!row) return null;
	const [recordedChecksum, appliedVia] = row.split("\t");
	return { checksum: recordedChecksum, appliedVia };
}

function assertRecordedMigrationMatches(migration, sum, recorded) {
	if (recorded.checksum === sum) return;
	throw new Error(`[db:migrate] ${migration.version} ${migration.name}: recorded checksum ${recorded.checksum} differs from current ${sum}. Refusing to ignore migration drift.`);
}

function recordMigration(migration, sum, appliedVia) {
	psql([
		"-c",
		`
			insert into sonik_agent_ui.schema_migrations (version, name, checksum, applied_via)
			values (${sqlLiteral(migration.version)}, ${sqlLiteral(migration.name)}, ${sqlLiteral(sum)}, ${sqlLiteral(appliedVia)})
			on conflict (version) do nothing;
		`,
	]);
}

function baselineExists(migration) {
	return scalar(migration.baselineCheck) === "true";
}

function applyMigration(migration, sum) {
	const filePath = path.resolve(repoRoot, migration.file);
	const recordSql = `
		insert into sonik_agent_ui.schema_migrations (version, name, checksum, applied_via)
		values (${sqlLiteral(migration.version)}, ${sqlLiteral(migration.name)}, ${sqlLiteral(sum)}, 'runner')
		on conflict (version) do nothing;
	`;
	psql(["-1", "-f", filePath, "-c", recordSql], { stdio: "inherit" });
}

if (!dryRun) ensureMigrationLedger();

for (const migration of migrations) {
	const filePath = path.resolve(repoRoot, migration.file);
	const sum = checksum(filePath);
	const recorded = readRecordedMigration(migration.version);
	if (recorded) {
		assertRecordedMigrationMatches(migration, sum, recorded);
		console.log(`[db:migrate] ${migration.version} ${migration.name}: already recorded (${recorded.appliedVia})`);
		continue;
	}
	if (baselineExists(migration)) {
		console.log(`[db:migrate] ${migration.version} ${migration.name}: existing schema detected; recording baseline`);
		if (!dryRun) recordMigration(migration, sum, "baseline");
		continue;
	}
	console.log(`[db:migrate] ${migration.version} ${migration.name}: applying ${migration.file}`);
	if (!dryRun) applyMigration(migration, sum);
}

console.log("[db:migrate] complete");

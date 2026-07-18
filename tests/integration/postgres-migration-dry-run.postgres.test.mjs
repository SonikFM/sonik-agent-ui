import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { buildPgEnv } from "../../scripts/lib/postgres-connection.mjs";

const sourceUrl = process.env.POSTGRES_TEST_URL;
if (!sourceUrl) throw new Error("POSTGRES_TEST_URL is required");

const adminUrl = new URL(sourceUrl);
adminUrl.pathname = "/postgres";
const database = `sonik_agent_ui_migration_dry_run_${process.pid}_${Date.now()}`;
const testUrl = new URL(sourceUrl);
testUrl.pathname = `/${database}`;

function psql(url, sql) {
  return execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-X", "-At", "-c", sql], {
    encoding: "utf8",
    env: { ...process.env, ...buildPgEnv(url.toString()) },
  }).trim();
}

psql(adminUrl, `create database ${database}`);
try {
  const output = execFileSync(process.execPath, ["scripts/run-postgres-migrations.mjs", "--dry-run"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: testUrl.toString() },
  });

  for (const version of ["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008", "0009", "0010", "0011", "0012", "0013", "0014", "0015", "0016", "0017", "0018", "0019"]) {
    assert.match(output, new RegExp(`\\[db:migrate\\] ${version} [^\\n]+: applying `), `${version} should be planned`);
  }
  assert.match(output, /\[db:migrate\] complete/);
  assert.equal(psql(testUrl, "select to_regnamespace('sonik_agent_ui') is null"), "t", "dry-run must not create the schema");
  console.log("postgres-migration-dry-run.postgres.test.mjs: all assertions passed");
} finally {
  psql(adminUrl, `drop database if exists ${database} with (force)`);
}

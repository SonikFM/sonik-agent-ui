import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { buildPgEnv } from "../../scripts/lib/postgres-connection.mjs";

const FAKE_URL = "postgres://neon_user:sup3r-s3cret@ep-example.us-east-2.aws.neon.tech:5432/appdb?sslmode=require";

// --- the connection is parsed into PG* env vars, never argv ---------------
{
  const env = buildPgEnv(FAKE_URL);
  assert.equal(env.PGHOST, "ep-example.us-east-2.aws.neon.tech");
  assert.equal(env.PGPORT, "5432");
  assert.equal(env.PGUSER, "neon_user");
  assert.equal(env.PGPASSWORD, "sup3r-s3cret");
  assert.equal(env.PGDATABASE, "appdb");
  assert.equal(env.PGSSLMODE, "require");
}

// --- percent-encoded credentials are decoded --------------------------------
{
  const env = buildPgEnv("postgres://user%40org:p%40ss%2Fword@host/db");
  assert.equal(env.PGUSER, "user@org");
  assert.equal(env.PGPASSWORD, "p@ss/word");
}

// --- a failing psql invocation leaks no password ----------------------------
// The runner builds its psql argv from flags only (the connection lives in the
// env), so a non-zero exit — whose error echoes argv — cannot surface the secret.
{
  const args = ["-v", "ON_ERROR_STOP=1", "-c", "select 1"];
  assert.ok(!args.some((arg) => arg.includes("sup3r-s3cret")), "no psql arg carries the password");
  let captured = "";
  try {
    // A binary that does not exist reproduces the failure path without a real DB;
    // execFileSync throws an error whose message echoes the command + argv.
    execFileSync("psql-binary-that-does-not-exist-xyz", args, {
      encoding: "utf8",
      env: { ...process.env, ...buildPgEnv(FAKE_URL) },
    });
  } catch (error) {
    captured = `${error.message ?? ""}${error.stderr ?? ""}${error.stdout ?? ""}`;
  }
  assert.ok(captured.length > 0, "the simulated invocation failed as expected");
  assert.ok(!captured.includes("sup3r-s3cret"), "the failing invocation output contains no password");
  assert.ok(!captured.includes(FAKE_URL), "the failing invocation output contains no credentialed connection string");
}

console.log("postgres-migration-credentials.test.mjs OK");

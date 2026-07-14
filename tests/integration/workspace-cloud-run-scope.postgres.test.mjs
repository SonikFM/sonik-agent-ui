import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createCloudWorkspacePersistenceAdapter } from "../../packages/workspace-session/src/index.ts";
import { buildPgEnv } from "../../scripts/lib/postgres-connection.mjs";

const sourceUrl = process.env.POSTGRES_TEST_URL;
if (!sourceUrl) throw new Error("POSTGRES_TEST_URL is required");

const adminUrl = new URL(sourceUrl);
adminUrl.pathname = "/postgres";
const database = `sonik_agent_ui_run_scope_${process.pid}_${Date.now()}`;
const testUrl = new URL(sourceUrl);
testUrl.pathname = `/${database}`;

function psql(url, sql) {
  return execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-X", "-At", "-c", sql], {
    encoding: "utf8",
    env: { ...process.env, ...buildPgEnv(url.toString()) },
  }).trim();
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function bind(sql, params) {
  return sql.replace(/\$(\d+)/g, (_, index) => sqlLiteral(params[Number(index) - 1]));
}

const executor = {
  async transaction(fn) {
    let context;
    return fn({
      async query(sql, params = []) {
        if (sql.startsWith("select sonik_agent_ui.set_request_context")) {
          context = params;
          const settings = psql(testUrl, `begin; ${bind(sql, params)}; select current_setting('app.organization_id') || ':' || current_setting('app.user_id'); commit; select coalesce(current_setting('app.organization_id', true), '<unset>') || ':' || coalesce(current_setting('app.user_id', true), '<unset>')`);
          assert.deepEqual(settings.split("\n").filter((line) => line && line !== "BEGIN" && line !== "COMMIT"), [`${params[0]}:${params[1]}`, ":"], "set_request_context must be transaction-local");
          return { rows: [] };
        }
        assert.ok(context, "workspace query must follow set_request_context in the adapter transaction");
        if (/^(?:update|delete|insert)\b/i.test(sql.trim()) && !/\breturning\b/i.test(sql)) {
          psql(testUrl, bind(sql, params));
          return { rows: [] };
        }
        const output = psql(testUrl, `with query_rows as (${bind(sql, params)}) select coalesce(json_agg(query_rows), '[]'::json)::text from query_rows`);
        return { rows: JSON.parse(output) };
      },
    });
  },
};

function runtime(hostSessionId) {
  return {
    kind: "cloud",
    env: { test: true },
    db: executor,
    userId: "user-run-scope",
    organizationId: "org-run-scope",
    principalId: "user-run-scope",
    requestId: `request-${hostSessionId}`,
    commandPolicy: { allowed: true, commandId: "workspace.session.write", reasonCode: "test", effectiveScope: "workspace" },
    hostSession: { source: "test", sessionId: hostSessionId, userId: "user-run-scope", principalId: "user-run-scope", organizationId: "org-run-scope", authenticated: true, scopes: ["workspace:read", "workspace:write"] },
  };
}

psql(adminUrl, `create database ${database}`);
try {
  assert.match(psql(testUrl, "show server_version"), /^18\./, "regression must exercise PostgreSQL 18");
  execFileSync(process.execPath, ["scripts/run-postgres-migrations.mjs"], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: testUrl.toString() }, stdio: "pipe" });

  const owner = createCloudWorkspacePersistenceAdapter(runtime("host-owner"));
  const otherHost = createCloudWorkspacePersistenceAdapter(runtime("host-other"));
  const session = await owner.createSession({ id: "session-run-scope" });
  const message = await owner.appendMessage({ id: "message-scope", session_id: session.id, role: "user", content: "owner" });
  const document = await owner.createDocument({ session_id: session.id, title: "Owner document", content: "owner" });
  const artifact = await owner.createArtifact({ id: "artifact-scope", session_id: session.id, kind: "json-render", title: "Owner artifact", content: { owner: true } });
  const file = await owner.createFile({ id: "file-scope", session_id: session.id, storage_key: "opaque/file-scope", original_filename: "owner.txt", media_type: "text/plain", byte_size: 5 });
  await owner.recordLayoutSnapshot({ session_id: session.id, active_artifact_id: artifact.id, layout: { owner: true } });

  assert.deepEqual(await otherHost.listMessages(session.id), []);
  await assert.rejects(() => otherHost.appendMessage({ id: "message-denied", session_id: session.id, role: "user", content: "denied" }), /outside the authorized host session/);
  assert.equal(await otherHost.getDocument(document.id), null);
  assert.deepEqual(await otherHost.listDocuments(session.id), []);
  assert.equal((await otherHost.listDocumentLibrary()).total, 0);
  assert.deepEqual(await otherHost.listDocumentVersions(document.id), []);
  assert.equal(await otherHost.getDocumentVersion(document.id, 1), null);
  assert.equal(await otherHost.updateDocument(document.id, { content: "denied" }), null);
  assert.equal(await otherHost.patchDocument(document.id, { title: "denied" }), null);
  assert.equal(await otherHost.archiveDocument(document.id), null);
  assert.equal(await otherHost.deleteDocument(document.id), false);
  assert.equal(await otherHost.restoreDocumentVersion(document.id, 1), null);
  await assert.rejects(() => otherHost.syncActiveDocumentSnapshot({ ...document, current_content: "denied" }), /outside the authorized host session/);
  assert.equal(await otherHost.getArtifact(artifact.id), null);
  assert.equal(await otherHost.updateArtifact(artifact.id, { title: "denied" }), null);
  assert.deepEqual(await otherHost.listArtifactVersions(artifact.id), []);
  assert.equal(await otherHost.getFile(file.id), null);
  assert.deepEqual(await otherHost.listFiles(session.id), []);
  assert.equal(await otherHost.updateFile(file.id, { provider_references: { google: "secret" } }), null);
  assert.equal(await otherHost.deleteFile(file.id), false);
  assert.deepEqual(await otherHost.listLayoutSnapshots(session.id), []);
  assert.equal(await otherHost.patchSession(session.id, { name: "denied" }), null);
  assert.equal(await otherHost.archiveSession(session.id), null);
  assert.equal(await otherHost.beginSessionDeletion(session.id), false);
  assert.equal(await otherHost.deleteSession(session.id), false);
  assert.equal((await owner.getDocument(document.id))?.current_content, "owner");
  assert.equal((await owner.getArtifact(artifact.id))?.title, "Owner artifact");
  assert.equal((await owner.getFile(file.id))?.provider_references, null);

  const run = await owner.createRun({ id: "run-scope", session_id: session.id, user_message_id: message.id });
  const event = await owner.appendRunEvent({ run_id: run.id, session_id: session.id, kind: "status", event: { kind: "status", label: "started" } });

  assert.equal((await owner.getRun(run.id))?.id, run.id);
  assert.equal(await otherHost.getRun(run.id), null);
  assert.deepEqual(await otherHost.listRuns(session.id), []);
  assert.equal(await otherHost.updateRun(run.id, { status: "failed" }), null);
  assert.deepEqual((await owner.listRunEvents(run.id)).map((entry) => entry.id), [event.id]);
  assert.deepEqual(await otherHost.listRunEvents(run.id), []);
  await assert.rejects(
    () => otherHost.appendRunEvent({ run_id: run.id, session_id: session.id, kind: "status", event: { kind: "status", label: "denied" } }),
    /Cloud run not found for the authorized host session/,
  );
  await assert.rejects(
    () => owner.appendRunEvent({ run_id: run.id, session_id: "different-session", kind: "status", event: { kind: "status", label: "mismatched" } }),
    /session_id must match the parent run/i,
  );
  assert.deepEqual((await owner.listRunEvents(run.id)).map((entry) => entry.seq), [0], "denied appends must not allocate a run-event sequence");
  assert.equal((await owner.updateRun(run.id, { status: "succeeded" }))?.status, "succeeded");
  console.log("workspace-cloud-run-scope.postgres.test.mjs: all assertions passed");
} finally {
  psql(adminUrl, `drop database if exists ${database} with (force)`);
}

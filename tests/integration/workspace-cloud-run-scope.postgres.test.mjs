import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createCloudWorkspacePersistenceAdapter } from "../../packages/workspace-session/src/index.ts";
import { createCloudWorkflowRunStore } from "../../apps/standalone-sveltekit/src/lib/server/workflow-run-store.ts";
import { buildPgEnv } from "../../scripts/lib/postgres-connection.mjs";

const sourceUrl = process.env.POSTGRES_TEST_URL;
if (!sourceUrl) {
  console.log("workspace-cloud-run-scope.postgres.test.mjs: SKIP (POSTGRES_TEST_URL unavailable; unit/source RLS ceiling remains active)");
  process.exit(0);
}

const adminUrl = new URL(sourceUrl);
adminUrl.pathname = "/postgres";
const database = `sonik_agent_ui_run_scope_${process.pid}_${Date.now()}`;
const rlsRole = `sonik_agent_ui_rls_probe_${process.pid}_${Date.now()}`;
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

function runtime(hostSessionId, organizationId = "org-run-scope", userId = "user-run-scope") {
  return {
    kind: "cloud",
    env: { test: true },
    db: executor,
    userId,
    organizationId,
    principalId: userId,
    requestId: `request-${hostSessionId}`,
    commandPolicy: { allowed: true, commandId: "workspace.session.write", reasonCode: "test", effectiveScope: "workspace" },
    hostSession: { source: "test", sessionId: hostSessionId, userId, principalId: userId, organizationId, authenticated: true, scopes: ["workspace:read", "workspace:write"] },
  };
}

psql(adminUrl, `create database ${database}`);
try {
  assert.match(psql(testUrl, "show server_version"), /^18\./, "regression must exercise PostgreSQL 18");
  execFileSync(process.execPath, ["scripts/run-postgres-migrations.mjs"], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: testUrl.toString() }, stdio: "pipe" });

  // agent_workflow_runs has its own store outside the general workspace persistence adapter.
  // Its durable authority is still the same stable organization + user pair, with host session
  // retained only as immutable insert-time provenance.
  const workflowStore = createCloudWorkflowRunStore(executor);
  const workflowOwner = { organizationId: "org-run-scope", userId: "user-run-scope", hostSessionId: "host-owner" };
  const rotatedWorkflowOwner = { ...workflowOwner, hostSessionId: "host-rotated" };
  const otherUserWorkflowOwner = { ...workflowOwner, userId: "user-other", hostSessionId: "host-other-user" };
  const otherOrgWorkflowOwner = { ...workflowOwner, organizationId: "org-other", hostSessionId: "host-other-org" };
  const workflowDefinition = {
    workflowId: "scope.workflow",
    title: "Scoped workflow",
    version: "0.1.0",
    nodes: [
      { nodeId: "trigger", type: "trigger", title: "Trigger", effect: "none", approvalPolicy: "none" },
      { nodeId: "preview", type: "tool_preview", title: "Preview", commandId: "scope.workflow.commit", effect: "none", approvalPolicy: "none" },
      { nodeId: "commit", type: "tool_commit", title: "Commit", commandId: "scope.workflow.commit", effect: "write", approvalPolicy: "preview_then_trusted_approval" },
    ],
  };
  const workflowVersionId = "scope.workflow@0.1.0";
  const workflowRunId = "legacy-shared-workflow-run";
  const workflowState = {
    runId: workflowRunId,
    workflowId: workflowDefinition.workflowId,
    workflowVersionId,
    artifactId: null,
    phase: "intake",
    currentNodeId: "trigger",
    facadeToolIds: [],
    nodeStates: {
      trigger: { nodeId: "trigger", type: "trigger", status: "active", effect: "none", required: false },
      preview: { nodeId: "preview", type: "tool_preview", status: "pending", commandId: "scope.workflow.commit", effect: "none", required: false },
      commit: { nodeId: "commit", type: "tool_commit", status: "pending", commandId: "scope.workflow.commit", effect: "write", required: false },
    },
    approvalState: { status: "none", hostSigned: false, approvedCommandIds: [], approvedInputHashes: {} },
    receipts: [],
  };
  const workflowInput = {
    workflowId: workflowDefinition.workflowId,
    workflowVersionId,
    definition: workflowDefinition,
    input: { productName: "Scoped campaign" },
    state: workflowState,
  };

  assert.equal(
    psql(testUrl, "select relrowsecurity::text || ':' || relforcerowsecurity::text from pg_class where oid = 'sonik_agent_ui.agent_workflow_runs'::regclass"),
    "true:true",
    "workflow-run storage must enable and force RLS",
  );
  psql(testUrl, `insert into sonik_agent_ui.agent_workflow_runs (run_id, workflow_id, workflow_version_id, definition, input, state) values ('${workflowRunId}', 'legacy.workflow', 'legacy.workflow@0', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb)`);
  const workflowCreated = await workflowStore.createRun(workflowOwner, workflowInput);
  assert.equal(workflowCreated.hostSessionId, "host-owner");

  // The adapter tests above and below retain explicit owner predicates, but this probe exercises
  // the database policy itself. It deliberately drops superuser bypass with SET LOCAL ROLE and
  // performs empty, owner, and foreign checks inside one real PostgreSQL transaction so the
  // transaction-local request context is the authority under test.
  psql(testUrl, `
    create role ${rlsRole} nologin;
    grant usage on schema sonik_agent_ui to ${rlsRole};
    grant select, update on sonik_agent_ui.agent_workflow_runs to ${rlsRole};
    grant execute on function sonik_agent_ui.set_request_context(text, text) to ${rlsRole};
    grant execute on function sonik_agent_ui.current_organization_id() to ${rlsRole};
    grant execute on function sonik_agent_ui.current_user_id() to ${rlsRole};
  `);
  const rlsEvidence = psql(testUrl, `
    begin;
    set local role ${rlsRole};
    select 'rls_empty_read=' || count(*) from sonik_agent_ui.agent_workflow_runs where run_id = '${workflowRunId}';
    with changed as (
      update sonik_agent_ui.agent_workflow_runs set updated_at = clock_timestamp()
      where run_id = '${workflowRunId}' returning 1
    ) select 'rls_empty_update=' || count(*) from changed;
    select sonik_agent_ui.set_request_context('org-run-scope', 'user-run-scope');
    select 'rls_owner_read=' || count(*) from sonik_agent_ui.agent_workflow_runs where run_id = '${workflowRunId}';
    select 'rls_legacy_read=' || count(*) from sonik_agent_ui.agent_workflow_runs where workflow_id = 'legacy.workflow';
    with changed as (
      update sonik_agent_ui.agent_workflow_runs set updated_at = clock_timestamp()
      where run_id = '${workflowRunId}' returning 1
    ) select 'rls_owner_update=' || count(*) from changed;
    select sonik_agent_ui.set_request_context('org-foreign', 'user-foreign');
    select 'rls_foreign_read=' || count(*) from sonik_agent_ui.agent_workflow_runs where run_id = '${workflowRunId}';
    with changed as (
      update sonik_agent_ui.agent_workflow_runs set updated_at = clock_timestamp()
      where run_id = '${workflowRunId}' returning 1
    ) select 'rls_foreign_update=' || count(*) from changed;
    rollback;
  `).split("\n").filter((line) => line.startsWith("rls_"));
  assert.deepEqual(rlsEvidence, [
    "rls_empty_read=0",
    "rls_empty_update=0",
    "rls_owner_read=1",
    "rls_legacy_read=0",
    "rls_owner_update=1",
    "rls_foreign_read=0",
    "rls_foreign_update=0",
  ], "forced RLS admits only the transaction-local stable owner and hides legacy null-owner rows");

  assert.equal((await workflowStore.getRun(rotatedWorkflowOwner, workflowRunId))?.runId, workflowRunId, "rotated host reads the stable owner's workflow run");
  assert.equal((await workflowStore.updateRunState(rotatedWorkflowOwner, workflowRunId, workflowState))?.hostSessionId, "host-owner", "workflow updates never rewrite host provenance");
  assert.deepEqual((await workflowStore.listRuns(rotatedWorkflowOwner)).map((entry) => entry.runId), [workflowRunId], "legacy unowned rows stay invisible while owned rows remain visible");
  for (const foreignOwner of [otherUserWorkflowOwner, otherOrgWorkflowOwner]) {
    assert.equal(await workflowStore.getRun(foreignOwner, workflowRunId), null, "foreign owners cannot read an exact workflow run");
    assert.deepEqual(await workflowStore.listRuns(foreignOwner), [], "foreign owners cannot list workflow runs");
    assert.equal(await workflowStore.updateRunState(foreignOwner, workflowRunId, workflowState), null, "foreign owners cannot update workflow runs");
    const reused = await workflowStore.createRun(foreignOwner, workflowInput);
    assert.equal(reused.runId, workflowRunId, "another owner can safely reuse a client-supplied run id");
  }
  assert.equal(
    psql(testUrl, `select count(*) from sonik_agent_ui.agent_workflow_runs where run_id = '${workflowRunId}'`),
    "4",
    "one legacy row plus three separately owned rows coexist without cross-tenant squatting",
  );

  const owner = createCloudWorkspacePersistenceAdapter(runtime("host-owner"));
  const rotatedHost = createCloudWorkspacePersistenceAdapter(runtime("host-rotated"));
  const otherUser = createCloudWorkspacePersistenceAdapter(runtime("host-rotated", "org-run-scope", "user-other"));
  const otherOrg = createCloudWorkspacePersistenceAdapter(runtime("host-rotated", "org-other", "user-run-scope"));
  const session = await owner.createSession({ id: "session-run-scope" });
  const nullHostSession = await owner.createSession({ id: "session-null-host" });
  psql(testUrl, "update sonik_agent_ui.agent_workspace_sessions set host_session_id = null where organization_id = 'org-run-scope' and user_id = 'user-run-scope' and id = 'session-null-host'");
  const message = await owner.appendMessage({ id: "message-scope", session_id: session.id, role: "user", content: "owner" });
  const document = await owner.createDocument({ session_id: session.id, title: "Owner document", content: "owner" });
  const artifact = await owner.createArtifact({ id: "artifact-scope", session_id: session.id, kind: "json-render", title: "Owner artifact", content: { owner: true } });
  const file = await owner.createFile({ id: "file-scope", session_id: session.id, storage_key: "opaque/file-scope", original_filename: "owner.txt", media_type: "text/plain", byte_size: 5 });
  await owner.recordLayoutSnapshot({ session_id: session.id, active_artifact_id: artifact.id, layout: { owner: true } });
  const run = await owner.createRun({ id: "run-scope", session_id: session.id, user_message_id: message.id });
  const event = await owner.appendRunEvent({ run_id: run.id, session_id: session.id, kind: "status", event: { kind: "status", label: "started" } });

  const provenanceBefore = psql(testUrl, "select json_agg(row_to_json(s) order by id)::text from (select id, host_session_id, created_at, updated_at, last_accessed, last_message_at from sonik_agent_ui.agent_workspace_sessions where organization_id = 'org-run-scope' and user_id = 'user-run-scope' and id in ('session-run-scope', 'session-null-host')) s");
  assert.equal((await rotatedHost.listSessions()).some((entry) => entry.id === session.id), true, "rotated host lists stable owner history");
  assert.equal((await rotatedHost.getSession(session.id))?.id, session.id, "rotated host reads exact old-host session");
  assert.equal((await rotatedHost.getSession(nullHostSession.id))?.id, nullHostSession.id, "rotated host reads legacy null-host session");
  assert.equal((await rotatedHost.listMessages(session.id))[0]?.id, message.id);
  assert.equal((await rotatedHost.getDocument(document.id))?.id, document.id);
  assert.equal((await rotatedHost.listDocuments(session.id))[0]?.id, document.id);
  assert.equal((await rotatedHost.getArtifact(artifact.id))?.id, artifact.id);
  assert.equal((await rotatedHost.getFile(file.id))?.id, file.id);
  assert.equal((await rotatedHost.listFiles(session.id))[0]?.id, file.id);
  assert.equal((await rotatedHost.getRun(run.id))?.id, run.id);
  assert.equal((await rotatedHost.listRuns(session.id))[0]?.id, run.id);
  assert.deepEqual((await rotatedHost.listRunEvents(run.id)).map((entry) => entry.id), [event.id]);
  assert.equal((await rotatedHost.updateRun(run.id, { resumable: true }))?.resumable, true, "rotated host retains owner-authorized updates");
  const rotatedEvent = await rotatedHost.appendRunEvent({ run_id: run.id, session_id: session.id, kind: "status", event: { kind: "status", label: "rotated" } });
  assert.equal(rotatedEvent.seq, 1);
  const provenanceAfter = psql(testUrl, "select json_agg(row_to_json(s) order by id)::text from (select id, host_session_id, created_at, updated_at, last_accessed, last_message_at from sonik_agent_ui.agent_workspace_sessions where organization_id = 'org-run-scope' and user_id = 'user-run-scope' and id in ('session-run-scope', 'session-null-host')) s");
  assert.equal(provenanceAfter, provenanceBefore, "old/null host provenance and timestamps remain byte-identical after reads");

  for (const foreign of [otherUser, otherOrg]) {
    assert.equal(await foreign.getSession(session.id), null, "foreign org/user cannot read exact session history");
    assert.deepEqual(await foreign.listSessions(), [], "foreign org/user cannot list history");
    assert.deepEqual(await foreign.listMessages(session.id), [], "foreign org/user cannot list messages");
    assert.equal(await foreign.getDocument(document.id), null, "foreign org/user cannot read documents");
    assert.equal(await foreign.getArtifact(artifact.id), null, "foreign org/user cannot read artifacts");
    assert.equal(await foreign.getFile(file.id), null, "foreign org/user cannot read files");
    assert.equal(await foreign.getRun(run.id), null, "foreign org/user cannot read runs");
    assert.deepEqual(await foreign.listRunEvents(run.id), [], "foreign org/user cannot read run events");
  }

  await assert.rejects(
    () => owner.appendRunEvent({ run_id: run.id, session_id: "different-session", kind: "status", event: { kind: "status", label: "mismatched" } }),
    /session_id must match the parent run/i,
  );
  console.log("workspace-cloud-run-scope.postgres.test.mjs: all assertions passed");
} finally {
  psql(adminUrl, `drop database if exists ${database} with (force)`);
  psql(adminUrl, `drop role if exists ${rlsRole}`);
}

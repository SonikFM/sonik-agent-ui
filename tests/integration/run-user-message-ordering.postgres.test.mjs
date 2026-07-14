import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { buildPgEnv } from "../../scripts/lib/postgres-connection.mjs";

const sourceUrl = process.env.POSTGRES_TEST_URL;
if (!sourceUrl) {
  throw new Error("POSTGRES_TEST_URL is required");
}

const adminUrl = new URL(sourceUrl);
adminUrl.pathname = "/postgres";
const database = `sonik_agent_ui_ordering_${process.pid}_${Date.now()}`;
const testUrl = new URL(sourceUrl);
testUrl.pathname = `/${database}`;

function psql(url, sql, { reject = true } = {}) {
  const result = spawnSync("psql", ["-v", "ON_ERROR_STOP=1", "-X", "-At", "-c", sql], {
    encoding: "utf8",
    env: { ...process.env, ...buildPgEnv(url.toString()) },
  });
  if (reject && result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result;
}

psql(adminUrl, `create database ${database}`);
try {
  execFileSync(process.execPath, ["scripts/run-postgres-migrations.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: testUrl.toString() },
    stdio: "pipe",
  });

  const outOfOrder = psql(testUrl, `
    begin;
    select sonik_agent_ui.set_request_context('org-ordering', 'user-ordering');
    insert into sonik_agent_ui.agent_workspace_sessions (organization_id, user_id, id)
      values ('org-ordering', 'user-ordering', 'session-ordering');
    insert into sonik_agent_ui.agent_workspace_runs
      (organization_id, user_id, id, session_id, user_message_id)
      values ('org-ordering', 'user-ordering', 'run-too-early', 'session-ordering', 'message-ordering');
    commit;
  `, { reject: false });
  assert.notEqual(outOfOrder.status, 0, "PostgreSQL must reject a run before its user message exists");
  assert.match(outOfOrder.stderr, /agent_workspace_runs_user_message_(?:id_fkey|provenance_check)|foreign key|user message in the same session/i);

  const ordered = psql(testUrl, `
    begin;
    select sonik_agent_ui.set_request_context('org-ordering', 'user-ordering');
    insert into sonik_agent_ui.agent_workspace_sessions (organization_id, user_id, id)
      values ('org-ordering', 'user-ordering', 'session-ordering');
    insert into sonik_agent_ui.agent_workspace_messages
      (organization_id, user_id, id, session_id, role, content)
      values ('org-ordering', 'user-ordering', 'message-ordering', 'session-ordering', 'user', 'hello');
    insert into sonik_agent_ui.agent_workspace_runs
      (organization_id, user_id, id, session_id, user_message_id, message_id)
      values ('org-ordering', 'user-ordering', 'run-ordered', 'session-ordering', 'message-ordering', 'assistant-message-ordering');
    select user_message_id, message_id from sonik_agent_ui.agent_workspace_runs where id = 'run-ordered';
    commit;
  `);
  assert.match(ordered.stdout, /message-ordering\|assistant-message-ordering/, "ordered run preserves distinct user and assistant message ids");

  psql(testUrl, `
    begin;
    select sonik_agent_ui.set_request_context('org-ordering', 'user-ordering');
    insert into sonik_agent_ui.agent_workspace_sessions (organization_id, user_id, id)
      values ('org-ordering', 'user-ordering', 'session-other');
    insert into sonik_agent_ui.agent_workspace_messages (organization_id, user_id, id, session_id, role, content)
      values
        ('org-ordering', 'user-ordering', 'message-assistant', 'session-ordering', 'assistant', 'no'),
        ('org-ordering', 'user-ordering', 'message-other', 'session-other', 'user', 'other');
    commit;
  `);

  for (const [id, messageId] of [["run-assistant", "message-assistant"], ["run-cross-session", "message-other"]]) {
    const invalid = psql(testUrl, `
      begin;
      select sonik_agent_ui.set_request_context('org-ordering', 'user-ordering');
      insert into sonik_agent_ui.agent_workspace_runs (organization_id, user_id, id, session_id, user_message_id)
        values ('org-ordering', 'user-ordering', '${id}', 'session-ordering', '${messageId}');
      commit;
    `, { reject: false });
    assert.notEqual(invalid.status, 0, `${id} must be rejected`);
    assert.match(invalid.stderr, /agent_workspace_runs_user_message_provenance_check|user message in the same session/i);
  }

  const nullable = psql(testUrl, `
    begin;
    select sonik_agent_ui.set_request_context('org-ordering', 'user-ordering');
    insert into sonik_agent_ui.agent_workspace_runs (organization_id, user_id, id, session_id, user_message_id)
      values ('org-ordering', 'user-ordering', 'run-nullable', 'session-ordering', null);
    select coalesce(user_message_id, 'NULL') from sonik_agent_ui.agent_workspace_runs where id = 'run-nullable';
    commit;
  `);
  assert.match(nullable.stdout, /NULL/, "legacy-compatible nullable provenance remains valid");
  console.log("run-user-message-ordering.postgres.test.mjs: all assertions passed");
} finally {
  psql(adminUrl, `drop database if exists ${database} with (force)`);
}

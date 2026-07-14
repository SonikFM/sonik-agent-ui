import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { buildPgEnv } from "../../scripts/lib/postgres-connection.mjs";

const sourceUrl = process.env.POSTGRES_TEST_URL;
if (!sourceUrl) throw new Error("POSTGRES_TEST_URL is required");

const adminUrl = new URL(sourceUrl);
adminUrl.pathname = "/postgres";
const database = `sonik_agent_ui_file_race_${process.pid}_${Date.now()}`;
const testUrl = new URL(sourceUrl);
testUrl.pathname = `/${database}`;
const lockId = process.pid * 1000 + Math.floor(Math.random() * 1000);

function psql(url, sql) {
  const result = spawnSync("psql", ["-v", "ON_ERROR_STOP=1", "-X", "-At", "-c", sql], {
    encoding: "utf8",
    env: { ...process.env, ...buildPgEnv(url.toString()) },
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout;
}

function psqlAsync(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn("psql", ["-v", "ON_ERROR_STOP=1", "-X", "-At", "-c", sql], {
      env: { ...process.env, ...buildPgEnv(testUrl.toString()) },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr || stdout)));
  });
}

psql(adminUrl, `create database ${database}`);
try {
  execFileSync(process.execPath, ["scripts/run-postgres-migrations.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: testUrl.toString() },
    stdio: "pipe",
  });
  psql(testUrl, `
    select sonik_agent_ui.set_request_context('org-race', 'user-race');
    insert into sonik_agent_ui.agent_workspace_sessions (organization_id, user_id, id)
      values ('org-race', 'user-race', 'session-race'), ('org-race', 'user-race', 'session-fenced');
  `);

  const upload = psqlAsync(`
    begin;
    select sonik_agent_ui.set_request_context('org-race', 'user-race');
    select id from sonik_agent_ui.agent_workspace_sessions
      where organization_id = 'org-race' and user_id = 'user-race' and id = 'session-race' and deleting_at is null
      for no key update;
    select pg_advisory_lock(${lockId});
    select pg_sleep(1);
    insert into sonik_agent_ui.agent_workspace_files
      (organization_id, user_id, id, session_id, storage_key, original_filename, media_type, byte_size)
      values ('org-race', 'user-race', 'file-race', 'session-race', 'agent-ui/file-race', 'race.txt', 'text/plain', 1);
    commit;
  `);
  for (let attempts = 0; attempts < 40; attempts += 1) {
    const locked = psql(testUrl, `select exists (select 1 from pg_locks where locktype = 'advisory' and objid = ${lockId} and granted)`);
    if (locked.trim() === "t") break;
    await new Promise((resolve) => setTimeout(resolve, 25));
    if (attempts === 39) assert.fail("upload transaction did not acquire its test lock");
  }
  const deletion = psqlAsync(`
    begin;
    select sonik_agent_ui.set_request_context('org-race', 'user-race');
    update sonik_agent_ui.agent_workspace_sessions set deleting_at = coalesce(deleting_at, now())
      where organization_id = 'org-race' and user_id = 'user-race' and id = 'session-race';
    select count(*) from sonik_agent_ui.agent_workspace_files where session_id = 'session-race' and status <> 'deleted';
    commit;
  `);
  await upload;
  assert.match(await deletion, /(?:^|\n)1(?:\n|$)/, "deletion waits for an earlier file reservation and snapshots it");

  psql(testUrl, `
    select sonik_agent_ui.set_request_context('org-race', 'user-race');
    insert into sonik_agent_ui.agent_workspace_files
      (organization_id, user_id, id, session_id, storage_key, original_filename, media_type, byte_size)
      values ('org-race', 'user-race', 'file-fenced', 'session-fenced', 'agent-ui/file-fenced', 'fenced.txt', 'text/plain', 1);
    update sonik_agent_ui.agent_workspace_sessions set deleting_at = now() where id = 'session-fenced';
  `);
  const lateReservation = psql(testUrl, `
    select sonik_agent_ui.set_request_context('org-race', 'user-race');
    select id from sonik_agent_ui.agent_workspace_sessions
      where organization_id = 'org-race' and user_id = 'user-race' and id = 'session-fenced' and deleting_at is null
      for no key update;
  `);
  assert.equal(lateReservation.trim(), "", "a later Worker cannot reserve a file after the durable deletion fence");
  const lateReady = psql(testUrl, `
    select sonik_agent_ui.set_request_context('org-race', 'user-race');
    update sonik_agent_ui.agent_workspace_files set status = 'ready'
      where organization_id = 'org-race' and user_id = 'user-race' and id = 'file-fenced'
        and exists (
          select 1 from sonik_agent_ui.agent_workspace_sessions
          where organization_id = 'org-race' and user_id = 'user-race'
            and id = agent_workspace_files.session_id and deleting_at is null
        )
      returning id;
  `);
  assert.equal(lateReady.trim(), "UPDATE 0", "a pre-fence reservation cannot become ready after deletion begins");
  console.log("session-delete-upload-race.postgres.test.mjs: all assertions passed");
} finally {
  psql(adminUrl, `drop database if exists ${database} with (force)`);
}

import assert from "node:assert/strict";
import {
  CloudWorkspacePersistenceError,
  createCloudWorkspacePersistenceAdapter,
} from "../../packages/workspace-session/src/index.ts";

function createAuthorizedRuntime(input) {
  return {
    kind: "cloud",
    env: { test: true },
    db: input.executor,
    userId: input.userId,
    organizationId: input.organizationId,
    principalId: input.userId,
    requestId: input.requestId ?? "request-test",
    commandPolicy: {
      allowed: input.allowed ?? true,
      commandId: "workspace.session.write",
      reasonCode: input.allowed === false ? "test-denied" : "test-allowed",
      effectiveScope: "workspace",
    },
    hostSession: {
      source: "test-host",
      sessionId: "host-session-1",
      userId: input.userId,
      principalId: input.userId,
      organizationId: input.organizationId,
      authenticated: true,
      scopes: ["workspace:read", "workspace:write"],
    },
  };
}

function createFakeWorkspaceTables() {
  return {
    sessions: new Map(),
    messages: new Map(),
    sequence: 0,
  };
}

class FakeRlsWorkspaceSqlExecutor {
  constructor(tables) {
    this.tables = tables;
    this.transactions = [];
  }

  async transaction(fn) {
    const tx = new FakeRlsWorkspaceSqlTransaction(this.tables);
    this.transactions.push(tx);
    return fn(tx);
  }
}

class FakeRlsWorkspaceSqlTransaction {
  constructor(tables) {
    this.tables = tables;
    this.context = null;
    this.queries = [];
    this.contextSetBeforeWorkspaceQuery = true;
  }

  async query(sql, params = []) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    this.queries.push({ sql: normalized, params });

    if (normalized === "select sonik_agent_ui.set_request_context($1, $2)") {
      const [organizationId, userId] = params;
      if (!organizationId || !userId) throw new Error("set_request_context requires organization and user");
      this.context = { organizationId, userId };
      return { rows: [] };
    }

    if (normalized.includes("sonik_agent_ui.agent_workspace_")) {
      if (!this.context) {
        this.contextSetBeforeWorkspaceQuery = false;
        throw new Error("workspace query executed before request context");
      }
    }

    if (normalized.startsWith("select id, name, mode") && normalized.includes("from sonik_agent_ui.agent_workspace_sessions") && normalized.includes("where organization_id = $1 and user_id = $2 and id = $3")) {
      this.assertMatchesContext(params[0], params[1]);
      const row = this.tables.sessions.get(this.scopedKey(params[2]));
      return { rows: row ? [clone(row)] : [] };
    }

    if (normalized.startsWith("select id, name, mode") && normalized.includes("from sonik_agent_ui.agent_workspace_sessions") && normalized.includes("where organization_id = $1 and user_id = $2 and archived = $3")) {
      this.assertMatchesContext(params[0], params[1]);
      const archived = Boolean(params[2]);
      const rows = [...this.tables.sessions.values()]
        .filter((row) => row.organization_id === this.context.organizationId && row.user_id === this.context.userId && row.archived === archived)
        .sort((a, b) => String(b.last_accessed).localeCompare(String(a.last_accessed)))
        .map(clone);
      return { rows };
    }

    if (normalized.startsWith("insert into sonik_agent_ui.agent_workspace_sessions")) {
      const [organization_id, user_id, id, host_session_id, name, mode, folder] = params;
      this.assertMatchesContext(organization_id, user_id);
      const key = this.scopedKey(id);
      const now = this.now();
      if (!this.tables.sessions.has(key)) {
        this.tables.sessions.set(key, {
          id,
          organization_id,
          user_id,
          host_session_id,
          name,
          mode,
          archived: false,
          is_important: false,
          folder: folder ?? null,
          message_count: 0,
          active_document_id: null,
          active_artifact_id: null,
          created_at: now,
          updated_at: now,
          last_accessed: now,
          last_message_at: null,
        });
      }
      return { rows: [clone(this.tables.sessions.get(key))] };
    }

    if (normalized.startsWith("update sonik_agent_ui.agent_workspace_sessions set name = $4")) {
      const [organization_id, user_id, id, name, mode, folder, active_document_id, active_artifact_id, is_important] = params;
      this.assertMatchesContext(organization_id, user_id);
      const row = this.tables.sessions.get(this.scopedKey(id));
      if (!row) return { rows: [] };
      Object.assign(row, { name, mode, folder, active_document_id, active_artifact_id, is_important, updated_at: this.now(), last_accessed: this.now() });
      return { rows: [clone(row)] };
    }

    if (normalized.startsWith("update sonik_agent_ui.agent_workspace_sessions set archived = $4")) {
      const [organization_id, user_id, id, archived] = params;
      this.assertMatchesContext(organization_id, user_id);
      const row = this.tables.sessions.get(this.scopedKey(id));
      if (!row) return { rows: [] };
      Object.assign(row, { archived, updated_at: this.now(), last_accessed: this.now() });
      return { rows: [clone(row)] };
    }

    if (normalized.startsWith("delete from sonik_agent_ui.agent_workspace_sessions")) {
      const [organization_id, user_id, id] = params;
      this.assertMatchesContext(organization_id, user_id);
      const key = this.scopedKey(id);
      const deleted = this.tables.sessions.delete(key);
      for (const [messageKey, row] of [...this.tables.messages.entries()]) {
        if (row.organization_id === this.context.organizationId && row.user_id === this.context.userId && row.session_id === id) {
          this.tables.messages.delete(messageKey);
        }
      }
      return { rows: deleted ? [{ id }] : [] };
    }

    if (normalized.startsWith("insert into sonik_agent_ui.agent_workspace_messages")) {
      const [organization_id, user_id, id, session_id, role, content, parts] = params;
      this.assertMatchesContext(organization_id, user_id);
      if (!this.tables.sessions.has(this.scopedKey(session_id))) throw new Error("message session FK missing");
      const row = {
        id,
        organization_id,
        user_id,
        session_id,
        role,
        content,
        parts: typeof parts === "string" ? JSON.parse(parts) : parts ?? null,
        created_at: this.now(),
      };
      this.tables.messages.set(this.scopedKey(id), row);
      return { rows: [clone(row)] };
    }

    if (normalized.startsWith("update sonik_agent_ui.agent_workspace_sessions set message_count = message_count + 1")) {
      const [organization_id, user_id, id, last_message_at] = params;
      this.assertMatchesContext(organization_id, user_id);
      const row = this.tables.sessions.get(this.scopedKey(id));
      if (row) {
        row.message_count += 1;
        row.last_message_at = last_message_at;
        row.updated_at = this.now();
        row.last_accessed = this.now();
      }
      return { rows: [] };
    }

    if (normalized.startsWith("select id, session_id, role, content, parts, created_at from sonik_agent_ui.agent_workspace_messages")) {
      const [organization_id, user_id, session_id] = params;
      this.assertMatchesContext(organization_id, user_id);
      const rows = [...this.tables.messages.values()]
        .filter((row) => row.organization_id === this.context.organizationId && row.user_id === this.context.userId && row.session_id === session_id)
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
        .map(clone);
      return { rows };
    }

    throw new Error(`Unhandled fake SQL: ${normalized}`);
  }

  scopedKey(id) {
    return `${this.context.organizationId}\u0000${this.context.userId}\u0000${id}`;
  }

  assertMatchesContext(organizationId, userId) {
    assert.equal(organizationId, this.context.organizationId, "query organization must match request context");
    assert.equal(userId, this.context.userId, "query user must match request context");
  }

  now() {
    this.tables.sequence += 1;
    return new Date(Date.UTC(2026, 0, 1, 0, 0, this.tables.sequence)).toISOString();
  }
}

function clone(value) {
  return structuredClone(value);
}

await runWorkspaceCloudSqlAdapterTests();

async function runWorkspaceCloudSqlAdapterTests() {
  const shared = createFakeWorkspaceTables();
  const executor = new FakeRlsWorkspaceSqlExecutor(shared);
  const orgA = createAuthorizedRuntime({ executor, organizationId: "org-a", userId: "user-a", requestId: "req-a" });
  const orgB = createAuthorizedRuntime({ executor, organizationId: "org-b", userId: "user-b", requestId: "req-b" });
  const adapterA = createCloudWorkspacePersistenceAdapter(orgA);
  const adapterB = createCloudWorkspacePersistenceAdapter(orgB);

  const session = await adapterA.createSession({ id: "session-rls", name: "RLS Session", mode: "chat" });
  assert.equal(session.id, "session-rls");
  assert.equal(session.name, "RLS Session");
  assert.equal(session.message_count, 0);
  assert.equal(await adapterB.getSession("session-rls"), null, "Org B must not read Org A sessions by guessed id");

  const message = await adapterA.appendMessage({ session_id: session.id, id: "msg-1", role: "user", content: "hello cloud", parts: [{ type: "text", text: "hello cloud" }] });
  assert.equal(message.session_id, session.id);
  assert.deepEqual(message.parts, [{ type: "text", text: "hello cloud" }]);
  assert.equal((await adapterA.getSession(session.id))?.message_count, 1, "message append should update session message_count");
  assert.equal((await adapterA.listMessages(session.id)).length, 1);
  assert.equal((await adapterB.listMessages(session.id)).length, 0, "Org B must not read Org A messages by guessed session id");

  await adapterB.appendMessage({ session_id: session.id, id: "msg-b", role: "assistant", content: "separate tenant" });
  assert.equal((await adapterB.getSession(session.id))?.message_count, 1, "Org B may create same logical id in its own scoped tenant row");
  assert.equal((await adapterA.listMessages(session.id)).map((row) => row.id).join(","), "msg-1");
  assert.equal((await adapterB.listMessages(session.id)).map((row) => row.id).join(","), "msg-b");

  const patched = await adapterA.patchSession(session.id, { is_important: true, folder: "Pinned" });
  assert.equal(patched?.is_important, true);
  assert.equal(patched?.folder, "Pinned");
  assert.equal((await adapterA.listSessions({ archived: false })).some((row) => row.id === session.id), true);
  assert.equal((await adapterA.archiveSession(session.id, true))?.archived, true);
  assert.equal((await adapterA.listSessions({ archived: false })).some((row) => row.id === session.id), false);
  assert.equal((await adapterA.listSessions({ archived: true })).some((row) => row.id === session.id), true);

  await assert.rejects(
    () => createCloudWorkspacePersistenceAdapter(createAuthorizedRuntime({ executor, organizationId: "", userId: "user-a" })).createSession(),
    (error) => error instanceof CloudWorkspacePersistenceError && error.code === "missing-request-context",
    "cloud adapter should fail closed without trusted org context",
  );
  await assert.rejects(
    () => createCloudWorkspacePersistenceAdapter(createAuthorizedRuntime({ executor, organizationId: "org-a", userId: "" })).appendMessage({ role: "user", content: "no user" }),
    (error) => error instanceof CloudWorkspacePersistenceError && error.code === "missing-request-context",
    "cloud adapter should fail closed without trusted user context",
  );
  await assert.rejects(
    () => createCloudWorkspacePersistenceAdapter(createAuthorizedRuntime({ executor, organizationId: "org-a", userId: "user-a", allowed: false })).getSession(session.id),
    (error) => error instanceof CloudWorkspacePersistenceError && error.code === "command-policy-denied",
    "cloud adapter should fail closed when command policy denies workspace persistence",
  );

  assert.equal(executor.transactions.length >= 10, true, "test should exercise multiple request-scoped transactions");
  for (const tx of executor.transactions) {
    assert.equal(tx.queries[0]?.sql, "select sonik_agent_ui.set_request_context($1, $2)", "every cloud operation must set RLS request context first");
    assert.equal(tx.contextSetBeforeWorkspaceQuery, true, "workspace queries must run only after RLS context is set");
  }

  console.log("workspace-cloud-sql-adapter tests passed");
}

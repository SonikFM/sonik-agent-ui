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
    documents: new Map(),
    documentVersions: new Map(),
    artifacts: new Map(),
    artifactVersions: new Map(),
    layouts: new Map(),
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

    if (normalized.startsWith("update sonik_agent_ui.agent_workspace_sessions set active_document_id = null")) {
      const [organization_id, user_id, id, document_id] = params;
      this.assertMatchesContext(organization_id, user_id);
      const row = this.tables.sessions.get(this.scopedKey(id));
      if (row?.active_document_id === document_id) Object.assign(row, { active_document_id: null, updated_at: this.now(), last_accessed: this.now() });
      return { rows: [] };
    }

    if (normalized.startsWith("update sonik_agent_ui.agent_workspace_sessions set active_document_id = case when $4")) {
      const [organization_id, user_id, id, has_active_document_id, active_document_id, has_active_artifact_id, active_artifact_id, mode] = params;
      this.assertMatchesContext(organization_id, user_id);
      const row = this.tables.sessions.get(this.scopedKey(id));
      if (row) Object.assign(row, {
        active_document_id: has_active_document_id ? active_document_id : row.active_document_id,
        active_artifact_id: has_active_artifact_id ? active_artifact_id : row.active_artifact_id,
        mode: mode ?? row.mode,
        updated_at: this.now(),
        last_accessed: this.now(),
      });
      return { rows: [] };
    }

    if (normalized.startsWith("insert into sonik_agent_ui.agent_workspace_documents")) {
      const [organization_id, user_id, id, session_id, title, language, current_content] = params;
      this.assertMatchesContext(organization_id, user_id);
      if (session_id && !this.tables.sessions.has(this.scopedKey(session_id))) throw new Error("document session FK missing");
      const now = this.now();
      const row = { id, organization_id, user_id, session_id, title, language, current_content, version_count: 1, is_active: true, archived: false, created_at: now, updated_at: now };
      this.tables.documents.set(this.scopedKey(id), row);
      return { rows: [clone(row)] };
    }

    if (normalized.startsWith("select id, session_id, title, language, current_content, version_count, is_active, archived, created_at, updated_at from sonik_agent_ui.agent_workspace_documents") && normalized.includes("where organization_id = $1 and user_id = $2 and id = $3")) {
      const [organization_id, user_id, id] = params;
      this.assertMatchesContext(organization_id, user_id);
      const row = this.tables.documents.get(this.scopedKey(id));
      return { rows: row ? [clone(row)] : [] };
    }

    if (normalized.startsWith("select id, session_id, title, language, current_content, version_count, is_active, archived, created_at, updated_at from sonik_agent_ui.agent_workspace_documents") && normalized.includes("session_id = $3")) {
      const [organization_id, user_id, session_id] = params;
      this.assertMatchesContext(organization_id, user_id);
      const rows = [...this.tables.documents.values()]
        .filter((row) => row.organization_id === this.context.organizationId && row.user_id === this.context.userId && row.session_id === session_id && row.is_active && !row.archived)
        .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
        .map(clone);
      return { rows };
    }

    if (normalized.startsWith("select documents.id, documents.session_id")) {
      const [organization_id, user_id, archived, language, search, limit, offset] = params;
      this.assertMatchesContext(organization_id, user_id);
      const rows = this.filteredDocuments({ archived, language, search })
        .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
        .slice(offset, offset + limit)
        .map((row) => {
          const preview = row.current_content.slice(0, 500);
          return { ...clone(row), current_content: preview, preview, session_name: row.session_id ? (this.tables.sessions.get(this.scopedKey(row.session_id))?.name ?? null) : null };
        });
      return { rows };
    }

    if (normalized.startsWith("select count(*)::int as total")) {
      const [organization_id, user_id, archived, language, search] = params;
      this.assertMatchesContext(organization_id, user_id);
      return { rows: [{ total: this.filteredDocuments({ archived, language, search }).length }] };
    }

    if (normalized.startsWith("select documents.language, count(*)::int as count")) {
      const [organization_id, user_id, archived, language, search] = params;
      this.assertMatchesContext(organization_id, user_id);
      const counts = new Map();
      for (const row of this.filteredDocuments({ archived, language, search })) counts.set(row.language, (counts.get(row.language) ?? 0) + 1);
      return { rows: [...counts.entries()].map(([language, count]) => ({ language, count })) };
    }

    if (normalized.startsWith("select count(distinct documents.session_id)::int as session_count")) {
      const [organization_id, user_id, archived, language, search] = params;
      this.assertMatchesContext(organization_id, user_id);
      const sessionIds = new Set(this.filteredDocuments({ archived, language, search }).map((row) => row.session_id).filter(Boolean));
      return { rows: [{ session_count: sessionIds.size }] };
    }

    if (normalized.startsWith("update sonik_agent_ui.agent_workspace_documents set title = $4")) {
      const [organization_id, user_id, id, title, language, current_content] = params;
      this.assertMatchesContext(organization_id, user_id);
      const row = this.tables.documents.get(this.scopedKey(id));
      if (!row) return { rows: [] };
      Object.assign(row, { title, language, current_content, version_count: row.version_count + 1, updated_at: this.now() });
      return { rows: [clone(row)] };
    }

    if (normalized.startsWith("update sonik_agent_ui.agent_workspace_documents set session_id = $4")) {
      const [organization_id, user_id, id, session_id, title, language, current_content] = params;
      this.assertMatchesContext(organization_id, user_id);
      const row = this.tables.documents.get(this.scopedKey(id));
      if (!row) return { rows: [] };
      Object.assign(row, { session_id, title, language, current_content, version_count: row.version_count + 1, updated_at: this.now() });
      return { rows: [clone(row)] };
    }

    if (normalized.startsWith("update sonik_agent_ui.agent_workspace_documents set archived = $4")) {
      const [organization_id, user_id, id, archived] = params;
      this.assertMatchesContext(organization_id, user_id);
      const row = this.tables.documents.get(this.scopedKey(id));
      if (!row) return { rows: [] };
      Object.assign(row, { archived, updated_at: this.now() });
      return { rows: [clone(row)] };
    }

    if (normalized.startsWith("update sonik_agent_ui.agent_workspace_documents set current_content = $4")) {
      const [organization_id, user_id, id, current_content] = params;
      this.assertMatchesContext(organization_id, user_id);
      const row = this.tables.documents.get(this.scopedKey(id));
      if (!row) return { rows: [] };
      Object.assign(row, { current_content, version_count: row.version_count + 1, updated_at: this.now() });
      return { rows: [clone(row)] };
    }

    if (normalized.startsWith("delete from sonik_agent_ui.agent_workspace_documents")) {
      const [organization_id, user_id, id] = params;
      this.assertMatchesContext(organization_id, user_id);
      const deleted = this.tables.documents.delete(this.scopedKey(id));
      this.tables.documentVersions.delete(this.scopedKey(id));
      return { rows: deleted ? [{ id }] : [] };
    }

    if (normalized.startsWith("insert into sonik_agent_ui.agent_workspace_document_versions")) {
      const [organization_id, user_id, id, document_id, version_number, content, summary, source] = params;
      this.assertMatchesContext(organization_id, user_id);
      if (!this.tables.documents.has(this.scopedKey(document_id))) throw new Error("document version FK missing");
      const row = { id, organization_id, user_id, document_id, version_number, content, summary, source, created_at: this.now() };
      const key = this.scopedKey(document_id);
      this.tables.documentVersions.set(key, [...(this.tables.documentVersions.get(key) ?? []), row]);
      return { rows: [clone(row)] };
    }

    if (normalized.startsWith("select id, document_id, version_number, content, summary, source, created_at from sonik_agent_ui.agent_workspace_document_versions") && normalized.includes("and version_number = $4")) {
      const [organization_id, user_id, document_id, version_number] = params;
      this.assertMatchesContext(organization_id, user_id);
      const row = (this.tables.documentVersions.get(this.scopedKey(document_id)) ?? []).find((entry) => entry.version_number === version_number);
      return { rows: row ? [clone(row)] : [] };
    }

    if (normalized.startsWith("select id, document_id, version_number, content, summary, source, created_at from sonik_agent_ui.agent_workspace_document_versions")) {
      const [organization_id, user_id, document_id] = params;
      this.assertMatchesContext(organization_id, user_id);
      const rows = [...(this.tables.documentVersions.get(this.scopedKey(document_id)) ?? [])]
        .sort((a, b) => b.version_number - a.version_number)
        .map(clone);
      return { rows };
    }

    if (normalized.startsWith("insert into sonik_agent_ui.agent_workspace_artifacts")) {
      const [organization_id, user_id, id, session_id, kind, title, content] = params;
      this.assertMatchesContext(organization_id, user_id);
      if (session_id && !this.tables.sessions.has(this.scopedKey(session_id))) throw new Error("artifact session FK missing");
      const now = this.now();
      const row = { id, organization_id, user_id, session_id, kind, title, content: parseJsonParam(content), version: 1, created_at: now, updated_at: now };
      this.tables.artifacts.set(this.scopedKey(id), row);
      return { rows: [clone(row)] };
    }

    if (normalized.startsWith("select id, session_id, kind, title, content, version, created_at, updated_at from sonik_agent_ui.agent_workspace_artifacts")) {
      const [organization_id, user_id, id] = params;
      this.assertMatchesContext(organization_id, user_id);
      const row = this.tables.artifacts.get(this.scopedKey(id));
      return { rows: row ? [clone(row)] : [] };
    }

    if (normalized.startsWith("update sonik_agent_ui.agent_workspace_artifacts set title = $4")) {
      const [organization_id, user_id, id, title, content] = params;
      this.assertMatchesContext(organization_id, user_id);
      const row = this.tables.artifacts.get(this.scopedKey(id));
      if (!row) return { rows: [] };
      Object.assign(row, { title, content: parseJsonParam(content), version: row.version + 1, updated_at: this.now() });
      return { rows: [clone(row)] };
    }

    if (normalized.startsWith("insert into sonik_agent_ui.agent_workspace_artifact_versions")) {
      const [organization_id, user_id, id, artifact_id, version_number, content, summary, source] = params;
      this.assertMatchesContext(organization_id, user_id);
      if (!this.tables.artifacts.has(this.scopedKey(artifact_id))) throw new Error("artifact version FK missing");
      const row = { id, organization_id, user_id, artifact_id, version_number, content: parseJsonParam(content), summary, source, created_at: this.now() };
      const key = this.scopedKey(artifact_id);
      this.tables.artifactVersions.set(key, [...(this.tables.artifactVersions.get(key) ?? []), row]);
      return { rows: [clone(row)] };
    }

    if (normalized.startsWith("select id, artifact_id, version_number, content, summary, source, created_at from sonik_agent_ui.agent_workspace_artifact_versions")) {
      const [organization_id, user_id, artifact_id] = params;
      this.assertMatchesContext(organization_id, user_id);
      const rows = [...(this.tables.artifactVersions.get(this.scopedKey(artifact_id)) ?? [])]
        .sort((a, b) => b.version_number - a.version_number)
        .map(clone);
      return { rows };
    }

    if (normalized.startsWith("insert into sonik_agent_ui.agent_workspace_layout_snapshots")) {
      const [organization_id, user_id, id, session_id, active_pane_id, active_artifact_id, layout, source] = params;
      this.assertMatchesContext(organization_id, user_id);
      if (!this.tables.sessions.has(this.scopedKey(session_id))) throw new Error("layout session FK missing");
      if (active_artifact_id && !this.tables.artifacts.has(this.scopedKey(active_artifact_id))) throw new Error("layout artifact FK missing");
      const row = { id, organization_id, user_id, session_id, active_pane_id, active_artifact_id, layout: parseJsonParam(layout), source, created_at: this.now() };
      const key = this.scopedKey(session_id);
      this.tables.layouts.set(key, [...(this.tables.layouts.get(key) ?? []), row]);
      return { rows: [clone(row)] };
    }

    if (normalized.startsWith("select id, session_id, active_pane_id, active_artifact_id, layout, source, created_at from sonik_agent_ui.agent_workspace_layout_snapshots")) {
      const [organization_id, user_id, session_id] = params;
      this.assertMatchesContext(organization_id, user_id);
      const rows = [...(this.tables.layouts.get(this.scopedKey(session_id)) ?? [])]
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
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

  filteredDocuments({ archived, language, search }) {
    const needle = typeof search === "string" ? search.toLowerCase() : null;
    return [...this.tables.documents.values()].filter((row) => {
      if (row.organization_id !== this.context.organizationId || row.user_id !== this.context.userId || !row.is_active || row.archived !== Boolean(archived)) return false;
      if (language && row.language.toLowerCase() !== language) return false;
      if (needle && !`${row.title}
${row.current_content}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }

  now() {
    this.tables.sequence += 1;
    return new Date(Date.UTC(2026, 0, 1, 0, 0, this.tables.sequence)).toISOString();
  }
}

function clone(value) {
  return structuredClone(value);
}

function parseJsonParam(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
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

  const document = await adapterA.createDocument({ session_id: session.id, title: "RLS Doc", content: "alpha", language: "markdown", source: "ai" });
  assert.equal(document.session_id, session.id);
  assert.equal(document.version_count, 1);
  assert.equal((await adapterA.getSession(session.id))?.active_document_id, document.id, "document creation should set active document pointer");
  assert.equal(await adapterB.getDocument(document.id), null, "Org B must not read Org A documents by guessed id");
  assert.equal((await adapterA.listDocuments(session.id)).length, 1);
  assert.equal((await adapterB.listDocuments(session.id)).length, 0, "Org B must not list Org A documents by guessed session id");
  assert.equal((await adapterA.listDocumentVersions(document.id)).length, 1);
  const updatedDocument = await adapterA.updateDocument(document.id, { content: "beta", summary: "change to beta", source: "user" });
  assert.equal(updatedDocument?.version_count, 2);
  const renamedDocument = await adapterA.updateDocument(document.id, { title: "RLS Doc Renamed", summary: "rename only", source: "user" });
  assert.equal(renamedDocument?.version_count, 3, "metadata-only document updates should still create a version");
  const secondSession = await adapterA.createSession({ id: "session-doc-target", name: "Doc Target", mode: "chat" });
  const rehomedDocument = await adapterA.patchDocument(document.id, { session_id: secondSession.id });
  assert.equal(rehomedDocument?.version_count, 4, "document rehome should create a version");
  assert.equal((await adapterA.getSession(session.id))?.active_document_id, null, "document rehome should clear stale old-session active pointer");
  assert.equal((await adapterA.getSession(secondSession.id))?.active_document_id, document.id, "document rehome should set new-session active pointer");
  assert.equal((await adapterA.listDocumentVersions(document.id)).map((row) => row.version_number).join(","), "4,3,2,1");
  assert.equal((await adapterB.listDocumentVersions(document.id)).length, 0, "Org B must not read Org A document versions by guessed id");
  const restoredDocument = await adapterA.restoreDocumentVersion(document.id, 1);
  assert.equal(restoredDocument?.current_content, "alpha");
  assert.equal(restoredDocument?.version_count, 5);
  const syncedDocument = await adapterA.syncActiveDocumentSnapshot({ ...restoredDocument, current_content: "gamma" });
  assert.equal(syncedDocument.version_count, 6);
  const library = await adapterA.listDocumentLibrary({ search: "rls", limit: 1, offset: 0 });
  assert.equal(library.total, 1);
  assert.equal(library.documents[0]?.preview.length <= 500, true);
  assert.equal(
    executor.transactions.some((tx) => tx.queries.some((query) => query.sql.includes("left(documents.current_content, 500)") && query.sql.includes("limit $6 offset $7"))),
    true,
    "document library must use SQL-side bounded preview and pagination",
  );

  const artifact = await adapterA.createArtifact({ session_id: session.id, id: "artifact-rls", kind: "json-render", title: "RLS Artifact", content: { root: "main", elements: { main: { type: "Text", props: { content: "alpha" }, children: [] } }, state: {} }, source: "ai" });
  assert.equal(artifact.version, 1);
  assert.equal((await adapterA.getSession(session.id))?.active_artifact_id, artifact.id, "artifact creation should set active artifact pointer");
  assert.equal(await adapterB.getArtifact(artifact.id), null, "Org B must not read Org A artifacts by guessed id");
  assert.equal((await adapterA.listArtifactVersions(artifact.id)).length, 1);
  const updatedArtifact = await adapterA.updateArtifact(artifact.id, { content: { root: "main", elements: { main: { type: "Text", props: { content: "beta" }, children: [] } }, state: {} }, summary: "change artifact" });
  assert.equal(updatedArtifact?.version, 2);
  const renamedArtifact = await adapterA.updateArtifact(artifact.id, { title: "RLS Artifact Renamed", summary: "rename artifact" });
  assert.equal(renamedArtifact?.version, 3, "metadata-only artifact updates should still create a version");
  assert.equal((await adapterA.listArtifactVersions(artifact.id)).map((row) => row.version_number).join(","), "3,2,1");
  assert.equal((await adapterB.listArtifactVersions(artifact.id)).length, 0, "Org B must not read Org A artifact versions by guessed id");
  const layout = await adapterA.recordLayoutSnapshot({ session_id: session.id, active_pane_id: "pane-artifact", active_artifact_id: artifact.id, layout: { split: "right", artifactId: artifact.id }, source: "user" });
  assert.equal(layout.active_artifact_id, artifact.id);
  assert.equal((await adapterA.listLayoutSnapshots(session.id)).length, 1, "Org A should restore layout snapshots by session");
  assert.equal((await adapterB.listLayoutSnapshots(session.id)).length, 0, "Org B must not read Org A layout snapshots by guessed session id");
  assert.equal((await adapterA.getSession(session.id))?.active_artifact_id, artifact.id, "layout snapshots should keep active artifact pointer current");

  assert.equal(
    executor.transactions.some((tx) => tx.queries.some((query) => query.sql.includes("version_count = version_count + 1"))),
    true,
    "document updates must increment versions atomically in SQL",
  );
  assert.equal(
    executor.transactions.some((tx) => tx.queries.some((query) => query.sql.includes("version = version + 1"))),
    true,
    "artifact updates must increment versions atomically in SQL",
  );
  assert.equal(
    executor.transactions.some((tx) => tx.queries.some((query) => query.sql.includes("from sonik_agent_ui.agent_workspace_documents") && query.sql.includes("for update"))),
    true,
    "document mutations must lock the current row before merging omitted fields",
  );
  assert.equal(
    executor.transactions.some((tx) => tx.queries.some((query) => query.sql.includes("from sonik_agent_ui.agent_workspace_artifacts") && query.sql.includes("for update"))),
    true,
    "artifact mutations must lock the current row before merging omitted fields",
  );
  assert.equal(
    executor.transactions.some((tx) => tx.queries.some((query) => query.sql.includes("active_document_id = case when $4 then $5 else active_document_id end"))),
    true,
    "session active pointer updates must leave omitted pointer fields unchanged in SQL",
  );


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

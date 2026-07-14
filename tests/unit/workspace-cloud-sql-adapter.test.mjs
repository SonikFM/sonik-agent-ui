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
      sessionId: input.hostSessionId ?? "host-session-1",
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
    files: new Map(),
    runs: new Map(),
    runEvents: new Map(),
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

    if (normalized.includes("sonik_agent_ui.agent_workspace_runs") && /(?<!agent_workspace_sessions\.)\bhost_session_id\b/.test(normalized)) {
      throw new Error('column "host_session_id" does not exist on agent_workspace_runs');
    }

    if (normalized.startsWith("select id, name, mode") && normalized.includes("from sonik_agent_ui.agent_workspace_sessions") && normalized.includes("where organization_id = $1 and user_id = $2 and id = $3")) {
      this.assertMatchesContext(params[0], params[1]);
      const row = this.tables.sessions.get(this.scopedKey(params[2]));
      return { rows: row?.host_session_id === params[3] ? [clone(row)] : [] };
    }

    if (normalized.startsWith("select id from sonik_agent_ui.agent_workspace_sessions") && !normalized.includes("deleting_at")) {
      const [organization_id, user_id, id] = params;
      this.assertMatchesContext(organization_id, user_id);
      return { rows: this.tables.sessions.has(this.scopedKey(id)) ? [{ id }] : [] };
    }

    if (normalized.startsWith("select id, name, mode") && normalized.includes("from sonik_agent_ui.agent_workspace_sessions") && normalized.includes("host_session_id is not distinct from $3 and archived = $4")) {
      this.assertMatchesContext(params[0], params[1]);
      const archived = Boolean(params[3]);
      const rows = [...this.tables.sessions.values()]
        .filter((row) => row.organization_id === this.context.organizationId && row.user_id === this.context.userId && row.host_session_id === params[2] && row.archived === archived)
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

    if (normalized.startsWith("update sonik_agent_ui.agent_workspace_sessions set deleting_at = coalesce(deleting_at, now())")) {
      const [organization_id, user_id, id] = params;
      this.assertMatchesContext(organization_id, user_id);
      const row = this.tables.sessions.get(this.scopedKey(id));
      if (!row) return { rows: [] };
      row.deleting_at ??= this.now();
      return { rows: [{ id }] };
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
      for (const [fileKey, row] of [...this.tables.files.entries()]) {
        if (row.organization_id === this.context.organizationId && row.user_id === this.context.userId && row.session_id === id) this.tables.files.delete(fileKey);
      }
      return { rows: deleted ? [{ id }] : [] };
    }

    if (normalized === "select id from sonik_agent_ui.agent_workspace_sessions where organization_id = $1 and user_id = $2 and id = $3 and host_session_id is not distinct from $4 and deleting_at is null for no key update") {
      const [organization_id, user_id, id, host_session_id] = params;
      this.assertMatchesContext(organization_id, user_id);
      const row = this.tables.sessions.get(this.scopedKey(id));
      return { rows: row && row.host_session_id === host_session_id && !row.deleting_at ? [{ id }] : [] };
    }

    if (normalized.startsWith("insert into sonik_agent_ui.agent_workspace_files")) {
      const [organization_id, user_id, id, session_id, storage_key, original_filename, media_type, byte_size, checksum, status, provider_references, provider_references_expires_at] = params;
      this.assertMatchesContext(organization_id, user_id);
      if (!this.tables.sessions.has(this.scopedKey(session_id))) throw new Error("file session FK missing");
      const now = this.now();
      const row = {
        id, organization_id, user_id, session_id, storage_key, original_filename, media_type,
        byte_size: String(byte_size), checksum, status,
        provider_references: parseJsonParam(provider_references), provider_references_expires_at,
        ready_at: status === "ready" ? now : null,
        failed_at: status === "failed" ? now : null,
        deleted_at: status === "deleted" ? now : null,
        created_at: now, updated_at: now,
      };
      this.tables.files.set(this.scopedKey(id), row);
      return { rows: [clone(row)] };
    }

    if (normalized.startsWith("select id, session_id, storage_key") && normalized.includes("from sonik_agent_ui.agent_workspace_files") && normalized.includes(" and id = $3")) {
      const [organization_id, user_id, id] = params;
      this.assertMatchesContext(organization_id, user_id);
      const row = this.tables.files.get(this.scopedKey(id));
      return { rows: row && row.status !== "deleted" ? [clone(row)] : [] };
    }

    if (normalized.startsWith("select id, session_id, storage_key") && normalized.includes("from sonik_agent_ui.agent_workspace_files") && normalized.includes("session_id = $3")) {
      const [organization_id, user_id, session_id] = params;
      this.assertMatchesContext(organization_id, user_id);
      return { rows: [...this.tables.files.values()].filter((row) => row.organization_id === organization_id && row.user_id === user_id && row.session_id === session_id && row.status !== "deleted").map(clone) };
    }

    if (normalized.startsWith("update sonik_agent_ui.agent_workspace_files set original_filename")) {
      const [organization_id, user_id, id, original_filename, media_type, byte_size, has_checksum, checksum, status, has_provider_references, provider_references, has_provider_expiry, provider_references_expires_at] = params;
      this.assertMatchesContext(organization_id, user_id);
      const row = this.tables.files.get(this.scopedKey(id));
      if (!row || row.status === "deleted") return { rows: [] };
      if (status === "ready" && this.tables.sessions.get(this.scopedKey(row.session_id))?.deleting_at) return { rows: [] };
      if (original_filename !== null) row.original_filename = original_filename;
      if (media_type !== null) row.media_type = media_type;
      if (byte_size !== null) row.byte_size = String(byte_size);
      if (has_checksum) row.checksum = checksum;
      if (has_provider_references) row.provider_references = parseJsonParam(provider_references);
      if (has_provider_expiry) row.provider_references_expires_at = provider_references_expires_at;
      if (status) {
        row.status = status;
        const now = this.now();
        if (status === "ready") row.ready_at ??= now;
        if (status === "failed") row.failed_at ??= now;
        if (status === "deleted") row.deleted_at ??= now;
      }
      row.updated_at = this.now();
      return { rows: [clone(row)] };
    }

    if (normalized.startsWith("update sonik_agent_ui.agent_workspace_files set status = 'deleted'")) {
      const [organization_id, user_id, id] = params;
      this.assertMatchesContext(organization_id, user_id);
      const row = this.tables.files.get(this.scopedKey(id));
      if (!row || row.status === "deleted") return { rows: [] };
      row.status = "deleted";
      row.deleted_at = this.now();
      row.updated_at = row.deleted_at;
      return { rows: [{ id }] };
    }

    if (normalized.startsWith("insert into sonik_agent_ui.agent_workspace_runs")) {
      const [organization_id, user_id, id, session_id, user_message_id, message_id, request_id, trace_id, traceparent, context_selection] = params;
      this.assertMatchesContext(organization_id, user_id);
      const now = this.now();
      const row = { id, organization_id, user_id, session_id, user_message_id, message_id, status: "running", resumable: false, error: null, error_code: null, request_id, trace_id, traceparent, context_selection: parseJsonParam(context_selection), started_at: now, ended_at: null, created_at: now, updated_at: now };
      this.tables.runs.set(this.scopedKey(id), row);
      return { rows: [clone(row)] };
    }

    if (normalized.startsWith("select id from sonik_agent_ui.agent_workspace_messages")) {
      const [organization_id, user_id, id, session_id] = params;
      this.assertMatchesContext(organization_id, user_id);
      const row = this.tables.messages.get(this.scopedKey(id));
      return { rows: row?.session_id === session_id && row.role === "user" ? [{ id }] : [] };
    }

    if (normalized.startsWith("select id, session_id, user_message_id, message_id") && normalized.includes("from sonik_agent_ui.agent_workspace_runs")) {
      const [organization_id, user_id, value] = params;
      this.assertMatchesContext(organization_id, user_id);
      if (normalized.includes(" and id = $3")) {
        const row = this.tables.runs.get(this.scopedKey(value));
        const session = row && this.tables.sessions.get(this.scopedKey(row.session_id));
        return { rows: row && session?.host_session_id === params[3] ? [clone(row)] : [] };
      }
      return { rows: [...this.tables.runs.values()].filter((row) => row.organization_id === organization_id && row.user_id === user_id && row.session_id === value && this.tables.sessions.get(this.scopedKey(row.session_id))?.host_session_id === params[3]).map(clone) };
    }

    if (normalized.startsWith("update sonik_agent_ui.agent_workspace_runs")) {
      const [organization_id, user_id, id, status, resumable, error, error_code, message_id, ended_at, host_session_id] = params;
      this.assertMatchesContext(organization_id, user_id);
      const row = this.tables.runs.get(this.scopedKey(id));
      const session = row && this.tables.sessions.get(this.scopedKey(row.session_id));
      if (!row || session?.host_session_id !== host_session_id) return { rows: [] };
      Object.assign(row, { status, resumable, error, error_code, message_id, ended_at, updated_at: this.now() });
      return { rows: [clone(row)] };
    }

    if (normalized.startsWith("select coalesce(max(run_events.seq), -1) + 1 as next_seq")) {
      const [organization_id, user_id, run_id, host_session_id] = params;
      this.assertMatchesContext(organization_id, user_id);
      const run = this.tables.runs.get(this.scopedKey(run_id));
      const session = run && this.tables.sessions.get(this.scopedKey(run.session_id));
      if (!run || session?.host_session_id !== host_session_id) return { rows: [] };
      const seqs = [...this.tables.runEvents.values()].filter((row) => row.organization_id === organization_id && row.user_id === user_id && row.run_id === run_id).map((row) => row.seq);
      return { rows: [{ next_seq: seqs.length ? Math.max(...seqs) + 1 : 0 }] };
    }

    if (normalized.startsWith("insert into sonik_agent_ui.agent_workspace_run_events")) {
      const [organization_id, user_id, id, run_id, session_id, seq, kind, event, host_session_id] = params;
      this.assertMatchesContext(organization_id, user_id);
      const run = this.tables.runs.get(this.scopedKey(run_id));
      const session = run && this.tables.sessions.get(this.scopedKey(run.session_id));
      if (!run || session?.host_session_id !== host_session_id || (session_id != null && session_id !== run.session_id)) return { rows: [] };
      const row = { id, organization_id, user_id, run_id, session_id, seq, kind, event: parseJsonParam(event), created_at: this.now() };
      this.tables.runEvents.set(this.scopedKey(id), row);
      return { rows: [clone(row)] };
    }

    if (normalized.startsWith("select run_events.id, run_events.run_id")) {
      const [organization_id, user_id, run_id, host_session_id] = params;
      this.assertMatchesContext(organization_id, user_id);
      const run = this.tables.runs.get(this.scopedKey(run_id));
      const session = run && this.tables.sessions.get(this.scopedKey(run.session_id));
      if (!run || session?.host_session_id !== host_session_id) return { rows: [] };
      return { rows: [...this.tables.runEvents.values()].filter((row) => row.organization_id === organization_id && row.user_id === user_id && row.run_id === run_id).sort((a, b) => a.seq - b.seq).map(clone) };
    }

    if (normalized.startsWith("insert into sonik_agent_ui.agent_workspace_messages")) {
      const [organization_id, user_id, id, session_id, role, content, parts] = params;
      this.assertMatchesContext(organization_id, user_id);
      if (!this.tables.sessions.has(this.scopedKey(session_id))) throw new Error("message session FK missing");
      if (this.tables.messages.has(this.scopedKey(id))) return { rows: [] };
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
      const [organization_id, user_id, value] = params;
      this.assertMatchesContext(organization_id, user_id);
      if (normalized.includes(" and id = $3")) {
        const row = this.tables.messages.get(this.scopedKey(value));
        return { rows: row ? [clone(row)] : [] };
      }
      const rows = [...this.tables.messages.values()]
        .filter((row) => row.organization_id === this.context.organizationId && row.user_id === this.context.userId && row.session_id === value)
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

    if (normalized.startsWith("select id from sonik_agent_ui.agent_workspace_documents")) {
      const [organization_id, user_id, id] = params;
      this.assertMatchesContext(organization_id, user_id);
      return { rows: this.tables.documents.has(this.scopedKey(id)) ? [{ id }] : [] };
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
      const [organization_id, user_id, archived, language, search, hostSessionId, limit, offset] = params;
      this.assertMatchesContext(organization_id, user_id);
      const rows = this.filteredDocuments({ archived, language, search, hostSessionId })
        .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
        .slice(offset, offset + limit)
        .map((row) => {
          const preview = row.current_content.slice(0, 500);
          return { ...clone(row), current_content: preview, preview, session_name: row.session_id ? (this.tables.sessions.get(this.scopedKey(row.session_id))?.name ?? null) : null };
        });
      return { rows };
    }

    if (normalized.startsWith("select count(*)::int as total")) {
      const [organization_id, user_id, archived, language, search, hostSessionId] = params;
      this.assertMatchesContext(organization_id, user_id);
      return { rows: [{ total: this.filteredDocuments({ archived, language, search, hostSessionId }).length }] };
    }

    if (normalized.startsWith("select documents.language, count(*)::int as count")) {
      const [organization_id, user_id, archived, language, search, hostSessionId] = params;
      this.assertMatchesContext(organization_id, user_id);
      const counts = new Map();
      for (const row of this.filteredDocuments({ archived, language, search, hostSessionId })) counts.set(row.language, (counts.get(row.language) ?? 0) + 1);
      return { rows: [...counts.entries()].map(([language, count]) => ({ language, count })) };
    }

    if (normalized.startsWith("select count(distinct documents.session_id)::int as session_count")) {
      const [organization_id, user_id, archived, language, search, hostSessionId] = params;
      this.assertMatchesContext(organization_id, user_id);
      const sessionIds = new Set(this.filteredDocuments({ archived, language, search, hostSessionId }).map((row) => row.session_id).filter(Boolean));
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

  filteredDocuments({ archived, language, search, hostSessionId }) {
    const needle = typeof search === "string" ? search.toLowerCase() : null;
    return [...this.tables.documents.values()].filter((row) => {
      if (row.organization_id !== this.context.organizationId || row.user_id !== this.context.userId || !row.is_active || row.archived !== Boolean(archived)) return false;
      if (this.tables.sessions.get(this.scopedKey(row.session_id))?.host_session_id !== hostSessionId) return false;
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
  const adapterOtherHost = createCloudWorkspacePersistenceAdapter(createAuthorizedRuntime({ executor, organizationId: "org-a", userId: "user-a", hostSessionId: "host-session-2" }));

  const session = await adapterA.createSession({ id: "session-rls", name: "RLS Session", mode: "chat" });
  assert.equal(session.id, "session-rls");
  assert.equal(session.name, "RLS Session");
  assert.equal(session.message_count, 0);
  assert.equal(await adapterB.getSession("session-rls"), null, "Org B must not read Org A sessions by guessed id");
  assert.equal(await adapterOtherHost.getSession("session-rls"), null, "the same org/user cannot read another trusted host session's workspace");

  const message = await adapterA.appendMessage({ session_id: session.id, id: "msg-1", role: "user", content: "hello cloud", parts: [{ type: "text", text: "hello cloud" }] });
  assert.equal(message.session_id, session.id);
  assert.deepEqual(message.parts, [{ type: "text", text: "hello cloud" }]);
  assert.equal((await adapterA.getSession(session.id))?.message_count, 1, "message append should update session message_count");
  assert.equal((await adapterA.listMessages(session.id)).length, 1);
  assert.equal((await adapterB.listMessages(session.id)).length, 0, "Org B must not read Org A messages by guessed session id");

  const replayedMessage = await adapterA.appendMessage({ session_id: session.id, id: "msg-1", role: "user", content: "hello cloud", parts: [{ text: "hello cloud", type: "text" }] });
  assert.equal(replayedMessage.id, message.id, "an exact cloud replay should return the existing message");
  assert.deepEqual(replayedMessage, message, "an exact cloud replay should preserve the exact first write");
  assert.equal((await adapterA.getSession(session.id))?.message_count, 1, "an exact cloud replay should not increment message_count");
  await assert.rejects(
    adapterA.appendMessage({ session_id: session.id, id: "msg-1", role: "user", content: "changed cloud", parts: message.parts }),
    /different payload/,
    "a cloud replay with changed content must fail",
  );
  await assert.rejects(
    adapterA.appendMessage({ session_id: session.id, id: "msg-1", role: "user", content: "hello cloud", parts: [{ type: "text", text: "changed parts" }] }),
    /different payload/,
    "a cloud replay with changed parts must fail",
  );

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
  const file = await adapterA.createFile({
    id: "file-cloud",
    session_id: session.id,
    storage_key: "opaque/cloud",
    original_filename: "brief.pdf",
    media_type: "application/pdf",
    byte_size: 4096,
    checksum: "sha256:abc",
  });
  assert.equal(file.byte_size, 4096, "PostgreSQL bigint file sizes should map to numbers");
  assert.equal(typeof file.byte_size, "number");
  assert.equal((await adapterA.listFiles(session.id)).map((row) => row.id).join(","), file.id);
  assert.equal((await adapterA.listFiles(secondSession.id)).length, 0, "file lists must remain session scoped");
  assert.equal(await adapterB.getFile(file.id), null, "Org B must not read Org A file metadata by guessed id");
  assert.equal((await adapterB.listFiles(session.id)).length, 0, "Org B must not list Org A file metadata by guessed session id");
  assert.equal(await adapterB.updateFile(file.id, { status: "ready" }), null, "Org B must not update Org A file metadata");
  assert.equal(await adapterB.deleteFile(file.id), false, "Org B must not delete Org A file metadata");
  const readyFile = await adapterA.updateFile(file.id, {
    status: "ready",
    provider_references: { google: "provider-file-1" },
    provider_references_expires_at: "2026-07-14T00:00:00.000Z",
  });
  assert.equal(readyFile?.status, "ready");
  assert.deepEqual(readyFile?.provider_references, { google: "provider-file-1" });
  assert.equal(Boolean(readyFile?.ready_at), true);
  const fileInsert = executor.transactions.flatMap((tx) => tx.queries).find((query) => query.sql.startsWith("insert into sonik_agent_ui.agent_workspace_files"));
  assert.deepEqual(fileInsert?.params, ["org-a", "user-a", "file-cloud", session.id, "opaque/cloud", "brief.pdf", "application/pdf", 4096, "sha256:abc", "pending", null, null]);
  assert.equal(await adapterA.deleteFile(file.id), true);
  assert.equal(await adapterA.getFile(file.id), null, "deleted files should leave the active catalog");
  assert.equal(await adapterA.deleteFile(file.id), false, "file deletion should be idempotently false after the first delete");
  assert.equal(await adapterB.beginSessionDeletion(secondSession.id), false, "another tenant cannot fence a guessed session");
  assert.equal(await adapterA.beginSessionDeletion(session.id), true, "the owner can durably fence file creation before cleanup");
  await assert.rejects(
    () => adapterA.createFile({ id: "file-too-late", session_id: session.id, storage_key: "opaque/too-late", original_filename: "late.txt", media_type: "text/plain", byte_size: 1 }),
    /Session not found/,
    "cloud file creation must fail after deletion begins",
  );
  assert.match(
    executor.transactions.flatMap((tx) => tx.queries).find((query) => query.sql.startsWith("update sonik_agent_ui.agent_workspace_files set original_filename"))?.sql ?? "",
    /deleting_at is null/,
    "the cloud pending-to-ready transition is fenced in the same transaction",
  );
  const cloudRun = await adapterA.createRun({ session_id: session.id, user_message_id: message.id, message_id: "assistant-cloud", context_selection: { items: [], dismissedAutoSeedIds: ["file:removed"] } });
  assert.equal(cloudRun.user_message_id, message.id);
  assert.equal(cloudRun.message_id, "assistant-cloud", "assistant message semantics remain unchanged");
  assert.equal((await adapterA.listRuns(session.id))[0]?.user_message_id, message.id);
  assert.equal((await adapterA.getRun(cloudRun.id))?.id, cloudRun.id, "the owning host session can read its run");
  assert.equal(await adapterOtherHost.getRun(cloudRun.id), null, "another host session cannot read a guessed run id");
  assert.deepEqual(await adapterOtherHost.listRuns(session.id), [], "another host session cannot list runs from a guessed workspace session");
  assert.equal(await adapterOtherHost.updateRun(cloudRun.id, { status: "failed" }), null, "another host session cannot update a guessed run id");
  const cloudRunEvent = await adapterA.appendRunEvent({ run_id: cloudRun.id, session_id: session.id, kind: "status", event: { kind: "status", label: "started" } });
  assert.equal(cloudRunEvent.seq, 0);
  assert.deepEqual((await adapterA.listRunEvents(cloudRun.id)).map((event) => event.id), [cloudRunEvent.id]);
  assert.deepEqual(await adapterOtherHost.listRunEvents(cloudRun.id), [], "another host session cannot read a guessed run's events");
  const sequenceQueriesBeforeDeniedAppend = executor.transactions.flatMap((tx) => tx.queries).filter((query) => query.sql.startsWith("select coalesce(max(run_events.seq)")).length;
  await assert.rejects(
    () => adapterOtherHost.appendRunEvent({ run_id: cloudRun.id, session_id: session.id, kind: "status", event: { kind: "status", label: "denied" } }),
    (error) => error instanceof CloudWorkspacePersistenceError && error.code === "missing-request-context",
    "another host session cannot append to or allocate a sequence for a guessed run",
  );
  assert.equal(executor.transactions.flatMap((tx) => tx.queries).filter((query) => query.sql.startsWith("select coalesce(max(run_events.seq)")).length, sequenceQueriesBeforeDeniedAppend);
  await assert.rejects(
    () => adapterA.appendRunEvent({ run_id: cloudRun.id, session_id: secondSession.id, kind: "status", event: { kind: "status", label: "mismatched" } }),
    /session_id must match the parent run/i,
    "run events cannot name a different workspace session than their parent run",
  );
  assert.equal((await adapterA.updateRun(cloudRun.id, { message_id: "assistant-cloud-updated" }))?.message_id, "assistant-cloud-updated");
  const assistant = await adapterA.appendMessage({ session_id: session.id, id: "assistant-provenance", role: "assistant", content: "No" });
  const otherUser = await adapterA.appendMessage({ session_id: secondSession.id, id: "other-user", role: "user", content: "Other" });
  await assert.rejects(() => adapterA.createRun({ session_id: session.id, user_message_id: assistant.id }), /user message in the same session/i);
  await assert.rejects(() => adapterA.createRun({ session_id: session.id, user_message_id: otherUser.id }), /user message in the same session/i);
  await assert.rejects(() => adapterA.createRun({ session_id: session.id, user_message_id: "" }), /user message in the same session/i);
  assert.equal((await adapterA.createRun({ session_id: session.id })).user_message_id, null);
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
    executor.transactions.some((tx) => tx.queries.some((query) => query.sql.includes("left(documents.current_content, 500)") && query.sql.includes("limit $7 offset $8"))),
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

  const hostBoundFile = await adapterA.createFile({ id: "file-host-bound", session_id: secondSession.id, storage_key: "opaque/host-bound", original_filename: "host.txt", media_type: "text/plain", byte_size: 4 });
  await assert.rejects(
    () => adapterOtherHost.appendMessage({ session_id: session.id, id: "host-leak-message", role: "user", content: "denied" }),
    (error) => error instanceof CloudWorkspacePersistenceError && error.code === "missing-request-context",
  );

  assert.deepEqual(await adapterOtherHost.listMessages(session.id), [], "another host cannot list messages from a guessed session");
  assert.equal(await adapterOtherHost.getDocument(document.id), null, "another host cannot read a guessed document");
  assert.deepEqual(await adapterOtherHost.listDocuments(secondSession.id), [], "another host cannot list documents from a guessed session");
  assert.deepEqual(await adapterOtherHost.listDocumentVersions(document.id), [], "another host cannot list guessed document versions");
  assert.equal(await adapterOtherHost.getDocumentVersion(document.id, 1), null, "another host cannot read a guessed document version");
  assert.equal(await adapterOtherHost.updateDocument(document.id, { content: "host leak" }), null, "another host cannot update a guessed document");
  assert.equal(await adapterOtherHost.patchDocument(document.id, { title: "host leak" }), null, "another host cannot patch a guessed document");
  assert.equal(await adapterOtherHost.archiveDocument(document.id), null, "another host cannot archive a guessed document");
  assert.equal(await adapterOtherHost.deleteDocument(document.id), false, "another host cannot delete a guessed document");
  assert.equal(await adapterOtherHost.restoreDocumentVersion(document.id, 1), null, "another host cannot restore a guessed document version");
  assert.equal((await adapterOtherHost.listDocumentLibrary()).total, 0, "another host cannot browse another host's document library");
  assert.equal(await adapterOtherHost.getArtifact(artifact.id), null, "another host cannot read a guessed artifact");
  assert.equal(await adapterOtherHost.updateArtifact(artifact.id, { title: "host leak" }), null, "another host cannot update a guessed artifact");
  assert.deepEqual(await adapterOtherHost.listArtifactVersions(artifact.id), [], "another host cannot list guessed artifact versions");
  assert.deepEqual(await adapterOtherHost.listLayoutSnapshots(session.id), [], "another host cannot list guessed layouts");
  assert.equal(await adapterOtherHost.getFile(hostBoundFile.id), null, "another host cannot read file provider metadata");
  assert.deepEqual(await adapterOtherHost.listFiles(secondSession.id), [], "another host cannot list guessed files");
  assert.equal(await adapterOtherHost.updateFile(hostBoundFile.id, { provider_references: { google: "leak" } }), null, "another host cannot write provider references");
  assert.equal(await adapterOtherHost.deleteFile(hostBoundFile.id), false, "another host cannot delete a guessed file");
  assert.equal(await adapterOtherHost.patchSession(session.id, { name: "host leak" }), null, "another host cannot patch a guessed session");
  assert.equal(await adapterOtherHost.archiveSession(session.id), null, "another host cannot archive a guessed session");
  assert.equal(await adapterOtherHost.beginSessionDeletion(session.id), false, "another host cannot fence a guessed session");
  assert.equal(await adapterOtherHost.deleteSession(session.id), false, "another host cannot delete a guessed session");
  assert.equal((await adapterA.getDocument(document.id))?.title, "RLS Doc Renamed", "denied document writes leave owner data unchanged");
  assert.equal((await adapterA.getArtifact(artifact.id))?.title, "RLS Artifact Renamed", "denied artifact writes leave owner data unchanged");
  assert.equal((await adapterA.getFile(hostBoundFile.id))?.provider_references, null, "denied provider-reference writes leave owner data unchanged");

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

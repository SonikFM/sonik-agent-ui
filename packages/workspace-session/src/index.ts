import type { AgentTelemetrySource } from "@sonik-agent-ui/agent-observability";
export type WorkspaceMode = "chat" | "artifact" | "document" | "research";
export const DEFAULT_WORKSPACE_SESSION_NAME = "New chat";
const LEGACY_DEFAULT_WORKSPACE_SESSION_NAMES = new Set(["sonik workspace", "workspace document session"]);

export function normalizeWorkspaceSessionName(name?: string | null): string {
  const trimmed = name?.trim();
  return trimmed || DEFAULT_WORKSPACE_SESSION_NAME;
}

export function isDefaultWorkspaceSessionName(name?: string | null): boolean {
  const normalized = name?.trim().toLowerCase() ?? "";
  return !normalized || normalized === DEFAULT_WORKSPACE_SESSION_NAME.toLowerCase() || LEGACY_DEFAULT_WORKSPACE_SESSION_NAMES.has(normalized);
}

export function deriveWorkspaceSessionTitle(message: string, input: { maxWords?: number; maxLength?: number } = {}): string {
  const maxWords = Math.max(1, input.maxWords ?? 7);
  const maxLength = Math.max(16, input.maxLength ?? 56);
  const cleaned = message
    .replace(/[`*_#>\[\](){}]/g, " ")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const withoutLeadIn = cleaned.replace(/^(please|can you|could you|would you|will you|i want to|i need to|let'?s|lets)\s+/i, "");
  const title = withoutLeadIn.split(/\s+/).filter(Boolean).slice(0, maxWords).join(" ").replace(/[?.!,;:]+$/g, "").trim();
  if (!title) return DEFAULT_WORKSPACE_SESSION_NAME;
  const sentence = title.charAt(0).toUpperCase() + title.slice(1);
  return sentence.length > maxLength ? `${sentence.slice(0, maxLength - 3).trim()}...` : sentence;
}

export type WorkspaceArtifactKind = "json-render" | "document";
export type WorkspaceDocumentVersionSource = "user" | "ai" | "system";

export interface WorkspaceSessionRecord {
  id: string;
  name: string;
  mode: WorkspaceMode;
  archived: boolean;
  is_important: boolean;
  folder: string | null;
  message_count: number;
  active_document_id: string | null;
  active_artifact_id: string | null;
  created_at: string;
  updated_at: string;
  last_accessed: string;
  last_message_at: string | null;
}

export interface WorkspaceDocumentRecord {
  id: string;
  session_id: string | null;
  title: string;
  language: string;
  current_content: string;
  version_count: number;
  is_active: boolean;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceDocumentVersionRecord {
  id: string;
  document_id: string;
  version_number: number;
  content: string;
  summary: string | null;
  source: WorkspaceDocumentVersionSource;
  created_at: string;
}

export interface WorkspaceArtifactRecord<TContent = unknown> {
  id: string;
  session_id: string | null;
  kind: WorkspaceArtifactKind;
  title: string;
  content: TContent;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceArtifactVersionRecord<TContent = unknown> {
  id: string;
  artifact_id: string;
  version_number: number;
  content: TContent;
  summary: string | null;
  source: WorkspaceDocumentVersionSource;
  created_at: string;
}

export interface WorkspaceMessageRecord<TParts = unknown> {
  id: string;
  session_id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  parts: TParts | null;
  created_at: string;
}

export interface WorkspaceToolCallRecord<TInput = unknown, TOutput = unknown> {
  id: string;
  session_id: string | null;
  message_id: string | null;
  tool_name: string;
  source: "orpc" | "openapi" | "mcp" | "sandbox" | "local-ui" | "unknown";
  effect: "read" | "write" | "destructive" | "environment" | "unknown";
  status: "pending" | "success" | "error";
  input: TInput | null;
  output: TOutput | null;
  error: string | null;
  artifact_id: string | null;
  document_id: string | null;
  request_id: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface WorkspaceLayoutSnapshotRecord<TLayout = unknown> {
  id: string;
  session_id: string;
  active_pane_id: string | null;
  active_artifact_id: string | null;
  layout: TLayout;
  source: "user" | "ai" | "system";
  created_at: string;
}

export interface WorkspaceTelemetryEventRecord<TPayload = unknown> {
  id: string;
  session_id: string | null;
  request_id: string | null;
  source: AgentTelemetrySource;
  event: string;
  payload: TPayload;
  ok: boolean | null;
  error: string | null;
  created_at: string;
}

export interface WorkspaceAuthContext {
  userId: string;
  sessionId: string;
  organizationId: string | null;
  authenticated: boolean;
  scopes: string[];
  mode: "standalone-local" | "embedded-host";
  authority: "local-only" | "host-asserted";
}

export interface WorkspaceAuthAdapter {
  resolveContext(input?: Partial<WorkspaceAuthContext>): WorkspaceAuthContext;
}

export interface DocumentLibraryResult {
  documents: Array<WorkspaceDocumentRecord & { session_name: string | null; preview: string }>;
  total: number;
  languages: Record<string, number>;
  session_count: number;
}

export interface WorkspaceSessionDocumentStore {
  createSession(input?: { id?: string; name?: string | null; mode?: WorkspaceMode; folder?: string | null }): WorkspaceSessionRecord;
  ensureSession(sessionId?: string | null): WorkspaceSessionRecord;
  getSession(id: string): WorkspaceSessionRecord | null;
  listSessions(input?: { archived?: boolean }): WorkspaceSessionRecord[];
  patchSession(id: string, input: Partial<Pick<WorkspaceSessionRecord, "name" | "mode" | "folder" | "active_document_id" | "active_artifact_id" | "is_important">>): WorkspaceSessionRecord | null;
  archiveSession(id: string, archived?: boolean): WorkspaceSessionRecord | null;
  deleteSession(id: string): boolean;
  createDocument(input: { session_id?: string | null; title?: string | null; content?: string | null; language?: string | null; source?: WorkspaceDocumentVersionSource; summary?: string | null }): WorkspaceDocumentRecord;
  getDocument(id: string): WorkspaceDocumentRecord | null;
  listDocuments(sessionId: string): WorkspaceDocumentRecord[];
  listDocumentLibrary(input?: { search?: string | null; language?: string | null; sort?: string | null; offset?: number; limit?: number; archived?: boolean }): DocumentLibraryResult;
  updateDocument(id: string, input: { content?: string; title?: string; language?: string; source?: WorkspaceDocumentVersionSource; summary?: string | null }): WorkspaceDocumentRecord | null;
  patchDocument(id: string, input: { content?: string; title?: string; language?: string; session_id?: string | null }): WorkspaceDocumentRecord | null;
  archiveDocument(id: string, archived?: boolean): WorkspaceDocumentRecord | null;
  deleteDocument(id: string): boolean;
  listDocumentVersions(documentId: string): WorkspaceDocumentVersionRecord[];
  getDocumentVersion(documentId: string, versionNumber: number): WorkspaceDocumentVersionRecord | null;
  restoreDocumentVersion(documentId: string, versionNumber: number): WorkspaceDocumentRecord | null;
  syncActiveDocumentSnapshot(snapshot: WorkspaceDocumentRecord): WorkspaceDocumentRecord;
}

export interface WorkspaceArtifactStore {
  createArtifact<TContent = unknown>(input: { session_id?: string | null; id?: string; kind: WorkspaceArtifactKind; title: string; content: TContent; source?: WorkspaceDocumentVersionSource; summary?: string | null }): WorkspaceArtifactRecord<TContent>;
  getArtifact<TContent = unknown>(id: string): WorkspaceArtifactRecord<TContent> | null;
  updateArtifact<TContent = unknown>(id: string, input: { title?: string; content?: TContent; source?: WorkspaceDocumentVersionSource; summary?: string | null }): WorkspaceArtifactRecord<TContent> | null;
  listArtifactVersions<TContent = unknown>(artifactId: string): WorkspaceArtifactVersionRecord<TContent>[];
}

export interface WorkspaceActivityStore {
  appendMessage<TParts = unknown>(input: { session_id?: string | null; id?: string; role: WorkspaceMessageRecord<TParts>["role"]; content?: string | null; parts?: TParts | null }): WorkspaceMessageRecord<TParts>;
  listMessages<TParts = unknown>(sessionId: string): WorkspaceMessageRecord<TParts>[];
  recordToolCall<TInput = unknown, TOutput = unknown>(input: Omit<WorkspaceToolCallRecord<TInput, TOutput>, "id" | "created_at" | "completed_at"> & { id?: string; created_at?: string; completed_at?: string | null }): WorkspaceToolCallRecord<TInput, TOutput>;
  listToolCalls(sessionId: string): WorkspaceToolCallRecord[];
  recordLayoutSnapshot<TLayout = unknown>(input: { session_id?: string | null; active_pane_id?: string | null; active_artifact_id?: string | null; layout: TLayout; source?: WorkspaceLayoutSnapshotRecord<TLayout>["source"] }): WorkspaceLayoutSnapshotRecord<TLayout>;
  listLayoutSnapshots<TLayout = unknown>(sessionId: string): WorkspaceLayoutSnapshotRecord<TLayout>[];
}

export interface WorkspaceTelemetryStore {
  recordTelemetryEvent<TPayload = unknown>(input: { session_id?: string | null; request_id?: string | null; source: WorkspaceTelemetryEventRecord<TPayload>["source"]; event: string; payload?: TPayload; ok?: boolean | null; error?: string | null }): WorkspaceTelemetryEventRecord<TPayload>;
  listTelemetryEvents(sessionId?: string | null): WorkspaceTelemetryEventRecord[];
}

export type WorkspacePersistenceAdapter = WorkspaceSessionDocumentStore & WorkspaceArtifactStore & WorkspaceActivityStore & WorkspaceTelemetryStore;

export interface WorkspaceServices {
  persistence: WorkspacePersistenceAdapter;
  auth: WorkspaceAuthAdapter;
}

export function createWorkspaceServices(input: {
  persistence?: WorkspacePersistenceAdapter;
  auth?: WorkspaceAuthAdapter;
} = {}): WorkspaceServices {
  return {
    persistence: input.persistence ?? createInMemoryWorkspacePersistence(),
    auth: input.auth ?? createLocalAuthAdapter(),
  };
}

export function createLocalAuthAdapter(defaults: Pick<Partial<WorkspaceAuthContext>, "userId" | "sessionId" | "scopes"> = {}): WorkspaceAuthAdapter {
  return {
    resolveContext(input = {}) {
      return {
        userId: input.userId ?? defaults.userId ?? "local-user",
        sessionId: input.sessionId ?? defaults.sessionId ?? "local-session",
        organizationId: null,
        authenticated: false,
        scopes: [...(input.scopes ?? defaults.scopes ?? ["workspace:read", "workspace:write"])],
        mode: "standalone-local",
        authority: "local-only",
      };
    },
  };
}

export interface AsyncWorkspaceSessionDocumentStore {
  createSession(input?: { id?: string; name?: string | null; mode?: WorkspaceMode; folder?: string | null }): Promise<WorkspaceSessionRecord>;
  ensureSession(sessionId?: string | null): Promise<WorkspaceSessionRecord>;
  getSession(id: string): Promise<WorkspaceSessionRecord | null>;
  listSessions(input?: { archived?: boolean }): Promise<WorkspaceSessionRecord[]>;
  patchSession(id: string, input: Partial<Pick<WorkspaceSessionRecord, "name" | "mode" | "folder" | "active_document_id" | "active_artifact_id" | "is_important">>): Promise<WorkspaceSessionRecord | null>;
  archiveSession(id: string, archived?: boolean): Promise<WorkspaceSessionRecord | null>;
  deleteSession(id: string): Promise<boolean>;
  createDocument(input: { session_id?: string | null; title?: string | null; content?: string | null; language?: string | null; source?: WorkspaceDocumentVersionSource; summary?: string | null }): Promise<WorkspaceDocumentRecord>;
  getDocument(id: string): Promise<WorkspaceDocumentRecord | null>;
  listDocuments(sessionId: string): Promise<WorkspaceDocumentRecord[]>;
  listDocumentLibrary(input?: { search?: string | null; language?: string | null; sort?: string | null; offset?: number; limit?: number; archived?: boolean }): Promise<DocumentLibraryResult>;
  updateDocument(id: string, input: { content?: string; title?: string; language?: string; source?: WorkspaceDocumentVersionSource; summary?: string | null }): Promise<WorkspaceDocumentRecord | null>;
  patchDocument(id: string, input: { content?: string; title?: string; language?: string; session_id?: string | null }): Promise<WorkspaceDocumentRecord | null>;
  archiveDocument(id: string, archived?: boolean): Promise<WorkspaceDocumentRecord | null>;
  deleteDocument(id: string): Promise<boolean>;
  listDocumentVersions(documentId: string): Promise<WorkspaceDocumentVersionRecord[]>;
  getDocumentVersion(documentId: string, versionNumber: number): Promise<WorkspaceDocumentVersionRecord | null>;
  restoreDocumentVersion(documentId: string, versionNumber: number): Promise<WorkspaceDocumentRecord | null>;
  syncActiveDocumentSnapshot(snapshot: WorkspaceDocumentRecord): Promise<WorkspaceDocumentRecord>;
}

export interface AsyncWorkspaceArtifactStore {
  createArtifact<TContent = unknown>(input: { session_id?: string | null; id?: string; kind: WorkspaceArtifactKind; title: string; content: TContent; source?: WorkspaceDocumentVersionSource; summary?: string | null }): Promise<WorkspaceArtifactRecord<TContent>>;
  getArtifact<TContent = unknown>(id: string): Promise<WorkspaceArtifactRecord<TContent> | null>;
  updateArtifact<TContent = unknown>(id: string, input: { title?: string; content?: TContent; source?: WorkspaceDocumentVersionSource; summary?: string | null }): Promise<WorkspaceArtifactRecord<TContent> | null>;
  listArtifactVersions<TContent = unknown>(artifactId: string): Promise<WorkspaceArtifactVersionRecord<TContent>[]>;
}

export interface AsyncWorkspaceActivityStore {
  appendMessage<TParts = unknown>(input: { session_id?: string | null; id?: string; role: WorkspaceMessageRecord<TParts>["role"]; content?: string | null; parts?: TParts | null }): Promise<WorkspaceMessageRecord<TParts>>;
  listMessages<TParts = unknown>(sessionId: string): Promise<WorkspaceMessageRecord<TParts>[]>;
  recordToolCall<TInput = unknown, TOutput = unknown>(input: Omit<WorkspaceToolCallRecord<TInput, TOutput>, "id" | "created_at" | "completed_at"> & { id?: string; created_at?: string; completed_at?: string | null }): Promise<WorkspaceToolCallRecord<TInput, TOutput>>;
  listToolCalls(sessionId: string): Promise<WorkspaceToolCallRecord[]>;
  recordLayoutSnapshot<TLayout = unknown>(input: { session_id?: string | null; active_pane_id?: string | null; active_artifact_id?: string | null; layout: TLayout; source?: WorkspaceLayoutSnapshotRecord<TLayout>["source"] }): Promise<WorkspaceLayoutSnapshotRecord<TLayout>>;
  listLayoutSnapshots<TLayout = unknown>(sessionId: string): Promise<WorkspaceLayoutSnapshotRecord<TLayout>[]>;
}

export interface AsyncWorkspaceTelemetryStore {
  recordTelemetryEvent<TPayload = unknown>(input: { session_id?: string | null; request_id?: string | null; source: WorkspaceTelemetryEventRecord<TPayload>["source"]; event: string; payload?: TPayload; ok?: boolean | null; error?: string | null }): Promise<WorkspaceTelemetryEventRecord<TPayload>>;
  listTelemetryEvents(sessionId?: string | null): Promise<WorkspaceTelemetryEventRecord[]>;
}

export type AsyncWorkspacePersistenceAdapter = AsyncWorkspaceSessionDocumentStore & AsyncWorkspaceArtifactStore & AsyncWorkspaceActivityStore & AsyncWorkspaceTelemetryStore;

export type WorkspacePersistencePolicy = "memory" | "cloud" | "auto";

export interface WorkspaceCommandPolicyDecision {
  allowed: boolean;
  commandId: string;
  reasonCode: string;
  effectiveScope: "workspace" | "session" | "document" | "artifact" | "none";
  auditRequired?: boolean;
}

export interface WorkspaceSqlTransaction {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface WorkspaceSqlExecutor {
  transaction<T>(fn: (tx: WorkspaceSqlTransaction) => Promise<T>): Promise<T>;
}

export interface WorkspaceHostSessionSnapshot {
  source: string;
  sessionId?: string | null;
  userId?: string | null;
  principalId?: string | null;
  organizationId?: string | null;
  authenticated: boolean;
  scopes: string[];
  expiresAt?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AuthorizedWorkspaceRuntime {
  kind: "cloud";
  env: unknown;
  db: WorkspaceSqlExecutor;
  userId: string;
  organizationId: string;
  principalId?: string | null;
  requestId: string;
  commandPolicy: WorkspaceCommandPolicyDecision;
  hostSession: WorkspaceHostSessionSnapshot;
}

export type MemoryWorkspaceRuntimeReason = "local" | "anonymous" | "cloud-unavailable";

export interface MemoryWorkspaceRuntime {
  kind: "memory";
  persistence: AsyncWorkspacePersistenceAdapter;
  reason: MemoryWorkspaceRuntimeReason;
}

export interface CloudWorkspaceRuntime {
  kind: "cloud";
  persistence: AsyncWorkspacePersistenceAdapter;
  authorized: AuthorizedWorkspaceRuntime;
}

export type ResolvedWorkspaceRuntime = MemoryWorkspaceRuntime | CloudWorkspaceRuntime;

export function createAsyncWorkspacePersistenceAdapter(adapter: WorkspacePersistenceAdapter): AsyncWorkspacePersistenceAdapter {
  return {
    createSession: async (input) => adapter.createSession(input),
    ensureSession: async (sessionId) => adapter.ensureSession(sessionId),
    getSession: async (id) => adapter.getSession(id),
    listSessions: async (input) => adapter.listSessions(input),
    patchSession: async (id, input) => adapter.patchSession(id, input),
    archiveSession: async (id, archived) => adapter.archiveSession(id, archived),
    deleteSession: async (id) => adapter.deleteSession(id),
    createDocument: async (input) => adapter.createDocument(input),
    getDocument: async (id) => adapter.getDocument(id),
    listDocuments: async (sessionId) => adapter.listDocuments(sessionId),
    listDocumentLibrary: async (input) => adapter.listDocumentLibrary(input),
    updateDocument: async (id, input) => adapter.updateDocument(id, input),
    patchDocument: async (id, input) => adapter.patchDocument(id, input),
    archiveDocument: async (id, archived) => adapter.archiveDocument(id, archived),
    deleteDocument: async (id) => adapter.deleteDocument(id),
    listDocumentVersions: async (documentId) => adapter.listDocumentVersions(documentId),
    getDocumentVersion: async (documentId, versionNumber) => adapter.getDocumentVersion(documentId, versionNumber),
    restoreDocumentVersion: async (documentId, versionNumber) => adapter.restoreDocumentVersion(documentId, versionNumber),
    syncActiveDocumentSnapshot: async (snapshot) => adapter.syncActiveDocumentSnapshot(snapshot),
    createArtifact: async <TContent = unknown>(input: { session_id?: string | null; id?: string; kind: WorkspaceArtifactKind; title: string; content: TContent; source?: WorkspaceDocumentVersionSource; summary?: string | null }) => adapter.createArtifact<TContent>(input),
    getArtifact: async <TContent = unknown>(id: string) => adapter.getArtifact<TContent>(id),
    updateArtifact: async <TContent = unknown>(id: string, input: { title?: string; content?: TContent; source?: WorkspaceDocumentVersionSource; summary?: string | null }) => adapter.updateArtifact<TContent>(id, input),
    listArtifactVersions: async <TContent = unknown>(artifactId: string) => adapter.listArtifactVersions<TContent>(artifactId),
    appendMessage: async <TParts = unknown>(input: { session_id?: string | null; id?: string; role: WorkspaceMessageRecord<TParts>["role"]; content?: string | null; parts?: TParts | null }) => adapter.appendMessage<TParts>(input),
    listMessages: async <TParts = unknown>(sessionId: string) => adapter.listMessages<TParts>(sessionId),
    recordToolCall: async <TInput = unknown, TOutput = unknown>(input: Omit<WorkspaceToolCallRecord<TInput, TOutput>, "id" | "created_at" | "completed_at"> & { id?: string; created_at?: string; completed_at?: string | null }) => adapter.recordToolCall<TInput, TOutput>(input),
    listToolCalls: async (sessionId) => adapter.listToolCalls(sessionId),
    recordLayoutSnapshot: async <TLayout = unknown>(input: { session_id?: string | null; active_pane_id?: string | null; active_artifact_id?: string | null; layout: TLayout; source?: WorkspaceLayoutSnapshotRecord<TLayout>["source"] }) => adapter.recordLayoutSnapshot<TLayout>(input),
    listLayoutSnapshots: async <TLayout = unknown>(sessionId: string) => adapter.listLayoutSnapshots<TLayout>(sessionId),
    recordTelemetryEvent: async <TPayload = unknown>(input: { session_id?: string | null; request_id?: string | null; source: WorkspaceTelemetryEventRecord<TPayload>["source"]; event: string; payload?: TPayload; ok?: boolean | null; error?: string | null }) => adapter.recordTelemetryEvent<TPayload>(input),
    listTelemetryEvents: async (sessionId) => adapter.listTelemetryEvents(sessionId),
  };
}

export function createMemoryWorkspaceRuntime(input: {
  persistence?: WorkspacePersistenceAdapter;
  reason?: MemoryWorkspaceRuntimeReason;
  persistenceOptions?: InMemoryWorkspacePersistenceOptions;
} = {}): MemoryWorkspaceRuntime {
  return {
    kind: "memory",
    reason: input.reason ?? "local",
    persistence: createAsyncWorkspacePersistenceAdapter(input.persistence ?? createInMemoryWorkspacePersistence(input.persistenceOptions)),
  };
}

export class CloudWorkspacePersistenceError extends Error {
  readonly code: "missing-request-context" | "command-policy-denied" | "unsupported-operation";

  constructor(code: CloudWorkspacePersistenceError["code"], message: string) {
    super(message);
    this.name = "CloudWorkspacePersistenceError";
    this.code = code;
  }
}

export function createCloudWorkspacePersistenceAdapter(authorized: AuthorizedWorkspaceRuntime): AsyncWorkspacePersistenceAdapter {
  return new CloudWorkspacePersistence(authorized);
}

export function createCloudWorkspaceRuntime(authorized: AuthorizedWorkspaceRuntime): CloudWorkspaceRuntime {
  return {
    kind: "cloud",
    authorized,
    persistence: createCloudWorkspacePersistenceAdapter(authorized),
  };
}

type CloudWorkspaceSessionRow = {
  id: string;
  name: string;
  mode: WorkspaceMode;
  archived: boolean;
  is_important: boolean;
  folder: string | null;
  message_count: number;
  active_document_id: string | null;
  active_artifact_id: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  last_accessed: string | Date;
  last_message_at: string | Date | null;
};

type CloudWorkspaceMessageRow<TParts = unknown> = {
  id: string;
  session_id: string;
  role: WorkspaceMessageRecord<TParts>["role"];
  content: string;
  parts: TParts | null;
  created_at: string | Date;
};

type CloudWorkspaceDocumentRow = {
  id: string;
  session_id: string | null;
  title: string;
  language: string;
  current_content: string;
  version_count: number;
  is_active: boolean;
  archived: boolean;
  created_at: string | Date;
  updated_at: string | Date;
};

type CloudWorkspaceDocumentLibraryRow = CloudWorkspaceDocumentRow & {
  session_name: string | null;
  preview: string;
};

type CloudWorkspaceDocumentLanguageCountRow = {
  language: string;
  count: number;
};

type CloudWorkspaceDocumentVersionRow = {
  id: string;
  document_id: string;
  version_number: number;
  content: string;
  summary: string | null;
  source: WorkspaceDocumentVersionSource;
  created_at: string | Date;
};

type CloudWorkspaceArtifactRow<TContent = unknown> = {
  id: string;
  session_id: string | null;
  kind: WorkspaceArtifactKind;
  title: string;
  content: TContent;
  version: number;
  created_at: string | Date;
  updated_at: string | Date;
};

type CloudWorkspaceArtifactVersionRow<TContent = unknown> = {
  id: string;
  artifact_id: string;
  version_number: number;
  content: TContent;
  summary: string | null;
  source: WorkspaceDocumentVersionSource;
  created_at: string | Date;
};

type CloudWorkspaceLayoutSnapshotRow<TLayout = unknown> = {
  id: string;
  session_id: string;
  active_pane_id: string | null;
  active_artifact_id: string | null;
  layout: TLayout;
  source: WorkspaceLayoutSnapshotRecord<TLayout>["source"];
  created_at: string | Date;
};

class CloudWorkspacePersistence implements AsyncWorkspacePersistenceAdapter {
  readonly #authorized: AuthorizedWorkspaceRuntime;

  constructor(authorized: AuthorizedWorkspaceRuntime) {
    this.#authorized = authorized;
  }

  createSession(input: { id?: string; name?: string | null; mode?: WorkspaceMode; folder?: string | null } = {}): Promise<WorkspaceSessionRecord> {
    return this.#withContext(async (tx) => {
      const id = input.id?.trim() || this.#nextId("workspace-session");
      const existing = await this.#selectSession(tx, id);
      if (existing) return existing;
      const { rows } = await tx.query<CloudWorkspaceSessionRow>(
          `insert into sonik_agent_ui.agent_workspace_sessions
          (organization_id, user_id, id, host_session_id, name, mode, folder)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning id, name, mode, archived, is_important, folder, message_count, active_document_id, active_artifact_id, created_at, updated_at, last_accessed, last_message_at`,
        [
          this.#authorized.organizationId,
          this.#authorized.userId,
          id,
          this.#authorized.hostSession.sessionId ?? null,
          normalizeWorkspaceSessionName(input.name),
          input.mode ?? "chat",
          input.folder ?? null,
        ],
      );
      const row = rows[0];
      if (!row) throw new CloudWorkspacePersistenceError("missing-request-context", "Cloud session insert returned no row.");
      return mapCloudSessionRow(row);
    });
  }

  ensureSession(sessionId?: string | null): Promise<WorkspaceSessionRecord> {
    return this.#withContext(async (tx) => this.#ensureSession(tx, sessionId));
  }

  getSession(id: string): Promise<WorkspaceSessionRecord | null> {
    return this.#withContext((tx) => this.#selectSession(tx, id));
  }

  listSessions({ archived = false }: { archived?: boolean } = {}): Promise<WorkspaceSessionRecord[]> {
    return this.#withContext(async (tx) => {
      const { rows } = await tx.query<CloudWorkspaceSessionRow>(
        `select id, name, mode, archived, is_important, folder, message_count, active_document_id, active_artifact_id, created_at, updated_at, last_accessed, last_message_at
         from sonik_agent_ui.agent_workspace_sessions
         where organization_id = $1 and user_id = $2 and archived = $3
         order by last_accessed desc`,
        [this.#authorized.organizationId, this.#authorized.userId, archived],
      );
      return rows.map(mapCloudSessionRow);
    });
  }

  patchSession(id: string, input: Partial<Pick<WorkspaceSessionRecord, "name" | "mode" | "folder" | "active_document_id" | "active_artifact_id" | "is_important">>): Promise<WorkspaceSessionRecord | null> {
    return this.#withContext(async (tx) => {
      const existing = await this.#selectSession(tx, id);
      if (!existing) return null;
      const next = { ...existing, ...input };
      const { rows } = await tx.query<CloudWorkspaceSessionRow>(
        `update sonik_agent_ui.agent_workspace_sessions
         set name = $4, mode = $5, folder = $6, active_document_id = $7, active_artifact_id = $8, is_important = $9, updated_at = now(), last_accessed = now()
         where organization_id = $1 and user_id = $2 and id = $3
         returning id, name, mode, archived, is_important, folder, message_count, active_document_id, active_artifact_id, created_at, updated_at, last_accessed, last_message_at`,
        [this.#authorized.organizationId, this.#authorized.userId, id, next.name, next.mode, next.folder, next.active_document_id, next.active_artifact_id, next.is_important],
      );
      return rows[0] ? mapCloudSessionRow(rows[0]) : null;
    });
  }

  archiveSession(id: string, archived = true): Promise<WorkspaceSessionRecord | null> {
    return this.#withContext(async (tx) => {
      const { rows } = await tx.query<CloudWorkspaceSessionRow>(
        `update sonik_agent_ui.agent_workspace_sessions
         set archived = $4, updated_at = now(), last_accessed = now()
         where organization_id = $1 and user_id = $2 and id = $3
         returning id, name, mode, archived, is_important, folder, message_count, active_document_id, active_artifact_id, created_at, updated_at, last_accessed, last_message_at`,
        [this.#authorized.organizationId, this.#authorized.userId, id, archived],
      );
      return rows[0] ? mapCloudSessionRow(rows[0]) : null;
    });
  }

  deleteSession(id: string): Promise<boolean> {
    return this.#withContext(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `delete from sonik_agent_ui.agent_workspace_sessions
         where organization_id = $1 and user_id = $2 and id = $3
         returning id`,
        [this.#authorized.organizationId, this.#authorized.userId, id],
      );
      return rows.length > 0;
    });
  }

  appendMessage<TParts = unknown>(input: { session_id?: string | null; id?: string; role: WorkspaceMessageRecord<TParts>["role"]; content?: string | null; parts?: TParts | null }): Promise<WorkspaceMessageRecord<TParts>> {
    return this.#withContext(async (tx) => {
      const session = await this.#ensureSession(tx, input.session_id);
      const id = input.id?.trim() || this.#nextId("workspace-message");
      const { rows } = await tx.query<CloudWorkspaceMessageRow<TParts>>(
        `insert into sonik_agent_ui.agent_workspace_messages
          (organization_id, user_id, id, session_id, role, content, parts)
         values ($1, $2, $3, $4, $5, $6, $7::jsonb)
         returning id, session_id, role, content, parts, created_at`,
        [
          this.#authorized.organizationId,
          this.#authorized.userId,
          id,
          session.id,
          input.role,
          input.content ?? "",
          input.parts === undefined || input.parts === null ? null : JSON.stringify(input.parts),
        ],
      );
      const row = rows[0];
      if (!row) throw new CloudWorkspacePersistenceError("missing-request-context", "Cloud message insert returned no row.");
      await tx.query(
        `update sonik_agent_ui.agent_workspace_sessions
         set message_count = message_count + 1, last_message_at = $4, updated_at = now(), last_accessed = now()
         where organization_id = $1 and user_id = $2 and id = $3`,
        [this.#authorized.organizationId, this.#authorized.userId, session.id, row.created_at],
      );
      return mapCloudMessageRow(row);
    });
  }

  listMessages<TParts = unknown>(sessionId: string): Promise<WorkspaceMessageRecord<TParts>[]> {
    return this.#withContext(async (tx) => {
      const { rows } = await tx.query<CloudWorkspaceMessageRow<TParts>>(
        `select id, session_id, role, content, parts, created_at
         from sonik_agent_ui.agent_workspace_messages
         where organization_id = $1 and user_id = $2 and session_id = $3
         order by created_at asc`,
        [this.#authorized.organizationId, this.#authorized.userId, sessionId],
      );
      return rows.map(mapCloudMessageRow<TParts>);
    });
  }

  createDocument(input: { session_id?: string | null; title?: string | null; content?: string | null; language?: string | null; source?: WorkspaceDocumentVersionSource; summary?: string | null }): Promise<WorkspaceDocumentRecord> {
    return this.#withContext(async (tx) => {
      const session = await this.#ensureSession(tx, input.session_id);
      const content = input.content ?? "";
      const document = await this.#insertDocument(tx, {
        id: this.#nextId("workspace-doc"),
        sessionId: session.id,
        title: input.title?.trim() || "Untitled",
        language: normalizeLanguage(input.language, content),
        content,
      });
      await this.#insertDocumentVersion(tx, document, input.source ?? "user", input.summary ?? "Initial version");
      await this.#updateSessionActivePointers(tx, session.id, { activeDocumentId: document.id, mode: "document" });
      return document;
    });
  }

  getDocument(id: string): Promise<WorkspaceDocumentRecord | null> {
    return this.#withContext((tx) => this.#selectDocument(tx, id));
  }

  listDocuments(sessionId: string): Promise<WorkspaceDocumentRecord[]> {
    return this.#withContext(async (tx) => {
      const { rows } = await tx.query<CloudWorkspaceDocumentRow>(
        `select id, session_id, title, language, current_content, version_count, is_active, archived, created_at, updated_at
         from sonik_agent_ui.agent_workspace_documents
         where organization_id = $1 and user_id = $2 and session_id = $3 and is_active = true and archived = false
         order by updated_at desc`,
        [this.#authorized.organizationId, this.#authorized.userId, sessionId],
      );
      return rows.map(mapCloudDocumentRow);
    });
  }

  listDocumentLibrary(input: { search?: string | null; language?: string | null; sort?: string | null; offset?: number; limit?: number; archived?: boolean } = {}): Promise<DocumentLibraryResult> {
    return this.#withContext(async (tx) => {
      const archived = Boolean(input.archived);
      const language = input.language?.trim().toLowerCase() || null;
      const search = input.search?.trim() || null;
      const offset = Math.max(0, input.offset ?? 0);
      const limit = Math.min(50, Math.max(1, input.limit ?? 20));
      const orderBy = resolveDocumentLibraryOrderBy(input.sort);
      const filterSql = `documents.organization_id = $1 and documents.user_id = $2 and documents.is_active = true and documents.archived = $3
         and ($4::text is null or lower(documents.language) = $4)
         and ($5::text is null or documents.title ilike '%' || $5 || '%' or documents.current_content ilike '%' || $5 || '%')`;
      const filterParams = [this.#authorized.organizationId, this.#authorized.userId, archived, language, search];
      const { rows } = await tx.query<CloudWorkspaceDocumentLibraryRow>(
        `select documents.id, documents.session_id, documents.title, documents.language, left(documents.current_content, 500) as current_content, documents.version_count, documents.is_active, documents.archived, documents.created_at, documents.updated_at, sessions.name as session_name, left(documents.current_content, 500) as preview
         from sonik_agent_ui.agent_workspace_documents documents
         left join sonik_agent_ui.agent_workspace_sessions sessions
           on sessions.organization_id = documents.organization_id and sessions.user_id = documents.user_id and sessions.id = documents.session_id
         where ${filterSql}
         order by ${orderBy}
         limit $6 offset $7`,
        [...filterParams, limit, offset],
      );
      const [{ total = 0 } = { total: 0 }] = (await tx.query<{ total: number }>(
        `select count(*)::int as total
         from sonik_agent_ui.agent_workspace_documents documents
         where ${filterSql}`,
        filterParams,
      )).rows;
      const languageRows = (await tx.query<CloudWorkspaceDocumentLanguageCountRow>(
        `select documents.language, count(*)::int as count
         from sonik_agent_ui.agent_workspace_documents documents
         where ${filterSql}
         group by documents.language`,
        filterParams,
      )).rows;
      const [{ session_count = 0 } = { session_count: 0 }] = (await tx.query<{ session_count: number }>(
        `select count(distinct documents.session_id)::int as session_count
         from sonik_agent_ui.agent_workspace_documents documents
         where ${filterSql}`,
        filterParams,
      )).rows;
      const languages: Record<string, number> = {};
      for (const row of languageRows) languages[row.language || "text"] = Number(row.count ?? 0);
      return {
        documents: rows.map((row) => ({ ...mapCloudDocumentRow(row), session_name: row.session_name ?? null, preview: row.preview ?? row.current_content.slice(0, 500) })),
        total: Number(total ?? 0),
        languages,
        session_count: Number(session_count ?? 0),
      };
    });
  }

  updateDocument(id: string, input: { content?: string; title?: string; language?: string; source?: WorkspaceDocumentVersionSource; summary?: string | null }): Promise<WorkspaceDocumentRecord | null> {
    return this.#withContext(async (tx) => {
      const existing = await this.#selectDocumentForUpdate(tx, id);
      if (!existing) return null;
      const contentChanged = input.content !== undefined && input.content !== existing.current_content;
      const titleChanged = input.title !== undefined && input.title !== existing.title;
      const languageChanged = input.language !== undefined && input.language !== existing.language;
      const shouldVersion = contentChanged || titleChanged || languageChanged;
      if (!shouldVersion) return existing;
      const { rows } = await tx.query<CloudWorkspaceDocumentRow>(
        `update sonik_agent_ui.agent_workspace_documents
         set title = $4, language = $5, current_content = $6, version_count = version_count + 1, updated_at = now()
         where organization_id = $1 and user_id = $2 and id = $3
         returning id, session_id, title, language, current_content, version_count, is_active, archived, created_at, updated_at`,
        [
          this.#authorized.organizationId,
          this.#authorized.userId,
          id,
          input.title ?? existing.title,
          input.language ?? existing.language,
          input.content ?? existing.current_content,
        ],
      );
      const updated = rows[0] ? mapCloudDocumentRow(rows[0]) : null;
      if (!updated) return null;
      await this.#insertDocumentVersion(tx, updated, input.source ?? "user", input.summary ?? "Updated document");
      if (updated.session_id) await this.#updateSessionActivePointers(tx, updated.session_id, { activeDocumentId: updated.id, mode: "document" });
      return updated;
    });
  }

  patchDocument(id: string, input: { content?: string; title?: string; language?: string; session_id?: string | null }): Promise<WorkspaceDocumentRecord | null> {
    return this.#withContext(async (tx) => {
      const existing = await this.#selectDocumentForUpdate(tx, id);
      if (!existing) {
        const session = await this.#ensureSession(tx, input.session_id);
        const content = input.content ?? "";
        const document = await this.#insertDocument(tx, {
          id,
          sessionId: session.id,
          title: input.title?.trim() || "Untitled",
          language: normalizeLanguage(input.language, content),
          content,
        });
        await this.#insertDocumentVersion(tx, document, "user", "Synced missing active editor snapshot");
        await this.#updateSessionActivePointers(tx, session.id, { activeDocumentId: document.id, mode: "document" });
        return document;
      }

      const contentChanged = input.content !== undefined && input.content !== existing.current_content;
      const titleChanged = input.title !== undefined && input.title !== existing.title;
      const languageChanged = input.language !== undefined && input.language !== existing.language;
      const nextSessionId = input.session_id === "" ? null : input.session_id;
      const sessionChanged = nextSessionId !== undefined && nextSessionId !== existing.session_id;
      if (nextSessionId) await this.#ensureSession(tx, nextSessionId);
      const shouldVersion = contentChanged || titleChanged || languageChanged || sessionChanged;
      if (!shouldVersion) return existing;
      const { rows } = await tx.query<CloudWorkspaceDocumentRow>(
        `update sonik_agent_ui.agent_workspace_documents
         set session_id = $4, title = $5, language = $6, current_content = $7, version_count = version_count + 1, updated_at = now()
         where organization_id = $1 and user_id = $2 and id = $3
         returning id, session_id, title, language, current_content, version_count, is_active, archived, created_at, updated_at`,
        [
          this.#authorized.organizationId,
          this.#authorized.userId,
          id,
          sessionChanged ? nextSessionId : existing.session_id,
          input.title ?? existing.title,
          input.language ?? existing.language,
          input.content ?? existing.current_content,
        ],
      );
      const updated = rows[0] ? mapCloudDocumentRow(rows[0]) : null;
      if (!updated) return null;
      await this.#insertDocumentVersion(tx, updated, "user", "Patched document");
      if (sessionChanged && existing.session_id && existing.session_id !== updated.session_id) await this.#clearSessionActiveDocumentPointer(tx, existing.session_id, id);
      if (updated.session_id) await this.#updateSessionActivePointers(tx, updated.session_id, { activeDocumentId: updated.id, mode: "document" });
      return updated;
    });
  }

  archiveDocument(id: string, archived = true): Promise<WorkspaceDocumentRecord | null> {
    return this.#withContext(async (tx) => {
      const { rows } = await tx.query<CloudWorkspaceDocumentRow>(
        `update sonik_agent_ui.agent_workspace_documents
         set archived = $4, updated_at = now()
         where organization_id = $1 and user_id = $2 and id = $3
         returning id, session_id, title, language, current_content, version_count, is_active, archived, created_at, updated_at`,
        [this.#authorized.organizationId, this.#authorized.userId, id, archived],
      );
      return rows[0] ? mapCloudDocumentRow(rows[0]) : null;
    });
  }

  deleteDocument(id: string): Promise<boolean> {
    return this.#withContext(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `delete from sonik_agent_ui.agent_workspace_documents
         where organization_id = $1 and user_id = $2 and id = $3
         returning id`,
        [this.#authorized.organizationId, this.#authorized.userId, id],
      );
      return rows.length > 0;
    });
  }

  listDocumentVersions(documentId: string): Promise<WorkspaceDocumentVersionRecord[]> {
    return this.#withContext(async (tx) => {
      const { rows } = await tx.query<CloudWorkspaceDocumentVersionRow>(
        `select id, document_id, version_number, content, summary, source, created_at
         from sonik_agent_ui.agent_workspace_document_versions
         where organization_id = $1 and user_id = $2 and document_id = $3
         order by version_number desc`,
        [this.#authorized.organizationId, this.#authorized.userId, documentId],
      );
      return rows.map(mapCloudDocumentVersionRow);
    });
  }

  getDocumentVersion(documentId: string, versionNumber: number): Promise<WorkspaceDocumentVersionRecord | null> {
    return this.#withContext(async (tx) => {
      const { rows } = await tx.query<CloudWorkspaceDocumentVersionRow>(
        `select id, document_id, version_number, content, summary, source, created_at
         from sonik_agent_ui.agent_workspace_document_versions
         where organization_id = $1 and user_id = $2 and document_id = $3 and version_number = $4`,
        [this.#authorized.organizationId, this.#authorized.userId, documentId, versionNumber],
      );
      return rows[0] ? mapCloudDocumentVersionRow(rows[0]) : null;
    });
  }

  restoreDocumentVersion(documentId: string, versionNumber: number): Promise<WorkspaceDocumentRecord | null> {
    return this.#withContext(async (tx) => {
      const version = await this.#selectDocumentVersion(tx, documentId, versionNumber);
      if (!version) return null;
      const existing = await this.#selectDocumentForUpdate(tx, documentId);
      if (!existing) return null;
      const { rows } = await tx.query<CloudWorkspaceDocumentRow>(
        `update sonik_agent_ui.agent_workspace_documents
         set current_content = $4, version_count = version_count + 1, updated_at = now()
         where organization_id = $1 and user_id = $2 and id = $3
         returning id, session_id, title, language, current_content, version_count, is_active, archived, created_at, updated_at`,
        [this.#authorized.organizationId, this.#authorized.userId, documentId, version.content],
      );
      const restored = rows[0] ? mapCloudDocumentRow(rows[0]) : null;
      if (!restored) return null;
      await this.#insertDocumentVersion(tx, restored, "user", `Restored version ${versionNumber}`);
      if (restored.session_id) await this.#updateSessionActivePointers(tx, restored.session_id, { activeDocumentId: restored.id, mode: "document" });
      return restored;
    });
  }

  syncActiveDocumentSnapshot(snapshot: WorkspaceDocumentRecord): Promise<WorkspaceDocumentRecord> {
    return this.#withContext(async (tx) => {
      const existing = await this.#selectDocumentForUpdate(tx, snapshot.id);
      if (!existing) {
        const session = await this.#ensureSession(tx, snapshot.session_id);
        const document = await this.#insertDocument(tx, {
          id: snapshot.id,
          sessionId: session.id,
          title: snapshot.title?.trim() || "Untitled",
          language: normalizeLanguage(snapshot.language, snapshot.current_content),
          content: snapshot.current_content ?? "",
        });
        await this.#insertDocumentVersion(tx, document, "user", "Synced active editor snapshot");
        await this.#updateSessionActivePointers(tx, session.id, { activeDocumentId: document.id, mode: "document" });
        return document;
      }
      if (existing.current_content !== snapshot.current_content || existing.title !== snapshot.title || existing.language !== snapshot.language) {
        const { rows } = await tx.query<CloudWorkspaceDocumentRow>(
          `update sonik_agent_ui.agent_workspace_documents
           set title = $4, language = $5, current_content = $6, version_count = version_count + 1, updated_at = now()
           where organization_id = $1 and user_id = $2 and id = $3
           returning id, session_id, title, language, current_content, version_count, is_active, archived, created_at, updated_at`,
          [this.#authorized.organizationId, this.#authorized.userId, snapshot.id, snapshot.title, snapshot.language, snapshot.current_content],
        );
        const updated = rows[0] ? mapCloudDocumentRow(rows[0]) : existing;
        await this.#insertDocumentVersion(tx, updated, "user", "Synced active editor snapshot before agent turn");
        if (updated.session_id) await this.#updateSessionActivePointers(tx, updated.session_id, { activeDocumentId: updated.id, mode: "document" });
        return updated;
      }
      return existing;
    });
  }

  createArtifact<TContent = unknown>(input: { session_id?: string | null; id?: string; kind: WorkspaceArtifactKind; title: string; content: TContent; source?: WorkspaceDocumentVersionSource; summary?: string | null }): Promise<WorkspaceArtifactRecord<TContent>> {
    return this.#withContext(async (tx) => {
      const session = await this.#ensureSession(tx, input.session_id);
      const id = input.id?.trim() || this.#nextId("workspace-artifact");
      const { rows } = await tx.query<CloudWorkspaceArtifactRow<TContent>>(
        `insert into sonik_agent_ui.agent_workspace_artifacts
          (organization_id, user_id, id, session_id, kind, title, content)
         values ($1, $2, $3, $4, $5, $6, $7::jsonb)
         returning id, session_id, kind, title, content, version, created_at, updated_at`,
        [this.#authorized.organizationId, this.#authorized.userId, id, session.id, input.kind, input.title, JSON.stringify(input.content)],
      );
      const artifact = rows[0] ? mapCloudArtifactRow<TContent>(rows[0]) : null;
      if (!artifact) throw new CloudWorkspacePersistenceError("missing-request-context", "Cloud artifact insert returned no row.");
      await this.#insertArtifactVersion(tx, artifact, input.source ?? "ai", input.summary ?? "Initial artifact version");
      await this.#updateSessionActivePointers(tx, session.id, { activeArtifactId: artifact.id, mode: artifact.kind === "document" ? "document" : "artifact" });
      return artifact;
    });
  }

  getArtifact<TContent = unknown>(id: string): Promise<WorkspaceArtifactRecord<TContent> | null> {
    return this.#withContext((tx) => this.#selectArtifact<TContent>(tx, id));
  }

  updateArtifact<TContent = unknown>(id: string, input: { title?: string; content?: TContent; source?: WorkspaceDocumentVersionSource; summary?: string | null }): Promise<WorkspaceArtifactRecord<TContent> | null> {
    return this.#withContext(async (tx) => {
      const existing = await this.#selectArtifactForUpdate<TContent>(tx, id);
      if (!existing) return null;
      const contentChanged = input.content !== undefined && JSON.stringify(input.content) !== JSON.stringify(existing.content);
      const titleChanged = input.title !== undefined && input.title !== existing.title;
      const shouldVersion = contentChanged || titleChanged;
      if (!shouldVersion) return existing;
      const { rows } = await tx.query<CloudWorkspaceArtifactRow<TContent>>(
        `update sonik_agent_ui.agent_workspace_artifacts
         set title = $4, content = $5::jsonb, version = version + 1, updated_at = now()
         where organization_id = $1 and user_id = $2 and id = $3
         returning id, session_id, kind, title, content, version, created_at, updated_at`,
        [
          this.#authorized.organizationId,
          this.#authorized.userId,
          id,
          input.title ?? existing.title,
          JSON.stringify(input.content === undefined ? existing.content : input.content),
        ],
      );
      const updated = rows[0] ? mapCloudArtifactRow<TContent>(rows[0]) : null;
      if (!updated) return null;
      await this.#insertArtifactVersion(tx, updated, input.source ?? "ai", input.summary ?? "Updated artifact");
      if (updated.session_id) await this.#updateSessionActivePointers(tx, updated.session_id, { activeArtifactId: updated.id, mode: updated.kind === "document" ? "document" : "artifact" });
      return updated;
    });
  }

  listArtifactVersions<TContent = unknown>(artifactId: string): Promise<WorkspaceArtifactVersionRecord<TContent>[]> {
    return this.#withContext(async (tx) => {
      const { rows } = await tx.query<CloudWorkspaceArtifactVersionRow<TContent>>(
        `select id, artifact_id, version_number, content, summary, source, created_at
         from sonik_agent_ui.agent_workspace_artifact_versions
         where organization_id = $1 and user_id = $2 and artifact_id = $3
         order by version_number desc`,
        [this.#authorized.organizationId, this.#authorized.userId, artifactId],
      );
      return rows.map(mapCloudArtifactVersionRow<TContent>);
    });
  }
  recordToolCall<TInput = unknown, TOutput = unknown>(): Promise<WorkspaceToolCallRecord<TInput, TOutput>> {
    return unsupportedCloudWorkspaceOperation("recordToolCall");
  }
  listToolCalls(): Promise<WorkspaceToolCallRecord[]> {
    return unsupportedCloudWorkspaceOperation("listToolCalls");
  }
  recordLayoutSnapshot<TLayout = unknown>(input: { session_id?: string | null; active_pane_id?: string | null; active_artifact_id?: string | null; layout: TLayout; source?: WorkspaceLayoutSnapshotRecord<TLayout>["source"] }): Promise<WorkspaceLayoutSnapshotRecord<TLayout>> {
    return this.#withContext(async (tx) => {
      const session = await this.#ensureSession(tx, input.session_id);
      if (input.active_artifact_id) {
        const artifact = await this.#selectArtifact(tx, input.active_artifact_id);
        if (!artifact) throw new CloudWorkspacePersistenceError("missing-request-context", `Cannot record layout snapshot for missing artifact ${input.active_artifact_id}.`);
      }
      const { rows } = await tx.query<CloudWorkspaceLayoutSnapshotRow<TLayout>>(
        `insert into sonik_agent_ui.agent_workspace_layout_snapshots
          (organization_id, user_id, id, session_id, active_pane_id, active_artifact_id, layout, source)
         values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
         returning id, session_id, active_pane_id, active_artifact_id, layout, source, created_at`,
        [this.#authorized.organizationId, this.#authorized.userId, this.#nextId("workspace-layout"), session.id, input.active_pane_id ?? null, input.active_artifact_id ?? null, JSON.stringify(input.layout), input.source ?? "user"],
      );
      if (input.active_artifact_id) await this.#updateSessionActivePointers(tx, session.id, { activeArtifactId: input.active_artifact_id });
      const row = rows[0];
      if (!row) throw new CloudWorkspacePersistenceError("missing-request-context", "Cloud layout snapshot insert returned no row.");
      return mapCloudLayoutSnapshotRow<TLayout>(row);
    });
  }
  listLayoutSnapshots<TLayout = unknown>(sessionId: string): Promise<WorkspaceLayoutSnapshotRecord<TLayout>[]> {
    return this.#withContext(async (tx) => {
      const { rows } = await tx.query<CloudWorkspaceLayoutSnapshotRow<TLayout>>(
        `select id, session_id, active_pane_id, active_artifact_id, layout, source, created_at
         from sonik_agent_ui.agent_workspace_layout_snapshots
         where organization_id = $1 and user_id = $2 and session_id = $3
         order by created_at desc`,
        [this.#authorized.organizationId, this.#authorized.userId, sessionId],
      );
      return rows.map(mapCloudLayoutSnapshotRow<TLayout>);
    });
  }
  recordTelemetryEvent<TPayload = unknown>(): Promise<WorkspaceTelemetryEventRecord<TPayload>> {
    return unsupportedCloudWorkspaceOperation("recordTelemetryEvent");
  }
  listTelemetryEvents(): Promise<WorkspaceTelemetryEventRecord[]> {
    return unsupportedCloudWorkspaceOperation("listTelemetryEvents");
  }

  async #withContext<T>(fn: (tx: WorkspaceSqlTransaction) => Promise<T>): Promise<T> {
    this.#assertAuthorized();
    return this.#authorized.db.transaction(async (tx) => {
      await tx.query("select sonik_agent_ui.set_request_context($1, $2)", [
        this.#authorized.organizationId,
        this.#authorized.userId,
      ]);
      return fn(tx);
    });
  }

  async #ensureSession(tx: WorkspaceSqlTransaction, sessionId?: string | null): Promise<WorkspaceSessionRecord> {
    if (sessionId) {
      const existing = await this.#selectSession(tx, sessionId);
      if (existing) return existing;
      return this.#insertSession(tx, { id: sessionId, name: "workspace document session", mode: "document" });
    }
    return this.#insertSession(tx, { id: this.#nextId("workspace-session"), name: DEFAULT_WORKSPACE_SESSION_NAME, mode: "chat" });
  }

  async #insertSession(tx: WorkspaceSqlTransaction, input: { id: string; name: string; mode: WorkspaceMode; folder?: string | null }): Promise<WorkspaceSessionRecord> {
    const { rows } = await tx.query<CloudWorkspaceSessionRow>(
      `insert into sonik_agent_ui.agent_workspace_sessions
        (organization_id, user_id, id, host_session_id, name, mode, folder)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id, name, mode, archived, is_important, folder, message_count, active_document_id, active_artifact_id, created_at, updated_at, last_accessed, last_message_at`,
      [
        this.#authorized.organizationId,
        this.#authorized.userId,
        input.id,
        this.#authorized.hostSession.sessionId ?? null,
        normalizeWorkspaceSessionName(input.name),
        input.mode,
        input.folder ?? null,
      ],
    );
    const row = rows[0];
    if (!row) throw new CloudWorkspacePersistenceError("missing-request-context", "Cloud session insert returned no row.");
    return mapCloudSessionRow(row);
  }

  async #selectSession(tx: WorkspaceSqlTransaction, id: string): Promise<WorkspaceSessionRecord | null> {
    const { rows } = await tx.query<CloudWorkspaceSessionRow>(
      `select id, name, mode, archived, is_important, folder, message_count, active_document_id, active_artifact_id, created_at, updated_at, last_accessed, last_message_at
       from sonik_agent_ui.agent_workspace_sessions
       where organization_id = $1 and user_id = $2 and id = $3`,
      [this.#authorized.organizationId, this.#authorized.userId, id],
    );
    return rows[0] ? mapCloudSessionRow(rows[0]) : null;
  }

  async #updateSessionActivePointers(tx: WorkspaceSqlTransaction, sessionId: string, input: { activeDocumentId?: string | null; activeArtifactId?: string | null; mode?: WorkspaceMode }): Promise<void> {
    await tx.query(
      `update sonik_agent_ui.agent_workspace_sessions
       set active_document_id = case when $4 then $5 else active_document_id end, active_artifact_id = case when $6 then $7 else active_artifact_id end, mode = coalesce($8, mode), updated_at = now(), last_accessed = now()
       where organization_id = $1 and user_id = $2 and id = $3`,
      [
        this.#authorized.organizationId,
        this.#authorized.userId,
        sessionId,
        input.activeDocumentId !== undefined,
        input.activeDocumentId ?? null,
        input.activeArtifactId !== undefined,
        input.activeArtifactId ?? null,
        input.mode ?? null,
      ],
    );
  }

  async #clearSessionActiveDocumentPointer(tx: WorkspaceSqlTransaction, sessionId: string, documentId: string): Promise<void> {
    await tx.query(
      `update sonik_agent_ui.agent_workspace_sessions
       set active_document_id = null, updated_at = now(), last_accessed = now()
       where organization_id = $1 and user_id = $2 and id = $3 and active_document_id = $4`,
      [this.#authorized.organizationId, this.#authorized.userId, sessionId, documentId],
    );
  }

  async #insertDocument(tx: WorkspaceSqlTransaction, input: { id: string; sessionId: string | null; title: string; language: string; content: string }): Promise<WorkspaceDocumentRecord> {
    const { rows } = await tx.query<CloudWorkspaceDocumentRow>(
      `insert into sonik_agent_ui.agent_workspace_documents
        (organization_id, user_id, id, session_id, title, language, current_content)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id, session_id, title, language, current_content, version_count, is_active, archived, created_at, updated_at`,
      [this.#authorized.organizationId, this.#authorized.userId, input.id, input.sessionId, input.title, input.language, input.content],
    );
    const row = rows[0];
    if (!row) throw new CloudWorkspacePersistenceError("missing-request-context", "Cloud document insert returned no row.");
    return mapCloudDocumentRow(row);
  }

  async #selectDocument(tx: WorkspaceSqlTransaction, id: string): Promise<WorkspaceDocumentRecord | null> {
    const { rows } = await tx.query<CloudWorkspaceDocumentRow>(
      `select id, session_id, title, language, current_content, version_count, is_active, archived, created_at, updated_at
       from sonik_agent_ui.agent_workspace_documents
       where organization_id = $1 and user_id = $2 and id = $3`,
      [this.#authorized.organizationId, this.#authorized.userId, id],
    );
    return rows[0] ? mapCloudDocumentRow(rows[0]) : null;
  }

  async #selectDocumentForUpdate(tx: WorkspaceSqlTransaction, id: string): Promise<WorkspaceDocumentRecord | null> {
    const { rows } = await tx.query<CloudWorkspaceDocumentRow>(
      `select id, session_id, title, language, current_content, version_count, is_active, archived, created_at, updated_at
       from sonik_agent_ui.agent_workspace_documents
       where organization_id = $1 and user_id = $2 and id = $3
       for update`,
      [this.#authorized.organizationId, this.#authorized.userId, id],
    );
    return rows[0] ? mapCloudDocumentRow(rows[0]) : null;
  }

  async #insertDocumentVersion(tx: WorkspaceSqlTransaction, document: WorkspaceDocumentRecord, source: WorkspaceDocumentVersionSource, summary: string | null): Promise<WorkspaceDocumentVersionRecord> {
    const { rows } = await tx.query<CloudWorkspaceDocumentVersionRow>(
      `insert into sonik_agent_ui.agent_workspace_document_versions
        (organization_id, user_id, id, document_id, version_number, content, summary, source)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning id, document_id, version_number, content, summary, source, created_at`,
      [this.#authorized.organizationId, this.#authorized.userId, this.#nextId("workspace-doc-version"), document.id, document.version_count, document.current_content, summary, source],
    );
    const row = rows[0];
    if (!row) throw new CloudWorkspacePersistenceError("missing-request-context", "Cloud document version insert returned no row.");
    return mapCloudDocumentVersionRow(row);
  }

  async #selectDocumentVersion(tx: WorkspaceSqlTransaction, documentId: string, versionNumber: number): Promise<WorkspaceDocumentVersionRecord | null> {
    const { rows } = await tx.query<CloudWorkspaceDocumentVersionRow>(
      `select id, document_id, version_number, content, summary, source, created_at
       from sonik_agent_ui.agent_workspace_document_versions
       where organization_id = $1 and user_id = $2 and document_id = $3 and version_number = $4`,
      [this.#authorized.organizationId, this.#authorized.userId, documentId, versionNumber],
    );
    return rows[0] ? mapCloudDocumentVersionRow(rows[0]) : null;
  }

  async #selectArtifact<TContent = unknown>(tx: WorkspaceSqlTransaction, id: string): Promise<WorkspaceArtifactRecord<TContent> | null> {
    const { rows } = await tx.query<CloudWorkspaceArtifactRow<TContent>>(
      `select id, session_id, kind, title, content, version, created_at, updated_at
       from sonik_agent_ui.agent_workspace_artifacts
       where organization_id = $1 and user_id = $2 and id = $3`,
      [this.#authorized.organizationId, this.#authorized.userId, id],
    );
    return rows[0] ? mapCloudArtifactRow<TContent>(rows[0]) : null;
  }

  async #selectArtifactForUpdate<TContent = unknown>(tx: WorkspaceSqlTransaction, id: string): Promise<WorkspaceArtifactRecord<TContent> | null> {
    const { rows } = await tx.query<CloudWorkspaceArtifactRow<TContent>>(
      `select id, session_id, kind, title, content, version, created_at, updated_at
       from sonik_agent_ui.agent_workspace_artifacts
       where organization_id = $1 and user_id = $2 and id = $3
       for update`,
      [this.#authorized.organizationId, this.#authorized.userId, id],
    );
    return rows[0] ? mapCloudArtifactRow<TContent>(rows[0]) : null;
  }

  async #insertArtifactVersion<TContent>(tx: WorkspaceSqlTransaction, artifact: WorkspaceArtifactRecord<TContent>, source: WorkspaceDocumentVersionSource, summary: string | null): Promise<WorkspaceArtifactVersionRecord<TContent>> {
    const { rows } = await tx.query<CloudWorkspaceArtifactVersionRow<TContent>>(
      `insert into sonik_agent_ui.agent_workspace_artifact_versions
        (organization_id, user_id, id, artifact_id, version_number, content, summary, source)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
       returning id, artifact_id, version_number, content, summary, source, created_at`,
      [this.#authorized.organizationId, this.#authorized.userId, this.#nextId("workspace-artifact-version"), artifact.id, artifact.version, JSON.stringify(artifact.content), summary, source],
    );
    const row = rows[0];
    if (!row) throw new CloudWorkspacePersistenceError("missing-request-context", "Cloud artifact version insert returned no row.");
    return mapCloudArtifactVersionRow<TContent>(row);
  }

  #assertAuthorized(): void {
    if (!this.#authorized.organizationId?.trim() || !this.#authorized.userId?.trim()) {
      throw new CloudWorkspacePersistenceError(
        "missing-request-context",
        "Cloud workspace persistence requires trusted organizationId and userId.",
      );
    }
    if (!this.#authorized.commandPolicy.allowed) {
      throw new CloudWorkspacePersistenceError(
        "command-policy-denied",
        `Cloud workspace persistence denied by command policy ${this.#authorized.commandPolicy.commandId}: ${this.#authorized.commandPolicy.reasonCode}`,
      );
    }
  }

  #nextId(prefix: string): string {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
}

function unsupportedCloudWorkspaceOperation(method: string): Promise<never> {
  return Promise.reject(
    new CloudWorkspacePersistenceError(
      "unsupported-operation",
      `Cloud workspace persistence v0 supports sessions, messages, documents, artifacts, and layout snapshots; ${method} is scheduled for a later slice.`,
    ),
  );
}

function mapCloudSessionRow(row: CloudWorkspaceSessionRow): WorkspaceSessionRecord {
  return {
    id: row.id,
    name: row.name,
    mode: row.mode,
    archived: Boolean(row.archived),
    is_important: Boolean(row.is_important),
    folder: row.folder ?? null,
    message_count: Number(row.message_count ?? 0),
    active_document_id: row.active_document_id ?? null,
    active_artifact_id: row.active_artifact_id ?? null,
    created_at: toIsoTimestamp(row.created_at),
    updated_at: toIsoTimestamp(row.updated_at),
    last_accessed: toIsoTimestamp(row.last_accessed),
    last_message_at: row.last_message_at ? toIsoTimestamp(row.last_message_at) : null,
  };
}

function mapCloudMessageRow<TParts = unknown>(row: CloudWorkspaceMessageRow<TParts>): WorkspaceMessageRecord<TParts> {
  return {
    id: row.id,
    session_id: row.session_id,
    role: row.role,
    content: row.content ?? "",
    parts: row.parts ?? null,
    created_at: toIsoTimestamp(row.created_at),
  };
}

function mapCloudDocumentRow(row: CloudWorkspaceDocumentRow): WorkspaceDocumentRecord {
  return {
    id: row.id,
    session_id: row.session_id ?? null,
    title: row.title,
    language: row.language,
    current_content: row.current_content ?? "",
    version_count: Number(row.version_count ?? 1),
    is_active: Boolean(row.is_active),
    archived: Boolean(row.archived),
    created_at: toIsoTimestamp(row.created_at),
    updated_at: toIsoTimestamp(row.updated_at),
  };
}

function mapCloudDocumentVersionRow(row: CloudWorkspaceDocumentVersionRow): WorkspaceDocumentVersionRecord {
  return {
    id: row.id,
    document_id: row.document_id,
    version_number: Number(row.version_number),
    content: row.content ?? "",
    summary: row.summary ?? null,
    source: row.source,
    created_at: toIsoTimestamp(row.created_at),
  };
}

function mapCloudArtifactRow<TContent = unknown>(row: CloudWorkspaceArtifactRow<TContent>): WorkspaceArtifactRecord<TContent> {
  return {
    id: row.id,
    session_id: row.session_id ?? null,
    kind: row.kind,
    title: row.title,
    content: row.content,
    version: Number(row.version ?? 1),
    created_at: toIsoTimestamp(row.created_at),
    updated_at: toIsoTimestamp(row.updated_at),
  };
}

function mapCloudArtifactVersionRow<TContent = unknown>(row: CloudWorkspaceArtifactVersionRow<TContent>): WorkspaceArtifactVersionRecord<TContent> {
  return {
    id: row.id,
    artifact_id: row.artifact_id,
    version_number: Number(row.version_number),
    content: row.content,
    summary: row.summary ?? null,
    source: row.source,
    created_at: toIsoTimestamp(row.created_at),
  };
}

function mapCloudLayoutSnapshotRow<TLayout = unknown>(row: CloudWorkspaceLayoutSnapshotRow<TLayout>): WorkspaceLayoutSnapshotRecord<TLayout> {
  return {
    id: row.id,
    session_id: row.session_id,
    active_pane_id: row.active_pane_id ?? null,
    active_artifact_id: row.active_artifact_id ?? null,
    layout: row.layout,
    source: row.source,
    created_at: toIsoTimestamp(row.created_at),
  };
}

function resolveDocumentLibraryOrderBy(sort?: string | null): string {
  if (sort === "oldest") return "documents.created_at asc";
  if (sort === "alpha") return "documents.title asc";
  if (sort === "edits") return "documents.version_count desc, documents.updated_at desc";
  return "documents.updated_at desc";
}

function toIsoTimestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export interface InMemoryWorkspacePersistenceOptions {
  maxTelemetryEvents?: number;
  maxTelemetryPayloadChars?: number;
}

export function createInMemoryWorkspacePersistence(options: InMemoryWorkspacePersistenceOptions = {}): WorkspacePersistenceAdapter {
  return new InMemoryWorkspacePersistence(options);
}

class InMemoryWorkspacePersistence implements WorkspacePersistenceAdapter {
  #maxTelemetryEvents: number;
  #maxTelemetryPayloadChars: number;
  #sessions = new Map<string, WorkspaceSessionRecord>();
  #documents = new Map<string, WorkspaceDocumentRecord>();
  #documentVersions = new Map<string, WorkspaceDocumentVersionRecord[]>();
  #artifacts = new Map<string, WorkspaceArtifactRecord>();
  #artifactVersions = new Map<string, WorkspaceArtifactVersionRecord[]>();
  #messages = new Map<string, WorkspaceMessageRecord[]>();
  #toolCalls = new Map<string, WorkspaceToolCallRecord>();
  #layoutSnapshots = new Map<string, WorkspaceLayoutSnapshotRecord[]>();
  #telemetryEvents: WorkspaceTelemetryEventRecord[] = [];
  #sequence = 0;

  constructor(options: InMemoryWorkspacePersistenceOptions = {}) {
    this.#maxTelemetryEvents = Math.max(1, options.maxTelemetryEvents ?? 1_000);
    this.#maxTelemetryPayloadChars = Math.max(256, options.maxTelemetryPayloadChars ?? 8_000);
  }

  createSession(input: { id?: string; name?: string | null; mode?: WorkspaceMode; folder?: string | null } = {}): WorkspaceSessionRecord {
    const timestamp = this.#now();
    const id = input.id?.trim() || this.#nextId("workspace-session");
    const existing = this.#sessions.get(id);
    if (existing) return clone(existing);
    const session: WorkspaceSessionRecord = {
      id,
      name: normalizeWorkspaceSessionName(input.name),
      mode: input.mode ?? "chat",
      archived: false,
      is_important: false,
      folder: input.folder ?? null,
      message_count: 0,
      active_document_id: null,
      active_artifact_id: null,
      created_at: timestamp,
      updated_at: timestamp,
      last_accessed: timestamp,
      last_message_at: null,
    };
    this.#sessions.set(id, session);
    return clone(session);
  }

  ensureSession(sessionId?: string | null): WorkspaceSessionRecord {
    if (sessionId) {
      const existing = this.#sessions.get(sessionId);
      if (existing) return clone(existing);
      return this.createSession({ id: sessionId, name: "workspace document session", mode: "document" });
    }
    return this.createSession({ name: DEFAULT_WORKSPACE_SESSION_NAME, mode: "chat" });
  }

  getSession(id: string): WorkspaceSessionRecord | null {
    const session = this.#sessions.get(id);
    return session ? clone(session) : null;
  }

  listSessions({ archived = false }: { archived?: boolean } = {}): WorkspaceSessionRecord[] {
    return [...this.#sessions.values()]
      .filter((session) => session.archived === archived)
      .sort((a, b) => b.last_accessed.localeCompare(a.last_accessed))
      .map(clone);
  }

  patchSession(id: string, input: Partial<Pick<WorkspaceSessionRecord, "name" | "mode" | "folder" | "active_document_id" | "active_artifact_id" | "is_important">>): WorkspaceSessionRecord | null {
    const existing = this.#sessions.get(id);
    if (!existing) return null;
    const timestamp = this.#now();
    const updated = { ...existing, ...input, updated_at: timestamp, last_accessed: timestamp } satisfies WorkspaceSessionRecord;
    this.#sessions.set(id, updated);
    return clone(updated);
  }

  archiveSession(id: string, archived = true): WorkspaceSessionRecord | null {
    const existing = this.#sessions.get(id);
    if (!existing) return null;
    const timestamp = this.#now();
    const updated = { ...existing, archived, updated_at: timestamp, last_accessed: timestamp } satisfies WorkspaceSessionRecord;
    this.#sessions.set(id, updated);
    return clone(updated);
  }

  deleteSession(id: string): boolean {
    const existing = this.#sessions.get(id);
    if (!existing) return false;

    for (const document of [...this.#documents.values()]) {
      if (document.session_id === id) this.deleteDocument(document.id);
    }

    for (const artifact of [...this.#artifacts.values()]) {
      if (artifact.session_id === id) {
        this.#artifactVersions.delete(artifact.id);
        this.#artifacts.delete(artifact.id);
      }
    }

    this.#messages.delete(id);
    this.#layoutSnapshots.delete(id);
    for (const [toolCallId, toolCall] of [...this.#toolCalls.entries()]) {
      if (toolCall.session_id === id) this.#toolCalls.delete(toolCallId);
    }
    this.#telemetryEvents = this.#telemetryEvents.filter((event) => event.session_id !== id);
    return this.#sessions.delete(id);
  }

  createDocument(input: { session_id?: string | null; title?: string | null; content?: string | null; language?: string | null; source?: WorkspaceDocumentVersionSource; summary?: string | null }): WorkspaceDocumentRecord {
    const session = this.ensureSession(input.session_id);
    const timestamp = this.#now();
    const content = input.content ?? "";
    const document: WorkspaceDocumentRecord = {
      id: this.#nextId("workspace-doc"),
      session_id: session.id,
      title: input.title?.trim() || "Untitled",
      language: normalizeLanguage(input.language, content),
      current_content: content,
      version_count: 1,
      is_active: true,
      archived: false,
      created_at: timestamp,
      updated_at: timestamp,
    };
    this.#documents.set(document.id, document);
    this.#appendDocumentVersion(document, input.source ?? "user", input.summary ?? "Initial version");
    this.patchSession(session.id, { active_document_id: document.id, mode: "document" });
    return clone(document);
  }

  getDocument(id: string): WorkspaceDocumentRecord | null {
    const document = this.#documents.get(id);
    return document ? clone(document) : null;
  }

  listDocuments(sessionId: string): WorkspaceDocumentRecord[] {
    return [...this.#documents.values()]
      .filter((document) => document.session_id === sessionId && document.is_active && !document.archived)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map(clone);
  }

  listDocumentLibrary(input: { search?: string | null; language?: string | null; sort?: string | null; offset?: number; limit?: number; archived?: boolean } = {}): DocumentLibraryResult {
    const searchTerms = (input.search ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
    const language = input.language?.trim().toLowerCase();
    const archived = Boolean(input.archived);
    const offset = Math.max(0, input.offset ?? 0);
    const limit = Math.min(50, Math.max(1, input.limit ?? 20));
    let rows = [...this.#documents.values()].filter((document) => document.is_active && document.archived === archived);
    if (searchTerms.length > 0) {
      rows = rows.filter((document) => {
        const haystack = `${document.title}\n${document.current_content}`.toLowerCase();
        return searchTerms.every((term) => haystack.includes(term));
      });
    }
    if (language) rows = rows.filter((document) => (document.language || "text").toLowerCase() === language);
    const languages: Record<string, number> = {};
    for (const document of rows) {
      const key = document.language || "text";
      languages[key] = (languages[key] ?? 0) + 1;
    }
    const sessionIds = new Set(rows.map((document) => document.session_id).filter(Boolean));
    const sort = input.sort ?? "recent";
    rows.sort((a, b) => {
      if (sort === "oldest") return a.created_at.localeCompare(b.created_at);
      if (sort === "alpha") return a.title.localeCompare(b.title);
      if (sort === "edits") return b.version_count - a.version_count;
      return b.updated_at.localeCompare(a.updated_at);
    });
    return {
      documents: rows.slice(offset, offset + limit).map((document) => ({
        ...clone(document),
        session_name: document.session_id ? (this.#sessions.get(document.session_id)?.name ?? null) : null,
        preview: document.current_content.slice(0, 500),
      })),
      total: rows.length,
      languages,
      session_count: sessionIds.size,
    };
  }

  updateDocument(id: string, input: { content?: string; title?: string; language?: string; source?: WorkspaceDocumentVersionSource; summary?: string | null }): WorkspaceDocumentRecord | null {
    const existing = this.#documents.get(id);
    if (!existing) return null;
    const contentChanged = input.content !== undefined && input.content !== existing.current_content;
    const titleChanged = input.title !== undefined && input.title !== existing.title;
    const languageChanged = input.language !== undefined && input.language !== existing.language;
    if (!contentChanged && !titleChanged && !languageChanged) return clone(existing);
    const updated: WorkspaceDocumentRecord = {
      ...existing,
      title: input.title ?? existing.title,
      language: input.language ?? existing.language,
      current_content: input.content ?? existing.current_content,
      version_count: contentChanged ? existing.version_count + 1 : existing.version_count,
      updated_at: this.#now(),
    };
    this.#documents.set(id, updated);
    if (contentChanged) this.#appendDocumentVersion(updated, input.source ?? "user", input.summary ?? "Updated document");
    if (updated.session_id) this.patchSession(updated.session_id, { active_document_id: updated.id, mode: "document" });
    return clone(updated);
  }

  patchDocument(id: string, input: { content?: string; title?: string; language?: string; session_id?: string | null }): WorkspaceDocumentRecord | null {
    const existing = this.#documents.get(id);
    if (!existing) {
      const session = this.ensureSession(input.session_id);
      const timestamp = this.#now();
      const content = input.content ?? "";
      const document: WorkspaceDocumentRecord = {
        id,
        session_id: session.id,
        title: input.title?.trim() || "Untitled",
        language: normalizeLanguage(input.language, content),
        current_content: content,
        version_count: 1,
        is_active: true,
        archived: false,
        created_at: timestamp,
        updated_at: timestamp,
      };
      this.#documents.set(id, document);
      this.#appendDocumentVersion(document, "user", "Synced missing active editor snapshot");
      this.patchSession(session.id, { active_document_id: id, mode: "document" });
      return clone(document);
    }
    const nextSessionId = input.session_id === "" ? null : input.session_id;
    const updated = this.updateDocument(id, { content: input.content, title: input.title, language: input.language, summary: "Patched document" });
    const current = updated ? this.#documents.get(id)! : existing;
    if (nextSessionId !== undefined && nextSessionId !== current.session_id) {
      if (nextSessionId) this.ensureSession(nextSessionId);
      const relinked = { ...current, session_id: nextSessionId, updated_at: this.#now() } satisfies WorkspaceDocumentRecord;
      this.#documents.set(id, relinked);
      if (nextSessionId) this.patchSession(nextSessionId, { active_document_id: id, mode: "document" });
      return clone(relinked);
    }
    return updated ?? clone(current);
  }

  archiveDocument(id: string, archived = true): WorkspaceDocumentRecord | null {
    const existing = this.#documents.get(id);
    if (!existing) return null;
    const updated = { ...existing, archived, updated_at: this.#now() } satisfies WorkspaceDocumentRecord;
    this.#documents.set(id, updated);
    return clone(updated);
  }

  deleteDocument(id: string): boolean {
    this.#documentVersions.delete(id);
    return this.#documents.delete(id);
  }

  listDocumentVersions(documentId: string): WorkspaceDocumentVersionRecord[] {
    return [...(this.#documentVersions.get(documentId) ?? [])]
      .sort((a, b) => b.version_number - a.version_number)
      .map(clone);
  }

  getDocumentVersion(documentId: string, versionNumber: number): WorkspaceDocumentVersionRecord | null {
    const version = (this.#documentVersions.get(documentId) ?? []).find((entry) => entry.version_number === versionNumber);
    return version ? clone(version) : null;
  }

  restoreDocumentVersion(documentId: string, versionNumber: number): WorkspaceDocumentRecord | null {
    const version = this.getDocumentVersion(documentId, versionNumber);
    if (!version) return null;
    return this.updateDocument(documentId, { content: version.content, source: "user", summary: `Restored version ${versionNumber}` });
  }

  syncActiveDocumentSnapshot(snapshot: WorkspaceDocumentRecord): WorkspaceDocumentRecord {
    const stored = this.#documents.get(snapshot.id);
    if (!stored) {
      const session = this.ensureSession(snapshot.session_id);
      const timestamp = this.#now();
      const synced: WorkspaceDocumentRecord = {
        ...snapshot,
        session_id: session.id,
        title: snapshot.title?.trim() || "Untitled",
        language: normalizeLanguage(snapshot.language, snapshot.current_content),
        current_content: snapshot.current_content ?? "",
        version_count: Math.max(1, Number(snapshot.version_count) || 1),
        is_active: true,
        archived: false,
        created_at: snapshot.created_at ?? timestamp,
        updated_at: snapshot.updated_at ?? timestamp,
      };
      this.#documents.set(synced.id, synced);
      this.#appendDocumentVersion(synced, "user", "Synced active editor snapshot");
      this.patchSession(session.id, { active_document_id: synced.id, mode: "document" });
      return clone(synced);
    }
    if (stored.current_content !== snapshot.current_content || stored.title !== snapshot.title || stored.language !== snapshot.language) {
      return this.updateDocument(snapshot.id, {
        title: snapshot.title,
        language: snapshot.language,
        content: snapshot.current_content,
        source: "user",
        summary: "Synced active editor snapshot before agent turn",
      }) ?? clone(snapshot);
    }
    return clone(stored);
  }

  createArtifact<TContent = unknown>(input: { session_id?: string | null; id?: string; kind: WorkspaceArtifactKind; title: string; content: TContent; source?: WorkspaceDocumentVersionSource; summary?: string | null }): WorkspaceArtifactRecord<TContent> {
    const session = this.ensureSession(input.session_id);
    const timestamp = this.#now();
    const artifact: WorkspaceArtifactRecord<TContent> = {
      id: input.id?.trim() || this.#nextId("workspace-artifact"),
      session_id: session.id,
      kind: input.kind,
      title: input.title,
      content: clone(input.content),
      version: 1,
      created_at: timestamp,
      updated_at: timestamp,
    };
    this.#artifacts.set(artifact.id, artifact as WorkspaceArtifactRecord);
    this.#appendArtifactVersion(artifact, input.source ?? "ai", input.summary ?? "Initial artifact version");
    this.patchSession(session.id, { active_artifact_id: artifact.id, mode: input.kind === "document" ? "document" : "artifact" });
    return clone(artifact);
  }

  getArtifact<TContent = unknown>(id: string): WorkspaceArtifactRecord<TContent> | null {
    const artifact = this.#artifacts.get(id);
    return artifact ? clone(artifact as WorkspaceArtifactRecord<TContent>) : null;
  }

  updateArtifact<TContent = unknown>(id: string, input: { title?: string; content?: TContent; source?: WorkspaceDocumentVersionSource; summary?: string | null }): WorkspaceArtifactRecord<TContent> | null {
    const existing = this.#artifacts.get(id);
    if (!existing) return null;
    const contentChanged = input.content !== undefined && JSON.stringify(input.content) !== JSON.stringify(existing.content);
    const titleChanged = input.title !== undefined && input.title !== existing.title;
    if (!contentChanged && !titleChanged) return clone(existing as WorkspaceArtifactRecord<TContent>);
    const updated = {
      ...existing,
      title: input.title ?? existing.title,
      content: input.content === undefined ? existing.content : clone(input.content),
      version: contentChanged ? existing.version + 1 : existing.version,
      updated_at: this.#now(),
    } satisfies WorkspaceArtifactRecord;
    this.#artifacts.set(id, updated);
    if (contentChanged) this.#appendArtifactVersion(updated, input.source ?? "ai", input.summary ?? "Updated artifact");
    if (updated.session_id) this.patchSession(updated.session_id, { active_artifact_id: updated.id, mode: updated.kind === "document" ? "document" : "artifact" });
    return clone(updated as WorkspaceArtifactRecord<TContent>);
  }

  listArtifactVersions<TContent = unknown>(artifactId: string): WorkspaceArtifactVersionRecord<TContent>[] {
    return [...(this.#artifactVersions.get(artifactId) ?? [])]
      .sort((a, b) => b.version_number - a.version_number)
      .map((version) => clone(version as WorkspaceArtifactVersionRecord<TContent>));
  }

  appendMessage<TParts = unknown>(input: { session_id?: string | null; id?: string; role: WorkspaceMessageRecord<TParts>["role"]; content?: string | null; parts?: TParts | null }): WorkspaceMessageRecord<TParts> {
    const session = this.ensureSession(input.session_id);
    const messages = this.#messages.get(session.id) ?? [];
    const id = input.id?.trim() || this.#nextId("workspace-message");
    const existing = messages.find((message) => message.id === id);
    if (existing) return clone(existing as WorkspaceMessageRecord<TParts>);

    const message: WorkspaceMessageRecord<TParts> = {
      id,
      session_id: session.id,
      role: input.role,
      content: input.content ?? "",
      parts: input.parts === undefined ? null : clone(input.parts),
      created_at: this.#now(),
    };
    this.#messages.set(session.id, [...messages, message as WorkspaceMessageRecord]);
    this.#sessions.set(session.id, { ...session, message_count: session.message_count + 1, last_message_at: message.created_at, last_accessed: message.created_at, updated_at: message.created_at });
    return clone(message);
  }

  listMessages<TParts = unknown>(sessionId: string): WorkspaceMessageRecord<TParts>[] {
    return [...(this.#messages.get(sessionId) ?? [])].map((message) => clone(message as WorkspaceMessageRecord<TParts>));
  }

  recordToolCall<TInput = unknown, TOutput = unknown>(input: Omit<WorkspaceToolCallRecord<TInput, TOutput>, "id" | "created_at" | "completed_at"> & { id?: string; created_at?: string; completed_at?: string | null }): WorkspaceToolCallRecord<TInput, TOutput> {
    const record: WorkspaceToolCallRecord<TInput, TOutput> = {
      ...input,
      id: input.id?.trim() || this.#nextId("workspace-tool-call"),
      input: input.input === undefined ? null : clone(input.input),
      output: input.output === undefined ? null : clone(input.output),
      created_at: input.created_at ?? this.#now(),
      completed_at: input.completed_at ?? (input.status === "pending" ? null : this.#now()),
    };
    this.#toolCalls.set(record.id, record as WorkspaceToolCallRecord);
    return clone(record);
  }

  listToolCalls(sessionId: string): WorkspaceToolCallRecord[] {
    return [...this.#toolCalls.values()]
      .filter((call) => call.session_id === sessionId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map(clone);
  }

  recordLayoutSnapshot<TLayout = unknown>(input: { session_id?: string | null; active_pane_id?: string | null; active_artifact_id?: string | null; layout: TLayout; source?: WorkspaceLayoutSnapshotRecord<TLayout>["source"] }): WorkspaceLayoutSnapshotRecord<TLayout> {
    const session = this.ensureSession(input.session_id);
    const snapshot: WorkspaceLayoutSnapshotRecord<TLayout> = {
      id: this.#nextId("workspace-layout"),
      session_id: session.id,
      active_pane_id: input.active_pane_id ?? null,
      active_artifact_id: input.active_artifact_id ?? null,
      layout: clone(input.layout),
      source: input.source ?? "user",
      created_at: this.#now(),
    };
    this.#layoutSnapshots.set(session.id, [...(this.#layoutSnapshots.get(session.id) ?? []), snapshot as WorkspaceLayoutSnapshotRecord]);
    if (snapshot.active_artifact_id) this.patchSession(session.id, { active_artifact_id: snapshot.active_artifact_id });
    return clone(snapshot);
  }

  listLayoutSnapshots<TLayout = unknown>(sessionId: string): WorkspaceLayoutSnapshotRecord<TLayout>[] {
    return [...(this.#layoutSnapshots.get(sessionId) ?? [])].map((snapshot) => clone(snapshot as WorkspaceLayoutSnapshotRecord<TLayout>));
  }

  recordTelemetryEvent<TPayload = unknown>(input: { session_id?: string | null; request_id?: string | null; source: WorkspaceTelemetryEventRecord<TPayload>["source"]; event: string; payload?: TPayload; ok?: boolean | null; error?: string | null }): WorkspaceTelemetryEventRecord<TPayload> {
    const record: WorkspaceTelemetryEventRecord<TPayload> = {
      id: this.#nextId("workspace-event"),
      session_id: input.session_id ?? null,
      request_id: input.request_id ?? null,
      source: input.source,
      event: input.event,
      payload: this.#normalizeTelemetryPayload(input.payload) as TPayload,
      ok: input.ok ?? null,
      error: input.error ?? null,
      created_at: this.#now(),
    };
    this.#telemetryEvents.push(record as WorkspaceTelemetryEventRecord);
    if (this.#telemetryEvents.length > this.#maxTelemetryEvents) {
      this.#telemetryEvents.splice(0, this.#telemetryEvents.length - this.#maxTelemetryEvents);
    }
    return clone(record);
  }

  listTelemetryEvents(sessionId?: string | null): WorkspaceTelemetryEventRecord[] {
    return this.#telemetryEvents
      .filter((event) => sessionId === undefined || event.session_id === sessionId)
      .map(clone);
  }

  #normalizeTelemetryPayload(value: unknown): unknown {
    if (value === undefined) return null;
    const json = safeStringify(value);
    if (json.length <= this.#maxTelemetryPayloadChars) return clone(value);
    return {
      truncated: true,
      originalBytes: json.length,
      preview: json.slice(0, this.#maxTelemetryPayloadChars),
    };
  }

  #appendDocumentVersion(document: WorkspaceDocumentRecord, source: WorkspaceDocumentVersionSource, summary: string | null): WorkspaceDocumentVersionRecord {
    const version: WorkspaceDocumentVersionRecord = {
      id: this.#nextId("workspace-doc-version"),
      document_id: document.id,
      version_number: document.version_count,
      content: document.current_content,
      summary,
      source,
      created_at: this.#now(),
    };
    this.#documentVersions.set(document.id, [...(this.#documentVersions.get(document.id) ?? []), version]);
    return clone(version);
  }

  #appendArtifactVersion<TContent>(artifact: WorkspaceArtifactRecord<TContent>, source: WorkspaceDocumentVersionSource, summary: string | null): WorkspaceArtifactVersionRecord<TContent> {
    const version: WorkspaceArtifactVersionRecord<TContent> = {
      id: this.#nextId("workspace-artifact-version"),
      artifact_id: artifact.id,
      version_number: artifact.version,
      content: clone(artifact.content),
      summary,
      source,
      created_at: this.#now(),
    };
    this.#artifactVersions.set(artifact.id, [...(this.#artifactVersions.get(artifact.id) ?? []), version as WorkspaceArtifactVersionRecord]);
    return clone(version);
  }

  #nextId(prefix: string): string {
    this.#sequence += 1;
    return `${prefix}-${Date.now().toString(36)}-${this.#sequence.toString(36)}`;
  }

  #now(): string {
    return new Date().toISOString();
  }
}

function normalizeLanguage(language?: string | null, content = ""): string {
  const candidate = language?.trim().toLowerCase();
  if (candidate) return candidate;
  const trimmed = content.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  if (/^\s*<(!doctype html|html|div|section|h[1-6]|p|svg)\b/i.test(trimmed)) return trimmed.includes("<svg") ? "svg" : "html";
  return "markdown";
}

function clone<T>(value: T): T {
  if (value === undefined || value === null) return value;
  return structuredClone(value);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    // Intentional fail-safe: unserializable telemetry still records bounded evidence instead of growing memory.
    return JSON.stringify({ unserializable: true });
  }
}

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

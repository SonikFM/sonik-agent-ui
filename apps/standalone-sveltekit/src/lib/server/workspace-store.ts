import type { Spec } from "@json-render/core";

export type WorkspaceMode = "chat" | "artifact" | "document" | "research";
export type WorkspaceArtifactKind = "json-render" | "document";

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
  source: "user" | "ai" | "system";
  created_at: string;
}

export interface WorkspaceArtifactRecord {
  id: string;
  session_id: string | null;
  kind: WorkspaceArtifactKind;
  title: string;
  content: Spec | WorkspaceDocumentRecord;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface DocumentLibraryResult {
  documents: Array<WorkspaceDocumentRecord & { session_name: string | null; preview: string }>;
  total: number;
  languages: Record<string, number>;
  session_count: number;
}

const sessions = new Map<string, WorkspaceSessionRecord>();
const documents = new Map<string, WorkspaceDocumentRecord>();
const documentVersions = new Map<string, WorkspaceDocumentVersionRecord[]>();
const artifacts = new Map<string, WorkspaceArtifactRecord>();
let sequence = 0;

function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}`;
}

function now(): string {
  return new Date().toISOString();
}

function normalizeLanguage(language?: string | null, content = ""): string {
  const candidate = language?.trim().toLowerCase();
  if (candidate) return candidate;
  const trimmed = content.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  if (/^\s*<(!doctype html|html|div|section|h[1-6]|p|svg)\b/i.test(trimmed)) return trimmed.includes("<svg") ? "svg" : "html";
  return "markdown";
}

function cloneSession(session: WorkspaceSessionRecord): WorkspaceSessionRecord {
  return { ...session };
}

function cloneDocument(document: WorkspaceDocumentRecord): WorkspaceDocumentRecord {
  return { ...document };
}

function cloneVersion(version: WorkspaceDocumentVersionRecord): WorkspaceDocumentVersionRecord {
  return { ...version };
}

export function createWorkspaceSession(input: {
  id?: string;
  name?: string | null;
  mode?: WorkspaceMode;
  folder?: string | null;
} = {}): WorkspaceSessionRecord {
  const timestamp = now();
  const id = input.id?.trim() || nextId("workspace-session");
  const existing = sessions.get(id);
  if (existing) return cloneSession(existing);

  const session: WorkspaceSessionRecord = {
    id,
    name: input.name?.trim() || "Sonik workspace",
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
  sessions.set(id, session);
  return cloneSession(session);
}

export function ensureWorkspaceSession(sessionId?: string | null): WorkspaceSessionRecord {
  if (sessionId) {
    const existing = sessions.get(sessionId);
    if (existing) return cloneSession(existing);
    return createWorkspaceSession({ id: sessionId, name: "Odysseus document session", mode: "document" });
  }
  return createWorkspaceSession({ name: "Sonik workspace", mode: "chat" });
}

export function getWorkspaceSession(id: string): WorkspaceSessionRecord | null {
  const session = sessions.get(id);
  return session ? cloneSession(session) : null;
}

export function listWorkspaceSessions({ archived = false }: { archived?: boolean } = {}): WorkspaceSessionRecord[] {
  return [...sessions.values()]
    .filter((session) => session.archived === archived)
    .sort((a, b) => b.last_accessed.localeCompare(a.last_accessed))
    .map(cloneSession);
}

export function patchWorkspaceSession(id: string, input: Partial<Pick<WorkspaceSessionRecord, "name" | "mode" | "folder" | "active_document_id" | "active_artifact_id" | "is_important">>): WorkspaceSessionRecord | null {
  const existing = sessions.get(id);
  if (!existing) return null;
  const updated = { ...existing, ...input, updated_at: now(), last_accessed: now() } satisfies WorkspaceSessionRecord;
  sessions.set(id, updated);
  return cloneSession(updated);
}

export function archiveWorkspaceSession(id: string, archived = true): WorkspaceSessionRecord | null {
  const existing = sessions.get(id);
  if (!existing) return null;
  const updated = { ...existing, archived, updated_at: now(), last_accessed: now() } satisfies WorkspaceSessionRecord;
  sessions.set(id, updated);
  return cloneSession(updated);
}

function appendDocumentVersion(document: WorkspaceDocumentRecord, source: WorkspaceDocumentVersionRecord["source"], summary: string | null): WorkspaceDocumentVersionRecord {
  const version: WorkspaceDocumentVersionRecord = {
    id: nextId("workspace-doc-version"),
    document_id: document.id,
    version_number: document.version_count,
    content: document.current_content,
    summary,
    source,
    created_at: now(),
  };
  const existing = documentVersions.get(document.id) ?? [];
  documentVersions.set(document.id, [...existing, version]);
  return cloneVersion(version);
}

export function createWorkspaceDocument(input: {
  session_id?: string | null;
  title?: string | null;
  content?: string | null;
  language?: string | null;
  source?: WorkspaceDocumentVersionRecord["source"];
  summary?: string | null;
}): WorkspaceDocumentRecord {
  const session = ensureWorkspaceSession(input.session_id);
  const timestamp = now();
  const content = input.content ?? "";
  const document: WorkspaceDocumentRecord = {
    id: nextId("workspace-doc"),
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
  documents.set(document.id, document);
  appendDocumentVersion(document, input.source ?? "user", input.summary ?? "Initial version");
  patchWorkspaceSession(session.id, { active_document_id: document.id, mode: "document" });
  return cloneDocument(document);
}

export function getWorkspaceDocument(id: string): WorkspaceDocumentRecord | null {
  const document = documents.get(id);
  return document ? cloneDocument(document) : null;
}

export function listWorkspaceDocuments(sessionId: string): WorkspaceDocumentRecord[] {
  return [...documents.values()]
    .filter((document) => document.session_id === sessionId && document.is_active && !document.archived)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .map(cloneDocument);
}

export function listDocumentLibrary(input: {
  search?: string | null;
  language?: string | null;
  sort?: string | null;
  offset?: number;
  limit?: number;
  archived?: boolean;
} = {}): DocumentLibraryResult {
  const searchTerms = (input.search ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  const language = input.language?.trim().toLowerCase();
  const archived = Boolean(input.archived);
  const offset = Math.max(0, input.offset ?? 0);
  const limit = Math.min(50, Math.max(1, input.limit ?? 20));

  let rows = [...documents.values()].filter((document) => document.is_active && document.archived === archived);
  if (searchTerms.length > 0) {
    rows = rows.filter((document) => {
      const haystack = `${document.title}\n${document.current_content}`.toLowerCase();
      return searchTerms.every((term) => haystack.includes(term));
    });
  }
  if (language) {
    rows = rows.filter((document) => (document.language || "text").toLowerCase() === language);
  }

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

  const paged = rows.slice(offset, offset + limit).map((document) => ({
    ...cloneDocument(document),
    session_name: document.session_id ? (sessions.get(document.session_id)?.name ?? null) : null,
    preview: document.current_content.slice(0, 500),
  }));

  return {
    documents: paged,
    total: rows.length,
    languages,
    session_count: sessionIds.size,
  };
}

export function updateWorkspaceDocument(id: string, input: {
  content?: string;
  title?: string;
  language?: string;
  source?: WorkspaceDocumentVersionRecord["source"];
  summary?: string | null;
}): WorkspaceDocumentRecord | null {
  const existing = documents.get(id);
  if (!existing) return null;
  const contentChanged = input.content !== undefined && input.content !== existing.current_content;
  const titleChanged = input.title !== undefined && input.title !== existing.title;
  const languageChanged = input.language !== undefined && input.language !== existing.language;
  if (!contentChanged && !titleChanged && !languageChanged) return cloneDocument(existing);

  const updated: WorkspaceDocumentRecord = {
    ...existing,
    title: input.title ?? existing.title,
    language: input.language ?? existing.language,
    current_content: input.content ?? existing.current_content,
    version_count: contentChanged ? existing.version_count + 1 : existing.version_count,
    updated_at: now(),
  };
  documents.set(id, updated);
  if (contentChanged) appendDocumentVersion(updated, input.source ?? "user", input.summary ?? "Updated document");
  if (updated.session_id) patchWorkspaceSession(updated.session_id, { active_document_id: updated.id, mode: "document" });
  return cloneDocument(updated);
}

export function patchWorkspaceDocument(id: string, input: {
  content?: string;
  title?: string;
  language?: string;
  session_id?: string | null;
}): WorkspaceDocumentRecord | null {
  const existing = documents.get(id);
  if (!existing) return null;
  const nextSessionId = input.session_id === "" ? null : input.session_id;
  const updated = updateWorkspaceDocument(id, {
    content: input.content,
    title: input.title,
    language: input.language,
    summary: "Patched document",
  });
  const current = updated ? documents.get(id)! : existing;
  if (nextSessionId !== undefined && nextSessionId !== current.session_id) {
    if (nextSessionId) ensureWorkspaceSession(nextSessionId);
    const relinked = { ...current, session_id: nextSessionId, updated_at: now() } satisfies WorkspaceDocumentRecord;
    documents.set(id, relinked);
    if (nextSessionId) patchWorkspaceSession(nextSessionId, { active_document_id: id, mode: "document" });
    return cloneDocument(relinked);
  }
  return updated ?? cloneDocument(current);
}

export function archiveWorkspaceDocument(id: string, archived = true): WorkspaceDocumentRecord | null {
  const existing = documents.get(id);
  if (!existing) return null;
  const updated = { ...existing, archived, updated_at: now() } satisfies WorkspaceDocumentRecord;
  documents.set(id, updated);
  return cloneDocument(updated);
}

export function deleteWorkspaceDocument(id: string): boolean {
  documentVersions.delete(id);
  return documents.delete(id);
}

export function listWorkspaceDocumentVersions(documentId: string): WorkspaceDocumentVersionRecord[] {
  return [...(documentVersions.get(documentId) ?? [])]
    .sort((a, b) => b.version_number - a.version_number)
    .map(cloneVersion);
}

export function getWorkspaceDocumentVersion(documentId: string, versionNumber: number): WorkspaceDocumentVersionRecord | null {
  const version = (documentVersions.get(documentId) ?? []).find((entry) => entry.version_number === versionNumber);
  return version ? cloneVersion(version) : null;
}

export function restoreWorkspaceDocumentVersion(documentId: string, versionNumber: number): WorkspaceDocumentRecord | null {
  const version = getWorkspaceDocumentVersion(documentId, versionNumber);
  if (!version) return null;
  return updateWorkspaceDocument(documentId, {
    content: version.content,
    source: "user",
    summary: `Restored version ${versionNumber}`,
  });
}


export function syncActiveWorkspaceDocumentSnapshot(snapshot: WorkspaceDocumentRecord): WorkspaceDocumentRecord {
  const stored = documents.get(snapshot.id);
  if (!stored) return cloneDocument(snapshot);
  if (
    stored.current_content !== snapshot.current_content ||
    stored.title !== snapshot.title ||
    stored.language !== snapshot.language
  ) {
    return updateWorkspaceDocument(snapshot.id, {
      title: snapshot.title,
      language: snapshot.language,
      content: snapshot.current_content,
      source: "user",
      summary: "Synced active editor snapshot before agent turn",
    }) ?? cloneDocument(snapshot);
  }
  return cloneDocument(stored);
}

export function createWorkspaceArtifact(input: {
  session_id?: string | null;
  id?: string;
  kind: WorkspaceArtifactKind;
  title: string;
  content: Spec | WorkspaceDocumentRecord;
}): WorkspaceArtifactRecord {
  const session = ensureWorkspaceSession(input.session_id);
  const timestamp = now();
  const artifact: WorkspaceArtifactRecord = {
    id: input.id?.trim() || nextId("workspace-artifact"),
    session_id: session.id,
    kind: input.kind,
    title: input.title,
    content: structuredClone(input.content),
    version: 1,
    created_at: timestamp,
    updated_at: timestamp,
  };
  artifacts.set(artifact.id, artifact);
  patchWorkspaceSession(session.id, { active_artifact_id: artifact.id, mode: input.kind === "document" ? "document" : "artifact" });
  return structuredClone(artifact);
}

export function getWorkspaceArtifact(id: string): WorkspaceArtifactRecord | null {
  const artifact = artifacts.get(id);
  return artifact ? structuredClone(artifact) : null;
}

export function summarizeWorkspaceContext(input: { activeDocument?: WorkspaceDocumentRecord | null; maxChars?: number } = {}): string | null {
  const document = input.activeDocument;
  if (!document) return null;
  const maxChars = input.maxChars ?? 3000;
  const content = document.current_content.length > maxChars
    ? `${document.current_content.slice(0, maxChars)}\n... (${document.current_content.length} chars total)`
    : document.current_content;
  return [
    "Active Odysseus/Sonik document context:",
    `- id: ${document.id}`,
    `- title: ${document.title}`,
    `- language: ${document.language}`,
    `- version: ${document.version_count}`,
    "Document content:",
    "```" + document.language,
    content,
    "```",
  ].join("\n");
}

export const workspaceProcedures = {
  "workspace.session.create": createWorkspaceSession,
  "workspace.session.list": listWorkspaceSessions,
  "workspace.session.get": getWorkspaceSession,
  "workspace.session.archive": archiveWorkspaceSession,
  "workspace.document.create": createWorkspaceDocument,
  "workspace.document.update": updateWorkspaceDocument,
  "workspace.document.patch": patchWorkspaceDocument,
  "workspace.document.list": listWorkspaceDocuments,
  "workspace.document.library": listDocumentLibrary,
  "workspace.document.get": getWorkspaceDocument,
  "workspace.document.versions": listWorkspaceDocumentVersions,
  "workspace.document.restore": restoreWorkspaceDocumentVersion,
  "workspace.document.archive": archiveWorkspaceDocument,
  "workspace.document.syncActiveSnapshot": syncActiveWorkspaceDocumentSnapshot,
  "workspace.artifact.create": createWorkspaceArtifact,
  "workspace.artifact.get": getWorkspaceArtifact,
} as const;

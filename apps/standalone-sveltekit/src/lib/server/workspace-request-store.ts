import type { RequestEvent } from "@sveltejs/kit";
import type {
  AsyncWorkspacePersistenceAdapter,
  DocumentLibraryResult,
  WorkspaceArtifactKind,
  WorkspaceArtifactRecord as BaseWorkspaceArtifactRecord,
  WorkspaceArtifactVersionRecord,
  WorkspaceDocumentRecord,
  WorkspaceDocumentVersionRecord,
  WorkspaceLayoutSnapshotRecord,
  WorkspaceMessageRecord,
  WorkspaceMode,
  WorkspaceRunEventRecord,
  WorkspaceRunRecord,
  WorkspaceRunStatus,
  WorkspaceSessionRecord,
  WorkspaceTelemetryEventRecord,
  WorkspaceToolCallRecord,
} from "@sonik-agent-ui/workspace-session";
import type { Spec } from "@json-render/core";
import { createRequestWorkspaceServices, type WorkspaceRuntimeRequest } from "./workspace-services.ts";

export type WorkspaceArtifactRecord = BaseWorkspaceArtifactRecord<Spec | WorkspaceDocumentRecord>;
export type RequestWorkspaceEvent = Pick<RequestEvent, "platform" | "request" | "locals">;

export function getRequestWorkspacePersistence(event?: WorkspaceRuntimeRequest | RequestWorkspaceEvent | null): AsyncWorkspacePersistenceAdapter {
  return createRequestWorkspaceServices(event as WorkspaceRuntimeRequest | null | undefined).persistence;
}

export async function createRequestWorkspaceSession(event: RequestWorkspaceEvent, input: { id?: string; name?: string | null; mode?: WorkspaceMode; folder?: string | null } = {}): Promise<WorkspaceSessionRecord> {
  return getRequestWorkspacePersistence(event).createSession(input);
}

export async function ensureRequestWorkspaceSession(event: RequestWorkspaceEvent, sessionId?: string | null): Promise<WorkspaceSessionRecord> {
  return getRequestWorkspacePersistence(event).ensureSession(sessionId);
}

export async function getRequestWorkspaceSession(event: RequestWorkspaceEvent, id: string): Promise<WorkspaceSessionRecord | null> {
  return getRequestWorkspacePersistence(event).getSession(id);
}

export async function listRequestWorkspaceSessions(event: RequestWorkspaceEvent, input: { archived?: boolean } = {}): Promise<WorkspaceSessionRecord[]> {
  return getRequestWorkspacePersistence(event).listSessions(input);
}

export async function patchRequestWorkspaceSession(event: RequestWorkspaceEvent, id: string, input: Partial<Pick<WorkspaceSessionRecord, "name" | "mode" | "folder" | "active_document_id" | "active_artifact_id" | "is_important">>): Promise<WorkspaceSessionRecord | null> {
  return getRequestWorkspacePersistence(event).patchSession(id, input);
}

export async function archiveRequestWorkspaceSession(event: RequestWorkspaceEvent, id: string, archived = true): Promise<WorkspaceSessionRecord | null> {
  return getRequestWorkspacePersistence(event).archiveSession(id, archived);
}

export async function deleteRequestWorkspaceSession(event: RequestWorkspaceEvent, id: string): Promise<boolean> {
  return getRequestWorkspacePersistence(event).deleteSession(id);
}

export async function createRequestWorkspaceDocument(event: RequestWorkspaceEvent, input: { session_id?: string | null; title?: string | null; content?: string | null; language?: string | null; source?: WorkspaceDocumentVersionRecord["source"]; summary?: string | null }): Promise<WorkspaceDocumentRecord> {
  return getRequestWorkspacePersistence(event).createDocument(input);
}

export async function getRequestWorkspaceDocument(event: RequestWorkspaceEvent, id: string): Promise<WorkspaceDocumentRecord | null> {
  return getRequestWorkspacePersistence(event).getDocument(id);
}

export async function listRequestWorkspaceDocuments(event: RequestWorkspaceEvent, sessionId: string): Promise<WorkspaceDocumentRecord[]> {
  return getRequestWorkspacePersistence(event).listDocuments(sessionId);
}

export async function listRequestWorkspaceDocumentLibrary(event: RequestWorkspaceEvent, input: { search?: string | null; language?: string | null; sort?: string | null; offset?: number; limit?: number; archived?: boolean } = {}): Promise<DocumentLibraryResult> {
  return getRequestWorkspacePersistence(event).listDocumentLibrary(input);
}

export async function updateRequestWorkspaceDocument(event: RequestWorkspaceEvent, id: string, input: { content?: string; title?: string; language?: string; source?: WorkspaceDocumentVersionRecord["source"]; summary?: string | null }): Promise<WorkspaceDocumentRecord | null> {
  return getRequestWorkspacePersistence(event).updateDocument(id, input);
}

export async function patchRequestWorkspaceDocument(event: RequestWorkspaceEvent, id: string, input: { content?: string; title?: string; language?: string; session_id?: string | null }): Promise<WorkspaceDocumentRecord | null> {
  return getRequestWorkspacePersistence(event).patchDocument(id, input);
}

export async function archiveRequestWorkspaceDocument(event: RequestWorkspaceEvent, id: string, archived = true): Promise<WorkspaceDocumentRecord | null> {
  return getRequestWorkspacePersistence(event).archiveDocument(id, archived);
}

export async function deleteRequestWorkspaceDocument(event: RequestWorkspaceEvent, id: string): Promise<boolean> {
  return getRequestWorkspacePersistence(event).deleteDocument(id);
}

export async function listRequestWorkspaceDocumentVersions(event: RequestWorkspaceEvent, documentId: string): Promise<WorkspaceDocumentVersionRecord[]> {
  return getRequestWorkspacePersistence(event).listDocumentVersions(documentId);
}

export async function getRequestWorkspaceDocumentVersion(event: RequestWorkspaceEvent, documentId: string, versionNumber: number): Promise<WorkspaceDocumentVersionRecord | null> {
  return getRequestWorkspacePersistence(event).getDocumentVersion(documentId, versionNumber);
}

export async function restoreRequestWorkspaceDocumentVersion(event: RequestWorkspaceEvent, documentId: string, versionNumber: number): Promise<WorkspaceDocumentRecord | null> {
  return getRequestWorkspacePersistence(event).restoreDocumentVersion(documentId, versionNumber);
}

export async function syncRequestActiveWorkspaceDocumentSnapshot(event: RequestWorkspaceEvent, snapshot: WorkspaceDocumentRecord): Promise<WorkspaceDocumentRecord> {
  return getRequestWorkspacePersistence(event).syncActiveDocumentSnapshot(snapshot);
}

export async function createRequestWorkspaceArtifact(event: RequestWorkspaceEvent, input: { session_id?: string | null; id?: string; kind: WorkspaceArtifactKind; title: string; content: Spec | WorkspaceDocumentRecord; source?: WorkspaceDocumentVersionRecord["source"]; summary?: string | null }): Promise<WorkspaceArtifactRecord> {
  return getRequestWorkspacePersistence(event).createArtifact<Spec | WorkspaceDocumentRecord>(input);
}

export async function getRequestWorkspaceArtifact(event: RequestWorkspaceEvent, id: string): Promise<WorkspaceArtifactRecord | null> {
  return getRequestWorkspacePersistence(event).getArtifact<Spec | WorkspaceDocumentRecord>(id);
}

export async function updateRequestWorkspaceArtifact(event: RequestWorkspaceEvent, id: string, input: { title?: string; content?: Spec | WorkspaceDocumentRecord; source?: WorkspaceDocumentVersionRecord["source"]; summary?: string | null }): Promise<WorkspaceArtifactRecord | null> {
  return getRequestWorkspacePersistence(event).updateArtifact<Spec | WorkspaceDocumentRecord>(id, input);
}

export async function listRequestWorkspaceArtifactVersions(event: RequestWorkspaceEvent, artifactId: string): Promise<WorkspaceArtifactVersionRecord<Spec | WorkspaceDocumentRecord>[]> {
  return getRequestWorkspacePersistence(event).listArtifactVersions<Spec | WorkspaceDocumentRecord>(artifactId);
}

export async function recordRequestWorkspaceLayoutSnapshot<TLayout = unknown>(event: RequestWorkspaceEvent, input: { session_id?: string | null; active_pane_id?: string | null; active_artifact_id?: string | null; layout: TLayout; source?: WorkspaceLayoutSnapshotRecord<TLayout>["source"] }): Promise<WorkspaceLayoutSnapshotRecord<TLayout>> {
  return getRequestWorkspacePersistence(event).recordLayoutSnapshot<TLayout>(input);
}

export async function listRequestWorkspaceLayoutSnapshots<TLayout = unknown>(event: RequestWorkspaceEvent, sessionId: string): Promise<WorkspaceLayoutSnapshotRecord<TLayout>[]> {
  return getRequestWorkspacePersistence(event).listLayoutSnapshots<TLayout>(sessionId);
}

export async function appendRequestWorkspaceMessage<TParts = unknown>(event: RequestWorkspaceEvent, input: { session_id?: string | null; id?: string; role: WorkspaceMessageRecord<TParts>["role"]; content?: string | null; parts?: TParts | null }): Promise<WorkspaceMessageRecord<TParts>> {
  return getRequestWorkspacePersistence(event).appendMessage(input);
}

export async function listRequestWorkspaceMessages<TParts = unknown>(event: RequestWorkspaceEvent, sessionId: string): Promise<WorkspaceMessageRecord<TParts>[]> {
  return getRequestWorkspacePersistence(event).listMessages<TParts>(sessionId);
}

export async function listRequestWorkspaceTelemetryEvents(event: RequestWorkspaceEvent, sessionId?: string | null): Promise<WorkspaceTelemetryEventRecord[]> {
  try {
    return await getRequestWorkspacePersistence(event).listTelemetryEvents(sessionId);
  } catch {
    return [];
  }
}

export async function listRequestWorkspaceRuns(event: RequestWorkspaceEvent, sessionId: string): Promise<WorkspaceRunRecord[]> {
  return getRequestWorkspacePersistence(event).listRuns(sessionId);
}

export async function listRequestWorkspaceRunEvents<TEvent = unknown>(event: RequestWorkspaceEvent, runId: string): Promise<WorkspaceRunEventRecord<TEvent>[]> {
  return getRequestWorkspacePersistence(event).listRunEvents<TEvent>(runId);
}

export type {
  DocumentLibraryResult,
  WorkspaceArtifactKind,
  WorkspaceArtifactVersionRecord,
  WorkspaceDocumentRecord,
  WorkspaceDocumentVersionRecord,
  WorkspaceLayoutSnapshotRecord,
  WorkspaceMessageRecord,
  WorkspaceMode,
  WorkspaceRunEventRecord,
  WorkspaceRunRecord,
  WorkspaceRunStatus,
  WorkspaceSessionRecord,
  WorkspaceTelemetryEventRecord,
  WorkspaceToolCallRecord,
} from "@sonik-agent-ui/workspace-session";

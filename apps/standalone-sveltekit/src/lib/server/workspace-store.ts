import type { Spec } from "@json-render/core";
import {
  type DocumentLibraryResult,
  type WorkspaceArtifactKind,
  type WorkspaceArtifactRecord as BaseWorkspaceArtifactRecord,
  type WorkspaceDocumentRecord,
  type WorkspaceDocumentVersionRecord,
  type WorkspaceLayoutSnapshotRecord,
  type WorkspaceMessageRecord,
  type WorkspaceMode,
  type WorkspacePersistenceAdapter,
  type WorkspaceRunContextSelection,
  type WorkspaceRunEventRecord,
  type WorkspaceRunRecord,
  type WorkspaceRunStatus,
  type WorkspaceSessionRecord,
  type WorkspaceTelemetryEventRecord,
  type WorkspaceToolCallRecord,
} from "@sonik-agent-ui/workspace-session";
import { workspaceServices } from "./workspace-services.ts";

export type {
  DocumentLibraryResult,
  WorkspaceArtifactKind,
  WorkspaceDocumentRecord,
  WorkspaceDocumentVersionRecord,
  WorkspaceLayoutSnapshotRecord,
  WorkspaceMessageRecord,
  WorkspaceMode,
  WorkspacePersistenceAdapter,
  WorkspaceRunEventRecord,
  WorkspaceRunRecord,
  WorkspaceRunStatus,
  WorkspaceSessionRecord,
  WorkspaceTelemetryEventRecord,
  WorkspaceToolCallRecord,
} from "@sonik-agent-ui/workspace-session";

export type WorkspaceArtifactRecord = BaseWorkspaceArtifactRecord<Spec | WorkspaceDocumentRecord>;

const workspacePersistence = workspaceServices.persistence;
export const localWorkspaceAuthAdapter = workspaceServices.auth;

export function getWorkspacePersistenceAdapter(): WorkspacePersistenceAdapter {
  return workspacePersistence;
}

export function createWorkspaceSession(input: {
  id?: string;
  name?: string | null;
  mode?: WorkspaceMode;
  folder?: string | null;
} = {}): WorkspaceSessionRecord {
  return workspacePersistence.createSession(input);
}

export function ensureWorkspaceSession(sessionId?: string | null): WorkspaceSessionRecord {
  return workspacePersistence.ensureSession(sessionId);
}

export function getWorkspaceSession(id: string): WorkspaceSessionRecord | null {
  return workspacePersistence.getSession(id);
}

export function listWorkspaceSessions(input: { archived?: boolean } = {}): WorkspaceSessionRecord[] {
  return workspacePersistence.listSessions(input);
}

export function patchWorkspaceSession(
  id: string,
  input: Partial<Pick<WorkspaceSessionRecord, "name" | "mode" | "folder" | "active_document_id" | "active_artifact_id" | "is_important">>,
): WorkspaceSessionRecord | null {
  return workspacePersistence.patchSession(id, input);
}

export function archiveWorkspaceSession(id: string, archived = true): WorkspaceSessionRecord | null {
  return workspacePersistence.archiveSession(id, archived);
}

export function deleteWorkspaceSession(id: string): boolean {
  return workspacePersistence.deleteSession(id);
}

export function createWorkspaceDocument(input: {
  session_id?: string | null;
  title?: string | null;
  content?: string | null;
  language?: string | null;
  source?: WorkspaceDocumentVersionRecord["source"];
  summary?: string | null;
}): WorkspaceDocumentRecord {
  return workspacePersistence.createDocument(input);
}

export function getWorkspaceDocument(id: string): WorkspaceDocumentRecord | null {
  return workspacePersistence.getDocument(id);
}

export function listWorkspaceDocuments(sessionId: string): WorkspaceDocumentRecord[] {
  return workspacePersistence.listDocuments(sessionId);
}

export function listDocumentLibrary(input: {
  search?: string | null;
  language?: string | null;
  sort?: string | null;
  offset?: number;
  limit?: number;
  archived?: boolean;
} = {}): DocumentLibraryResult {
  return workspacePersistence.listDocumentLibrary(input);
}

export function updateWorkspaceDocument(id: string, input: {
  content?: string;
  title?: string;
  language?: string;
  source?: WorkspaceDocumentVersionRecord["source"];
  summary?: string | null;
}): WorkspaceDocumentRecord | null {
  return workspacePersistence.updateDocument(id, input);
}

export function patchWorkspaceDocument(id: string, input: {
  content?: string;
  title?: string;
  language?: string;
  session_id?: string | null;
}): WorkspaceDocumentRecord | null {
  return workspacePersistence.patchDocument(id, input);
}

export function archiveWorkspaceDocument(id: string, archived = true): WorkspaceDocumentRecord | null {
  return workspacePersistence.archiveDocument(id, archived);
}

export function deleteWorkspaceDocument(id: string): boolean {
  return workspacePersistence.deleteDocument(id);
}

export function listWorkspaceDocumentVersions(documentId: string): WorkspaceDocumentVersionRecord[] {
  return workspacePersistence.listDocumentVersions(documentId);
}

export function getWorkspaceDocumentVersion(documentId: string, versionNumber: number): WorkspaceDocumentVersionRecord | null {
  return workspacePersistence.getDocumentVersion(documentId, versionNumber);
}

export function restoreWorkspaceDocumentVersion(documentId: string, versionNumber: number): WorkspaceDocumentRecord | null {
  return workspacePersistence.restoreDocumentVersion(documentId, versionNumber);
}

export function syncActiveWorkspaceDocumentSnapshot(snapshot: WorkspaceDocumentRecord): WorkspaceDocumentRecord {
  return workspacePersistence.syncActiveDocumentSnapshot(snapshot);
}

export function createWorkspaceArtifact(input: {
  session_id?: string | null;
  id?: string;
  kind: WorkspaceArtifactKind;
  title: string;
  content: Spec | WorkspaceDocumentRecord;
}): WorkspaceArtifactRecord {
  return workspacePersistence.createArtifact<Spec | WorkspaceDocumentRecord>(input);
}

export function getWorkspaceArtifact(id: string): WorkspaceArtifactRecord | null {
  return workspacePersistence.getArtifact<Spec | WorkspaceDocumentRecord>(id);
}

export function updateWorkspaceArtifact(id: string, input: {
  title?: string;
  content?: Spec | WorkspaceDocumentRecord;
  source?: WorkspaceDocumentVersionRecord["source"];
  summary?: string | null;
}): WorkspaceArtifactRecord | null {
  return workspacePersistence.updateArtifact<Spec | WorkspaceDocumentRecord>(id, input);
}

export function listWorkspaceArtifactVersions(id: string) {
  return workspacePersistence.listArtifactVersions<Spec | WorkspaceDocumentRecord>(id);
}

export function appendWorkspaceMessage<TParts = unknown>(input: {
  session_id?: string | null;
  id?: string;
  role: WorkspaceMessageRecord<TParts>["role"];
  content?: string | null;
  parts?: TParts | null;
}): WorkspaceMessageRecord<TParts> {
  return workspacePersistence.appendMessage(input);
}

export function listWorkspaceMessages<TParts = unknown>(sessionId: string): WorkspaceMessageRecord<TParts>[] {
  return workspacePersistence.listMessages(sessionId);
}

export function createWorkspaceRun(input: {
  id?: string;
  session_id?: string | null;
  message_id?: string | null;
  request_id?: string | null;
  trace_id?: string | null;
  traceparent?: string | null;
  context_selection?: WorkspaceRunContextSelection | null;
} = {}): WorkspaceRunRecord {
  return workspacePersistence.createRun(input);
}

export function getWorkspaceRun(id: string): WorkspaceRunRecord | null {
  return workspacePersistence.getRun(id);
}

export function listWorkspaceRuns(sessionId: string): WorkspaceRunRecord[] {
  return workspacePersistence.listRuns(sessionId);
}

export function updateWorkspaceRun(id: string, input: {
  status?: WorkspaceRunStatus;
  resumable?: boolean;
  error?: string | null;
  error_code?: string | null;
  message_id?: string | null;
  ended_at?: string | null;
}): WorkspaceRunRecord | null {
  return workspacePersistence.updateRun(id, input);
}

export function appendWorkspaceRunEvent<TEvent = unknown>(input: {
  run_id: string;
  session_id?: string | null;
  seq?: number;
  kind: string;
  event: TEvent;
}): WorkspaceRunEventRecord<TEvent> {
  return workspacePersistence.appendRunEvent<TEvent>(input);
}

export function listWorkspaceRunEvents<TEvent = unknown>(runId: string): WorkspaceRunEventRecord<TEvent>[] {
  return workspacePersistence.listRunEvents<TEvent>(runId);
}

export function recordWorkspaceToolCall<TInput = unknown, TOutput = unknown>(
  input: Omit<WorkspaceToolCallRecord<TInput, TOutput>, "id" | "created_at" | "completed_at"> & {
    id?: string;
    created_at?: string;
    completed_at?: string | null;
  },
): WorkspaceToolCallRecord<TInput, TOutput> {
  return workspacePersistence.recordToolCall(input);
}

export function listWorkspaceToolCalls(sessionId: string): WorkspaceToolCallRecord[] {
  return workspacePersistence.listToolCalls(sessionId);
}

export function recordWorkspaceLayoutSnapshot<TLayout = unknown>(input: {
  session_id?: string | null;
  active_pane_id?: string | null;
  active_artifact_id?: string | null;
  layout: TLayout;
  source?: WorkspaceLayoutSnapshotRecord<TLayout>["source"];
}): WorkspaceLayoutSnapshotRecord<TLayout> {
  return workspacePersistence.recordLayoutSnapshot(input);
}

export function listWorkspaceLayoutSnapshots<TLayout = unknown>(sessionId: string): WorkspaceLayoutSnapshotRecord<TLayout>[] {
  return workspacePersistence.listLayoutSnapshots(sessionId);
}

export function recordWorkspaceTelemetryEvent<TPayload = unknown>(input: {
  session_id?: string | null;
  request_id?: string | null;
  source: WorkspaceTelemetryEventRecord<TPayload>["source"];
  event: string;
  payload?: TPayload;
  ok?: boolean | null;
  error?: string | null;
}): WorkspaceTelemetryEventRecord<TPayload> {
  return workspacePersistence.recordTelemetryEvent(input);
}

export function listWorkspaceTelemetryEvents(sessionId?: string | null): WorkspaceTelemetryEventRecord[] {
  return workspacePersistence.listTelemetryEvents(sessionId);
}

export function summarizeWorkspaceContext(input: { activeDocument?: WorkspaceDocumentRecord | null; maxChars?: number } = {}): string | null {
  const document = input.activeDocument;
  if (!document) return null;
  const maxChars = input.maxChars ?? 3000;
  const content = document.current_content.length > maxChars
    ? `${document.current_content.slice(0, maxChars)}\n... (${document.current_content.length} chars total)`
    : document.current_content;
  return [
    "Active Workspace/Sonik document context:",
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
  "workspace.artifact.update": updateWorkspaceArtifact,
  "workspace.artifact.get": getWorkspaceArtifact,
  "workspace.artifact.versions": listWorkspaceArtifactVersions,
  "workspace.message.append": appendWorkspaceMessage,
  "workspace.message.list": listWorkspaceMessages,
  "workspace.run.create": createWorkspaceRun,
  "workspace.run.get": getWorkspaceRun,
  "workspace.run.list": listWorkspaceRuns,
  "workspace.run.update": updateWorkspaceRun,
  "workspace.run.event.append": appendWorkspaceRunEvent,
  "workspace.run.event.list": listWorkspaceRunEvents,
  "workspace.toolCall.record": recordWorkspaceToolCall,
  "workspace.toolCall.list": listWorkspaceToolCalls,
  "workspace.layoutSnapshot.record": recordWorkspaceLayoutSnapshot,
  "workspace.layoutSnapshot.list": listWorkspaceLayoutSnapshots,
  "workspace.telemetry.record": recordWorkspaceTelemetryEvent,
  "workspace.telemetry.list": listWorkspaceTelemetryEvents,
} as const;

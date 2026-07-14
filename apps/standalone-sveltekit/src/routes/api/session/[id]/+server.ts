import { error, json } from "@sveltejs/kit";
import {
  ensureRequestWorkspaceSession,
  getRequestWorkspaceArtifact,
  getRequestWorkspaceDocument,
  getRequestWorkspacePersistence,
  getRequestWorkspaceSession,
  listRequestWorkspaceArtifactVersions,
  listRequestWorkspaceDocuments,
  listRequestWorkspaceLayoutSnapshots,
  listRequestWorkspaceMessages,
  listRequestWorkspaceRunEvents,
  listRequestWorkspaceRuns,
  listRequestWorkspaceTelemetryEvents,
  patchRequestWorkspaceSession,
} from "$lib/server/workspace-request-store";
import { AgentUiFileError, deleteAgentUiFile, requireAgentUiFileBucket, type AgentUiFileBucket } from "$lib/server/agent-ui-files";
import {
  AGENT_UI_WORKSPACE_SESSION_CONTEXT_HEADER,
  createSignedWorkspaceSessionContextHeader,
  resolveTrustedHostSessionSnapshot,
} from "$lib/server/workspace-services";
import { buildRunReattachMessage, runAssistantTurnPersisted, type RunReattachMessage } from "$lib/server/run-event-log";
import type { PersistedRunEvent } from "@sonik-agent-ui/tool-contracts";
import { routeString, WORKSPACE_TITLE_MAX_CHARS } from "$lib/server/workspace-route-limits";
import type { RequestHandler } from "./$types";
import { sanitizeSessionFailureProjection } from "$lib/server/run-error-safety";

const PRIVATE_SESSION_HEADERS = {
  "cache-control": "private, no-store",
  pragma: "no-cache",
  expires: "0",
};

export const GET: RequestHandler = async (event) => {
  const session = await getRequestWorkspaceSession(event, event.params.id);
  if (!session) error(404, "Session not found");

  const [documents, activeDocument, messages, telemetry, activeArtifact, layoutSnapshots, runs] = await Promise.all([
    listRequestWorkspaceDocuments(event, session.id),
    session.active_document_id ? getRequestWorkspaceDocument(event, session.active_document_id) : Promise.resolve(null),
    listRequestWorkspaceMessages(event, session.id),
    listRequestWorkspaceTelemetryEvents(event, session.id),
    session.active_artifact_id ? getRequestWorkspaceArtifact(event, session.active_artifact_id) : Promise.resolve(null),
    listRequestWorkspaceLayoutSnapshots(event, session.id).catch(() => []),
    listRequestWorkspaceRuns(event, session.id),
  ]);
  const activeArtifactVersions = activeArtifact ? await listRequestWorkspaceArtifactVersions(event, activeArtifact.id) : [];

  // Reattach: rebuild the latest run's assistant message from persisted events.
  // Only for a non-succeeded latest run whose turn was not already persisted
  // client-side (a tab that stayed alive persists the partial assistant message
  // itself) — reattaching that would double the last turn.
  const latestRun = runs.at(-1) ?? null;
  let reattachMessage: RunReattachMessage | null = null;
  if (latestRun && latestRun.status !== "succeeded" && !runAssistantTurnPersisted(latestRun, messages)) {
    const runEvents = await listRequestWorkspaceRunEvents<PersistedRunEvent>(event, latestRun.id);
    reattachMessage = buildRunReattachMessage({ run: latestRun, messages, events: runEvents });
  }

  const workspaceSessionContext = createSignedWorkspaceSessionContextHeader(event, session.id);
  return json(sanitizeSessionFailureProjection({
    session,
    documents,
    activeDocument,
    messages,
    runs,
    reattach: latestRun ? { run: latestRun, message: reattachMessage } : null,
    telemetry: telemetry.slice(-50),
    artifactState: {
      persistence: "cloud-or-memory-v1",
      activeArtifactId: session.active_artifact_id,
      activeArtifact,
      activeArtifactVersions,
      latestLayout: layoutSnapshots[0] ?? null,
      note: "JSON-render artifacts, versions, and active workspace pointers are restored through the workspace persistence adapter.",
    },
  }), {
    headers: {
      ...PRIVATE_SESSION_HEADERS,
      ...(workspaceSessionContext ? { [AGENT_UI_WORKSPACE_SESSION_CONTEXT_HEADER]: workspaceSessionContext } : {}),
    },
  });
};

export const PATCH: RequestHandler = async (event) => {
  const session = (await getRequestWorkspaceSession(event, event.params.id)) ?? (await ensureRequestWorkspaceSession(event, event.params.id));

  let body: Record<string, unknown>;
  try {
    const parsed = await event.request.json();
    if (!isRecord(parsed)) error(400, "Session patch payload must be a JSON object");
    body = parsed;
  } catch (caught) {
    if (caught && typeof caught === "object" && "status" in caught) throw caught;
    error(400, "Invalid JSON session patch payload");
  }

  const name = routeString(body.name, "name", WORKSPACE_TITLE_MAX_CHARS, "").trim();
  if (!name) error(400, "Session name is required");
  const updated = await patchRequestWorkspaceSession(event, session.id, { name });
  if (!updated) error(404, "Session not found");
  return json(updated);
};

export const DELETE: RequestHandler = async (event) => {
  const session = await getRequestWorkspaceSession(event, event.params.id);
  if (!session) error(404, "Session not found");
  const persistence = getRequestWorkspacePersistence(event);
  if (!(await persistence.beginSessionDeletion(session.id))) error(404, "Session not found");
  const files = await persistence.listFiles(session.id);
  if (files.length > 0) {
    const auth = resolveTrustedHostSessionSnapshot(event);
    const bucket = requireAgentUiFileBucket(event.platform?.env?.AGENT_UI_FILES_BUCKET as AgentUiFileBucket | undefined);
    try {
      for (const file of files) await deleteAgentUiFile({ id: file.id, sessionId: session.id, auth, persistence, bucket });
    } catch (caught) {
      if (caught instanceof AgentUiFileError) error(caught.status, caught.message);
      throw caught;
    }
  }
  const deleted = await persistence.deleteSession(session.id);
  if (!deleted) error(404, "Session not found");
  return json({ id: session.id, deleted: true });
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

import { error, json } from "@sveltejs/kit";
import {
  deleteRequestWorkspaceSession,
  ensureRequestWorkspaceSession,
  getRequestWorkspaceArtifact,
  getRequestWorkspaceDocument,
  getRequestWorkspaceSession,
  listRequestWorkspaceArtifactVersions,
  listRequestWorkspaceDocuments,
  listRequestWorkspaceLayoutSnapshots,
  listRequestWorkspaceMessages,
  listRequestWorkspaceTelemetryEvents,
  patchRequestWorkspaceSession,
} from "$lib/server/workspace-request-store";
import { routeString, WORKSPACE_TITLE_MAX_CHARS } from "$lib/server/workspace-route-limits";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async (event) => {
  const session = await getRequestWorkspaceSession(event, event.params.id);
  if (!session) error(404, "Session not found");

  const [documents, activeDocument, messages, telemetry, activeArtifact, layoutSnapshots] = await Promise.all([
    listRequestWorkspaceDocuments(event, session.id),
    session.active_document_id ? getRequestWorkspaceDocument(event, session.active_document_id) : Promise.resolve(null),
    listRequestWorkspaceMessages(event, session.id),
    listRequestWorkspaceTelemetryEvents(event, session.id),
    session.active_artifact_id ? getRequestWorkspaceArtifact(event, session.active_artifact_id) : Promise.resolve(null),
    listRequestWorkspaceLayoutSnapshots(event, session.id).catch(() => []),
  ]);
  const activeArtifactVersions = activeArtifact ? await listRequestWorkspaceArtifactVersions(event, activeArtifact.id) : [];

  return json({
    session,
    documents,
    activeDocument,
    messages,
    telemetry: telemetry.slice(-50),
    artifactState: {
      persistence: "cloud-or-memory-v1",
      activeArtifactId: session.active_artifact_id,
      activeArtifact,
      activeArtifactVersions,
      latestLayout: layoutSnapshots[0] ?? null,
      note: "JSON-render artifacts, versions, and active workspace pointers are restored through the workspace persistence adapter.",
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
  const deleted = await deleteRequestWorkspaceSession(event, session.id);
  if (!deleted) error(404, "Session not found");
  return json({ id: session.id, deleted: true });
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

import { error, json } from "@sveltejs/kit";
import {
  deleteWorkspaceSession,
  ensureWorkspaceSession,
  getWorkspaceDocument,
  getWorkspaceSession,
  listWorkspaceDocuments,
  patchWorkspaceSession,
} from "$lib/server/workspace-document-store";
import {
  listWorkspaceMessages,
  listWorkspaceTelemetryEvents,
} from "$lib/server/workspace-store";
import { routeString, WORKSPACE_TITLE_MAX_CHARS } from "$lib/server/workspace-route-limits";

export function GET({ params }) {
  const session = getWorkspaceSession(params.id);
  if (!session) error(404, "Session not found");

  return json({
    session,
    documents: listWorkspaceDocuments(session.id),
    activeDocument: session.active_document_id ? getWorkspaceDocument(session.active_document_id) : null,
    messages: listWorkspaceMessages(session.id),
    telemetry: listWorkspaceTelemetryEvents(session.id).slice(-50),
    artifactState: {
      persistence: "ephemeral-v0",
      activeArtifactId: session.active_artifact_id,
      note: "JSON-render artifacts are live UI state in v0; durable restore belongs to the artifact warehouse slice.",
    },
  });
}

export async function PATCH({ params, request }) {
  const session = getWorkspaceSession(params.id) ?? ensureWorkspaceSession(params.id);

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!isRecord(parsed)) error(400, "Session patch payload must be a JSON object");
    body = parsed;
  } catch (caught) {
    if (caught && typeof caught === "object" && "status" in caught) throw caught;
    error(400, "Invalid JSON session patch payload");
  }

  const name = routeString(body.name, "name", WORKSPACE_TITLE_MAX_CHARS, "").trim();
  if (!name) error(400, "Session name is required");
  const updated = patchWorkspaceSession(session.id, { name });
  if (!updated) error(404, "Session not found");
  return json(updated);
}

export function DELETE({ params }) {
  const session = getWorkspaceSession(params.id);
  if (!session) error(404, "Session not found");
  const deleted = deleteWorkspaceSession(session.id);
  if (!deleted) error(404, "Session not found");
  return json({ id: session.id, deleted: true });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

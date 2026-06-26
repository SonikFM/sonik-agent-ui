import { error, json } from "@sveltejs/kit";
import type { Spec } from "@json-render/core";
import {
  createRequestWorkspaceArtifact,
  getRequestWorkspaceArtifact,
  updateRequestWorkspaceArtifact,
  type WorkspaceArtifactKind,
  type WorkspaceDocumentVersionRecord,
} from "$lib/server/workspace-request-store";
import {
  routeString,
  WORKSPACE_CONTENT_MAX_CHARS,
  WORKSPACE_SESSION_ID_MAX_CHARS,
  WORKSPACE_TITLE_MAX_CHARS,
} from "$lib/server/workspace-route-limits";
import type { RequestHandler } from "./$types";

const ARTIFACT_ID_MAX_CHARS = 256;

export const POST: RequestHandler = async (event) => {
  let body: Record<string, unknown>;
  try {
    const parsed = await event.request.json();
    if (!isRecord(parsed)) error(400, "Artifact upsert payload must be a JSON object");
    body = parsed;
  } catch (caught) {
    if (caught && typeof caught === "object" && "status" in caught) throw caught;
    error(400, "Invalid JSON artifact upsert payload");
  }

  const id = routeString(body.id, "id", ARTIFACT_ID_MAX_CHARS, "").trim();
  if (!id) error(400, "Artifact id is required");
  const sessionId = routeString(body.session_id, "session_id", WORKSPACE_SESSION_ID_MAX_CHARS, "").trim();
  if (!sessionId) error(400, "Artifact session_id is required");
  const kind = normalizeKind(body.kind);
  const title = routeString(body.title, "title", WORKSPACE_TITLE_MAX_CHARS, "Untitled artifact").trim() || "Untitled artifact";
  const content = normalizeArtifactContent(body.content);
  const source = normalizeVersionSource(body.source);
  const summary = routeString(body.summary, "summary", WORKSPACE_CONTENT_MAX_CHARS, "Synced artifact snapshot");

  const existing = await getRequestWorkspaceArtifact(event, id);
  if (existing) {
    const updated = await updateRequestWorkspaceArtifact(event, id, { title, content, source, summary });
    if (!updated) error(404, "Artifact not found");
    return json({ artifact: updated, created: false });
  }

  const artifact = await createRequestWorkspaceArtifact(event, {
    id,
    session_id: sessionId,
    kind,
    title,
    content,
    source,
    summary,
  });
  return json({ artifact, created: true });
};

function normalizeKind(value: unknown): WorkspaceArtifactKind {
  return value === "document" ? "document" : "json-render";
}

function normalizeVersionSource(value: unknown): WorkspaceDocumentVersionRecord["source"] {
  if (value === "user" || value === "system" || value === "ai") return value;
  if (value === "user-edit" || value === "import") return "user";
  return "ai";
}

function normalizeArtifactContent(value: unknown): Spec {
  if (!isRecord(value)) error(400, "Artifact content must be a JSON object");
  if (typeof value.root !== "string" || !isRecord(value.elements)) error(400, "Artifact content must be a json-render spec with root and elements");
  return value as unknown as Spec;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

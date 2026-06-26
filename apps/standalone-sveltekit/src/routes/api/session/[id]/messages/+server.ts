import { error, json } from "@sveltejs/kit";
import { appendRequestWorkspaceMessage, getRequestWorkspaceSession, listRequestWorkspaceMessages } from "$lib/server/workspace-request-store";
import { routeString, WORKSPACE_CONTENT_MAX_CHARS, WORKSPACE_SESSION_ID_MAX_CHARS } from "$lib/server/workspace-route-limits";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async (event) => {
  const session = await getRequestWorkspaceSession(event, event.params.id);
  if (!session) error(404, "Session not found");
  return json(await listRequestWorkspaceMessages(event, session.id));
};

export const POST: RequestHandler = async (event) => {
  const session = await getRequestWorkspaceSession(event, event.params.id);
  if (!session) error(404, "Session not found");
  let body: Record<string, unknown>;
  try {
    const parsed = await event.request.json();
    if (!isRecord(parsed)) error(400, "Message payload must be a JSON object");
    body = parsed;
  } catch (caught) {
    if (caught && typeof caught === "object" && "status" in caught) throw caught;
    error(400, "Invalid JSON message payload");
  }

  const role = normalizeRole(body.role);
  const content = routeString(body.content, "content", WORKSPACE_CONTENT_MAX_CHARS, "");
  const id = routeString(body.id, "id", WORKSPACE_SESSION_ID_MAX_CHARS, "");
  const record = await appendRequestWorkspaceMessage(event, {
    session_id: session.id,
    id: id || undefined,
    role,
    content,
    parts: Array.isArray(body.parts) ? body.parts : null,
  });
  return json(record);
};

function normalizeRole(value: unknown): "system" | "user" | "assistant" | "tool" {
  if (value === "system" || value === "user" || value === "assistant" || value === "tool") return value;
  error(400, "role must be system, user, assistant, or tool");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

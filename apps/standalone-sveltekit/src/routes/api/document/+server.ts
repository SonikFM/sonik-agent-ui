import { json } from "@sveltejs/kit";
import { createRequestWorkspaceDocument } from "$lib/server/workspace-request-store";
import {
  routeString,
  WORKSPACE_CONTENT_MAX_CHARS,
  WORKSPACE_LANGUAGE_MAX_CHARS,
  WORKSPACE_SESSION_ID_MAX_CHARS,
  WORKSPACE_TITLE_MAX_CHARS,
} from "$lib/server/workspace-route-limits";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async (event) => {
  const body = await event.request.json();
  return json(await createRequestWorkspaceDocument(event, {
    session_id: routeString(body.session_id, "session_id", WORKSPACE_SESSION_ID_MAX_CHARS, "workspace-document-island"),
    title: routeString(body.title, "title", WORKSPACE_TITLE_MAX_CHARS, ""),
    content: routeString(body.content, "content", WORKSPACE_CONTENT_MAX_CHARS, ""),
    language: routeString(body.language, "language", WORKSPACE_LANGUAGE_MAX_CHARS, "markdown"),
  }));
};

import { error, json } from "@sveltejs/kit";
import { deleteRequestWorkspaceDocument, getRequestWorkspaceDocument, patchRequestWorkspaceDocument, updateRequestWorkspaceDocument } from "$lib/server/workspace-request-store";
import {
  optionalRouteString,
  WORKSPACE_CONTENT_MAX_CHARS,
  WORKSPACE_LANGUAGE_MAX_CHARS,
  WORKSPACE_SESSION_ID_MAX_CHARS,
  WORKSPACE_TITLE_MAX_CHARS,
} from "$lib/server/workspace-route-limits";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async (event) => {
  const document = await getRequestWorkspaceDocument(event, event.params.id);
  if (!document) error(404, "Document not found");
  return json(document);
};

export const PUT: RequestHandler = async (event) => {
  const body = await event.request.json();
  const document = await updateRequestWorkspaceDocument(event, event.params.id, {
    content: optionalRouteString(body.content, "content", WORKSPACE_CONTENT_MAX_CHARS),
    title: optionalRouteString(body.title, "title", WORKSPACE_TITLE_MAX_CHARS),
    language: optionalRouteString(body.language, "language", WORKSPACE_LANGUAGE_MAX_CHARS),
  });
  if (!document) error(404, "Document not found");
  return json(document);
};

export const PATCH: RequestHandler = async (event) => {
  const body = await event.request.json();
  const document = await patchRequestWorkspaceDocument(event, event.params.id, {
    content: optionalRouteString(body.content, "content", WORKSPACE_CONTENT_MAX_CHARS),
    title: optionalRouteString(body.title, "title", WORKSPACE_TITLE_MAX_CHARS),
    language: optionalRouteString(body.language, "language", WORKSPACE_LANGUAGE_MAX_CHARS),
    session_id: optionalRouteString(body.session_id, "session_id", WORKSPACE_SESSION_ID_MAX_CHARS),
  });
  if (!document) error(404, "Document not found");
  return json(document);
};

export const DELETE: RequestHandler = async (event) => {
  await deleteRequestWorkspaceDocument(event, event.params.id);
  return json({ ok: true });
};

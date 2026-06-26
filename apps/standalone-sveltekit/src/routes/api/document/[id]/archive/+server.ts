import { error, json } from "@sveltejs/kit";
import { archiveRequestWorkspaceDocument } from "$lib/server/workspace-request-store";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async (event) => {
  const archived = event.url.searchParams.get("archived") !== "false";
  const document = await archiveRequestWorkspaceDocument(event, event.params.id, archived);
  if (!document) error(404, "Document not found");
  return json(document);
};

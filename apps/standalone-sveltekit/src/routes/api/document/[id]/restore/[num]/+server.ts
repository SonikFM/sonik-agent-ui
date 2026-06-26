import { error, json } from "@sveltejs/kit";
import { restoreRequestWorkspaceDocumentVersion } from "$lib/server/workspace-request-store";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async (event) => {
  const document = await restoreRequestWorkspaceDocumentVersion(event, event.params.id, Number(event.params.num));
  if (!document) error(404, "Document version not found");
  return json(document);
};

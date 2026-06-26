import { error, json } from "@sveltejs/kit";
import { getRequestWorkspaceDocumentVersion } from "$lib/server/workspace-request-store";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async (event) => {
  const version = await getRequestWorkspaceDocumentVersion(event, event.params.id, Number(event.params.num));
  if (!version) error(404, "Document version not found");
  return json(version);
};

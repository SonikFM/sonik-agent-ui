import { json } from "@sveltejs/kit";
import { listRequestWorkspaceDocumentVersions } from "$lib/server/workspace-request-store";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async (event) => {
  return json(await listRequestWorkspaceDocumentVersions(event, event.params.id));
};

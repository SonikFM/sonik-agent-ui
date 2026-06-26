import { json } from "@sveltejs/kit";
import { listRequestWorkspaceDocuments } from "$lib/server/workspace-request-store";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async (event) => {
  return json(await listRequestWorkspaceDocuments(event, event.params.sessionId));
};

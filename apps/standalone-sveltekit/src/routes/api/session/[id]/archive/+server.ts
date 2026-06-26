import { error, json } from "@sveltejs/kit";
import { archiveRequestWorkspaceSession } from "$lib/server/workspace-request-store";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async (event) => {
  const session = await archiveRequestWorkspaceSession(event, event.params.id, true);
  if (!session) error(404, "Session not found");
  return json(session);
};

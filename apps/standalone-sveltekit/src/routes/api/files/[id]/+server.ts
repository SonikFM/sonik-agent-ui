import { json } from "@sveltejs/kit";
import {
  AgentUiFileError,
  deleteAgentUiFile,
  PRIVATE_FILE_HEADERS,
  readAgentUiFile,
  requireAgentUiFileBucket,
  resolveAgentUiWorkspaceSession,
  type AgentUiFileBucket,
} from "$lib/server/agent-ui-files";
import type { RequestHandler } from "./$types";
import { resolveSignedWorkspaceSessionId } from "$lib/server/workspace-services";

export const GET: RequestHandler = async (event) => {
  try {
    return await readAgentUiFile(await dependencies(event));
  } catch (error) {
    return routeError(error, "File read failed");
  }
};

export const DELETE: RequestHandler = async (event) => {
  try {
    const file = await deleteAgentUiFile(await dependencies(event));
    return json({ id: file.id, deleted: true }, { headers: PRIVATE_FILE_HEADERS });
  } catch (error) {
    return routeError(error, "File deletion failed");
  }
};

async function dependencies(event: Parameters<RequestHandler>[0]) {
  const workspace = await resolveAgentUiWorkspaceSession(event, { sessionId: resolveSignedWorkspaceSessionId(event) });
  return {
    id: event.params.id,
    ...workspace,
    bucket: requireAgentUiFileBucket(event.platform?.env?.AGENT_UI_FILES_BUCKET as AgentUiFileBucket | undefined),
  };
}

function routeError(error: unknown, fallback: string): Response {
  if (error instanceof AgentUiFileError) {
    return Response.json({ error: error.message }, { status: error.status, headers: PRIVATE_FILE_HEADERS });
  }
  console.error(fallback, error);
  return Response.json({ error: fallback }, { status: 500, headers: PRIVATE_FILE_HEADERS });
}

import { json } from "@sveltejs/kit";
import {
  AgentUiFileError,
  deleteAgentUiFile,
  PRIVATE_FILE_HEADERS,
  readAgentUiFile,
  requireAgentUiFileBucket,
  resolveAgentUiWorkspaceSession,
  type AgentUiFileBucket,
  type AgentUiFileErrorCode,
  type AgentUiFileErrorPhase,
} from "$lib/server/agent-ui-files";
import type { RequestHandler } from "./$types";
import { resolveSignedWorkspaceSessionId } from "$lib/server/workspace-services";

export const GET: RequestHandler = async (event) => {
  try {
    return await readAgentUiFile(await dependencies(event, "read"));
  } catch (error) {
    return routeError(event, error, { message: "File read failed", code: "file_read_failed", phase: "read" });
  }
};

export const DELETE: RequestHandler = async (event) => {
  try {
    const file = await deleteAgentUiFile(await dependencies(event, "pre_write"));
    return json({ id: file.id, deleted: true }, { headers: PRIVATE_FILE_HEADERS });
  } catch (error) {
    return routeError(event, error, { message: "File deletion failed", code: "file_delete_failed", phase: "post_write" });
  }
};

async function dependencies(event: Parameters<RequestHandler>[0], phase: "read" | "pre_write") {
  const workspace = await resolveAgentUiWorkspaceSession(event, {
    sessionId: resolveSignedWorkspaceSessionId(event),
    phase,
    safeToRetry: phase === "read",
  });
  return {
    id: event.params.id,
    ...workspace,
    bucket: requireAgentUiFileBucket(event.platform?.env?.AGENT_UI_FILES_BUCKET as AgentUiFileBucket | undefined),
  };
}

function routeError(
  event: Parameters<RequestHandler>[0],
  error: unknown,
  fallback: { message: string; code: AgentUiFileErrorCode; phase: AgentUiFileErrorPhase },
): Response {
  const requestId = event.request.headers.get("x-sonik-request-id") ?? undefined;
  const traceId = event.request.headers.get("x-sonik-trace-id") ?? undefined;
  if (error instanceof AgentUiFileError) {
    return Response.json({
      ok: false,
      error: error.message,
      code: error.code,
      phase: error.phase,
      safeToRetry: error.safeToRetry,
      ...(requestId ? { requestId } : {}),
      ...(traceId ? { traceId } : {}),
    }, { status: error.status, headers: correlationHeaders(requestId, traceId) });
  }
  console.error(fallback.message, { category: fallback.code });
  return Response.json({ ok: false, error: fallback.message, code: fallback.code, phase: fallback.phase, safeToRetry: false, ...(requestId ? { requestId } : {}), ...(traceId ? { traceId } : {}) }, { status: 500, headers: correlationHeaders(requestId, traceId) });
}

function correlationHeaders(requestId?: string, traceId?: string): Record<string, string> {
  return {
    ...PRIVATE_FILE_HEADERS,
    ...(requestId ? { "x-sonik-request-id": requestId } : {}),
    ...(traceId ? { "x-sonik-trace-id": traceId } : {}),
  };
}

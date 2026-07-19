import { json } from "@sveltejs/kit";
import {
  AgentUiFileError,
  PRIVATE_FILE_HEADERS,
  requireAgentUiFileBucket,
  resolveAgentUiWorkspaceSession,
  toPublicAgentUiFile,
  uploadAgentUiFile,
  type AgentUiFileBucket,
} from "$lib/server/agent-ui-files";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async (event) => {
  try {
    if (!event.request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
      return failure(event, new AgentUiFileError(415, "multipart/form-data is required", { code: "invalid_request", phase: "pre_write" }));
    }
    const form = await event.request.formData().catch(() => null);
    if (!form) return failure(event, new AgentUiFileError(400, "Invalid multipart form data", { code: "invalid_request", phase: "pre_write" }));
    const file = form.get("file");
    const sessionId = form.get("session_id");
    if (!(file instanceof File)) return failure(event, new AgentUiFileError(400, "Multipart file field is required", { code: "invalid_request", phase: "pre_write" }));
    if (typeof sessionId !== "string" || !sessionId.trim()) return failure(event, new AgentUiFileError(400, "session_id is required", { code: "invalid_request", phase: "pre_write" }));
    const workspace = await resolveAgentUiWorkspaceSession(event, { sessionId, phase: "pre_write", safeToRetry: true });
    // Authentication and session ownership must be established before either
    // the file catalog or private object storage can be touched.
    const bucket = requireAgentUiFileBucket(event.platform?.env?.AGENT_UI_FILES_BUCKET as AgentUiFileBucket | undefined);

    const record = await uploadAgentUiFile({
      file,
      ...workspace,
      bucket,
    });
    return json(toPublicAgentUiFile(record), { status: 201, headers: PRIVATE_FILE_HEADERS });
  } catch (error) {
    if (error instanceof AgentUiFileError) return failure(event, error);
    console.error("Agent UI file upload failed", { category: "upload_unexpected" });
    return failure(event, new AgentUiFileError(500, "File upload failed", { code: "file_upload_failed", phase: "post_write" }));
  }
};

function failure(event: Parameters<RequestHandler>[0], error: AgentUiFileError): Response {
  const requestId = event.request.headers.get("x-sonik-request-id") ?? undefined;
  const traceId = event.request.headers.get("x-sonik-trace-id") ?? undefined;
  return Response.json({
    ok: false,
    error: error.message,
    code: error.code,
    phase: error.phase,
    safeToRetry: error.safeToRetry,
    ...(requestId ? { requestId } : {}),
    ...(traceId ? { traceId } : {}),
    ...(error.retryFileId ? { retry_file_id: error.retryFileId } : {}),
  }, {
    status: error.status,
    headers: {
      ...PRIVATE_FILE_HEADERS,
      ...(requestId ? { "x-sonik-request-id": requestId } : {}),
      ...(traceId ? { "x-sonik-trace-id": traceId } : {}),
    },
  });
}

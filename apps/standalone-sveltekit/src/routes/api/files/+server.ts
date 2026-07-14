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
    const bucket = requireAgentUiFileBucket(event.platform?.env?.AGENT_UI_FILES_BUCKET as AgentUiFileBucket | undefined);
    if (!event.request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
      return failure(415, "multipart/form-data is required");
    }
    const form = await event.request.formData().catch(() => null);
    if (!form) return failure(400, "Invalid multipart form data");
    const file = form.get("file");
    const sessionId = form.get("session_id");
    if (!(file instanceof File)) return failure(400, "Multipart file field is required");
    if (typeof sessionId !== "string" || !sessionId.trim()) return failure(400, "session_id is required");
    const workspace = await resolveAgentUiWorkspaceSession(event, { sessionId });

    const record = await uploadAgentUiFile({
      file,
      ...workspace,
      bucket,
    });
    return json(toPublicAgentUiFile(record), { status: 201, headers: PRIVATE_FILE_HEADERS });
  } catch (error) {
    if (error instanceof AgentUiFileError) return failure(error.status, error.message, error.retryFileId);
    console.error("Agent UI file upload failed", error);
    return failure(500, "File upload failed");
  }
};

function failure(status: number, message: string, retryFileId?: string): Response {
  return Response.json({ error: message, ...(retryFileId ? { retry_file_id: retryFileId } : {}) }, { status, headers: PRIVATE_FILE_HEADERS });
}

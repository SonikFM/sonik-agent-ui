import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { visualContextRequestSchema } from "@sonik-agent-ui/tool-contracts/visual-context";
import { emitVisualBrowserTelemetry } from "$lib/server/visual-context-coordinator";
import { DEV_WORKBENCH_SESSION_COOKIE } from "$lib/server/session-cookie";
import { runWorkspacePlaywrightVisualContext } from "$lib/server/workspace-service";

const NO_STORE = { "cache-control": "no-store, max-age=0" };
const MAX_REQUEST_BYTES = 32 * 1024;
export const config = { runtime: "nodejs24.x", maxDuration: 180 };

export const POST: RequestHandler = async ({ cookies, request }) => {
  const sessionId = cookies.get(DEV_WORKBENCH_SESSION_COOKIE);
  if (!sessionId) return json({ error: "No Dev Workbench session is attached." }, { status: 404, headers: NO_STORE });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_REQUEST_BYTES) return json({ error: "Visual browser request is too large." }, { status: 413, headers: NO_STORE });
  let input: unknown;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text) > MAX_REQUEST_BYTES) return json({ error: "Visual browser request is too large." }, { status: 413, headers: NO_STORE });
    input = JSON.parse(text);
  } catch { return json({ error: "Visual browser request must be valid JSON." }, { status: 400, headers: NO_STORE }); }
  const parsed = visualContextRequestSchema.safeParse(input);
  if (!parsed.success || !["get-capabilities", "setup-browser", "capture"].includes(parsed.data.operation) || parsed.data.provider !== "playwright") {
    return json({ error: "Visual browser request is invalid." }, { status: 400, headers: NO_STORE });
  }
  emitVisualBrowserTelemetry({ workspaceSessionId: sessionId, request: parsed.data, phase: "started", status: "started" });
  const result = await runWorkspacePlaywrightVisualContext(sessionId, parsed.data, request.signal);
  if (!result.ok) {
    emitVisualBrowserTelemetry({ workspaceSessionId: sessionId, request: parsed.data, phase: "failed", status: result.error.code, accepted: false });
    return json({ error: result.error }, { status: result.error.retryable ? 502 : 400, headers: NO_STORE });
  }
  const accepted = result.value.accepted && result.value.result.status === "completed";
  emitVisualBrowserTelemetry({
    workspaceSessionId: sessionId,
    request: parsed.data,
    phase: accepted ? "completed" : "failed",
    status: result.value.result.status,
    accepted,
  });
  return json({ ...result.value, accepted }, { status: accepted ? 200 : 202, headers: NO_STORE });
};

import { env } from "$env/dynamic/private";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import {
  emitVisualContextTelemetry,
  visualContextInvalidationSchema,
  visualContextSubmissionSchema,
  type VisualContextSubmission,
  type VisualContextTelemetryEventName,
} from "$lib/server/visual-context-coordinator";
import { DEV_WORKBENCH_SESSION_COOKIE } from "$lib/server/session-cookie";
import { readDevWorkbenchConfig } from "$lib/server/workbench-config";
import {
  invalidateWorkspaceVisualContext,
  readWorkspaceVisualContext,
  submitWorkspaceVisualContext,
} from "$lib/server/workspace-service";

const NO_STORE = { "cache-control": "no-store, max-age=0" };
const MAX_BODY_BYTES = 14 * 1_024 * 1_024;

export const config = { runtime: "nodejs24.x", maxDuration: 60 };

export const GET: RequestHandler = async ({ cookies, request, url }) => {
  const configuration = readDevWorkbenchConfig(env);
  if (!configuration.ok) return json({ error: configuration.reason }, { status: 503, headers: NO_STORE });
  const sessionId = cookies.get(DEV_WORKBENCH_SESSION_COOKIE);
  if (!sessionId) return json({ error: "No Dev Workbench session is attached." }, { status: 404, headers: NO_STORE });
  const wantsPng = url.searchParams.get("asset") === "png" || request.headers.get("accept") === "image/png";
  const result = await readWorkspaceVisualContext(sessionId, wantsPng, request.signal);
  if (!result.ok) return json({ error: result.error }, { status: 404, headers: NO_STORE });
  if (wantsPng && result.value.png) {
    return new Response(new Uint8Array(result.value.png), { headers: { ...NO_STORE, "content-type": "image/png" } });
  }
  return json({ snapshot: result.value.snapshot }, { headers: NO_STORE });
};

export const POST: RequestHandler = async ({ cookies, request }) => {
  const configuration = readDevWorkbenchConfig(env);
  if (!configuration.ok) return json({ error: configuration.reason }, { status: 503, headers: NO_STORE });
  const sessionId = cookies.get(DEV_WORKBENCH_SESSION_COOKIE);
  if (!sessionId) return json({ error: "No Dev Workbench session is attached." }, { status: 404, headers: NO_STORE });
  const input = await parseBoundedJson(request);
  if (!input.ok) return json({ error: input.error }, { status: input.status, headers: NO_STORE });
  const parsed = visualContextSubmissionSchema.safeParse(input.value);
  if (!parsed.success) return json({ error: "Visual context submission is invalid." }, { status: 400, headers: NO_STORE });
  emitLifecycleEvent(sessionId, parsed.data, parsed.data.request.operation === "pick"
    ? "visual_context.picker.started"
    : parsed.data.request.operation === "capture" ? "visual_context.capture.started" : null, undefined, "started");
  const result = await submitWorkspaceVisualContext(sessionId, parsed.data, request.signal);
  if (!result.ok) {
    emitLifecycleEvent(sessionId, parsed.data, parsed.data.request.operation === "capture"
      ? "visual_context.capture.failed"
      : "visual_context.result.discarded", false);
    return json({ error: result.error }, { status: result.error.retryable ? 409 : 400, headers: NO_STORE });
  }
  emitLifecycleEvent(sessionId, parsed.data, terminalEvent(parsed.data.result.operation, parsed.data.result.status, result.value.accepted), result.value.accepted);
  return json(result.value, { status: result.value.accepted ? 200 : 202, headers: NO_STORE });
};

export const DELETE: RequestHandler = async ({ cookies, request }) => {
  const configuration = readDevWorkbenchConfig(env);
  if (!configuration.ok) return json({ error: configuration.reason }, { status: 503, headers: NO_STORE });
  const sessionId = cookies.get(DEV_WORKBENCH_SESSION_COOKIE);
  if (!sessionId) return json({ error: "No Dev Workbench session is attached." }, { status: 404, headers: NO_STORE });
  const input = await parseBoundedJson(request);
  if (!input.ok) return json({ error: input.error }, { status: input.status, headers: NO_STORE });
  const parsed = visualContextInvalidationSchema.safeParse(input.value);
  if (!parsed.success) return json({ error: "Visual context invalidation is invalid." }, { status: 400, headers: NO_STORE });
  const result = await invalidateWorkspaceVisualContext(sessionId, parsed.data, request.signal);
  if (!result.ok) return json({ error: result.error }, { status: result.error.retryable ? 409 : 400, headers: NO_STORE });
  return json(result.value, { headers: NO_STORE });
};

async function parseBoundedJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; error: string; status: 400 | 413 }> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return { ok: false, error: "Visual context payload exceeds the 14 MiB limit.", status: 413 };
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return { ok: false, error: "Visual context payload exceeds the 14 MiB limit.", status: 413 };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, error: "Visual context payload must be valid JSON.", status: 400 };
  }
}

function terminalEvent(operation: string, status: string, accepted: boolean): VisualContextTelemetryEventName | null {
  if (!accepted) return status === "cancelled" && operation === "pick"
    ? "visual_context.picker.cancelled"
    : operation === "capture" && status === "failed" ? "visual_context.capture.failed" : "visual_context.result.discarded";
  if (operation === "pick") return "visual_context.target.selected";
  if (operation === "capture") return "visual_context.capture.completed";
  if (operation === "setup-browser") return "visual_context.browser_setup.changed";
  if (operation === "pair-extension" || operation === "unpair-extension") return "visual_context.extension_pairing.changed";
  return null;
}

function emitLifecycleEvent(
  workspaceSessionId: string,
  input: VisualContextSubmission,
  event: VisualContextTelemetryEventName | null,
  accepted?: boolean,
  status = input.result.status,
): void {
  if (!event) return;
  emitVisualContextTelemetry({
    event,
    workspaceSessionId,
    requestId: input.request.requestId,
    operation: input.request.operation,
    provider: input.request.provider,
    status,
    accepted,
    sourceContextRevision: input.request.sourceContextRevision,
    routeRevision: input.request.routeRevision,
  });
}

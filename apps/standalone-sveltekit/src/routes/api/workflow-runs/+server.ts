// P1 #5 (production-readiness-agent-creation-2026-07-13.md): thin HTTP wrapper around
// $lib/server/workflow-runs.ts (the controller's first production caller). All logic lives in
// that plain module so it stays testable without a SvelteKit runtime, matching the
// api/reservation/commit precedent.
import { json } from "@sveltejs/kit";
import { createAgentHostSessionEnvelope } from "$lib/server/host-command-runtime";
import { handleWorkflowRunsAction, type WorkflowRunsAction } from "$lib/server/workflow-runs";
import { resolveWorkflowRunStore } from "$lib/server/workflow-run-store";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async (event) => {
  const body = await event.request.json().catch(() => null);
  if (!body || typeof body !== "object" || typeof (body as Record<string, unknown>).action !== "string") {
    return json({ ok: false, error: "invalid_json_body" }, { status: 400 });
  }
  const action = body as WorkflowRunsAction;
  if (!["start", "preview", "approve", "commit"].includes(action.action)) {
    return json({ ok: false, error: "unknown_action" }, { status: 400 });
  }

  const hostSession = createAgentHostSessionEnvelope(event);
  const store = resolveWorkflowRunStore(event.platform?.env as Record<string, unknown> | undefined);
  const result = await handleWorkflowRunsAction(action, { hostSession, store });
  return json(result, { status: 200 });
};

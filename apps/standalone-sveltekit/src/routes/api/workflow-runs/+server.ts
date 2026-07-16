// P1 #5 (production-readiness-agent-creation-2026-07-13.md): thin HTTP wrapper around
// $lib/server/workflow-runs.ts (the controller's first production caller). All logic lives in
// that plain module so it stays testable without a SvelteKit runtime, matching the
// api/reservation/commit precedent.
import { json } from "@sveltejs/kit";
import { createAgentHostSessionEnvelope } from "$lib/server/host-command-runtime";
import { handleWorkflowRunsAction, workflowRunOwnerFromHostSession, type WorkflowRunsAction } from "$lib/server/workflow-runs";
import { resolveWorkflowRunJournalStore, resolveWorkflowRunStore } from "$lib/server/workflow-run-store";
import { resolveWorkflowDefinitionRepository } from "$lib/server/workflow-definition-repository";
import { handlePublicWorkflowDriverAction, type PublicWorkflowDriverAction } from "$lib/server/workflow-runs-public";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async (event) => {
  const body = await event.request.json().catch(() => null);
  if (!body || typeof body !== "object" || typeof (body as Record<string, unknown>).action !== "string") {
    return json({ ok: false, error: "invalid_json_body" }, { status: 400 });
  }
  const action = body as WorkflowRunsAction;
  if (!["start", "preview", "approve", "commit", "run_until_blocked", "resume_run", "cancel_run"].includes(action.action)) {
    return json({ ok: false, error: "unknown_action" }, { status: 400 });
  }

  const hostSession = createAgentHostSessionEnvelope(event);
  if (!hostSession || !workflowRunOwnerFromHostSession(hostSession)) {
    return json({ ok: false, reason: "authenticated_workspace_owner_required" }, { status: 401 });
  }
  const env = event.platform?.env as Record<string, unknown> | undefined;
  const store = resolveWorkflowRunStore(env);
  if (action.action === "run_until_blocked" || action.action === "resume_run" || action.action === "cancel_run") {
    const response = await handlePublicWorkflowDriverAction(action as PublicWorkflowDriverAction, {
      hostSession,
      store,
      journal: resolveWorkflowRunJournalStore(env),
      repository: resolveWorkflowDefinitionRepository(env),
    });
    return json(response.result, { status: response.status });
  }
  const result = await handleWorkflowRunsAction(action, {
    hostSession,
    store,
    env,
    repository: resolveWorkflowDefinitionRepository(env),
  });
  return json(result, { status: 200 });
};

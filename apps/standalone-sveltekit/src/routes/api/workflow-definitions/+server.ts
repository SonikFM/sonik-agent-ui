import { json } from "@sveltejs/kit";
import { createAgentHostSessionEnvelope } from "$lib/server/host-command-runtime";
import { resolveWorkflowDefinitionRepository } from "$lib/server/workflow-definition-repository";
import { handleWorkflowDefinitionsAction, workflowDefinitionOwnerFromHostSession, type WorkflowDefinitionsAction } from "$lib/server/workflow-definitions";
import type { RequestHandler } from "./$types";
import { resolveStandaloneCapabilityReadiness } from "$lib/server/standalone-capability-readiness";
import { approvedCommandIdsFromHostSession } from "$lib/server/host-command-runtime";

const ACTIONS = new Set(["create", "update", "organizer_patch", "get", "list", "publish", "versions", "archive", "clone", "resolve"]);

export const POST: RequestHandler = async (event) => {
  const body = await event.request.json().catch(() => null);
  if (!body || typeof body !== "object" || !ACTIONS.has(String((body as { action?: unknown }).action))) return json({ ok: false, reason: "invalid_action" }, { status: 400 });
  const hostSession = createAgentHostSessionEnvelope(event);
  if (!workflowDefinitionOwnerFromHostSession(hostSession)) return json({ ok: false, reason: "authenticated_workspace_owner_required" }, { status: 401 });
  const repository = resolveWorkflowDefinitionRepository(event.platform?.env as Record<string, unknown> | undefined);
  const result = await handleWorkflowDefinitionsAction(body as WorkflowDefinitionsAction, {
    hostSession,
    repository,
    capabilityReadiness: resolveStandaloneCapabilityReadiness({ hostSession, approvedCommandIds: approvedCommandIdsFromHostSession(hostSession) }),
  });
  const status = result.ok ? 200 : result.reason.includes("conflict") || result.reason.includes("exists") ? 409 : 400;
  return json(result, { status });
};

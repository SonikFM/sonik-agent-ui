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
  let action = body as WorkflowRunsAction;
  const publicBody = body as Record<string, unknown>;
  if (!["start", "preview", "approve", "commit", "run_until_blocked", "resume_run", "cancel_run"].includes(action.action)) {
    return json({ ok: false, error: "unknown_action" }, { status: 400 });
  }

  const hostSession = createAgentHostSessionEnvelope(event);
  if (!workflowRunOwnerFromHostSession(hostSession)) {
    return json({ ok: false, reason: "authenticated_workspace_owner_required" }, { status: 401 });
  }
  const env = event.platform?.env as Record<string, unknown> | undefined;
  const store = resolveWorkflowRunStore(env);
  if (action.action === "run_until_blocked" || action.action === "resume_run" || action.action === "cancel_run") {
    const owner = workflowRunOwnerFromHostSession(hostSession)!;
    if (action.action === "cancel_run" && "lease" in publicBody) return json({ ok: false, reason: "public_lease_forbidden" }, { status: 400 });
    const request = action.action === "cancel_run" ? {} : action.request;
    if (!request || typeof request !== "object" || Array.isArray(request)) return json({ ok: false, reason: "invalid_driver_request" }, { status: 400 });
    const publicRequest = request as Record<string, unknown>;
    for (const field of ["workflowVersionId", "runInput", "lease", "hostSigned"]) {
      if (field in publicRequest) return json({ ok: false, reason: `public_${field}_forbidden` }, { status: 400 });
    }
    if (action.action !== "resume_run" && "resumeEvent" in publicRequest) return json({ ok: false, reason: "resume_event_not_allowed" }, { status: 400 });
    const runId = action.action === "cancel_run" ? action.runId : String(publicRequest.workflowRunId ?? "");
    if (!runId) return json({ ok: false, reason: "workflowRunId_required" }, { status: 400 });
    const row = await store.getRun(owner, runId);
    if (!row) return json({ ok: false, reason: "run_not_found" }, { status: 404 });
    const repository = resolveWorkflowDefinitionRepository(env);
    const published = await repository.getPublished(owner, row.workflowVersionId);
    if (!published || published.workflowId !== row.workflowId) return json({ ok: false, reason: "published_workflow_not_found" }, { status: 404 });
    const parsedResumeEvent = action.action === "resume_run" ? publicResumeEventSchema.safeParse(publicRequest.resumeEvent) : null;
    if (action.action === "resume_run" && !parsedResumeEvent?.success) return json({ ok: false, reason: "invalid_resume_event" }, { status: 400 });
    const signedResumeEvent = parsedResumeEvent?.success ? { ...parsedResumeEvent.data, organizationId: owner.organizationId, subjectId: owner.userId, authenticationEvidenceDigest: digest(`${hostSession?.sessionId ?? owner.userId}:${owner.organizationId}`) } : undefined;
    const lease = { leaseId: randomUUID(), ownerId: `api:${owner.userId}`, expiresAt: new Date(Date.now() + 30_000).toISOString() };
    const serverRequest = { workflowRunId: runId, resumeEvent: signedResumeEvent, lease, budget: { maxNodes: 20, maxWallTimeMs: 10_000 } };
    action = action.action === "cancel_run" ? { action: "cancel_run", runId, lease } : { ...action, request: serverRequest } as WorkflowRunsAction;
    const readiness = () => resolveStandaloneCapabilityReadiness({ hostSession, approvedCommandIds: approvedCommandIdsFromHostSession(hostSession) });
    const journal = resolveWorkflowRunJournalStore(env);
    driverLease = { owner, runId, leaseId: lease.leaseId };
    driver = new WorkflowRunDriver({
      journal, owner, definition: published.definition,
      initialState: {
        workflowRunId: runId, organizationId: owner.organizationId,
        source: { kind: "published", organizationId: owner.organizationId, workflowVersionId: published.workflowVersionId, definitionDigest: published.definitionDigest },
        status: "ready", revision: 0, eventSequence: 0, selectedPath: [], schedulerFrontier: [published.definition.entryNodeId], outputs: {}, outputRefs: {}, waits: [], compatibilityPhase: "ready", dependencyPins: published.dependencyPins,
      },
      runInput: row.input as never,
      hostContext: { organizationId: owner.organizationId, principalId: owner.userId },
      resolveReadiness: readiness,
      resolveDependencyPins: () => published.dependencyPins,
      executionContext: (node) => ({
        subjectId: owner.userId,
        ...(node.nodeType === "ask_user" && signedResumeEvent?.kind === "answer" ? { answer: signedResumeEvent.answer } : {}),
        ...(node.nodeType === "approval" && signedResumeEvent?.kind === "approval" ? { approvalDecision: "approved" as const } : {}),
      }),
      approvalDecision: (commitNodeId, externalEffectIdentity) => {
        if (signedResumeEvent?.kind !== "approval") return undefined;
        const commit = published.definition.nodes.find((node) => node.nodeId === commitNodeId && node.nodeType === "tool_commit");
        if (!commit?.effectBinding || signedResumeEvent.logicalEffectId !== commit.effectBinding.logicalEffectId) return undefined;
        return { decisionId: String(signedResumeEvent.eventId), decision: "approved", runId, approvalNodeId: commit.effectBinding.approvalNodeId, previewNodeId: commit.effectBinding.previewNodeId, commitNodeId, commandId: commit.effectBinding.commandId, logicalEffectId: commit.effectBinding.logicalEffectId, organizationId: owner.organizationId, approverId: owner.userId, grantEvidenceDigest: digest(JSON.stringify(readiness())), resolvedInputHash: commit.effectBinding.resolvedInputHash, externalEffectIdentity, issuedAt: String(signedResumeEvent.issuedAt), expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), hostSigned: true };
      },
    });
    return json(response.result, { status: response.status });
  }
  const result = await handleWorkflowRunsAction(action, { hostSession, store, env });
  return json(result, { status: 200 });
};

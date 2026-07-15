import { createHash, randomUUID } from "node:crypto";
import type { HostSessionEnvelope } from "@sonik-agent-ui/platform-adapters";
import { publicResumeEventSchema } from "@sonik-agent-ui/tool-contracts/workflow-vnext";
import { approvedCommandIdsFromHostSession } from "./host-command-runtime.ts";
import { resolveStandaloneCapabilityReadiness } from "./standalone-capability-readiness.ts";
import type { WorkflowDefinitionRepository } from "./workflow-definition-repository.ts";
import { WorkflowRunDriver } from "./workflow-run-driver.ts";
import type { AsyncWorkflowRunStore, WorkflowRunJournalStore } from "./workflow-run-store.ts";
import { handleWorkflowRunsAction, workflowRunOwnerFromHostSession, type WorkflowRunsAction, type WorkflowRunsResult } from "./workflow-runs.ts";

export type PublicWorkflowDriverAction =
  | { action: "run_until_blocked"; request: unknown }
  | { action: "resume_run"; request: unknown }
  | { action: "cancel_run"; runId: string };

export interface PublicWorkflowDriverDeps {
  hostSession: HostSessionEnvelope;
  store: AsyncWorkflowRunStore;
  journal: WorkflowRunJournalStore;
  repository: WorkflowDefinitionRepository;
}

export interface PublicWorkflowDriverResponse {
  status: number;
  result: WorkflowRunsResult;
}

export async function handlePublicWorkflowDriverAction(action: PublicWorkflowDriverAction, deps: PublicWorkflowDriverDeps): Promise<PublicWorkflowDriverResponse> {
  const owner = workflowRunOwnerFromHostSession(deps.hostSession);
  if (!owner) return failure(401, "authenticated_workspace_owner_required");
  if (action.action === "cancel_run" && "lease" in action) return failure(400, "public_lease_forbidden");
  const request = action.action === "cancel_run" ? {} : action.request;
  if (!request || typeof request !== "object" || Array.isArray(request)) return failure(400, "invalid_driver_request");
  const publicRequest = request as Record<string, unknown>;
  for (const field of ["workflowVersionId", "runInput", "lease", "hostSigned"]) {
    if (field in publicRequest) return failure(400, `public_${field}_forbidden`);
  }
  if (action.action !== "resume_run" && "resumeEvent" in publicRequest) return failure(400, "resume_event_not_allowed");
  const runId = action.action === "cancel_run" ? action.runId : String(publicRequest.workflowRunId ?? "");
  if (!runId) return failure(400, "workflowRunId_required");
  const row = await deps.store.getRun(owner, runId);
  if (!row) return failure(404, "run_not_found");
  const published = await deps.repository.getPublished(owner, row.workflowVersionId);
  if (!published || published.workflowId !== row.workflowId) return failure(404, "published_workflow_not_found");
  const parsedResumeEvent = action.action === "resume_run" ? publicResumeEventSchema.safeParse(publicRequest.resumeEvent) : null;
  if (action.action === "resume_run" && !parsedResumeEvent?.success) return failure(400, "invalid_resume_event");
  const signedResumeEvent = parsedResumeEvent?.success ? {
    ...parsedResumeEvent.data,
    organizationId: owner.organizationId,
    subjectId: owner.userId,
    authenticationEvidenceDigest: digest(`${deps.hostSession.sessionId ?? owner.userId}:${owner.organizationId}`),
  } : undefined;
  const lease = { leaseId: randomUUID(), ownerId: `api:${owner.userId}`, expiresAt: new Date(Date.now() + 30_000).toISOString() };
  const serverRequest = { workflowRunId: runId, resumeEvent: signedResumeEvent, lease, budget: { maxNodes: 20, maxWallTimeMs: 10_000 } };
  const internalAction: WorkflowRunsAction = action.action === "cancel_run"
    ? { action: "cancel_run", runId, lease }
    : { ...action, request: serverRequest };
  const readiness = () => resolveStandaloneCapabilityReadiness({ hostSession: deps.hostSession, approvedCommandIds: approvedCommandIdsFromHostSession(deps.hostSession) });
  const driver = new WorkflowRunDriver({
    journal: deps.journal,
    owner,
    definition: published.definition,
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
    approvalDecision: (commitNodeId) => {
      if (signedResumeEvent?.kind !== "approval") return undefined;
      const commit = published.definition.nodes.find((node) => node.nodeId === commitNodeId && node.nodeType === "tool_commit");
      if (!commit?.effectBinding || signedResumeEvent.logicalEffectId !== commit.effectBinding.logicalEffectId) return undefined;
      return { decisionId: signedResumeEvent.eventId, decision: "approved", runId, approvalNodeId: commit.effectBinding.approvalNodeId, previewNodeId: commit.effectBinding.previewNodeId, commitNodeId, commandId: commit.effectBinding.commandId, logicalEffectId: commit.effectBinding.logicalEffectId, organizationId: owner.organizationId, approverId: owner.userId, grantEvidenceDigest: digest(JSON.stringify(readiness())), resolvedInputHash: commit.effectBinding.resolvedInputHash, issuedAt: signedResumeEvent.issuedAt, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), hostSigned: true };
    },
  });
  try {
    return { status: 200, result: await handleWorkflowRunsAction(internalAction, { hostSession: deps.hostSession, store: deps.store, driver }) };
  } finally {
    await deps.journal.releaseLease(owner, runId, lease.leaseId);
  }
}

function failure(status: number, reason: string): PublicWorkflowDriverResponse {
  return { status, result: { ok: false, reason } };
}

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

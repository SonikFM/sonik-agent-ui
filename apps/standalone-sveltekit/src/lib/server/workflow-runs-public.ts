import { createHash, randomUUID } from "node:crypto";
import type { HostSessionEnvelope } from "@sonik-agent-ui/platform-adapters";
import { approvalDecisionSchema, publicResumeEventSchema, type CapabilityReadiness, type WorkflowVNextNode } from "@sonik-agent-ui/tool-contracts/workflow-vnext";
import { approvedCommandIdsFromHostSession } from "./host-command-runtime.ts";
import { resolveStandaloneCapabilityReadiness } from "./standalone-capability-readiness.ts";
import type { WorkflowDefinitionRepository } from "./workflow-definition-repository.ts";
import { WorkflowRunDriver } from "./workflow-run-driver.ts";
import type { WorkflowBindingResolutionContext, WorkflowNodeExecutionContext } from "./workflow-node-executors.ts";
import type { AsyncWorkflowRunStore, WorkflowRunJournalStore } from "./workflow-run-store.ts";
import { handleWorkflowRunsAction, workflowRunOwnerFromHostSession, type WorkflowRunsAction, type WorkflowRunsResult } from "./workflow-runs.ts";

export type PublicWorkflowDriverAction =
  | Extract<WorkflowRunsAction, { action: "start" }>
  | { action: "preview" | "approve" | "commit"; runId: string; nodeId?: string }
  | { action: "run_until_blocked"; request: unknown }
  | { action: "resume_run"; request: unknown }
  | { action: "cancel_run"; runId: string; lease?: unknown };

export interface PublicWorkflowDriverDeps {
  hostSession: HostSessionEnvelope;
  store: AsyncWorkflowRunStore;
  journal: WorkflowRunJournalStore;
  repository: WorkflowDefinitionRepository;
  executionContext?: (node: WorkflowVNextNode) => WorkflowNodeExecutionContext;
  resolveReadiness?: (approvedCommandIds?: readonly string[]) => readonly CapabilityReadiness[];
  loadArtifact?: WorkflowBindingResolutionContext["loadArtifact"];
}

export interface PublicWorkflowDriverResponse {
  status: number;
  result: WorkflowRunsResult;
}

export async function handlePublicWorkflowDriverAction(action: PublicWorkflowDriverAction, deps: PublicWorkflowDriverDeps): Promise<PublicWorkflowDriverResponse> {
  const owner = workflowRunOwnerFromHostSession(deps.hostSession);
  if (!owner) return failure(401, "authenticated_workspace_owner_required");
  if (action.action === "start") {
    if (action.source?.kind !== "published") return failure(400, "legacy_workflow_path_not_available_for_vnext");
    const result = await handleWorkflowRunsAction(action, { hostSession: deps.hostSession, store: deps.store, repository: deps.repository });
    return { status: result.ok ? 200 : 400, result };
  }
  if (action.action === "cancel_run" && "lease" in action) return failure(400, "public_lease_forbidden");
  const request = action.action === "run_until_blocked" || action.action === "resume_run" ? action.request : {};
  if (!request || typeof request !== "object" || Array.isArray(request)) return failure(400, "invalid_driver_request");
  const publicRequest = request as Record<string, unknown>;
  for (const field of ["workflowVersionId", "runInput", "lease", "hostSigned"]) {
    if (field in publicRequest) return failure(400, `public_${field}_forbidden`);
  }
  if (action.action !== "resume_run" && "resumeEvent" in publicRequest) return failure(400, "resume_event_not_allowed");
  const runId = "runId" in action ? action.runId : String(publicRequest.workflowRunId ?? "");
  if (!runId) return failure(400, "workflowRunId_required");
  const row = await deps.store.getRun(owner, runId);
  if (!row) return failure(404, "run_not_found");
  const published = await deps.repository.getPublished(owner, row.workflowVersionId);
  if (!published || published.workflowId !== row.workflowId) return failure(404, "published_workflow_not_found");
  const snapshot = await deps.journal.getSnapshot(owner, runId);
  const approvalWait = snapshot?.waits[0];
  if (action.action === "approve" && (!approvalWait || approvalWait.kind !== "approval")) return failure(409, "approval_wait_not_available");
  const approvalLogicalEffectId = approvalWait?.kind === "approval" ? approvalWait.logicalEffectId : undefined;
  const parsedResumeEvent = action.action === "resume_run"
    ? publicResumeEventSchema.safeParse(publicRequest.resumeEvent)
    : action.action === "approve"
      ? publicResumeEventSchema.safeParse({ kind: "approval", eventId: randomUUID(), waitpointId: approvalWait!.waitpointId, workflowRunId: runId, nodeId: approvalWait!.nodeId, runRevision: snapshot!.revision, logicalEffectId: approvalLogicalEffectId, issuedAt: new Date().toISOString() })
      : null;
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
    : action.action === "resume_run"
      ? { action: "resume_run", request: serverRequest }
      : { action: "run_until_blocked", request: serverRequest };
  const durableApprovedCommandIds = Object.entries(snapshot?.outputs ?? {})
    .filter(([key]) => key.startsWith("__approval_decision__:"))
    .flatMap(([, output]) => output.storage === "inline" && approvalDecisionSchema.safeParse(output.value).success
      ? [approvalDecisionSchema.parse(output.value).commandId]
      : []);
  const approvedCommandIds = [...new Set([...approvedCommandIdsFromHostSession(deps.hostSession), ...durableApprovedCommandIds])];
  const readiness = () => deps.resolveReadiness?.(approvedCommandIds) ?? resolveStandaloneCapabilityReadiness({ hostSession: deps.hostSession, approvedCommandIds });
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
    authorizedHostContextKeys: new Set(["organizationId", "principalId"]),
    loadArtifact: deps.loadArtifact,
    resolveReadiness: readiness,
    resolveDependencyPins: () => published.dependencyPins,
    executionContext: (node) => ({
      ...deps.executionContext?.(node),
      subjectId: owner.userId,
    }),
    approvalDecision: (commitNodeId, externalEffectIdentity) => {
      if (signedResumeEvent?.kind !== "approval") return undefined;
      const commit = published.definition.nodes.find((node) => node.nodeId === commitNodeId && node.nodeType === "tool_commit");
      if (!commit?.effectBinding || signedResumeEvent.logicalEffectId !== commit.effectBinding.logicalEffectId) return undefined;
      return { decisionId: signedResumeEvent.eventId, decision: "approved", runId, approvalNodeId: commit.effectBinding.approvalNodeId, previewNodeId: commit.effectBinding.previewNodeId, commitNodeId, commandId: commit.effectBinding.commandId, logicalEffectId: commit.effectBinding.logicalEffectId, organizationId: owner.organizationId, approverId: owner.userId, grantEvidenceDigest: digest(JSON.stringify(readiness())), resolvedInputHash: commit.effectBinding.resolvedInputHash, externalEffectIdentity, issuedAt: signedResumeEvent.issuedAt, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), hostSigned: true };
    },
  });
  try {
    if (action.action === "approve") return { status: 200, result: { ok: true, run: await driver.approve(serverRequest) } as unknown as WorkflowRunsResult };
    return { status: 200, result: await handleWorkflowRunsAction(internalAction, { hostSession: deps.hostSession, store: deps.store, driver }) };
  } catch (error) {
    return failure(200, error instanceof Error ? error.message : "workflow_run_driver_failed");
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

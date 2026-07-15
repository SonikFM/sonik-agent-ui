import { createHash, randomUUID } from "node:crypto";
import {
  authenticatedResumeEventSchema,
  runDriverPumpRequestSchema,
  validateApprovalDecisionForCommit,
  workflowEffectIdempotencyKey,
  workflowVNextDefinitionSchema,
  workflowVNextRunStateSchema,
  type ApprovalDecision,
  type BoundedNodeOutput,
  type CapabilityReadiness,
  type EngineRequest,
  type EngineResponse,
  type JsonValue,
  type WorkflowVNextDefinition,
  type WorkflowVNextNode,
} from "@sonik-agent-ui/tool-contracts/workflow-vnext";
import { requireCallableCapability } from "./capability-readiness.ts";
import { dispatchWorkflowNode, hashWorkflowInput, type WorkflowNodeExecutionContext } from "./workflow-node-executors.ts";
import type { WorkflowRunJournalStore, WorkflowRunOwner, WorkflowRunSnapshot } from "./workflow-run-store.ts";

type PumpRequest = ReturnType<typeof runDriverPumpRequestSchema.parse>;

export interface WorkflowRunDriverDeps {
  journal: WorkflowRunJournalStore;
  owner: WorkflowRunOwner;
  definition: WorkflowVNextDefinition;
  initialState: WorkflowRunSnapshot;
  runInput?: JsonValue;
  hostContext?: Readonly<Record<string, JsonValue>>;
  executionContext?: (node: WorkflowVNextNode) => WorkflowNodeExecutionContext;
  resolveReadiness?: () => readonly CapabilityReadiness[];
  resolveDependencyPins?: () => WorkflowRunSnapshot["dependencyPins"];
  approvalDecision?: (commitNodeId: string) => ApprovalDecision | undefined;
  reconcileEffect?: (node: WorkflowVNextNode, claim: Awaited<ReturnType<WorkflowRunJournalStore["claimEffect"]>>["claim"]) => Promise<EngineResponse> | EngineResponse;
  now?: () => number;
}

export class WorkflowRunDriver {
  readonly deps: WorkflowRunDriverDeps;

  constructor(deps: WorkflowRunDriverDeps) {
    this.deps = { ...deps, definition: workflowVNextDefinitionSchema.parse(deps.definition), initialState: workflowVNextRunStateSchema.parse(deps.initialState) };
  }

  start(input: unknown): Promise<WorkflowRunSnapshot> { return this.pump(input, false); }
  resume(input: unknown): Promise<WorkflowRunSnapshot> { return this.pump(input, true); }
  runUntilBlocked(input: unknown): Promise<WorkflowRunSnapshot> { return this.pump(input, false); }

  async cancel(workflowRunId: string, leaseInput: unknown): Promise<WorkflowRunSnapshot> {
    const request = runDriverPumpRequestSchema.parse({ workflowRunId, lease: leaseInput, budget: { maxNodes: 1, maxWallTimeMs: 1 } });
    if (!await this.deps.journal.acquireLease(this.deps.owner, workflowRunId, request.lease)) return this.load();
    const state = await this.load();
    if (state.compatibilityPhase === "outcome_unknown") return state;
    return this.appendStatus(state, request, "cancelled", "cancelled", { schedulerFrontier: [], waits: [] });
  }

  private async pump(input: unknown, resuming: boolean): Promise<WorkflowRunSnapshot> {
    const request = runDriverPumpRequestSchema.parse(input);
    if (request.workflowRunId !== this.deps.initialState.workflowRunId) throw new Error("workflow_run_mismatch");
    if (!await this.deps.journal.acquireLease(this.deps.owner, request.workflowRunId, request.lease)) return this.load();
    let state = await this.load();
    const startedAt = this.now();

    if (state.revision === 0) state = await this.appendStatus(state, request, "running", "saving");
    if (["succeeded", "failed", "cancelled"].includes(state.status)) {
      if (resuming) throw new Error("resume_not_allowed_for_terminal_run");
      return state;
    }
    if (resuming) state = await this.resumeWait(state, request);
    else if (state.status === "waiting" && state.waits.some((wait) => wait.kind !== "budget_yield")) return state;
    else if (state.status === "waiting") state = await this.appendStatus(state, request, "running", "saving", { waits: [] });

    let completed = 0;
    while (state.schedulerFrontier.length) {
      if (completed >= request.budget.maxNodes || this.now() - startedAt >= request.budget.maxWallTimeMs) {
        const waitpoint = { kind: "budget_yield" as const, waitpointId: `budget:${state.workflowRunId}:${state.revision + 1}`, runId: state.workflowRunId, nodeId: state.schedulerFrontier[0]!, wakeupReason: completed >= request.budget.maxNodes ? "node_budget_exhausted" as const : "wall_time_budget_exhausted" as const };
        await this.deps.journal.createWaitpoint(this.deps.owner, waitpoint);
        return this.appendWait(state, request, waitpoint);
      }

      const node = this.node(state.schedulerFrontier[0]!);
      if (this.deps.resolveDependencyPins && JSON.stringify(this.deps.resolveDependencyPins()) !== JSON.stringify(state.dependencyPins)) {
        return this.appendStatus(state, request, "failed", "dependency_pin_drift", { schedulerFrontier: [] });
      }
      const inputValue = this.resolveInput(node, state);
      if (node.nodeType === "branch") {
        state = await this.complete(state, request, node, this.inline(inputValue), this.selectBranch(node, state));
        completed += 1;
        continue;
      }

      const logicalEffectId = node.nodeType === "tool_commit" ? node.effectBinding?.logicalEffectId : undefined;
      const attempt = state.eventSequence + 1;
      const attemptId = `${state.workflowRunId}:${node.nodeId}:${attempt}`;
      const engineRequest: EngineRequest = {
        workflowRunId: state.workflowRunId,
        workflowVersionId: state.source.kind === "published" ? state.source.workflowVersionId : `${state.source.workflowId}@draft-${state.source.draftRevision}`,
        nodeId: node.nodeId,
        nodeType: node.nodeType,
        typeVersion: node.typeVersion,
        attempt,
        attemptId,
        ...(logicalEffectId ? { logicalEffectId } : {}),
        input: inputValue,
        contextSnapshot: { ...(this.deps.hostContext ?? {}) },
        capabilityPins: node.capabilityPins,
        idempotencyKey: logicalEffectId ? workflowEffectIdempotencyKey(state.workflowRunId, logicalEffectId) : attemptId,
      };

      let claim: Awaited<ReturnType<WorkflowRunJournalStore["claimEffect"]>> | undefined;
      if (logicalEffectId) {
        try { this.authorizeCommit(node, state, inputValue); }
        catch (error) { return this.appendStatus(state, request, "failed", error instanceof Error ? error.message : "commit_authorization_failed", { schedulerFrontier: [] }); }
        claim = await this.deps.journal.claimEffect(this.deps.owner, { claimId: randomUUID(), runId: state.workflowRunId, logicalEffectId, attemptId, idempotencyKey: engineRequest.idempotencyKey, providerSupportsIdempotency: true });
        if (!claim.created) {
          if (claim.claim.status === "succeeded" && claim.claim.result) {
            state = await this.complete(state, request, node, claim.claim.result as BoundedNodeOutput);
            completed += 1;
            continue;
          }
          if (claim.claim.status === "outcome_unknown" && this.deps.reconcileEffect) {
            const reconciled = await this.deps.reconcileEffect(node, claim.claim);
            if (reconciled.status === "succeeded" && reconciled.receipt) {
              await this.deps.journal.transitionEffectClaim(this.deps.owner, state.workflowRunId, logicalEffectId, "outcome_unknown", "reconciled", reconciled.output);
              state = await this.complete(state, request, node, reconciled.output);
              completed += 1;
              continue;
            }
          }
          return state;
        }
        await this.deps.journal.transitionEffectClaim(this.deps.owner, state.workflowRunId, logicalEffectId, "claimed", "in_flight");
      }

      let response: EngineResponse;
      try { response = await dispatchWorkflowNode(engineRequest, this.deps.executionContext?.(node)); }
      catch (error) {
        if (!logicalEffectId) throw error;
        await this.deps.journal.transitionEffectClaim(this.deps.owner, state.workflowRunId, logicalEffectId, "in_flight", "outcome_unknown", { code: "provider_response_lost" });
        return this.appendStatus(state, request, "waiting", "outcome_unknown");
      }
      if (response.status === "waiting") {
        await this.deps.journal.createWaitpoint(this.deps.owner, response.waitpoint);
        return this.appendWait(state, request, response.waitpoint);
      }
      if (response.status === "retryable_error") {
        if (logicalEffectId) {
          await this.deps.journal.transitionEffectClaim(this.deps.owner, state.workflowRunId, logicalEffectId, "in_flight", "failed", response);
          return this.appendStatus(state, request, "failed", "unsafe_write_retry_refused", { schedulerFrontier: [] });
        }
        return this.appendStatus(state, request, "waiting", "retry_pending");
      }
      if (response.status === "terminal_error") {
        if (logicalEffectId) await this.deps.journal.transitionEffectClaim(this.deps.owner, state.workflowRunId, logicalEffectId, "in_flight", "failed", response);
        return this.appendStatus(state, request, "failed", response.error.code, { schedulerFrontier: [] });
      }
      if (logicalEffectId) {
        if (!response.receipt) return this.appendStatus(state, request, "failed", "semantic_receipt_required", { schedulerFrontier: [] });
        await this.deps.journal.transitionEffectClaim(this.deps.owner, state.workflowRunId, logicalEffectId, "in_flight", "succeeded", response.output);
      }
      state = await this.complete(state, request, node, response.output);
      completed += 1;
    }
    return state.status === "succeeded" ? state : this.appendStatus(state, request, "succeeded", "committed");
  }

  private async resumeWait(state: WorkflowRunSnapshot, request: PumpRequest): Promise<WorkflowRunSnapshot> {
    const wait = state.waits[0];
    if (!wait) return state;
    if (wait.kind === "budget_yield") return this.appendStatus(state, request, "running", "saving", { waits: [] });
    const event = authenticatedResumeEventSchema.parse(request.resumeEvent);
    if (event.workflowRunId !== state.workflowRunId || event.organizationId !== state.organizationId || event.waitpointId !== wait.waitpointId || event.nodeId !== wait.nodeId || event.subjectId !== wait.subjectId || event.runRevision !== state.revision) throw new Error("resume_event_does_not_match_waitpoint");
    if (wait.expiresAt && this.now() >= Date.parse(wait.expiresAt)) throw new Error("waitpoint_expired");
    if (!await this.deps.journal.resolveWaitpoint(this.deps.owner, state.workflowRunId, wait.waitpointId)) throw new Error("waitpoint_already_resolved");
    return this.appendStatus(state, request, "running", "saving", { waits: [] });
  }

  private authorizeCommit(node: WorkflowVNextNode, state: WorkflowRunSnapshot, resolvedInput: JsonValue): void {
    const binding = node.effectBinding;
    if (!binding) throw new Error("commit_effect_binding_missing");
    if (hashWorkflowInput(resolvedInput) !== binding.resolvedInputHash) throw new Error("resolved_input_hash_mismatch");
    const preview = this.node(binding.previewNodeId);
    const approval = this.node(binding.approvalNodeId);
    const sameEffect = (effect?: { commandId: string; logicalEffectId: string; resolvedInputHash: string }): boolean => Boolean(effect
      && effect.commandId === binding.commandId
      && effect.logicalEffectId === binding.logicalEffectId
      && effect.resolvedInputHash === binding.resolvedInputHash);
    if (preview.nodeType !== "tool_preview" || !sameEffect(preview.previewEffect)) throw new Error("preview_effect_binding_mismatch");
    if (approval.nodeType !== "approval" || !sameEffect(approval.approvalEffect) || approval.approvalEffect?.previewNodeId !== preview.nodeId || approval.approvalEffect.approvalNodeId !== approval.nodeId || approval.approvalEffect.commitNodeId !== node.nodeId) throw new Error("approval_effect_binding_mismatch");
    const previewOutput = state.outputs[preview.nodeId];
    const previewValue = previewOutput?.storage === "inline" && previewOutput.value && typeof previewOutput.value === "object" && !Array.isArray(previewOutput.value) ? previewOutput.value : undefined;
    if (previewValue?.commandId !== binding.commandId || previewValue.stableInputHash !== binding.resolvedInputHash) throw new Error("preview_output_binding_mismatch");
    for (const key of node.requiredHostContext) if (this.deps.hostContext?.[key] == null) throw new Error(`missing_context:${key}`);
    requireCallableCapability(this.deps.resolveReadiness?.() ?? [], binding.commandId);
    const decision = this.deps.approvalDecision?.(node.nodeId);
    validateApprovalDecisionForCommit(decision, this.deps.definition, node.nodeId, { runId: state.workflowRunId, organizationId: state.organizationId, evaluatedAt: new Date(this.now()).toISOString() });
  }

  private async complete(state: WorkflowRunSnapshot, request: PumpRequest, node: WorkflowVNextNode, output: BoundedNodeOutput, next = this.next(node.nodeId)): Promise<WorkflowRunSnapshot> {
    const digest = `sha256:${createHash("sha256").update(JSON.stringify(output)).digest("hex")}`;
    const outputRef = output.storage === "artifact" ? output : { storage: "inline_redacted" as const, digest, byteLength: output.byteLength, redactedSummary: "Node output recorded" };
    return this.append(state, request, "node_completed", { nodeId: node.nodeId, outputRef }, { status: next.length ? "running" : "succeeded", selectedPath: [...state.selectedPath, node.nodeId], schedulerFrontier: next, outputs: { ...state.outputs, [node.nodeId]: output }, outputRefs: { ...state.outputRefs, [node.nodeId]: outputRef }, compatibilityPhase: next.length ? "saving" : "committed" }, { kind: "node", id: node.nodeId });
  }

  private appendWait(state: WorkflowRunSnapshot, request: PumpRequest, waitpoint: WorkflowRunSnapshot["waits"][number]): Promise<WorkflowRunSnapshot> {
    return this.append(state, request, "wait_created", { waitpoint }, { status: "waiting", waits: [waitpoint], compatibilityPhase: "waiting" }, { kind: "waitpoint", id: waitpoint.waitpointId });
  }

  private appendStatus(state: WorkflowRunSnapshot, request: PumpRequest, status: WorkflowRunSnapshot["status"], compatibilityPhase: string, patch: Partial<WorkflowRunSnapshot> = {}): Promise<WorkflowRunSnapshot> {
    return this.append(state, request, "run_status_changed", { status, compatibilityPhase }, { ...patch, status, compatibilityPhase }, { kind: "run", id: state.workflowRunId });
  }

  private async append(state: WorkflowRunSnapshot, request: PumpRequest, eventType: "node_completed" | "wait_created" | "run_status_changed", payload: unknown, patch: Partial<WorkflowRunSnapshot>, subject: { kind: "run" | "node" | "waitpoint"; id: string }): Promise<WorkflowRunSnapshot> {
    const revision = state.revision + 1;
    const snapshot = workflowVNextRunStateSchema.parse({ ...state, ...patch, revision, eventSequence: revision });
    const event = { eventId: randomUUID(), schemaVersion: "sonik.workflow.event.v1" as const, eventVersion: 1 as const, workflowRunId: state.workflowRunId, sequence: revision, revision, actor: { kind: "worker" as const, id: request.lease.ownerId }, subject, causationId: request.lease.leaseId, correlationIds: [request.lease.leaseId], timestamp: new Date(this.now()).toISOString(), eventType, payload };
    if (!await this.deps.journal.appendEventAndProject(this.deps.owner, { expectedRevision: state.revision, leaseId: request.lease.leaseId, event: event as never, snapshot })) throw new Error("run_revision_or_lease_conflict");
    return snapshot;
  }

  private next(nodeId: string): string[] { return this.deps.definition.edges.filter((edge) => edge.from === nodeId).map((edge) => edge.to); }
  private selectBranch(node: WorkflowVNextNode, state: WorkflowRunSnapshot): string[] {
    const edges = this.deps.definition.edges.filter((edge) => edge.from === node.nodeId);
    const selected = edges.find((edge) => edge.predicate && this.predicate(edge.predicate, state)) ?? edges.find((edge) => edge.default);
    if (!selected) throw new Error("branch_no_matching_edge");
    return [selected.to];
  }
  private predicate(predicate: WorkflowVNextDefinition["edges"][number]["predicate"], state: WorkflowRunSnapshot): boolean {
    if (!predicate) return false;
    const left = this.binding(predicate.left, state); const right = predicate.right && "value" in predicate.right ? predicate.right.value : predicate.right ? this.binding(predicate.right, state) : undefined;
    if (predicate.operator === "exists") return left !== undefined && left !== null;
    if (predicate.operator === "eq") return JSON.stringify(left) === JSON.stringify(right);
    if (predicate.operator === "not_eq") return JSON.stringify(left) !== JSON.stringify(right);
    if (predicate.operator === "in") return Array.isArray(right) && right.some((value) => JSON.stringify(value) === JSON.stringify(left));
    return typeof left === "number" && typeof right === "number" && ({ gt: left > right, gte: left >= right, lt: left < right, lte: left <= right } as const)[predicate.operator];
  }
  private resolveInput(node: WorkflowVNextNode, state: WorkflowRunSnapshot): JsonValue { return Object.fromEntries(Object.entries(node.bindings).map(([key, binding]) => [key, this.binding(binding, state)])) as JsonValue; }
  private binding(binding: WorkflowVNextNode["bindings"][string], state: WorkflowRunSnapshot): JsonValue {
    const nodeOutput = binding.source === "node_output" ? state.outputs[binding.nodeId] : undefined;
    const root = binding.source === "constant" ? binding.value : binding.source === "run_input" ? this.deps.runInput ?? null : binding.source === "host_context" ? this.deps.hostContext?.[binding.key] ?? null : nodeOutput?.storage === "inline" ? nodeOutput.value : null;
    return (binding.source === "constant" || binding.source === "host_context" ? root : binding.path.reduce<JsonValue>((value, key) => value && typeof value === "object" && !Array.isArray(value) ? value[key] ?? null : null, root));
  }
  private inline(value: JsonValue): BoundedNodeOutput { return { storage: "inline", value, byteLength: new TextEncoder().encode(JSON.stringify(value)).byteLength }; }
  private node(nodeId: string): WorkflowVNextNode { const node = this.deps.definition.nodes.find((candidate) => candidate.nodeId === nodeId); if (!node) throw new Error(`unknown_node:${nodeId}`); return node; }
  private load(): Promise<WorkflowRunSnapshot> { return this.deps.journal.getSnapshot(this.deps.owner, this.deps.initialState.workflowRunId).then((state) => state ?? this.deps.initialState); }
  private now(): number { return (this.deps.now ?? Date.now)(); }
}

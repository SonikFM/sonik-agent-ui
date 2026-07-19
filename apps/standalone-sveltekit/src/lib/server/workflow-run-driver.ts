import { randomUUID } from "node:crypto";
import {
  approvalDecisionSchema,
  authenticatedResumeEventSchema,
  engineResponseSchema,
  externalEffectIdempotencyKey,
  runDriverPumpRequestSchema,
  validateApprovalDecisionForCommit,
  workflowEffectIdempotencyKey,
  workflowSchemaRefKey,
  workflowNodeAttemptId,
  workflowVNextDefinitionSchema,
  workflowVNextRunStateSchema,
  type ApprovalDecision,
  type BoundedNodeOutput,
  type CapabilityReadiness,
  type EngineRequest,
  type EngineResponse,
  type ExternalEffectIdentity,
  type JsonValue,
  type WorkflowEventOutputRef,
  type WorkflowVNextDefinition,
  type WorkflowVNextNode,
  type WorkflowRuntimeRegistry,
} from "@sonik-agent-ui/tool-contracts/workflow-vnext";
import { requireCallableCapability } from "./capability-readiness.ts";
import {
  dispatchWorkflowNode,
  hashWorkflowInput,
  resolveWorkflowBinding,
  toWorkflowOutputRef,
  validateWorkflowResumePayload,
  workflowNodeExecutorRuntimeRegistry,
  type WorkflowBindingResolutionContext,
  type WorkflowNodeExecutionContext,
} from "./workflow-node-executors.ts";
import type { WorkflowRunJournalStore, WorkflowRunOwner, WorkflowRunSnapshot } from "./workflow-run-store.ts";

type PumpRequest = ReturnType<typeof runDriverPumpRequestSchema.parse>;
const MAX_NODE_ATTEMPTS = 100;

export interface WorkflowRunDriverDeps {
  journal: WorkflowRunJournalStore;
  owner: WorkflowRunOwner;
  definition: WorkflowVNextDefinition;
  initialState: WorkflowRunSnapshot;
  runInput?: JsonValue;
  hostContext?: Readonly<Record<string, JsonValue>>;
  authorizedHostContextKeys?: ReadonlySet<string>;
  loadArtifact?: WorkflowBindingResolutionContext["loadArtifact"];
  runtimeRegistry?: WorkflowRuntimeRegistry;
  executionContext?: (node: WorkflowVNextNode) => WorkflowNodeExecutionContext;
  resolveReadiness?: () => readonly CapabilityReadiness[];
  resolveDependencyPins?: () => WorkflowRunSnapshot["dependencyPins"];
  approvalDecision?: (commitNodeId: string, externalEffectIdentity: ExternalEffectIdentity) => ApprovalDecision | undefined;
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
  approve(input: unknown): Promise<WorkflowRunSnapshot> { return this.pump(input, true, true); }
  runUntilBlocked(input: unknown): Promise<WorkflowRunSnapshot> { return this.pump(input, false); }

  async cancel(workflowRunId: string, leaseInput: unknown): Promise<WorkflowRunSnapshot> {
    const request = runDriverPumpRequestSchema.parse({ workflowRunId, lease: leaseInput, budget: { maxNodes: 1, maxWallTimeMs: 1 } });
    if (!await this.deps.journal.acquireLease(this.deps.owner, workflowRunId, request.lease)) return this.load();
    const state = await this.load();
    if (state.compatibilityPhase === "outcome_unknown") return state;
    return this.appendStatus(state, request, "cancelled", "cancelled", { schedulerFrontier: [], waits: [] });
  }

  private async pump(input: unknown, resuming: boolean, stopAfterResume = false): Promise<WorkflowRunSnapshot> {
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

    if (stopAfterResume) return state;
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
      const inputValue = await this.resolveInput(node, state);
      const attempt = state.eventSequence + 1;
      const attemptId = workflowNodeAttemptId(state.workflowRunId, node.nodeId, attempt);
      if (node.nodeType === "branch") {
        state = await this.complete(state, request, node, this.inline(inputValue), await this.selectBranch(node, state), attemptId);
        completed += 1;
        continue;
      }

      const logicalEffectId = node.nodeType === "tool_commit" ? node.effectBinding?.logicalEffectId : undefined;
      const executionContext = {
        ...this.deps.executionContext?.(node),
        ...(node.nodeType === "approval" ? { logicalEffectId: node.approvalEffect?.logicalEffectId } : {}),
        ...(this.deps.runtimeRegistry ? { runtimeRegistry: this.deps.runtimeRegistry } : {}),
      };
      const externalEffectIdentity = this.externalEffectIdentity(node, state, executionContext);
      const engineRequest: EngineRequest = {
        workflowRunId: state.workflowRunId,
        workflowVersionId: state.source.kind === "published" ? state.source.workflowVersionId : `${state.source.workflowId}@draft-${state.source.draftRevision}`,
        nodeId: node.nodeId,
        nodeType: node.nodeType,
        typeVersion: node.typeVersion,
        attempt,
        attemptId,
        ...(logicalEffectId ? { logicalEffectId } : {}),
        ...(externalEffectIdentity ? { externalEffectIdentity } : {}),
        input: inputValue,
        contextSnapshot: { ...(this.deps.hostContext ?? {}) },
        capabilityPins: node.capabilityPins,
        idempotencyKey: logicalEffectId && externalEffectIdentity ? externalEffectIdempotencyKey(externalEffectIdentity) : logicalEffectId ? workflowEffectIdempotencyKey(state.workflowRunId, logicalEffectId) : attemptId,
      };

      let claim: Awaited<ReturnType<WorkflowRunJournalStore["claimEffect"]>> | undefined;
      if (logicalEffectId) {
        try { this.authorizeCommit(node, state, inputValue, externalEffectIdentity); }
        catch (error) { return this.appendStatus(state, request, "failed", error instanceof Error ? error.message : "commit_authorization_failed", { schedulerFrontier: [] }); }
        claim = await this.deps.journal.claimEffect(this.deps.owner, { claimId: randomUUID(), runId: state.workflowRunId, logicalEffectId, attemptId, idempotencyKey: engineRequest.idempotencyKey, providerSupportsIdempotency: executionContext?.providerSupportsIdempotency === true, externalEffectIdentity: externalEffectIdentity! });
        if (!claim.created) {
          const replay = this.persistedEffectResponse(claim.claim.result);
          if ((claim.claim.status === "succeeded" || claim.claim.status === "reconciled") && replay) {
            state = await this.complete(state, request, node, replay.output, undefined, attemptId);
            completed += 1;
            continue;
          }
          if (claim.claim.status === "outcome_unknown" && this.deps.reconcileEffect) {
            const reconciled = await this.deps.reconcileEffect(node, claim.claim);
            if (reconciled.status === "succeeded" && reconciled.receipt?.semanticStatus === "success") {
              const transitioned = await this.deps.journal.transitionEffectClaim(this.deps.owner, claim.claim.claimId, "outcome_unknown", "reconciled", reconciled);
              if (!transitioned) throw new Error("effect_claim_transition_conflict");
              const authoritative = await this.deps.journal.claimEffect(this.deps.owner, {
                claimId: randomUUID(), runId: state.workflowRunId, logicalEffectId, attemptId,
                idempotencyKey: engineRequest.idempotencyKey, providerSupportsIdempotency: executionContext?.providerSupportsIdempotency === true,
                externalEffectIdentity: externalEffectIdentity!,
              });
              const replay = authoritative.claim.status === "reconciled" ? this.persistedEffectResponse(authoritative.claim.result) : undefined;
              if (!replay) throw new Error("effect_claim_reconciliation_not_authoritative");
              state = await this.complete(state, request, node, replay.output, undefined, attemptId);
              completed += 1;
              continue;
            }
          }
          return state;
        }
        await this.deps.journal.transitionEffectClaim(this.deps.owner, claim.claim.claimId, "claimed", "in_flight");
      }

      let response: EngineResponse;
      const retryConfig = node.nodeType === "skill" && node.config && typeof node.config === "object" && !Array.isArray(node.config)
        ? node.config.retry
        : undefined;
      const configuredRetries = retryConfig && typeof retryConfig === "object" && !Array.isArray(retryConfig)
        ? Number(retryConfig.maxAttempts ?? 1)
        : 1;
      const requestedAttempts = node.nodeType === "tool_preview" ? 3 : node.nodeType === "reasoning" ? node.reasoning?.budgets.maxSteps ?? 1 : configuredRetries;
      const maxAttempts = Number.isFinite(requestedAttempts) && requestedAttempts > 0
        ? Math.min(Math.floor(requestedAttempts), MAX_NODE_ATTEMPTS)
        : 1;
      const reasoningStartedAt = this.now();
      let completedAttemptId = attemptId;
      for (let retry = 0; ; retry += 1) {
        const retryAttemptId = workflowNodeAttemptId(state.workflowRunId, node.nodeId, attempt + retry);
        const retryRequest = retry === 0 ? engineRequest : { ...engineRequest, attempt: attempt + retry, attemptId: retryAttemptId, idempotencyKey: retryAttemptId };
        completedAttemptId = retryRequest.attemptId;
        try { response = await dispatchWorkflowNode(retryRequest, executionContext); }
        catch (error) {
          if (!logicalEffectId) throw error;
          await this.deps.journal.transitionEffectClaim(this.deps.owner, claim!.claim.claimId, "in_flight", "outcome_unknown", { code: "provider_response_lost" });
          return this.appendStatus(state, request, "waiting", "outcome_unknown");
        }
        const reasoningTimeExhausted = node.nodeType === "reasoning" && this.now() - reasoningStartedAt >= (node.reasoning?.budgets.maxWallTimeMs ?? 0);
        if (reasoningTimeExhausted) return this.appendReasoningYield(state, request, node, "wall_time_budget_exhausted", completedAttemptId, response.status === "succeeded" ? toWorkflowOutputRef(response.output, "Reasoning output withheld at budget yield") : response.status === "terminal_error" ? response.outputRef : undefined);
        if (response.status !== "retryable_error" || logicalEffectId || retry + 1 >= maxAttempts) break;
      }
      if (response.status === "waiting") {
        await this.deps.journal.createWaitpoint(this.deps.owner, response.waitpoint);
        return this.appendWait(state, request, response.waitpoint, completedAttemptId);
      }
      if (response.status === "retryable_error") {
        if (logicalEffectId) {
          await this.deps.journal.transitionEffectClaim(this.deps.owner, claim!.claim.claimId, "in_flight", "failed", response);
          return this.appendStatus(state, request, "failed", "unsafe_write_retry_refused", { schedulerFrontier: [] });
        }
        return this.appendStatus(state, request, "failed", node.nodeType === "reasoning" ? "reasoning_budget_exhausted" : node.nodeType === "tool_preview" ? "safe_read_retry_exhausted" : "unsafe_retry_refused", { schedulerFrontier: [] });
      }
      if (response.status === "terminal_error") {
        if (logicalEffectId) await this.deps.journal.transitionEffectClaim(this.deps.owner, claim!.claim.claimId, "in_flight", "failed", response);
        if (node.nodeType === "reasoning" && ["reasoning_budget_exhausted", "reasoning_output_budget_exhausted"].includes(response.error.code)) {
          return this.appendReasoningYield(state, request, node, "node_budget_exhausted", completedAttemptId, response.outputRef);
        }
        return this.appendStatus(state, request, "failed", response.error.code, { schedulerFrontier: [] });
      }
      if (logicalEffectId) {
        if (response.receipt?.semanticStatus !== "success") {
          await this.deps.journal.transitionEffectClaim(this.deps.owner, claim!.claim.claimId, "in_flight", "failed", response);
          return this.appendStatus(state, request, "failed", "semantic_receipt_required", { schedulerFrontier: [] });
        }
        await this.deps.journal.transitionEffectClaim(this.deps.owner, claim!.claim.claimId, "in_flight", "succeeded", response);
      }
      state = await this.complete(state, request, node, response.output, undefined, completedAttemptId);
      completed += 1;
    }
    return state.status === "succeeded" ? state : this.appendStatus(state, request, "succeeded", "committed");
  }

  private async resumeWait(state: WorkflowRunSnapshot, request: PumpRequest): Promise<WorkflowRunSnapshot> {
    const wait = state.waits[0];
    if (!wait) return state;
    if (wait.kind === "budget_yield") return this.appendStatus(state, request, "running", "saving", { waits: [] });
    const event = authenticatedResumeEventSchema.parse(request.resumeEvent);
    if (event.workflowRunId !== state.workflowRunId || event.organizationId !== state.organizationId || event.runRevision !== state.revision) throw new Error("resume_event_does_not_match_waitpoint");
    let payload: JsonValue;
    try { payload = validateWorkflowResumePayload(wait, event, this.now()); }
    catch (error) {
      if (error instanceof Error && error.message === "resume_payload_expired") throw new Error("waitpoint_expired");
      throw new Error("resume_event_does_not_match_waitpoint");
    }
    const waitNode = this.node(wait.nodeId);
    let durableApproval: BoundedNodeOutput | undefined;
    if (wait.kind === "approval") {
      const commit = this.deps.definition.nodes.find((node) => node.nodeType === "tool_commit" && node.effectBinding?.approvalNodeId === wait.nodeId);
      if (!commit) throw new Error("commit_effect_binding_missing");
      const context = this.deps.executionContext?.(commit);
      const identity = this.externalEffectIdentity(commit, state, context);
      if (!identity) throw new Error("external_effect_identity_missing");
      const decision = validateApprovalDecisionForCommit(
        this.deps.approvalDecision?.(commit.nodeId, identity), this.deps.definition, commit.nodeId,
        { runId: state.workflowRunId, organizationId: state.organizationId, evaluatedAt: new Date(this.now()).toISOString(), externalEffectIdentity: identity },
      );
      durableApproval = this.inline(approvalDecisionSchema.parse(decision));
    }
    const output = this.inline(payload);
    const resumed = await this.complete(state, request, waitNode, output, undefined, undefined,
      durableApproval ? { [this.approvalDecisionKey(wait.nodeId)]: durableApproval } : undefined);
    await this.deps.journal.resolveWaitpoint(this.deps.owner, state.workflowRunId, wait.waitpointId);
    return resumed;
  }

  private authorizeCommit(node: WorkflowVNextNode, state: WorkflowRunSnapshot, resolvedInput: JsonValue, externalEffectIdentity?: ExternalEffectIdentity): void {
    const binding = node.effectBinding;
    if (!binding) throw new Error("commit_effect_binding_missing");
    if (!externalEffectIdentity) throw new Error("external_effect_identity_missing");
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
    if (previewValue?.commandId !== binding.commandId || previewValue.stableInputHash !== binding.resolvedInputHash || JSON.stringify(previewValue.externalEffectIdentity) !== JSON.stringify(externalEffectIdentity)) throw new Error("preview_output_binding_mismatch");
    for (const key of node.requiredHostContext) if (this.deps.hostContext?.[key] == null) throw new Error(`missing_context:${key}`);
    requireCallableCapability(this.deps.resolveReadiness?.() ?? [], binding.commandId);
    const persisted = state.outputs[this.approvalDecisionKey(binding.approvalNodeId)];
    const persistedDecision = persisted?.storage === "inline" ? approvalDecisionSchema.safeParse(persisted.value) : undefined;
    const decision = this.deps.approvalDecision?.(node.nodeId, externalEffectIdentity) ?? (persistedDecision?.success ? persistedDecision.data : undefined);
    validateApprovalDecisionForCommit(decision, this.deps.definition, node.nodeId, { runId: state.workflowRunId, organizationId: state.organizationId, evaluatedAt: new Date(this.now()).toISOString(), externalEffectIdentity });
  }

  private externalEffectIdentity(node: WorkflowVNextNode, state: WorkflowRunSnapshot, context?: WorkflowNodeExecutionContext): ExternalEffectIdentity | undefined {
    const binding = node.effectBinding ?? node.previewEffect ?? node.approvalEffect;
    if (!binding) return undefined;
    return {
      namespace: context?.externalEffectIdentity?.namespace ?? "workflow-run-v1",
      keyDigest: context?.externalEffectIdentity?.keyDigest ?? hashWorkflowInput({ workflowRunId: state.workflowRunId, logicalEffectId: binding.logicalEffectId }),
      commandId: binding.commandId,
      resolvedInputHash: binding.resolvedInputHash,
    };
  }

  private async complete(state: WorkflowRunSnapshot, request: PumpRequest, node: WorkflowVNextNode, output: BoundedNodeOutput, next = this.next(node.nodeId), attemptId?: string, durableOutputs?: Readonly<Record<string, BoundedNodeOutput>>): Promise<WorkflowRunSnapshot> {
    const outputRef = toWorkflowOutputRef(output);
    return this.append(state, request, "node_completed", { nodeId: node.nodeId, outputRef }, { status: next.length ? "running" : "succeeded", selectedPath: [...state.selectedPath, node.nodeId], schedulerFrontier: next, outputs: { ...state.outputs, ...durableOutputs, [node.nodeId]: output }, outputRefs: { ...state.outputRefs, [node.nodeId]: outputRef }, waits: [], compatibilityPhase: next.length ? "saving" : "committed" }, { kind: "node", id: node.nodeId }, attemptId);
  }

  private approvalDecisionKey(approvalNodeId: string): string { return `__approval_decision__:${approvalNodeId}`; }

  private appendWait(state: WorkflowRunSnapshot, request: PumpRequest, waitpoint: WorkflowRunSnapshot["waits"][number], attemptId?: string): Promise<WorkflowRunSnapshot> {
    const outputRefs = waitpoint.kind === "budget_yield" && waitpoint.outputRef ? { ...state.outputRefs, [waitpoint.nodeId]: waitpoint.outputRef } : state.outputRefs;
    return this.append(state, request, "wait_created", { waitpoint }, { status: "waiting", waits: [waitpoint], outputRefs, compatibilityPhase: "waiting" }, { kind: "waitpoint", id: waitpoint.waitpointId }, attemptId);
  }

  private async appendReasoningYield(state: WorkflowRunSnapshot, request: PumpRequest, node: WorkflowVNextNode, wakeupReason: "node_budget_exhausted" | "wall_time_budget_exhausted", attemptId: string, outputRef?: WorkflowEventOutputRef): Promise<WorkflowRunSnapshot> {
    const waitpoint = { kind: "budget_yield" as const, waitpointId: `reasoning-budget:${state.workflowRunId}:${state.revision + 1}`, runId: state.workflowRunId, nodeId: node.nodeId, wakeupReason, ...(outputRef ? { outputRef } : {}) };
    await this.deps.journal.createWaitpoint(this.deps.owner, waitpoint);
    return this.appendWait(state, request, waitpoint, attemptId);
  }

  private appendStatus(state: WorkflowRunSnapshot, request: PumpRequest, status: WorkflowRunSnapshot["status"], compatibilityPhase: string, patch: Partial<WorkflowRunSnapshot> = {}): Promise<WorkflowRunSnapshot> {
    return this.append(state, request, "run_status_changed", { status, compatibilityPhase }, { ...patch, status, compatibilityPhase }, { kind: "run", id: state.workflowRunId });
  }

  private async append(state: WorkflowRunSnapshot, request: PumpRequest, eventType: "node_completed" | "wait_created" | "run_status_changed", payload: unknown, patch: Partial<WorkflowRunSnapshot>, subject: { kind: "run" | "node" | "waitpoint"; id: string }, attemptId?: string): Promise<WorkflowRunSnapshot> {
    const revision = state.revision + 1;
    const snapshot = workflowVNextRunStateSchema.parse({ ...state, ...patch, revision, eventSequence: revision });
    const event = { eventId: randomUUID(), schemaVersion: "sonik.workflow.event.v1" as const, eventVersion: 1 as const, workflowRunId: state.workflowRunId, sequence: revision, revision, actor: { kind: "worker" as const, id: request.lease.ownerId }, subject, causationId: request.lease.leaseId, ...(attemptId ? { attemptId } : {}), correlationIds: [request.lease.leaseId, ...(attemptId ? [attemptId] : [])], timestamp: new Date(this.now()).toISOString(), eventType, payload };
    if (!await this.deps.journal.appendEventAndProject(this.deps.owner, { expectedRevision: state.revision, leaseId: request.lease.leaseId, event: event as never, snapshot })) throw new Error("run_revision_or_lease_conflict");
    return snapshot;
  }

  private next(nodeId: string): string[] { return this.deps.definition.edges.filter((edge) => edge.from === nodeId).map((edge) => edge.to); }
  private async selectBranch(node: WorkflowVNextNode, state: WorkflowRunSnapshot): Promise<string[]> {
    const edges = this.deps.definition.edges.filter((edge) => edge.from === node.nodeId);
    const matches = [];
    for (const edge of edges) if (edge.predicate && await this.predicate(edge.predicate, state)) matches.push(edge);
    if (matches.length > 1) throw new Error("branch_ambiguous_match");
    const selected = matches[0] ?? edges.find((edge) => edge.default);
    if (!selected) throw new Error("branch_no_matching_edge");
    return [selected.to];
  }
  private async predicate(predicate: WorkflowVNextDefinition["edges"][number]["predicate"], state: WorkflowRunSnapshot): Promise<boolean> {
    if (!predicate) return false;
    if (predicate.operator === "exists") return this.bindingExists(predicate.left, state);
    const left = await this.binding(predicate.left, state); const right = predicate.right && "value" in predicate.right ? predicate.right.value : predicate.right ? await this.binding(predicate.right, state) : undefined;
    if (predicate.operator === "eq") return JSON.stringify(left) === JSON.stringify(right);
    if (predicate.operator === "not_eq") return JSON.stringify(left) !== JSON.stringify(right);
    if (predicate.operator === "in") return Array.isArray(right) && right.some((value) => JSON.stringify(value) === JSON.stringify(left));
    return typeof left === "number" && typeof right === "number" && ({ gt: left > right, gte: left >= right, lt: left < right, lte: left <= right } as const)[predicate.operator];
  }
  private async bindingExists(binding: WorkflowVNextNode["bindings"][string], state: WorkflowRunSnapshot): Promise<boolean> {
    if (binding.source === "node_output" && !(binding.nodeId in state.outputs)) return false;
    try { return await this.binding(binding, state) !== null; }
    catch (error) {
      if (error instanceof Error && ["binding_path_missing", "host_context_missing"].includes(error.message)) return false;
      throw error;
    }
  }
  private async resolveInput(node: WorkflowVNextNode, state: WorkflowRunSnapshot): Promise<JsonValue> {
    return Object.fromEntries(await Promise.all(Object.entries(node.bindings).map(async ([key, binding]) => [key, await this.binding(binding, state)]))) as JsonValue;
  }
  private binding(binding: WorkflowVNextNode["bindings"][string], state: WorkflowRunSnapshot): Promise<JsonValue> {
    return resolveWorkflowBinding(binding, {
      organizationId: state.organizationId,
      runInput: this.deps.runInput ?? null,
      hostContext: this.deps.hostContext ?? {},
      authorizedHostContextKeys: this.deps.authorizedHostContextKeys ?? new Set(this.deps.definition.nodes.flatMap((node) => node.requiredHostContext)),
      nodeOutputs: state.outputs,
      nodeOutputSchemas: this.nodeOutputSchemas(),
      loadArtifact: this.deps.loadArtifact,
    });
  }
  private nodeOutputSchemas(): ReadonlyMap<string, import("zod").ZodType> {
    const registry = this.deps.runtimeRegistry ?? workflowNodeExecutorRuntimeRegistry;
    return new Map(this.deps.definition.nodes.map((node) => {
      const descriptor = registry.descriptors.find((candidate) => candidate.nodeType === node.nodeType && candidate.typeVersion === node.typeVersion);
      if (!descriptor) throw new Error(`node_output_schema_missing:${node.nodeId}`);
      const key = workflowSchemaRefKey(descriptor.outputSchema);
      const schemas = registry.schemas as ReadonlyMap<string, import("zod").ZodType> | Readonly<Record<string, import("zod").ZodType>>;
      const schema = typeof (schemas as ReadonlyMap<string, import("zod").ZodType>).get === "function"
        ? (schemas as ReadonlyMap<string, import("zod").ZodType>).get(key)
        : (schemas as Readonly<Record<string, import("zod").ZodType>>)[key];
      if (!schema) throw new Error(`node_output_schema_missing:${node.nodeId}`);
      return [node.nodeId, schema];
    }));
  }
  private inline(value: JsonValue): BoundedNodeOutput { return { storage: "inline", value, byteLength: new TextEncoder().encode(JSON.stringify(value)).byteLength }; }
  private persistedEffectResponse(result: unknown): Extract<EngineResponse, { status: "succeeded" }> | undefined {
    const parsed = engineResponseSchema.safeParse(result);
    return parsed.success && parsed.data.status === "succeeded" && parsed.data.receipt?.semanticStatus === "success" ? parsed.data : undefined;
  }
  private node(nodeId: string): WorkflowVNextNode { const node = this.deps.definition.nodes.find((candidate) => candidate.nodeId === nodeId); if (!node) throw new Error(`unknown_node:${nodeId}`); return node; }
  private load(): Promise<WorkflowRunSnapshot> { return this.deps.journal.getSnapshot(this.deps.owner, this.deps.initialState.workflowRunId).then((state) => state ?? this.deps.initialState); }
  private now(): number { return (this.deps.now ?? Date.now)(); }
}

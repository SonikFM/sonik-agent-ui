import {
  authenticatedResumeEventSchema,
  runDriverPumpRequestSchema,
  workflowEffectIdempotencyKey,
  type BoundedNodeOutput,
  type RunDriver,
  type WorkflowWaitpoint,
} from "./workflow-vnext.ts";

export type RunDriverPumpRequest = Parameters<RunDriver["runUntilBlocked"]>[0];
export type RunDriverState = Awaited<ReturnType<RunDriver["runUntilBlocked"]>>;
export type SpikeEffectStatus = "claimed" | "in_flight" | "succeeded" | "failed" | "outcome_unknown" | "reconciled";
export type SpikeNodeAttemptStatus = "claimed" | "in_flight" | "waiting" | "succeeded" | "failed" | "reconciled";

export type RunDriverSpikeDispatchResult =
  | { kind: "completed"; output?: BoundedNodeOutput }
  | { kind: "waiting"; waitpoint: WorkflowWaitpoint }
  | { kind: "failed" }
  | { kind: "outcome_unknown" }
  | { kind: "delayed_retry" };

export interface RunDriverSpikeStore {
  load(workflowRunId: string): RunDriverState;
  acquireLease(workflowRunId: string, lease: RunDriverPumpRequest["lease"], now: number): boolean;
  compareAndSwap(workflowRunId: string, expectedRevision: number, next: RunDriverState, lease: RunDriverPumpRequest["lease"], now: number): boolean;
  claimNodeAttempt(workflowRunId: string, nodeId: string): { created: boolean; status: SpikeNodeAttemptStatus; result?: RunDriverSpikeDispatchResult };
  setNodeAttemptStatus(workflowRunId: string, nodeId: string, status: SpikeNodeAttemptStatus, result?: RunDriverSpikeDispatchResult): void;
  claimEffect(workflowRunId: string, logicalEffectId: string, idempotencyKey: string): { created: boolean; status: SpikeEffectStatus; result?: RunDriverSpikeDispatchResult };
  setEffectStatus(workflowRunId: string, logicalEffectId: string, idempotencyKey: string, status: SpikeEffectStatus, result?: RunDriverSpikeDispatchResult): void;
}

export type RunDriverSpikeDispatch = (
  state: RunDriverState,
  nodeId: string,
  context: { request: RunDriverPumpRequest; logicalEffectId?: string; idempotencyKey?: string },
) => Promise<RunDriverSpikeDispatchResult> | RunDriverSpikeDispatchResult;
export type RunDriverSpikeScheduler = (state: RunDriverState, nodeId: string) => string[];
export type RunDriverSpikeResumeAuthorizer = (
  state: RunDriverState,
  event: ReturnType<typeof authenticatedResumeEventSchema.parse>,
) => boolean;

export const NATIVE_RUN_DRIVER_DELAYED_RETRY_PUBLISHABLE = false as const;

export class NativeRunDriverSpike implements RunDriver {
  private readonly store: RunDriverSpikeStore;
  private readonly dispatch: RunDriverSpikeDispatch;
  private readonly nextNodeIdsFor: RunDriverSpikeScheduler;
  private readonly logicalEffectIdFor: (state: RunDriverState, nodeId: string) => string | undefined;
  private readonly now: () => number;
  private readonly authorizeResume: RunDriverSpikeResumeAuthorizer;

  constructor(
    store: RunDriverSpikeStore,
    dispatch: RunDriverSpikeDispatch,
    nextNodeIdsFor: RunDriverSpikeScheduler = () => [],
    logicalEffectIdFor: (state: RunDriverState, nodeId: string) => string | undefined = () => undefined,
    now: () => number = Date.now,
    authorizeResume: RunDriverSpikeResumeAuthorizer = () => false,
  ) {
    this.store = store;
    this.dispatch = dispatch;
    this.nextNodeIdsFor = nextNodeIdsFor;
    this.logicalEffectIdFor = logicalEffectIdFor;
    this.now = now;
    this.authorizeResume = authorizeResume;
  }

  start(request: RunDriverPumpRequest): Promise<RunDriverState> {
    return this.pump(request, false);
  }

  resume(request: RunDriverPumpRequest): Promise<RunDriverState> {
    return this.pump(request, true);
  }

  runUntilBlocked(request: RunDriverPumpRequest): Promise<RunDriverState> {
    return this.pump(request, false);
  }

  cancel(workflowRunId: string, lease: RunDriverPumpRequest["lease"]): RunDriverState {
    if (!this.store.acquireLease(workflowRunId, lease, this.now())) return this.store.load(workflowRunId);
    const state = this.store.load(workflowRunId);
    if (state.status === "cancelled") return state;
    const next = { ...state, status: "cancelled" as const, compatibilityPhase: "cancelled", schedulerFrontier: [], waits: [], revision: state.revision + 1 };
    if (!this.store.compareAndSwap(workflowRunId, state.revision, next, lease, this.now())) throw new Error("run_revision_or_lease_conflict");
    return next;
  }

  private async pump(input: RunDriverPumpRequest, resuming: boolean): Promise<RunDriverState> {
    const request = runDriverPumpRequestSchema.parse(input);
    const startedAt = this.now();
    if (Date.parse(request.lease.expiresAt) <= startedAt) throw new Error("lease_expired");
    if (!this.store.acquireLease(request.workflowRunId, request.lease, startedAt)) return this.store.load(request.workflowRunId);
    let state = this.store.load(request.workflowRunId);
    if (["succeeded", "failed", "cancelled"].includes(state.status)) return state;

    if (resuming) state = this.applyResume(state, request);
    else if (state.status === "waiting" && state.waits.some((wait) => wait.kind !== "budget_yield")) return state;
    else if (state.status === "waiting" && state.waits.some((wait) => wait.kind === "budget_yield")) state = this.save(state, { ...state, status: "running", waits: [] }, request);
    else if (state.status === "waiting") return state;

    let completedNodes = 0;
    while (state.schedulerFrontier.length > 0) {
      const wallTimeExhausted = this.now() - startedAt >= request.budget.maxWallTimeMs;
      if (completedNodes >= request.budget.maxNodes || wallTimeExhausted) {
        const nodeId = state.schedulerFrontier[0]!;
        const waitpoint: WorkflowWaitpoint = {
          kind: "budget_yield",
          waitpointId: `budget:${state.workflowRunId}:${state.revision + 1}`,
          runId: state.workflowRunId,
          nodeId,
          wakeupReason: wallTimeExhausted ? "wall_time_budget_exhausted" : "node_budget_exhausted",
        };
        return this.save(state, { ...state, status: "waiting", waits: [waitpoint], compatibilityPhase: "waiting" }, request);
      }

      const nodeId = state.schedulerFrontier[0]!;
      const logicalEffectId = this.logicalEffectIdFor(state, nodeId);
      const idempotencyKey = logicalEffectId ? workflowEffectIdempotencyKey(state.workflowRunId, logicalEffectId) : undefined;
      if (logicalEffectId) {
        const claim = this.store.claimEffect(state.workflowRunId, logicalEffectId, idempotencyKey!);
        if (!claim.created) {
          if (claim.status === "succeeded" && claim.result?.kind === "completed") {
            state = this.completeNode(state, nodeId, claim.result, request);
            this.store.setEffectStatus(state.workflowRunId, logicalEffectId, idempotencyKey!, "reconciled", claim.result);
            completedNodes += 1;
            continue;
          }
          if (claim.status === "outcome_unknown") {
            state = this.save(state, { ...state, status: "waiting", compatibilityPhase: "outcome_unknown" }, request);
            this.store.setEffectStatus(state.workflowRunId, logicalEffectId, idempotencyKey!, "reconciled", claim.result);
          }
          return state;
        }
        this.store.setEffectStatus(state.workflowRunId, logicalEffectId, idempotencyKey!, "in_flight");
      } else {
        const claim = this.store.claimNodeAttempt(state.workflowRunId, nodeId);
        if (!claim.created && claim.status !== "waiting") {
          if (claim.status === "succeeded" && claim.result?.kind === "completed") {
            state = this.completeNode(state, nodeId, claim.result, request);
            this.store.setNodeAttemptStatus(state.workflowRunId, nodeId, "reconciled", claim.result);
            completedNodes += 1;
            continue;
          }
          return state;
        }
        this.store.setNodeAttemptStatus(state.workflowRunId, nodeId, "in_flight");
      }

      const result = await this.dispatch(state, nodeId, { request, logicalEffectId, idempotencyKey });
      if (result.kind === "delayed_retry") throw new Error("delayed_retry_requires_queue_or_scheduled_wakeup");
      if (result.kind === "outcome_unknown") {
        if (!logicalEffectId || !idempotencyKey) throw new Error("outcome_unknown_requires_logical_effect");
        this.store.setEffectStatus(state.workflowRunId, logicalEffectId, idempotencyKey, "outcome_unknown", result);
        state = this.save(state, { ...state, status: "waiting", compatibilityPhase: "outcome_unknown" }, request);
        this.store.setEffectStatus(state.workflowRunId, logicalEffectId, idempotencyKey, "reconciled", result);
        return state;
      }
      if (result.kind === "failed") {
        if (logicalEffectId) this.store.setEffectStatus(state.workflowRunId, logicalEffectId, idempotencyKey!, "failed", result);
        else this.store.setNodeAttemptStatus(state.workflowRunId, nodeId, "failed", result);
        return this.save(state, { ...state, status: "failed", compatibilityPhase: "error", schedulerFrontier: [] }, request);
      }
      if (result.kind === "waiting") {
        if (!logicalEffectId) this.store.setNodeAttemptStatus(state.workflowRunId, nodeId, "waiting", result);
        return this.save(state, { ...state, status: "waiting", waits: [result.waitpoint], compatibilityPhase: "waiting" }, request);
      }

      if (logicalEffectId) this.store.setEffectStatus(state.workflowRunId, logicalEffectId, idempotencyKey!, "succeeded", result);
      else this.store.setNodeAttemptStatus(state.workflowRunId, nodeId, "succeeded", result);
      state = this.completeNode(state, nodeId, result, request);
      if (logicalEffectId) this.store.setEffectStatus(state.workflowRunId, logicalEffectId, idempotencyKey!, "reconciled", result);
      else this.store.setNodeAttemptStatus(state.workflowRunId, nodeId, "reconciled", result);
      completedNodes += 1;
    }
    return state.status === "succeeded" ? state : this.save(state, { ...state, status: "succeeded", compatibilityPhase: "committed" }, request);
  }

  private applyResume(state: RunDriverState, request: RunDriverPumpRequest): RunDriverState {
    const humanWait = state.waits.find((wait) => wait.kind !== "budget_yield");
    if (!humanWait) return state.status === "waiting" && state.waits.some((wait) => wait.kind === "budget_yield")
      ? this.save(state, { ...state, status: "running", waits: [] }, request)
      : state;
    const event = authenticatedResumeEventSchema.parse(request.resumeEvent);
    const expectedKind = humanWait.kind === "approval" ? "approval" : "answer";
    if (event.workflowRunId !== state.workflowRunId || event.organizationId !== state.organizationId || event.waitpointId !== humanWait.waitpointId || event.nodeId !== humanWait.nodeId || event.runRevision !== state.revision || event.subjectId !== humanWait.subjectId || event.kind !== expectedKind) {
      throw new Error("resume_event_does_not_match_waitpoint");
    }
    if (humanWait.kind === "approval" && event.kind === "approval" && event.logicalEffectId !== humanWait.logicalEffectId) throw new Error("resume_event_does_not_match_effect");
    if (humanWait.expiresAt && (this.now() >= Date.parse(humanWait.expiresAt) || Date.parse(event.issuedAt) > Date.parse(humanWait.expiresAt))) throw new Error("waitpoint_expired");
    if (!this.authorizeResume(state, event)) throw new Error("resume_event_not_authorized");
    return this.save(state, { ...state, status: "running", waits: [], compatibilityPhase: "saving" }, request);
  }

  private completeNode(state: RunDriverState, nodeId: string, result: Extract<RunDriverSpikeDispatchResult, { kind: "completed" }>, request: RunDriverPumpRequest): RunDriverState {
    const nextNodeIds = this.nextNodeIdsFor(state, nodeId);
    if (nextNodeIds.length > 1) throw new Error("ambiguous_scheduler_transition");
    return this.save(state, {
      ...state,
      status: nextNodeIds.length ? "running" : "succeeded",
      selectedPath: [...state.selectedPath, nodeId],
      schedulerFrontier: nextNodeIds,
      outputs: result.output ? { ...state.outputs, [nodeId]: result.output } : state.outputs,
      waits: [],
      compatibilityPhase: nextNodeIds.length ? "saving" : "committed",
    }, request);
  }

  private save(current: RunDriverState, next: RunDriverState, request: RunDriverPumpRequest): RunDriverState {
    const revised = { ...next, revision: current.revision + 1 };
    if (!this.store.compareAndSwap(current.workflowRunId, current.revision, revised, request.lease, this.now())) throw new Error("run_revision_or_lease_conflict");
    return revised;
  }
}

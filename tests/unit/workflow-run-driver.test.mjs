import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createInMemoryWorkflowRunJournalStore } from "../../apps/standalone-sveltekit/src/lib/server/workflow-run-store.ts";
import { WorkflowRunDriver } from "../../apps/standalone-sveltekit/src/lib/server/workflow-run-driver.ts";
import { hashWorkflowInput } from "../../apps/standalone-sveltekit/src/lib/server/workflow-node-executors.ts";
import { handleWorkflowRunsAction } from "../../apps/standalone-sveltekit/src/lib/server/workflow-runs.ts";
import { train0SelectedPathRunState, train0WorkflowFixtures } from "../../packages/tool-contracts/src/workflow-vnext-fixtures.ts";

const owner = { organizationId: "org-1", userId: "user-1" };
const future = () => new Date(Date.now() + 60_000).toISOString();
const lease = (leaseId) => ({ leaseId, ownerId: leaseId, expiresAt: future() });
const request = (runId, leaseId, budget = { maxNodes: 20, maxWallTimeMs: 10_000 }) => ({ workflowRunId: runId, lease: lease(leaseId), budget });

function harness(definition, suffix, options = {}) {
  const runId = `run-${suffix}`;
  const journal = createInMemoryWorkflowRunJournalStore({ getRun: (candidate, candidateRunId) => candidate.organizationId === owner.organizationId && candidate.userId === owner.userId && candidateRunId === runId ? {} : null });
  const initialState = {
    ...structuredClone(train0SelectedPathRunState),
    workflowRunId: runId,
    source: { kind: "published", organizationId: owner.organizationId, workflowVersionId: `${definition.workflowId}@1`, definitionDigest: `sha256:${"e".repeat(64)}` },
    status: "ready",
    revision: 0,
    eventSequence: 0,
    selectedPath: [],
    schedulerFrontier: [definition.entryNodeId],
    outputs: {},
    outputRefs: {},
    waits: [],
    compatibilityPhase: "ready",
  };
  return { runId, journal, driver: new WorkflowRunDriver({ journal, owner, definition, initialState, ...options }) };
}

{
  const { runId, driver, journal } = harness(train0WorkflowFixtures.linear, "linear");
  const completed = await driver.start(request(runId, "linear-a"));
  assert.equal(completed.status, "succeeded");
  assert.deepEqual(completed.selectedPath, ["start", "work"], "scheduler, not client node IDs, owns traversal");
  assert.equal((await journal.listEvents(owner, runId)).length, 3, "status plus two node events are canonical and gap-free");
}

{
  const { runId, driver } = harness(train0WorkflowFixtures.conditional, "branch");
  const completed = await driver.start(request(runId, "branch-a"));
  assert.equal(completed.status, "succeeded");
  assert.deepEqual(completed.selectedPath, ["start", "choose", "no"], "one deterministic branch is selected");
  assert.equal(completed.selectedPath.includes("yes"), false, "unselected branches never dispatch");
}

{
  const { runId, driver } = harness(train0WorkflowFixtures.linear, "budget");
  const yielded = await driver.start(request(runId, "budget-a", { maxNodes: 1, maxWallTimeMs: 10_000 }));
  assert.equal(yielded.status, "waiting");
  assert.equal(yielded.waits[0].kind, "budget_yield");
  const resumed = await driver.resume(request(runId, "budget-a"));
  assert.equal(resumed.status, "succeeded");
}

{
  const { runId, driver } = harness(train0WorkflowFixtures.linear, "takeover");
  const shortLease = { leaseId: "takeover-a", ownerId: "worker-a", expiresAt: new Date(Date.now() + 10).toISOString() };
  const yielded = await driver.start({ workflowRunId: runId, lease: shortLease, budget: { maxNodes: 1, maxWallTimeMs: 10_000 } });
  assert.equal(yielded.status, "waiting");
  await new Promise((resolve) => setTimeout(resolve, 15));
  const completed = await driver.resume(request(runId, "takeover-b"));
  assert.equal(completed.status, "succeeded", "an expired lease can be taken over from canonical state");
}

{
  let answered = false;
  const { runId, driver } = harness(train0WorkflowFixtures.askUser, "ask", {
    executionContext: (node) => node.nodeType === "ask_user" ? { subjectId: owner.userId, ...(answered ? { answer: "Ada" } : {}) } : {},
  });
  const waiting = await driver.start(request(runId, "ask-a"));
  assert.equal(waiting.status, "waiting");
  const waitpoint = waiting.waits[0];
  answered = true;
  const resumed = await driver.resume({
    ...request(runId, "ask-a"),
    resumeEvent: { kind: "answer", answer: "Ada", eventId: "answer-1", waitpointId: waitpoint.waitpointId, workflowRunId: runId, organizationId: owner.organizationId, nodeId: waitpoint.nodeId, runRevision: waiting.revision, subjectId: owner.userId, issuedAt: new Date().toISOString(), authenticationEvidenceDigest: `sha256:${"a".repeat(64)}` },
  });
  assert.equal(resumed.status, "succeeded", "a persisted wait resumes once after service recreation-compatible state load");
  await assert.rejects(() => driver.resume({ ...request(runId, "ask-a"), resumeEvent: { kind: "answer", answer: "Ada", eventId: "answer-2", waitpointId: waitpoint.waitpointId, workflowRunId: runId, organizationId: owner.organizationId, nodeId: waitpoint.nodeId, runRevision: waiting.revision, subjectId: owner.userId, issuedAt: new Date().toISOString(), authenticationEvidenceDigest: `sha256:${"a".repeat(64)}` } }), /waitpoint|terminal|resume/i);
}

{
  let dispatches = 0;
  const { runId, driver } = harness(train0WorkflowFixtures.linear, "lease", {
    executionContext: (node) => ({ executors: { [node.nodeType]: (engineRequest) => {
      dispatches += 1;
      const value = engineRequest.input;
      return { status: "succeeded", output: { storage: "inline", value, byteLength: new TextEncoder().encode(JSON.stringify(value)).byteLength } };
    } } }),
  });
  await Promise.all([driver.start(request(runId, "lease-a")), driver.start(request(runId, "lease-b"))]);
  assert.equal(dispatches, 2, "only the lease winner dispatches the two-node workflow");
}

function readiness(capabilityId, callable = true) {
  return { capabilityId, callable, reasonCodes: callable ? [] : ["kill_switched"] };
}

function approvalDecision(runId, definition) {
  const commit = definition.nodes.find((node) => node.nodeType === "tool_commit");
  const binding = commit.effectBinding;
  return {
    decisionId: "decision-1", decision: "approved", runId, approvalNodeId: binding.approvalNodeId,
    previewNodeId: binding.previewNodeId, commitNodeId: commit.nodeId, commandId: binding.commandId,
    logicalEffectId: binding.logicalEffectId, organizationId: owner.organizationId, approverId: owner.userId,
    grantEvidenceDigest: `sha256:${"a".repeat(64)}`, resolvedInputHash: binding.resolvedInputHash,
    issuedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: future(), hostSigned: true,
  };
}

function approvalDefinition() {
  const definition = structuredClone(train0WorkflowFixtures.approval);
  const resolvedInputHash = `sha256:${createHash("sha256").update("{}").digest("hex")}`;
  for (const node of definition.nodes) {
    if (node.previewEffect) node.previewEffect.resolvedInputHash = resolvedInputHash;
    if (node.approvalEffect) node.approvalEffect.resolvedInputHash = resolvedInputHash;
    if (node.effectBinding) node.effectBinding.resolvedInputHash = resolvedInputHash;
  }
  return definition;
}

assert.equal(hashWorkflowInput({ b: 2, a: { d: 4, c: 3 } }), hashWorkflowInput({ a: { c: 3, d: 4 }, b: 2 }), "resolved input hashing is canonical across object insertion order");

{
  const definition = approvalDefinition();
  let commits = 0;
  const { runId, driver, journal } = harness(definition, "commit", {
    hostContext: { organizationId: owner.organizationId, principalId: owner.userId },
    resolveReadiness: () => [readiness("booking.create.booking")],
    executionContext: (node) => node.nodeType === "tool_preview" ? { commandId: "booking.create.booking" } : node.nodeType === "approval" ? { approvalDecision: "approved" } : node.nodeType === "tool_commit" ? { executors: { tool_commit: () => {
      commits += 1;
      return { status: "succeeded", output: { storage: "inline", value: { ok: true }, byteLength: 11 }, receipt: { receiptId: "receipt-1", semanticStatus: "success" } };
    } } } : {},
  });
  driver.deps.approvalDecision = () => approvalDecision(runId, definition);
  const completed = await driver.start(request(runId, "commit-a"));
  assert.equal(completed.status, "succeeded");
  assert.equal(commits, 1);
  const binding = definition.nodes.find((node) => node.nodeType === "tool_commit").effectBinding;
  const persisted = await journal.claimEffect(owner, {
    claimId: "ignored", runId, logicalEffectId: binding.logicalEffectId, attemptId: "ignored",
    idempotencyKey: `${runId}:${binding.logicalEffectId}`, providerSupportsIdempotency: true,
  });
  assert.deepEqual(persisted.claim.result, {
    status: "succeeded",
    output: { storage: "inline", value: { ok: true }, byteLength: 11 },
    receipt: { receiptId: "receipt-1", semanticStatus: "success" },
  }, "the canonical durable effect result retains its semantic receipt");
  await driver.start(request(runId, "commit-b"));
  assert.equal(commits, 1, "lost-response retry replays durable success without a second provider effect");
}

{
  const definition = approvalDefinition();
  let commits = 0;
  const { runId, driver, journal } = harness(definition, "reconciled-replay", {
    hostContext: { organizationId: owner.organizationId, principalId: owner.userId },
    resolveReadiness: () => [readiness("booking.create.booking")],
    executionContext: (node) => node.nodeType === "tool_preview" ? { commandId: "booking.create.booking" } : node.nodeType === "approval" ? { approvalDecision: "approved" } : node.nodeType === "tool_commit" ? { executors: { tool_commit: () => { commits += 1; throw new Error("must not redispatch"); } } } : {},
  });
  driver.deps.approvalDecision = () => approvalDecision(runId, definition);
  const binding = definition.nodes.find((node) => node.nodeType === "tool_commit").effectBinding;
  const effect = { claimId: "reconciled", runId, logicalEffectId: binding.logicalEffectId, attemptId: "lost", idempotencyKey: `${runId}:${binding.logicalEffectId}`, providerSupportsIdempotency: true };
  await journal.claimEffect(owner, effect);
  await journal.transitionEffectClaim(owner, runId, binding.logicalEffectId, "claimed", "in_flight");
  await journal.transitionEffectClaim(owner, runId, binding.logicalEffectId, "in_flight", "outcome_unknown");
  await journal.transitionEffectClaim(owner, runId, binding.logicalEffectId, "outcome_unknown", "reconciled", {
    status: "succeeded",
    output: { storage: "inline", value: { ok: true }, byteLength: 11 },
    receipt: { receiptId: "receipt-reconciled", semanticStatus: "success" },
  });
  const completed = await driver.start(request(runId, "reconciled-a"));
  assert.equal(completed.status, "succeeded");
  assert.equal(commits, 0, "a reconciled canonical receipt replays without a second provider effect");
}

{
  const definition = approvalDefinition();
  let approved = false;
  const { runId, driver } = harness(definition, "approval-wait", {
    hostContext: { organizationId: owner.organizationId, principalId: owner.userId },
    resolveReadiness: () => [readiness("booking.create.booking")],
    executionContext: (node) => node.nodeType === "tool_preview" ? { commandId: "booking.create.booking" } : node.nodeType === "approval" ? { subjectId: owner.userId, ...(approved ? { approvalDecision: "approved" } : {}) } : node.nodeType === "tool_commit" ? { executors: { tool_commit: () => ({ status: "succeeded", output: { storage: "inline", value: { ok: true }, byteLength: 11 }, receipt: { receiptId: "receipt-approval", semanticStatus: "success" } }) } } : {},
  });
  driver.deps.approvalDecision = () => approvalDecision(runId, definition);
  const waiting = await driver.start(request(runId, "approval-a"));
  assert.equal(waiting.waits[0].kind, "approval");
  const waitpoint = waiting.waits[0];
  await assert.rejects(() => driver.resume({ ...request(runId, "approval-a"), resumeEvent: { kind: "approval", eventId: "wrong-effect", waitpointId: waitpoint.waitpointId, workflowRunId: runId, organizationId: owner.organizationId, nodeId: waitpoint.nodeId, runRevision: waiting.revision, subjectId: owner.userId, issuedAt: new Date().toISOString(), authenticationEvidenceDigest: `sha256:${"a".repeat(64)}`, logicalEffectId: "sibling-effect" } }), /resume_event_does_not_match_waitpoint/, "approval resume must bind the persisted waitpoint effect before resolving it");
  approved = true;
  const completed = await driver.resume({ ...request(runId, "approval-a"), resumeEvent: { kind: "approval", eventId: "approval-event", waitpointId: waitpoint.waitpointId, workflowRunId: runId, organizationId: owner.organizationId, nodeId: waitpoint.nodeId, runRevision: waiting.revision, subjectId: owner.userId, issuedAt: new Date().toISOString(), authenticationEvidenceDigest: `sha256:${"a".repeat(64)}`, logicalEffectId: waitpoint.logicalEffectId } });
  assert.equal(completed.status, "succeeded");
}

{
  const definition = approvalDefinition();
  let providerCalls = 0;
  const { runId, driver, journal } = harness(definition, "signed-decision-mismatch", {
    hostContext: { organizationId: owner.organizationId, principalId: owner.userId },
    resolveReadiness: () => [readiness("booking.create.booking")],
    executionContext: (node) => node.nodeType === "tool_preview" ? { commandId: "booking.create.booking" } : node.nodeType === "approval" ? { approvalDecision: "approved" } : node.nodeType === "tool_commit" ? { executors: { tool_commit: () => { providerCalls += 1; throw new Error("must not dispatch"); } } } : {},
  });
  let claimCalls = 0;
  const claimEffect = journal.claimEffect.bind(journal);
  journal.claimEffect = (...args) => { claimCalls += 1; return claimEffect(...args); };
  driver.deps.approvalDecision = () => ({ ...approvalDecision(runId, definition), logicalEffectId: "sibling-effect" });
  const denied = await driver.start(request(runId, "signed-decision-mismatch-a"));
  assert.equal(denied.compatibilityPhase, "approval_effect_binding_mismatch");
  assert.equal(claimCalls, 0);
  assert.equal(providerCalls, 0);
}

{
  const definition = approvalDefinition();
  let commits = 0;
  const { runId, driver } = harness(definition, "unsafe-write-retry", {
    hostContext: { organizationId: owner.organizationId, principalId: owner.userId }, resolveReadiness: () => [readiness("booking.create.booking")],
    executionContext: (node) => node.nodeType === "tool_preview" ? { commandId: "booking.create.booking" } : node.nodeType === "approval" ? { approvalDecision: "approved" } : node.nodeType === "tool_commit" ? { executors: { tool_commit: () => { commits += 1; return { status: "retryable_error", error: { code: "provider_busy", message: "retry", retrySafe: true } }; } } } : {},
  });
  driver.deps.approvalDecision = () => approvalDecision(runId, definition);
  const failed = await driver.start(request(runId, "unsafe-a"));
  assert.equal(failed.status, "failed");
  assert.equal(failed.compatibilityPhase, "unsafe_write_retry_refused");
  assert.equal(commits, 1, "unsafe writes are never retried");
}

{
  const definition = structuredClone(train0WorkflowFixtures.linear);
  definition.nodes[1].nodeType = "reasoning";
  definition.nodes[1].reasoning = { structuredOutputSchema: { schemaId: "reasoning.output", version: 1, digest: `sha256:${"a".repeat(64)}` }, budgets: { maxSteps: 1, maxTokens: 10, maxWallTimeMs: 100 }, nestedCapabilityEffects: [] };
  const { runId, driver } = harness(definition, "reasoning", { executionContext: (node) => node.nodeType === "reasoning" ? { reasoning: { ...node.reasoning, nestedCapabilityEffects: ["write"] } } : {} });
  const failed = await driver.start(request(runId, "reasoning-a"));
  assert.equal(failed.status, "failed");
  assert.equal(failed.compatibilityPhase, "reasoning_contract_required");
}

{
  const definition = approvalDefinition();
  let commits = 0;
  const { runId, driver } = harness(definition, "revoked", {
    hostContext: { organizationId: owner.organizationId, principalId: owner.userId },
    resolveReadiness: () => [readiness("booking.create.booking", false)],
    executionContext: (node) => node.nodeType === "tool_preview" ? { commandId: "booking.create.booking" } : node.nodeType === "approval" ? { approvalDecision: "approved" } : node.nodeType === "tool_commit" ? { executors: { tool_commit: () => { commits += 1; throw new Error("must not dispatch"); } } } : {},
  });
  driver.deps.approvalDecision = () => approvalDecision(runId, definition);
  const denied = await driver.start(request(runId, "revoked-a"));
  assert.equal(denied.status, "failed");
  assert.match(denied.compatibilityPhase, /kill_switched/);
  assert.equal(commits, 0, "commit-time readiness re-resolution blocks stale UI grants");
}

{
  let dispatches = 0;
  const { runId, driver } = harness(train0WorkflowFixtures.linear, "cancel", { executionContext: () => ({ executors: { trigger: () => { dispatches += 1; throw new Error("must not dispatch"); } } }) });
  const cancelled = await driver.cancel(runId, lease("cancel-a"));
  assert.equal(cancelled.status, "cancelled");
  assert.equal(dispatches, 0);
}

{
  const { runId, driver } = harness(train0WorkflowFixtures.linear, "pin-drift", {
    resolveDependencyPins: () => ({ ...train0SelectedPathRunState.dependencyPins, runtimePolicyDigest: `sha256:${"9".repeat(64)}` }),
  });
  const failed = await driver.start(request(runId, "pin-drift-a"));
  assert.equal(failed.status, "failed");
  assert.equal(failed.compatibilityPhase, "dependency_pin_drift");
}

{
  const definition = structuredClone(train0WorkflowFixtures.linear);
  definition.nodes[1].nodeType = "tool_preview";
  let attempts = 0;
  const { runId, driver } = harness(definition, "retry", {
    executionContext: (node) => node.nodeType === "tool_preview" ? { executors: { tool_preview: () => {
      attempts += 1;
      return { status: "retryable_error", error: { code: "provider_busy", message: "retry", retrySafe: true } };
    } } } : {},
  });
  const failed = await driver.start(request(runId, "retry-a"));
  assert.equal(failed.status, "failed");
  assert.equal(failed.compatibilityPhase, "safe_read_retry_exhausted");
  assert.equal(attempts, 3, "safe reads retry only within the fixed attempt bound");
}

{
  const definition = structuredClone(train0WorkflowFixtures.linear);
  definition.nodes[1].nodeType = "reasoning";
  definition.nodes[1].reasoning = { structuredOutputSchema: { schemaId: "reasoning.output", version: 1, digest: `sha256:${"a".repeat(64)}` }, budgets: { maxSteps: 2, maxTokens: 10, maxWallTimeMs: 100 }, nestedCapabilityEffects: [] };
  let attempts = 0;
  const { runId, driver } = harness(definition, "reasoning-budget", { executionContext: (node) => node.nodeType === "reasoning" ? { reasoning: node.reasoning, executors: { reasoning: () => { attempts += 1; return { status: "retryable_error", error: { code: "provider_busy", message: "retry", retrySafe: true } }; } } } : {} });
  const failed = await driver.start(request(runId, "reasoning-budget-a"));
  assert.equal(failed.status, "failed");
  assert.equal(failed.compatibilityPhase, "reasoning_budget_exhausted");
  assert.equal(attempts, 2, "reasoning maxSteps is an execution bound, not advisory metadata");
}

{
  const definition = approvalDefinition();
  let providerCalls = 0;
  const { runId, driver } = harness(definition, "lost-response", {
    hostContext: { organizationId: owner.organizationId, principalId: owner.userId },
    resolveReadiness: () => [readiness("booking.create.booking")],
    executionContext: (node) => node.nodeType === "tool_preview" ? { commandId: "booking.create.booking" } : node.nodeType === "approval" ? { approvalDecision: "approved" } : node.nodeType === "tool_commit" ? { executors: { tool_commit: () => { providerCalls += 1; throw new Error("response lost after acceptance"); } } } : {},
    reconcileEffect: () => ({ status: "succeeded", output: { storage: "inline", value: { ok: true }, byteLength: 11 }, receipt: { receiptId: "receipt-reconciled", semanticStatus: "success" } }),
  });
  driver.deps.approvalDecision = () => approvalDecision(runId, definition);
  const unknown = await driver.start(request(runId, "lost-a"));
  assert.equal(unknown.compatibilityPhase, "outcome_unknown");
  const cancellation = await driver.cancel(runId, lease("lost-cancel"));
  assert.equal(cancellation.compatibilityPhase, "outcome_unknown", "cancellation cannot falsely undo an accepted unknown effect");
  const reconciled = await driver.runUntilBlocked(request(runId, "lost-a"));
  assert.equal(reconciled.status, "succeeded");
  assert.equal(providerCalls, 1, "reconciliation never replays an accepted provider effect");
}

{
  const definition = approvalDefinition();
  definition.nodes.find((node) => node.nodeType === "tool_commit").bindings = { changed: { source: "constant", value: true } };
  let providerCalls = 0;
  const { runId, driver, journal } = harness(definition, "commit-input-mismatch", {
    hostContext: { organizationId: owner.organizationId, principalId: owner.userId },
    resolveReadiness: () => [readiness("booking.create.booking")],
    executionContext: (node) => node.nodeType === "tool_preview" ? { commandId: "booking.create.booking" } : node.nodeType === "approval" ? { approvalDecision: "approved" } : node.nodeType === "tool_commit" ? { executors: { tool_commit: () => { providerCalls += 1; throw new Error("must not dispatch"); } } } : {},
  });
  let claimCalls = 0;
  const claimEffect = journal.claimEffect.bind(journal);
  journal.claimEffect = (...args) => { claimCalls += 1; return claimEffect(...args); };
  driver.deps.approvalDecision = () => approvalDecision(runId, definition);
  const denied = await driver.start(request(runId, "commit-input-mismatch-a"));
  assert.equal(denied.compatibilityPhase, "resolved_input_hash_mismatch");
  assert.equal(claimCalls, 0, "changed commit input is rejected before the durable effect claim");
  assert.equal(providerCalls, 0, "changed commit input is rejected before effect claim and provider dispatch");
}

{
  const definition = approvalDefinition();
  let providerCalls = 0;
  const { runId, driver, journal } = harness(definition, "preview-output-mismatch", {
    hostContext: { organizationId: owner.organizationId, principalId: owner.userId },
    resolveReadiness: () => [readiness("booking.create.booking")],
    executionContext: (node) => node.nodeType === "tool_preview" ? { executors: { tool_preview: () => {
      const value = { commandId: "wrong.command", stableInputHash: node.previewEffect.resolvedInputHash, effect: "read", approvalRequired: false };
      return { status: "succeeded", output: { storage: "inline", value, byteLength: new TextEncoder().encode(JSON.stringify(value)).byteLength } };
    } } } : node.nodeType === "approval" ? { approvalDecision: "approved" } : node.nodeType === "tool_commit" ? { executors: { tool_commit: () => { providerCalls += 1; throw new Error("must not dispatch"); } } } : {},
  });
  let claimCalls = 0;
  const claimEffect = journal.claimEffect.bind(journal);
  journal.claimEffect = (...args) => { claimCalls += 1; return claimEffect(...args); };
  driver.deps.approvalDecision = () => approvalDecision(runId, definition);
  const denied = await driver.start(request(runId, "preview-output-mismatch-a"));
  assert.equal(denied.compatibilityPhase, "preview_output_binding_mismatch");
  assert.equal(claimCalls, 0);
  assert.equal(providerCalls, 0);
}

{
  const hostSession = { authenticated: true, organizationId: owner.organizationId, userId: owner.userId };
  let calls = 0;
  const fakeDriver = { runUntilBlocked: async () => { calls += 1; return { status: "succeeded" }; } };
  assert.equal((await handleWorkflowRunsAction({ action: "run_until_blocked", request: { hostSigned: true } }, { hostSession, driver: fakeDriver })).reason, "public_hostSigned_forbidden");
  const result = await handleWorkflowRunsAction({ action: "run_until_blocked", request: { workflowRunId: "generic" } }, { hostSession, driver: fakeDriver });
  assert.equal(result.ok, true);
  assert.equal(calls, 1, "generic public service routes through the same driver without workflow-ID callbacks");
}

console.log(JSON.stringify({ ok: true, checked: "workflow-run-driver" }));

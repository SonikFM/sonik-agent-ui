import assert from "node:assert/strict";
import { NativeRunDriverSpike, NATIVE_RUN_DRIVER_DELAYED_RETRY_PUBLISHABLE } from "../../packages/tool-contracts/dist/run-driver-spike.js";

const digest = `sha256:${"a".repeat(64)}`;
const BASE_TIME = Date.now();
const source = { kind: "published", organizationId: "org-1", workflowVersionId: "v1", definitionDigest: digest };
const dependencyPins = { organizationId: "org-1", workflowVersionId: "v1", definitionDigest: digest, agentPublishedVersionId: "a1", nodeDescriptorsDigest: digest, capabilityVersionsDigest: digest, toolPackVersionsDigest: digest, skillVersionsDigest: digest, runtimePolicyDigest: digest };
const state = (runId, frontier = ["a"]) => ({ workflowRunId: runId, organizationId: "org-1", source, status: "ready", revision: 0, selectedPath: [], schedulerFrontier: frontier, outputs: {}, waits: [], compatibilityPhase: "intake", dependencyPins });
const lease = (id, owner, expiresInMs) => ({ leaseId: id, ownerId: owner, expiresAt: new Date(BASE_TIME + expiresInMs).toISOString() });
const request = (runId, activeLease, budget = { maxNodes: 10, maxWallTimeMs: 1_000 }, resumeEvent) => ({ workflowRunId: runId, lease: activeLease, budget, resumeEvent });

class FakeStore {
  states = new Map(); leases = new Map(); effects = new Map(); effectKeys = new Map(); effectResults = new Map(); effectHistory = new Map(); nodeAttempts = new Map(); nodeResults = new Map(); nodeHistory = new Map(); failNextCas = false;
  constructor(initial) { this.states.set(initial.workflowRunId, structuredClone(initial)); }
  load(id) { return structuredClone(this.states.get(id)); }
  acquireLease(id, next, now) { const current = this.leases.get(id); if (current && current.expiresAt > now && current.leaseId !== next.leaseId) return false; this.leases.set(id, { leaseId: next.leaseId, expiresAt: Date.parse(next.expiresAt) }); return true; }
  compareAndSwap(id, revision, next, activeLease, now) { if (this.failNextCas) { this.failNextCas = false; return false; } const held = this.leases.get(id); if (!held || held.leaseId !== activeLease.leaseId || held.expiresAt <= now || this.states.get(id).revision !== revision) return false; this.states.set(id, structuredClone(next)); return true; }
  claimNodeAttempt(runId, nodeId) { const id = `${runId}:${nodeId}`; const status = this.nodeAttempts.get(id); if (status) return { created: false, status, result: this.nodeResults.get(id) }; this.setNodeAttemptStatus(runId, nodeId, "claimed"); return { created: true, status: "claimed" }; }
  setNodeAttemptStatus(runId, nodeId, status, result) { const id = `${runId}:${nodeId}`; this.nodeAttempts.set(id, status); this.nodeHistory.set(id, [...(this.nodeHistory.get(id) ?? []), status]); if (result) this.nodeResults.set(id, structuredClone(result)); }
  claimEffect(runId, effectId, key) { const id = `${runId}:${effectId}`; const status = this.effects.get(id); if (status) return { created: false, status, result: this.effectResults.get(id) }; this.setEffectStatus(runId, effectId, key, "claimed"); return { created: true, status: "claimed" }; }
  setEffectStatus(runId, effectId, key, status, result) { const id = `${runId}:${effectId}`; this.effects.set(id, status); this.effectHistory.set(id, [...(this.effectHistory.get(id) ?? []), status]); const previous = this.effectKeys.get(id); assert.ok(!previous || previous === key, "logical effect idempotency key stays stable"); this.effectKeys.set(id, key); if (result) this.effectResults.set(id, structuredClone(result)); }
}

{
  const store = new FakeStore(state("selected"));
  const seen = [];
  const driver = new NativeRunDriverSpike(store, (_run, node) => { seen.push(node); return { kind: "completed" }; }, (_run, node) => node === "a" ? ["chosen"] : []);
  const result = await driver.start(request("selected", lease("l1", "w1", 10_000)));
  assert.deepEqual(result.selectedPath, ["a", "chosen"]);
  assert.deepEqual(seen, ["a", "chosen"], "unselected paths never dispatch");
  assert.equal(result.status, "succeeded");
}

{
  const store = new FakeStore(state("budget", ["a", "b"]));
  const driver = new NativeRunDriverSpike(store, () => ({ kind: "completed" }), (_run, node) => node === "a" ? ["b"] : []);
  const yielded = await driver.start(request("budget", lease("l1", "w1", 10_000), { maxNodes: 1, maxWallTimeMs: 1_000 }));
  assert.equal(yielded.waits[0].kind, "budget_yield");
  assert.equal(yielded.waits[0].wakeupReason, "node_budget_exhausted");
  const completed = await driver.resume(request("budget", lease("l1", "w1", 10_000)));
  assert.equal(completed.status, "succeeded");
}

{
  let now = BASE_TIME;
  const store = new FakeStore(state("wall-time"));
  const driver = new NativeRunDriverSpike(store, () => { throw new Error("wall-time exhausted before dispatch"); }, undefined, undefined, () => now++);
  const yielded = await driver.start(request("wall-time", lease("l1", "w1", 10_000), { maxNodes: 1, maxWallTimeMs: 1 }));
  assert.equal(yielded.waits[0].wakeupReason, "wall_time_budget_exhausted");
}

{
  const store = new FakeStore(state("approval", ["approve"]));
  let calls = 0;
  const driver = new NativeRunDriverSpike(store, (_run, _node, context) => ++calls === 1 ? { kind: "waiting", waitpoint: { kind: "approval", waitpointId: "wait-1", runId: "approval", nodeId: "approve", subjectId: "user-1", logicalEffectId: "effect-1", expiresAt: new Date(BASE_TIME + 20_000).toISOString() } } : (assert.equal(context.request.resumeEvent.kind, "approval"), { kind: "completed" }), undefined, undefined, () => BASE_TIME, () => true);
  await driver.start(request("approval", lease("l1", "w1", 10_000)));
  const approvalEvent = { eventId: "ok", waitpointId: "wait-1", workflowRunId: "approval", organizationId: "org-1", nodeId: "approve", runRevision: 1, subjectId: "user-1", kind: "approval", logicalEffectId: "effect-1", issuedAt: new Date(BASE_TIME + 1_000).toISOString(), authenticationEvidenceDigest: digest };
  await assert.rejects(() => driver.resume(request("approval", lease("l1", "w1", 10_000), undefined, { ...approvalEvent, eventId: "bad", waitpointId: "other" })), /resume_event_does_not_match_waitpoint/);
  const resumed = await driver.resume(request("approval", lease("l1", "w1", 10_000), undefined, approvalEvent));
  assert.equal(resumed.status, "succeeded");
}

{
  const store = new FakeStore(state("answer", ["ask"]));
  let calls = 0;
  const driver = new NativeRunDriverSpike(store, () => ++calls === 1
    ? { kind: "waiting", waitpoint: { kind: "answer", waitpointId: "question-1", runId: "answer", nodeId: "ask", subjectId: "user-1" } }
    : { kind: "completed" }, undefined, undefined, () => BASE_TIME, () => true);
  await driver.start(request("answer", lease("l1", "w1", 10_000)));
  const resumed = await driver.resume(request("answer", lease("l1", "w1", 10_000), undefined, { eventId: "answer-1", waitpointId: "question-1", workflowRunId: "answer", organizationId: "org-1", nodeId: "ask", runRevision: 1, subjectId: "user-1", kind: "answer", issuedAt: new Date(BASE_TIME + 1_000).toISOString(), authenticationEvidenceDigest: digest }));
  assert.equal(resumed.status, "succeeded");
}

{
  let now = BASE_TIME;
  const store = new FakeStore(state("lease"));
  let calls = 0;
  const driver = new NativeRunDriverSpike(store, () => { calls += 1; return { kind: "completed" }; }, undefined, undefined, () => now);
  store.acquireLease("lease", lease("old", "w1", 100), now);
  const blocked = await driver.start(request("lease", lease("new", "w2", 1_000)));
  assert.equal(blocked.status, "ready"); assert.equal(calls, 0);
  now = BASE_TIME + 101;
  const takenOver = await driver.start(request("lease", lease("new", "w2", 1_000)));
  assert.equal(takenOver.status, "succeeded"); assert.equal(calls, 1);
}

{
  const store = new FakeStore(state("simultaneous"));
  let calls = 0;
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const driver = new NativeRunDriverSpike(store, async () => { calls += 1; await barrier; return { kind: "completed" }; });
  const first = driver.start(request("simultaneous", lease("first", "w1", 10_000)));
  await Promise.resolve();
  const second = driver.start(request("simultaneous", lease("second", "w2", 10_000)));
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 1, "simultaneous pumps dispatch once");
}

{
  let now = BASE_TIME;
  const store = new FakeStore(state("takeover-during-dispatch", ["commit"]));
  let calls = 0;
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const driver = new NativeRunDriverSpike(store, async () => { calls += 1; await barrier; return { kind: "completed" }; }, undefined, () => "effect-1", () => now);
  const oldPump = driver.start(request("takeover-during-dispatch", lease("old", "w1", 100)));
  await Promise.resolve();
  now = BASE_TIME + 101;
  const takeover = await driver.start(request("takeover-during-dispatch", lease("new", "w2", 1_000)));
  assert.equal(takeover.status, "ready", "takeover blocks on the durable in-flight claim");
  release();
  await assert.rejects(() => oldPump, /run_revision_or_lease_conflict/);
  assert.equal(calls, 1, "lease expiry during dispatch never duplicates the provider effect");
}

{
  let now = BASE_TIME;
  const store = new FakeStore(state("non-effect-takeover", ["read"]));
  let calls = 0;
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const driver = new NativeRunDriverSpike(store, async () => { calls += 1; await barrier; return { kind: "completed" }; }, undefined, undefined, () => now);
  const oldPump = driver.start(request("non-effect-takeover", lease("old", "w1", 100)));
  await Promise.resolve();
  now = BASE_TIME + 101;
  const takeover = await driver.start(request("non-effect-takeover", lease("new", "w2", 1_000)));
  assert.equal(takeover.status, "ready", "takeover blocks on the durable node-attempt claim");
  release();
  await assert.rejects(() => oldPump, /run_revision_or_lease_conflict/);
  const reconciled = await driver.start(request("non-effect-takeover", lease("new", "w2", 1_000)));
  assert.equal(reconciled.status, "succeeded");
  assert.equal(calls, 1, "non-effect takeover never redispatches the node");
  assert.deepEqual(store.nodeHistory.get("non-effect-takeover:read"), ["claimed", "in_flight", "succeeded", "reconciled"]);
}

{
  for (const mutate of [
    (event) => ({ ...event, organizationId: "other" }),
    (event) => ({ ...event, subjectId: "other" }),
    (event) => ({ ...event, nodeId: "other" }),
    (event) => ({ ...event, runRevision: 0 }),
  ]) {
    const store = new FakeStore(state("resume-check", ["ask"]));
    const driver = new NativeRunDriverSpike(store, () => ({ kind: "waiting", waitpoint: { kind: "answer", waitpointId: "wait", runId: "resume-check", nodeId: "ask", subjectId: "user-1", expiresAt: new Date(BASE_TIME + 10_000).toISOString() } }));
    await driver.start(request("resume-check", lease("l1", "w1", 20_000)));
    const event = { eventId: "answer", waitpointId: "wait", workflowRunId: "resume-check", organizationId: "org-1", nodeId: "ask", runRevision: 1, subjectId: "user-1", kind: "answer", issuedAt: new Date(BASE_TIME + 1_000).toISOString(), authenticationEvidenceDigest: digest };
    await assert.rejects(() => driver.resume(request("resume-check", lease("l1", "w1", 20_000), undefined, mutate(event))), /resume_event_does_not_match_waitpoint/);
  }
}

{
  const store = new FakeStore(state("trusted-resume", ["ask"]));
  let calls = 0;
  let trusted = false;
  const driver = new NativeRunDriverSpike(store, () => ++calls === 1
    ? { kind: "waiting", waitpoint: { kind: "answer", waitpointId: "trusted-wait", runId: "trusted-resume", nodeId: "ask", subjectId: "user-1" } }
    : { kind: "completed" }, undefined, undefined, () => BASE_TIME, () => trusted);
  await driver.start(request("trusted-resume", lease("l1", "w1", 10_000)));
  const event = { eventId: "answer", waitpointId: "trusted-wait", workflowRunId: "trusted-resume", organizationId: "org-1", nodeId: "ask", runRevision: 1, subjectId: "user-1", kind: "answer", issuedAt: new Date(BASE_TIME + 1_000).toISOString(), authenticationEvidenceDigest: digest };
  await assert.rejects(() => driver.resume(request("trusted-resume", lease("l1", "w1", 10_000), undefined, event)), /resume_event_not_authorized/);
  assert.equal(store.load("trusted-resume").status, "waiting", "denied resume cannot mutate canonical state");
  assert.equal(calls, 1, "denied resume cannot dispatch");
  trusted = true;
  assert.equal((await driver.resume(request("trusted-resume", lease("l1", "w1", 10_000), undefined, event))).status, "succeeded");
}

{
  const store = new FakeStore(state("expired-wait", ["ask"]));
  const driver = new NativeRunDriverSpike(store, () => ({ kind: "waiting", waitpoint: { kind: "answer", waitpointId: "wait", runId: "expired-wait", nodeId: "ask", subjectId: "user-1", expiresAt: new Date(BASE_TIME - 1).toISOString() } }));
  await driver.start(request("expired-wait", lease("l1", "w1", 20_000)));
  await assert.rejects(() => driver.resume(request("expired-wait", lease("l1", "w1", 20_000), undefined, { eventId: "answer", waitpointId: "wait", workflowRunId: "expired-wait", organizationId: "org-1", nodeId: "ask", runRevision: 1, subjectId: "user-1", kind: "answer", issuedAt: new Date(BASE_TIME).toISOString(), authenticationEvidenceDigest: digest })), /waitpoint_expired/);
}

{
  const store = new FakeStore(state("cancel"));
  let calls = 0;
  const driver = new NativeRunDriverSpike(store, () => { calls += 1; return { kind: "completed" }; });
  driver.cancel("cancel", lease("cancel-lease", "w1", 10_000));
  const cancelled = await driver.resume(request("cancel", lease("cancel-lease", "w1", 10_000)));
  assert.equal(cancelled.status, "cancelled"); assert.equal(calls, 0);
}

{
  const store = new FakeStore(state("unknown", ["commit"]));
  let calls = 0;
  const driver = new NativeRunDriverSpike(store, () => { calls += 1; return { kind: "outcome_unknown" }; }, undefined, () => "effect-1");
  const first = await driver.start(request("unknown", lease("l1", "w1", 10_000)));
  assert.equal(first.compatibilityPhase, "outcome_unknown");
  const stillBlocked = await driver.resume(request("unknown", lease("l1", "w1", 10_000)));
  assert.equal(calls, 1, "outcome-unknown effects are never replayed automatically");
  assert.equal(stillBlocked.compatibilityPhase, "outcome_unknown");
  assert.equal(store.effectKeys.get("unknown:effect-1"), "unknown:effect-1");
}

{
  const store = new FakeStore(state("unknown-cas", ["commit"]));
  let calls = 0;
  const driver = new NativeRunDriverSpike(store, () => { calls += 1; store.failNextCas = true; return { kind: "outcome_unknown" }; }, undefined, () => "effect-1");
  await assert.rejects(() => driver.start(request("unknown-cas", lease("l1", "w1", 10_000))), /run_revision_or_lease_conflict/);
  const reconciled = await driver.start(request("unknown-cas", lease("l1", "w1", 10_000)));
  assert.equal(reconciled.compatibilityPhase, "outcome_unknown");
  assert.equal(store.effects.get("unknown-cas:effect-1"), "reconciled");
  assert.equal(calls, 1, "outcome-unknown reconciliation never replays the provider");
  assert.deepEqual(store.effectHistory.get("unknown-cas:effect-1"), ["claimed", "in_flight", "outcome_unknown", "reconciled"]);
}

{
  const store = new FakeStore(state("succeeded-cas", ["commit"]));
  let calls = 0;
  const driver = new NativeRunDriverSpike(store, () => { calls += 1; store.failNextCas = true; return { kind: "completed" }; }, undefined, () => "effect-1");
  await assert.rejects(() => driver.start(request("succeeded-cas", lease("l1", "w1", 10_000))), /run_revision_or_lease_conflict/);
  const reconciled = await driver.start(request("succeeded-cas", lease("l1", "w1", 10_000)));
  assert.equal(reconciled.status, "succeeded");
  assert.deepEqual(reconciled.selectedPath, ["commit"]);
  assert.equal(store.effects.get("succeeded-cas:effect-1"), "reconciled");
  assert.equal(calls, 1, "succeeded claim reconciliation never replays the provider");
  assert.deepEqual(store.effectHistory.get("succeeded-cas:effect-1"), ["claimed", "in_flight", "succeeded", "reconciled"]);
}

{
  const store = new FakeStore(state("already-succeeded", ["commit"]));
  store.setEffectStatus("already-succeeded", "effect-1", "already-succeeded:effect-1", "succeeded", { kind: "completed" });
  let calls = 0;
  const driver = new NativeRunDriverSpike(store, () => { calls += 1; return { kind: "completed" }; }, undefined, () => "effect-1");
  await driver.start(request("already-succeeded", lease("l1", "w1", 10_000)));
  assert.equal(calls, 0, "succeeded effects are never dispatched again");
}

{
  const store = new FakeStore(state("accepted-cancel", ["commit"]));
  store.setEffectStatus("accepted-cancel", "effect-1", "accepted-cancel:effect-1", "outcome_unknown");
  const driver = new NativeRunDriverSpike(store, () => ({ kind: "completed" }));
  driver.cancel("accepted-cancel", lease("cancel", "w1", 10_000));
  assert.equal(store.effects.get("accepted-cancel:effect-1"), "outcome_unknown", "cancellation never falsely undoes an accepted effect");
}

{
  const store = new FakeStore(state("expired-lease"));
  const driver = new NativeRunDriverSpike(store, () => ({ kind: "completed" }), undefined, undefined, () => BASE_TIME);
  await assert.rejects(() => driver.start(request("expired-lease", lease("old", "w1", -1))), /lease_expired/);
}

{
  const store = new FakeStore(state("cas"));
  store.compareAndSwap = () => false;
  const driver = new NativeRunDriverSpike(store, () => ({ kind: "completed" }));
  await assert.rejects(() => driver.start(request("cas", lease("l1", "w1", 10_000))), /run_revision_or_lease_conflict/);
}

{
  const store = new FakeStore(state("retry"));
  const driver = new NativeRunDriverSpike(store, () => ({ kind: "delayed_retry" }));
  assert.equal(NATIVE_RUN_DRIVER_DELAYED_RETRY_PUBLISHABLE, false);
  await assert.rejects(() => driver.start(request("retry", lease("l1", "w1", 10_000))), /delayed_retry_requires_queue_or_scheduled_wakeup/);
}

console.log("run-driver-conformance.test.mjs passed");

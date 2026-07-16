import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getWorkflowHistory, hasExactWorkflowHistoryIdentifier, WORKFLOW_HISTORY_QUERY_KEYS } from "../../apps/standalone-sveltekit/src/lib/server/workflow-history.ts";

const calls = { workflowGet: 0, workflowList: 0, journal: 0, conversationGet: 0, conversationList: 0, conversationEvents: 0, tools: 0, artifact: 0 };
const workflowRow = {
  organizationId: "org-a", userId: "user-a", hostSessionId: "session-a",
  runId: "workflow-run-a", workflowId: "workflow-a", workflowVersionId: "workflow-a@1",
  definition: {}, input: { secret: "must-not-leak" }, createdAt: "2026-07-15T20:00:00.000Z", updatedAt: "2026-07-15T20:01:00.000Z",
  state: {
    runId: "workflow-run-a", workflowId: "workflow-a", workflowVersionId: "workflow-a@1", artifactId: "artifact-a", phase: "committed", currentNodeId: "commit",
    facadeToolIds: ["booking.create"],
    nodeStates: {
      approval: { nodeId: "approval", type: "approval", status: "approved", effect: "none", required: false },
      commit: { nodeId: "commit", type: "tool_commit", status: "committed", commandId: "booking.create", effect: "write", required: false },
    },
    approvalState: { status: "approved", hostSigned: true, approvedCommandIds: ["booking.create"], approvedInputHashes: {} },
    receipts: [{ nodeId: "commit", commandId: "booking.create", receiptRef: "receipt-a", semanticStatus: "success" }],
  },
};
const conversation = {
  id: "conversation-run-a", session_id: "session-a", user_message_id: "user-message-a", message_id: "assistant-message-a",
  status: "succeeded", resumable: false, error: null, error_code: null, request_id: "request-a", trace_id: "trace-a", traceparent: null,
  context_selection: null, started_at: "2026-07-15T20:00:00.000Z", ended_at: "2026-07-15T20:01:00.000Z", created_at: "2026-07-15T20:00:00.000Z", updated_at: "2026-07-15T20:01:00.000Z",
};
const toolCall = {
  id: "tool-a", session_id: "session-a", message_id: "assistant-message-a", tool_name: "booking.create", source: "orpc", effect: "write", status: "success",
  input: { secret: "must-not-leak" }, output: { private: "must-not-leak" }, error: null, artifact_id: "artifact-a", document_id: null, request_id: "request-a",
  created_at: "2026-07-15T20:00:10.000Z", completed_at: "2026-07-15T20:00:11.000Z",
};
const canonicalEvent = {
  eventId: "workflow-event-a", schemaVersion: "sonik.workflow.event.v1", eventVersion: 1, workflowRunId: "workflow-run-a", sequence: 1, revision: 1,
  actor: { kind: "worker", id: "worker-a" }, subject: { kind: "node", id: "commit" }, causationId: "request-a", attemptId: "workflow-run-a:commit:1", correlationIds: ["conversation-run-a", "request-a", "trace-a", "tool-a", "receipt-a", "workflow-run-a:commit:1"],
  timestamp: "2026-07-15T20:00:11.000Z", eventType: "node_completed",
  payload: { nodeId: "commit", outputRef: { storage: "artifact", artifact: { artifactId: "artifact-a", organizationId: "org-a", contentType: "application/json", byteLength: 10, digest: `sha256:${"a".repeat(64)}`, createdByNodeId: "commit" } } },
};
const waitCanonicalEvent = {
  eventId: "workflow-wait-a", schemaVersion: "sonik.workflow.event.v1", eventVersion: 1, workflowRunId: "workflow-run-a", sequence: 2, revision: 2,
  actor: { kind: "worker", id: "worker-a" }, subject: { kind: "waitpoint", id: "workflow-run-a:approval:2" }, causationId: "request-a", attemptId: "workflow-run-a:approval:2",
  correlationIds: ["conversation-run-a", "request-a", "trace-a", "workflow-run-a:approval:2"], timestamp: "2026-07-15T20:00:12.000Z", eventType: "wait_created",
  payload: { waitpoint: { kind: "approval", waitpointId: "workflow-run-a:approval:2", runId: "workflow-run-a", nodeId: "approval", subjectId: "user-a", logicalEffectId: "effect-a", expiresAt: "2026-07-15T20:15:12.000Z" } },
};

const result = await getWorkflowHistory({
  sessionId: "session-a", conversationRunId: "conversation-run-a", workflowRunId: "workflow-run-a", nodeId: "commit",
  toolCallId: "tool-a", artifactId: "artifact-a", receiptId: "receipt-a", requestId: "request-a", traceId: "trace-a", attemptId: "workflow-run-a:commit:1",
}, {
  owner: { organizationId: "org-a", userId: "user-a" },
  workflowRuns: {
    getRun: async () => (calls.workflowGet++, workflowRow),
    listRuns: async () => (calls.workflowList++, [workflowRow]),
    createRun: async () => { throw new Error("unused"); },
    updateRunState: async () => { throw new Error("unused"); },
  },
  journal: {
    listEvents: async () => (calls.journal++, [canonicalEvent]),
  },
  workspace: {
    getRun: async () => (calls.conversationGet++, conversation),
    listRuns: async () => (calls.conversationList++, [conversation]),
    listRunEvents: async () => (calls.conversationEvents++, [{ id: "conversation-event-a", run_id: conversation.id, session_id: conversation.session_id, seq: 0, kind: "tool_result", event: { secret: "must-not-leak" }, created_at: "2026-07-15T20:00:11.000Z" }]),
    listToolCalls: async () => (calls.tools++, [toolCall]),
    getArtifact: async () => (calls.artifact++, { id: "artifact-a", session_id: "session-a", kind: "json-render", title: "Safe title", content: { secret: "must-not-leak" }, version: 2, created_at: "2026-07-15T20:00:00.000Z", updated_at: "2026-07-15T20:00:11.000Z" }),
  },
});

assert.equal(result.ok, true);
assert.deepEqual(result.history.conversations.map((run) => run.conversationRunId), ["conversation-run-a"]);
assert.deepEqual(result.history.workflows.map((run) => run.workflowRunId), ["workflow-run-a"]);
assert.deepEqual(result.history.nodes.map((node) => node.nodeId), ["commit"]);
assert.deepEqual(result.history.toolCalls.map((call) => call.toolCallId), ["tool-a"]);
assert.deepEqual(result.history.approvals.map((approval) => approval.approvalId), ["approval"]);
assert.deepEqual(result.history.artifacts.map((artifact) => artifact.artifactId), ["artifact-a"]);
assert.deepEqual(result.history.receipts.map((receipt) => receipt.receiptId), ["receipt-a"]);
assert.deepEqual(result.history.events.map((event) => event.eventId), ["conversation-event-a", "workflow-event-a"]);
assert.equal(JSON.stringify(result).includes("must-not-leak"), false, "operator history returns redacted summaries, never authoritative payloads");
assert.deepEqual(calls, { workflowGet: 1, workflowList: 0, journal: 1, conversationGet: 1, conversationList: 0, conversationEvents: 1, tools: 1, artifact: 1 }, "each authoritative store is queried at most once; no per-row/N+1 loads");

const queryValues = {
  sessionId: "session-a",
  conversationRunId: "conversation-run-a",
  workflowRunId: "workflow-run-a",
  nodeId: "commit",
  toolCallId: "tool-a",
  approvalId: "approval",
  artifactId: "artifact-a",
  receiptId: "receipt-a",
  requestId: "request-a",
  traceId: "trace-a",
  attemptId: "workflow-run-a:commit:1",
};
assert.deepEqual(Object.keys(queryValues), [...WORKFLOW_HISTORY_QUERY_KEYS]);

const decoyWorkflow = {
  ...workflowRow,
  hostSessionId: "session-decoy",
  runId: "workflow-run-decoy",
  workflowId: "workflow-decoy",
  workflowVersionId: "workflow-decoy@1",
  input: { secret: "decoy-must-not-leak" },
  state: {
    ...workflowRow.state,
    runId: "workflow-run-decoy",
    workflowId: "workflow-decoy",
    workflowVersionId: "workflow-decoy@1",
    artifactId: "artifact-decoy",
    currentNodeId: "decoy",
    nodeStates: { decoy: { nodeId: "decoy", type: "prompt", status: "completed", effect: "none", required: false } },
    approvalState: { status: "none", hostSigned: false, approvedCommandIds: [], approvedInputHashes: {} },
    receipts: [],
  },
};

const identifierDeps = (identifierCalls, workflowEvents = [canonicalEvent]) => ({
  owner: { organizationId: "org-a", userId: "user-a", hostSessionId: "session-a" },
  workflowRuns: {
    getRun: async (_owner, runId) => (identifierCalls.workflowGet++, runId === workflowRow.runId ? workflowRow : null),
    listRuns: async () => (identifierCalls.workflowList++, [decoyWorkflow, workflowRow]),
    createRun: async () => { throw new Error("unused"); },
    updateRunState: async () => { throw new Error("unused"); },
  },
  journal: { listEvents: async (_owner, runId) => (identifierCalls.journal++, runId === workflowRow.runId ? workflowEvents : []) },
  workspace: {
    getRun: async (runId) => (identifierCalls.conversationGet++, runId === conversation.id ? conversation : null),
    listRuns: async (sessionId) => (identifierCalls.conversationList++, sessionId === conversation.session_id ? [conversation] : []),
    listRunEvents: async (runId) => (identifierCalls.conversationEvents++, runId === conversation.id ? [{ id: "conversation-event-a", run_id: conversation.id, session_id: conversation.session_id, seq: 0, kind: "tool_result", event: { secret: "must-not-leak" }, created_at: "2026-07-15T20:00:11.000Z" }] : []),
    listToolCalls: async (sessionId) => (identifierCalls.tools++, sessionId === toolCall.session_id ? [toolCall] : []),
    getArtifact: async (artifactId) => (identifierCalls.artifact++, artifactId === "artifact-a" ? { id: "artifact-a", session_id: "session-a", kind: "json-render", title: "Safe title", content: { secret: "must-not-leak" }, version: 2, created_at: "2026-07-15T20:00:00.000Z", updated_at: "2026-07-15T20:00:11.000Z" } : null),
  },
});

const rotatedOwner = { organizationId: "org-a", userId: "user-a", hostSessionId: decoyWorkflow.hostSessionId };
const rotatedExactCalls = { workflowGet: 0, workflowList: 0, journal: 0, conversationGet: 0, conversationList: 0, conversationEvents: 0, tools: 0, artifact: 0 };
const rotatedExactDeps = identifierDeps(rotatedExactCalls);
rotatedExactDeps.owner = rotatedOwner;
rotatedExactDeps.workflowRuns.getRun = async (owner, runId) => (
  rotatedExactCalls.workflowGet++,
  owner.organizationId === workflowRow.organizationId && owner.userId === workflowRow.userId && runId === workflowRow.runId ? workflowRow : null
);
const rotatedExact = await getWorkflowHistory({ workflowRunId: workflowRow.runId }, rotatedExactDeps);
assert.deepEqual(rotatedExact.history.workflows.map((run) => run.workflowRunId), [workflowRow.runId], "an exact same-owner workflow lookup survives host-session rotation");
for (const key of ["workflowRunId", "nodeId", "approvalId", "artifactId", "receiptId", "attemptId"]) {
  assert.equal(hasExactWorkflowHistoryIdentifier({ [key]: queryValues[key] }), true, `${key} is an exact workflow-history identifier`);
  const exactResult = await getWorkflowHistory({ [key]: queryValues[key] }, { ...identifierDeps({ workflowGet: 0, workflowList: 0, journal: 0, conversationGet: 0, conversationList: 0, conversationEvents: 0, tools: 0, artifact: 0 }), owner: rotatedOwner });
  assert.deepEqual(exactResult.history.workflows.map((run) => run.workflowRunId), [workflowRow.runId], `${key} survives host-session rotation`);
}
assert.equal(hasExactWorkflowHistoryIdentifier({ conversationRunId: conversation.id }), true, "an exact conversation lookup must not inherit the current host session");

const rotatedConversation = await getWorkflowHistory(
  { conversationRunId: conversation.id },
  { ...identifierDeps({ workflowGet: 0, workflowList: 0, journal: 0, conversationGet: 0, conversationList: 0, conversationEvents: 0, tools: 0, artifact: 0 }), owner: rotatedOwner },
);
assert.deepEqual(rotatedConversation.history.conversations.map((run) => run.conversationRunId), [conversation.id], "an exact same-owner conversation lookup survives host-session rotation");

const mismatchedConversation = await getWorkflowHistory(
  { sessionId: rotatedOwner.hostSessionId, conversationRunId: conversation.id },
  identifierDeps({ workflowGet: 0, workflowList: 0, journal: 0, conversationGet: 0, conversationList: 0, conversationEvents: 0, tools: 0, artifact: 0 }),
);
assert.deepEqual(mismatchedConversation.history.conversations, [], "an explicit mismatched session excludes the exact conversation");
assert.deepEqual(mismatchedConversation.history.toolCalls, [], "an explicit mismatched session excludes conversation tool correlations");
assert.deepEqual(mismatchedConversation.history.events, [], "an explicit mismatched session excludes conversation events");

const matchedConversation = await getWorkflowHistory(
  { sessionId: conversation.session_id, conversationRunId: conversation.id },
  identifierDeps({ workflowGet: 0, workflowList: 0, journal: 0, conversationGet: 0, conversationList: 0, conversationEvents: 0, tools: 0, artifact: 0 }),
);
assert.deepEqual(matchedConversation.history.conversations.map((run) => run.conversationRunId), [conversation.id], "an explicit matching session retains the exact conversation");
assert.deepEqual(matchedConversation.history.toolCalls.map((call) => call.toolCallId), [toolCall.id], "an explicit matching session retains conversation tool correlations");
assert.deepEqual(matchedConversation.history.events.map((event) => event.eventId), ["conversation-event-a", "workflow-event-a"], "an explicit matching session retains correlated events");

for (const owner of [
  { ...rotatedOwner, userId: "user-foreign" },
  { ...rotatedOwner, organizationId: "org-foreign" },
]) {
  const foreignCalls = { workflowGet: 0, workflowList: 0, journal: 0, conversationGet: 0, conversationList: 0, conversationEvents: 0, tools: 0, artifact: 0 };
  const foreignDeps = identifierDeps(foreignCalls);
  foreignDeps.owner = owner;
  foreignDeps.workflowRuns.getRun = rotatedExactDeps.workflowRuns.getRun;
  const foreignExact = await getWorkflowHistory({ workflowRunId: workflowRow.runId }, foreignDeps);
  assert.deepEqual(foreignExact.history.workflows, [], "exact workflow history remains owner-scoped across user and organization boundaries");
}

const currentSessionCalls = { workflowGet: 0, workflowList: 0, journal: 0, conversationGet: 0, conversationList: 0, conversationEvents: 0, tools: 0, artifact: 0 };
const currentSessionDeps = identifierDeps(currentSessionCalls);
currentSessionDeps.owner = rotatedOwner;
const currentSessionHistory = await getWorkflowHistory({ sessionId: rotatedOwner.hostSessionId }, currentSessionDeps);
assert.deepEqual(currentSessionHistory.history.workflows.map((run) => run.workflowRunId), [decoyWorkflow.runId], "session-scoped history still filters workflow rows to the requested current session");

for (const key of WORKFLOW_HISTORY_QUERY_KEYS) {
  const identifierCalls = { workflowGet: 0, workflowList: 0, journal: 0, conversationGet: 0, conversationList: 0, conversationEvents: 0, tools: 0, artifact: 0 };
  const identifierResult = await getWorkflowHistory({ [key]: queryValues[key] }, identifierDeps(identifierCalls));

  assert.equal(identifierResult.ok, true, `${key} query succeeds`);
  assert.deepEqual(identifierResult.history.conversations.map((run) => run.conversationRunId), ["conversation-run-a"], `${key} resolves the correlated conversation`);
  assert.deepEqual(identifierResult.history.workflows.map((run) => run.workflowRunId), ["workflow-run-a"], `${key} never selects the unrelated first workflow session`);
  assert.deepEqual(identifierResult.history.nodes.map((node) => node.nodeId), ["approval", "commit"].filter((nodeId) => !["nodeId", "attemptId"].includes(key) || nodeId === "commit"), `${key} resolves the correlated nodes`);
  assert.deepEqual(identifierResult.history.toolCalls.map((call) => call.toolCallId), ["tool-a"], `${key} resolves the correlated tool call`);
  assert.deepEqual(identifierResult.history.approvals.map((approval) => approval.approvalId), ["approval"], `${key} resolves the correlated approval`);
  assert.deepEqual(identifierResult.history.artifacts.map((artifactEntry) => artifactEntry.artifactId), ["artifact-a"], `${key} resolves the correlated artifact`);
  assert.deepEqual(identifierResult.history.receipts.map((receipt) => receipt.receiptId), ["receipt-a"], `${key} resolves the correlated receipt`);
  assert.deepEqual(identifierResult.history.events.map((event) => event.eventId), ["conversation-event-a", "workflow-event-a"], `${key} resolves the same causal event path`);
  assert.equal(identifierResult.history.events.find((event) => event.eventId === "workflow-event-a")?.attemptId, "workflow-run-a:commit:1", `${key} projects the canonical node attempt`);
  assert.equal(JSON.stringify(identifierResult).includes("must-not-leak"), false, `${key} projection remains redacted`);
  assert.equal(Object.values(identifierCalls).every((count) => count <= 1), true, `${key} performs at most one call per authoritative store`);
}

const missingAttemptCalls = { workflowGet: 0, workflowList: 0, journal: 0, conversationGet: 0, conversationList: 0, conversationEvents: 0, tools: 0, artifact: 0 };
const missingAttempt = await getWorkflowHistory({ attemptId: "workflow-run-a:commit:999" }, identifierDeps(missingAttemptCalls));
assert.deepEqual(missingAttempt.history.workflows, [], "a canonical-looking but nonexistent attempt does not match the run prefix");
assert.deepEqual(missingAttempt.history.events, [], "a nonexistent attempt has no causal path");
assert.equal(Object.values(missingAttemptCalls).every((count) => count <= 1), true, "exact attempt rejection preserves one read per authoritative store");

const waitAttemptCalls = { workflowGet: 0, workflowList: 0, journal: 0, conversationGet: 0, conversationList: 0, conversationEvents: 0, tools: 0, artifact: 0 };
const waitAttempt = await getWorkflowHistory({ attemptId: "workflow-run-a:approval:2" }, identifierDeps(waitAttemptCalls, [canonicalEvent, waitCanonicalEvent]));
assert.deepEqual(waitAttempt.history.nodes.map((node) => node.nodeId), ["approval"], "a wait attempt projects its owning node rather than its waitpoint subject");
assert.deepEqual(waitAttempt.history.events.find((event) => event.eventId === "workflow-wait-a"), {
  source: "workflow", eventId: "workflow-wait-a", workflowRunId: "workflow-run-a", type: "wait_created", sequence: 2,
  nodeId: "approval", approvalId: "workflow-run-a:approval:2", artifactId: null, attemptId: "workflow-run-a:approval:2",
  correlationIds: ["conversation-run-a", "request-a", "trace-a", "workflow-run-a:approval:2"], timestamp: "2026-07-15T20:00:12.000Z",
});
assert.equal(Object.values(waitAttemptCalls).every((count) => count <= 1), true, "wait attempt correlation preserves one read per authoritative store");

for (const [operation, query] of [
  ["getArtifact", { artifactId: "artifact-a" }],
  ["listToolCalls", { sessionId: "session-a" }],
  ["listRunEvents", { conversationRunId: "conversation-run-a" }],
]) {
  const rejectingDeps = identifierDeps({ workflowGet: 0, workflowList: 0, journal: 0, conversationGet: 0, conversationList: 0, conversationEvents: 0, tools: 0, artifact: 0 });
  rejectingDeps.workspace[operation] = async () => { throw new Error(`db_unavailable:${operation}`); };
  await assert.rejects(
    () => getWorkflowHistory(query, rejectingDeps),
    new RegExp(`db_unavailable:${operation}`),
    `${operation} failures must propagate instead of returning successful incomplete history`,
  );
}

const route = await readFile(new URL("../../apps/standalone-sveltekit/src/routes/api/workflow-history/+server.ts", import.meta.url), "utf8");
assert.match(route, /createAgentHostSessionEnvelope\(event\)/);
assert.match(route, /status: 401/);
assert.match(route, /WORKFLOW_HISTORY_QUERY_KEYS/);
assert.match(route, /!query\.sessionId && hostSession\.sessionId && !hasExactWorkflowHistoryIdentifier\(query\)/, "the route only defaults the current host session for non-exact browsing");

console.log("workflow-history.test.mjs passed");

import type {
  AsyncWorkspacePersistenceAdapter,
  WorkspaceArtifactRecord,
  WorkspaceRunEventRecord,
  WorkspaceRunRecord,
  WorkspaceToolCallRecord,
} from "@sonik-agent-ui/workspace-session";
import { isWorkflowNodeAttemptId, type CanonicalWorkflowEvent } from "@sonik-agent-ui/tool-contracts/workflow-vnext";
import type { AsyncWorkflowRunStore, WorkflowRunJournalStore, WorkflowRunOwner, WorkflowRunRow } from "./workflow-run-store.ts";

export const WORKFLOW_HISTORY_QUERY_KEYS = [
  "sessionId", "conversationRunId", "workflowRunId", "nodeId", "toolCallId", "approvalId", "artifactId", "receiptId", "requestId", "traceId", "attemptId",
] as const;
export type WorkflowHistoryQuery = Partial<Record<(typeof WORKFLOW_HISTORY_QUERY_KEYS)[number], string>>;

export interface WorkflowHistoryDeps {
  owner: WorkflowRunOwner;
  workflowRuns: AsyncWorkflowRunStore;
  journal: WorkflowRunJournalStore;
  workspace: Pick<AsyncWorkspacePersistenceAdapter, "getRun" | "listRuns" | "listRunEvents" | "listToolCalls" | "getArtifact">;
}

export async function getWorkflowHistory(queryInput: WorkflowHistoryQuery, deps: WorkflowHistoryDeps) {
  const query = normalizeQuery(queryInput);
  if (!Object.keys(query).length) return { ok: false as const, reason: "history_identifier_required" };

  const [workflowCandidates, exactConversation, artifact] = await Promise.all([
    query.workflowRunId
      ? deps.workflowRuns.getRun(deps.owner, query.workflowRunId).then((row) => row ? [row] : [])
      : deps.workflowRuns.listRuns(deps.owner),
    query.conversationRunId ? deps.workspace.getRun(query.conversationRunId) : Promise.resolve(null),
    query.artifactId ? failSoft(() => deps.workspace.getArtifact(query.artifactId!), null) : Promise.resolve(null),
  ]);
  const workflowMatches = workflowCandidates.filter((row) => matchesWorkflow(row, query));
  const sessionId = query.sessionId
    ?? exactConversation?.session_id
    ?? deps.owner.hostSessionId
    ?? artifact?.session_id
    ?? workflowMatches.find((row) => row.hostSessionId)?.hostSessionId
    ?? undefined;
  const workflowRows = workflowMatches.filter((row) => !sessionId || row.hostSessionId === sessionId);
  const correlatedWorkflowId = workflowRows.length === 1 ? workflowRows[0]?.runId : undefined;

  const [conversationCandidates, workflowEvents, toolCalls] = await Promise.all([
    exactConversation ? Promise.resolve([exactConversation]) : sessionId ? deps.workspace.listRuns(sessionId) : Promise.resolve([]),
    correlatedWorkflowId ? deps.journal.listEvents(deps.owner, correlatedWorkflowId) : Promise.resolve([]),
    sessionId ? failSoft(() => deps.workspace.listToolCalls(sessionId), []) : Promise.resolve([]),
  ]);
  const hasExactAttempt = !query.attemptId || workflowEvents.some((event) => event.attemptId === query.attemptId);
  const causalWorkflowRows = hasExactAttempt ? workflowRows : [];
  const causalWorkflowEvents = hasExactAttempt ? workflowEvents : [];
  const correlationIds = new Set(causalWorkflowEvents.flatMap((event) => event.correlationIds));
  const conversations = hasExactAttempt ? conversationCandidates.filter((run) => matchesConversation(run, query, correlationIds)) : [];
  const conversationRequestIds = new Set(conversations.flatMap((run) => run.request_id ? [run.request_id] : []));
  const filteredToolCalls = hasExactAttempt ? toolCalls.filter((call) => matchesToolCall(call, query, correlationIds, conversationRequestIds)) : [];
  const correlatedConversationId = conversations.length === 1 ? conversations[0]?.id : undefined;
  const conversationEvents = correlatedConversationId
    ? await failSoft(() => deps.workspace.listRunEvents(correlatedConversationId), [])
    : [];
  const attemptNodeIds = new Set(causalWorkflowEvents.flatMap((event) => {
    if (event.attemptId !== query.attemptId) return [];
    if (event.eventType === "node_completed") return [event.payload.nodeId];
    if (event.eventType === "wait_created") return [event.payload.waitpoint.nodeId];
    return [];
  }));

  return {
    ok: true as const,
    history: {
      query,
      conversations: conversations.map(projectConversation),
      workflows: causalWorkflowRows.map(projectWorkflow),
      nodes: causalWorkflowRows.flatMap(projectNodes).filter((node) => (!query.nodeId || node.nodeId === query.nodeId) && (!query.attemptId || attemptNodeIds.has(node.nodeId))),
      toolCalls: filteredToolCalls.map(projectToolCall),
      approvals: dedupeById([...causalWorkflowRows.flatMap(projectApprovals), ...causalWorkflowEvents.flatMap(projectEventApproval)], "approvalId")
        .filter((approval) => !query.approvalId || approval.approvalId === query.approvalId),
      artifacts: projectArtifacts(causalWorkflowRows, causalWorkflowEvents, hasExactAttempt ? artifact : null).filter((entry) => !query.artifactId || entry.artifactId === query.artifactId),
      receipts: causalWorkflowRows.flatMap(projectReceipts).filter((receipt) => !query.receiptId || receipt.receiptId === query.receiptId),
      events: [
        ...conversationEvents.map(projectConversationEvent),
        ...causalWorkflowEvents.map(projectWorkflowEvent),
      ],
    },
  };
}

function normalizeQuery(input: WorkflowHistoryQuery): WorkflowHistoryQuery {
  return Object.fromEntries(WORKFLOW_HISTORY_QUERY_KEYS.flatMap((key) => {
    const value = input[key]?.trim();
    return value ? [[key, value]] : [];
  }));
}

function matchesWorkflow(row: WorkflowRunRow, query: WorkflowHistoryQuery): boolean {
  if (query.workflowRunId) return row.runId === query.workflowRunId;
  if (query.nodeId && !row.state.nodeStates[query.nodeId]) return false;
  if (query.attemptId && !Object.keys(row.state.nodeStates).some((nodeId) => isWorkflowNodeAttemptId(query.attemptId!, row.runId, nodeId))) return false;
  if (query.approvalId && !projectApprovals(row).some((approval) => approval.approvalId === query.approvalId)) return false;
  if (query.artifactId && row.state.artifactId !== query.artifactId) return false;
  if (query.receiptId && !row.state.receipts.some((receipt) => receipt.receiptRef === query.receiptId)) return false;
  return true;
}

function projectEventApproval(event: CanonicalWorkflowEvent) {
  if (event.eventType !== "wait_created" || event.payload.waitpoint.kind !== "approval") return [];
  return [{
    approvalId: event.payload.waitpoint.waitpointId, workflowRunId: event.workflowRunId,
    nodeId: event.payload.waitpoint.nodeId, commandId: null, status: "requested", hostSigned: false,
  }];
}

function dedupeById<T extends Record<K, string>, K extends keyof T>(entries: T[], key: K): T[] {
  return [...new Map(entries.map((entry) => [entry[key], entry])).values()];
}

function matchesConversation(run: WorkspaceRunRecord, query: WorkflowHistoryQuery, correlationIds: Set<string>): boolean {
  const explicitlyMatched = (!query.conversationRunId || run.id === query.conversationRunId)
    && (!query.requestId || run.request_id === query.requestId)
    && (!query.traceId || run.trace_id === query.traceId);
  if (!explicitlyMatched) return false;
  if (!correlationIds.size) return true;
  return correlationIds.has(run.id) || Boolean(run.request_id && correlationIds.has(run.request_id)) || Boolean(run.trace_id && correlationIds.has(run.trace_id));
}

function matchesToolCall(call: WorkspaceToolCallRecord, query: WorkflowHistoryQuery, correlationIds: Set<string>, conversationRequestIds: Set<string>): boolean {
  const explicitlyMatched = (!query.toolCallId || call.id === query.toolCallId)
    && (!query.requestId || call.request_id === query.requestId)
    && (!query.artifactId || call.artifact_id === query.artifactId);
  if (!explicitlyMatched) return false;
  if (correlationIds.size) return correlationIds.has(call.id) || Boolean(call.request_id && correlationIds.has(call.request_id));
  if (query.traceId || query.conversationRunId) return Boolean(call.request_id && conversationRequestIds.has(call.request_id));
  return true;
}

function projectConversation(run: WorkspaceRunRecord) {
  return {
    conversationRunId: run.id, sessionId: run.session_id, messageId: run.message_id,
    requestId: run.request_id, traceId: run.trace_id, status: run.status,
    startedAt: run.started_at, endedAt: run.ended_at,
  };
}

function projectWorkflow(row: WorkflowRunRow) {
  return {
    workflowRunId: row.runId, workflowId: row.workflowId, workflowVersionId: row.workflowVersionId,
    sessionId: row.hostSessionId, status: row.state.phase, currentNodeId: row.state.currentNodeId,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function projectNodes(row: WorkflowRunRow) {
  return Object.values(row.state.nodeStates).map((node) => ({
    workflowRunId: row.runId, nodeId: node.nodeId, nodeType: node.type, status: node.status,
    commandId: node.commandId ?? null, errorCode: node.error?.code ?? null,
  }));
}

function projectToolCall(call: WorkspaceToolCallRecord) {
  return {
    toolCallId: call.id, sessionId: call.session_id, messageId: call.message_id, requestId: call.request_id,
    toolName: call.tool_name, source: call.source, effect: call.effect, status: call.status,
    artifactId: call.artifact_id, createdAt: call.created_at, completedAt: call.completed_at,
  };
}

function projectApprovals(row: WorkflowRunRow) {
  const nodes = Object.values(row.state.nodeStates).filter((node) => node.type === "approval");
  if (!nodes.length && row.state.approvalState.status === "none") return [];
  return (nodes.length ? nodes : [{ nodeId: `${row.runId}:approval`, commandId: undefined }]).map((node) => ({
    approvalId: node.nodeId, workflowRunId: row.runId, nodeId: node.nodeId,
    commandId: node.commandId ?? null, status: row.state.approvalState.status,
    hostSigned: row.state.approvalState.hostSigned,
  }));
}

function projectReceipts(row: WorkflowRunRow) {
  return row.state.receipts.flatMap((receipt) => receipt.receiptRef ? [{
    receiptId: receipt.receiptRef, workflowRunId: row.runId, nodeId: receipt.nodeId,
    commandId: receipt.commandId ?? null, semanticStatus: receipt.semanticStatus,
  }] : []);
}

function projectArtifacts(rows: WorkflowRunRow[], events: CanonicalWorkflowEvent[], exact: WorkspaceArtifactRecord | null) {
  const entries = new Map<string, { artifactId: string; workflowRunId: string | null; nodeId: string | null; kind: string | null; title: string | null; version: number | null }>();
  for (const row of rows) if (row.state.artifactId) entries.set(row.state.artifactId, { artifactId: row.state.artifactId, workflowRunId: row.runId, nodeId: null, kind: null, title: null, version: null });
  for (const event of events) if (event.eventType === "node_completed" && event.payload.outputRef.storage === "artifact") {
    const ref = event.payload.outputRef.artifact;
    entries.set(ref.artifactId, { artifactId: ref.artifactId, workflowRunId: event.workflowRunId, nodeId: ref.createdByNodeId, kind: ref.contentType, title: null, version: null });
  }
  if (exact) entries.set(exact.id, { artifactId: exact.id, workflowRunId: entries.get(exact.id)?.workflowRunId ?? null, nodeId: entries.get(exact.id)?.nodeId ?? null, kind: exact.kind, title: exact.title, version: exact.version });
  return [...entries.values()];
}

function projectConversationEvent(record: WorkspaceRunEventRecord) {
  return { source: "conversation" as const, eventId: record.id, conversationRunId: record.run_id, type: record.kind, sequence: record.seq, timestamp: record.created_at };
}

function projectWorkflowEvent(event: CanonicalWorkflowEvent) {
  return {
    source: "workflow" as const, eventId: event.eventId, workflowRunId: event.workflowRunId,
    type: event.eventType, sequence: event.sequence, nodeId: event.subject.kind === "node" ? event.subject.id : null,
    approvalId: event.eventType === "wait_created" && event.payload.waitpoint.kind === "approval" ? event.payload.waitpoint.waitpointId : null,
    artifactId: event.eventType === "node_completed" && event.payload.outputRef.storage === "artifact" ? event.payload.outputRef.artifact.artifactId : null,
    attemptId: event.attemptId ?? null, correlationIds: event.correlationIds, timestamp: event.timestamp,
  };
}

async function failSoft<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
  try { return await operation(); } catch { return fallback; }
}

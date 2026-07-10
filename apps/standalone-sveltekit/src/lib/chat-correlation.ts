import {
  sanitizeDeploymentSnapshot,
  sanitizeTurnCorrelationSnapshot,
  type AgentUiDeploymentSnapshot,
  type AgentUiTurnCorrelationSnapshot,
} from "@sonik-agent-ui/agent-observability";

export const SUPPORT_CORRELATION_RECORD_LIMIT = 50;

export interface AgentUiTurnCorrelationInput {
  sessionId?: unknown;
  messageId?: unknown;
  requestId?: unknown;
  traceId?: unknown;
  traceparent?: unknown;
  agentUiRunId?: unknown;
  status?: unknown;
  capturedAt?: unknown;
  deployment?: unknown;
}


export interface TurnCorrelationHeaderSource {
  get(name: string): string | null;
}

export interface CreateTurnCorrelationFromResponseInput {
  sessionId?: unknown;
  messageId?: unknown;
  prepared?: AgentUiTurnCorrelationInput | null;
  headers?: TurnCorrelationHeaderSource | null;
  status?: unknown;
  capturedAt?: unknown;
  deployment?: unknown;
}

export interface SelectTurnCorrelationInput {
  sessionId?: unknown;
  messageId?: unknown;
}

export function createTurnCorrelationSnapshot(input: AgentUiTurnCorrelationInput, now: () => Date | string = () => new Date()): AgentUiTurnCorrelationSnapshot | null {
  const current = now();
  const snapshot = sanitizeTurnCorrelationSnapshot({
    ...input,
    status: input.status === "error" ? "error" : "success",
    capturedAt: typeof input.capturedAt === "string" && input.capturedAt.trim()
      ? input.capturedAt
      : typeof current === "string"
        ? current
        : current.toISOString(),
    deployment: sanitizeDeploymentSnapshot(input.deployment) satisfies AgentUiDeploymentSnapshot | undefined,
  });
  return snapshot ?? null;
}

export function createTurnCorrelationRecord(input: AgentUiTurnCorrelationInput, now: () => Date | string = () => new Date()): AgentUiTurnCorrelationSnapshot {
  const snapshot = createTurnCorrelationSnapshot(input, now);
  if (!snapshot) throw new Error("Invalid turn correlation input");
  return snapshot;
}


export function createTurnCorrelationRecordFromResponse(
  input: CreateTurnCorrelationFromResponseInput,
  now: () => Date | string = () => new Date(),
): AgentUiTurnCorrelationSnapshot {
  const headers = input.headers;
  const traceparent = headerValue(headers, "traceparent") ?? input.prepared?.traceparent;
  const deployment = sanitizeDeploymentSnapshot(input.deployment) ?? sanitizeDeploymentSnapshot({
    id: headerValue(headers, "x-sonik-agent-ui-deployment-id"),
    tag: headerValue(headers, "x-sonik-agent-ui-deployment-tag"),
    timestamp: headerValue(headers, "x-sonik-agent-ui-deployment-timestamp"),
  }) ?? sanitizeDeploymentSnapshot(input.prepared?.deployment);
  return createTurnCorrelationRecord({
    sessionId: input.sessionId ?? input.prepared?.sessionId,
    messageId: input.messageId ?? input.prepared?.messageId,
    requestId: headerValue(headers, "x-sonik-request-id") ?? input.prepared?.requestId,
    traceId: headerValue(headers, "x-sonik-trace-id") ?? input.prepared?.traceId,
    traceparent,
    agentUiRunId: headerValue(headers, "x-sonik-agent-ui-run-id") ?? input.prepared?.agentUiRunId,
    status: input.status === "error" ? "error" : "success",
    capturedAt: input.capturedAt,
    deployment,
  }, now);
}

export function deploymentSnapshotFromHeaders(headers: TurnCorrelationHeaderSource | null | undefined): AgentUiDeploymentSnapshot | undefined {
  return sanitizeDeploymentSnapshot({
    id: headerValue(headers, "x-sonik-agent-ui-deployment-id"),
    tag: headerValue(headers, "x-sonik-agent-ui-deployment-tag"),
    timestamp: headerValue(headers, "x-sonik-agent-ui-deployment-timestamp"),
  });
}

export function upsertTurnCorrelationRecord(
  records: readonly AgentUiTurnCorrelationSnapshot[],
  input: AgentUiTurnCorrelationSnapshot | AgentUiTurnCorrelationInput,
  options: { limit?: number; now?: () => Date } = {},
): AgentUiTurnCorrelationSnapshot[] {
  const snapshot = isCorrelationSnapshot(input) ? sanitizeTurnCorrelationSnapshot(input) : createTurnCorrelationSnapshot(input, options.now);
  if (!snapshot) return boundCorrelationRecords(records, options.limit);
  const next = records.filter((record) => !sameCorrelationTurn(record, snapshot));
  next.push(snapshot);
  return boundCorrelationRecords(next, options.limit);
}

export function selectTurnCorrelationRecord(
  records: readonly AgentUiTurnCorrelationSnapshot[],
  input: SelectTurnCorrelationInput,
): AgentUiTurnCorrelationSnapshot | undefined {
  const sessionId = normalizeScalar(input.sessionId);
  if (!sessionId) return undefined;
  const messageId = normalizeScalar(input.messageId);
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (record.sessionId !== sessionId) continue;
    if (messageId && record.messageId !== messageId) continue;
    return record;
  }
  return undefined;
}

function boundCorrelationRecords(records: readonly AgentUiTurnCorrelationSnapshot[], limit = SUPPORT_CORRELATION_RECORD_LIMIT): AgentUiTurnCorrelationSnapshot[] {
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit), SUPPORT_CORRELATION_RECORD_LIMIT));
  return records.slice(-boundedLimit).map((record) => ({ ...record, deployment: record.deployment ? { ...record.deployment } : undefined }));
}

function sameCorrelationTurn(left: AgentUiTurnCorrelationSnapshot, right: AgentUiTurnCorrelationSnapshot): boolean {
  return left.sessionId === right.sessionId && (left.messageId ?? null) === (right.messageId ?? null);
}

function isCorrelationSnapshot(input: AgentUiTurnCorrelationSnapshot | AgentUiTurnCorrelationInput): input is AgentUiTurnCorrelationSnapshot {
  return typeof input.sessionId === "string" && typeof input.requestId === "string" && (input.status === "success" || input.status === "error") && typeof input.capturedAt === "string";
}

function normalizeScalar(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function headerValue(headers: TurnCorrelationHeaderSource | null | undefined, name: string): string | undefined {
  const value = headers?.get(name);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

import {
  sanitizeDeploymentSnapshot,
  sanitizeTelemetryValue,
  sanitizeTurnCorrelationSnapshot,
  type AgentTelemetrySource,
  type AgentUiDeploymentSnapshot,
  type AgentUiTurnCorrelationSnapshot,
} from "@sonik-agent-ui/agent-observability";

export const SUPPORT_DIAGNOSTICS_SCHEMA_VERSION = "sonik.agent_ui.support_diagnostics.v1";
export const SUPPORT_TRANSCRIPT_SCHEMA_VERSION = "sonik.agent_ui.support_transcript.v1";
export const SUPPORT_EXPORT_LIMIT = 25;

export interface SupportTranscriptMessageLike {
  role?: unknown;
  parts?: unknown;
}

export interface AgentUiRunSummarySnapshot {
  id?: string;
  sessionId?: string;
  messageId?: string;
  requestId?: string;
  traceId?: string;
  traceparent?: string;
  agentUiRunId?: string;
  status?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  errorCode?: string;
}

export interface AgentUiTelemetrySummarySnapshot {
  event?: string;
  source?: AgentTelemetrySource | string;
  phase?: string;
  sessionId?: string;
  messageId?: string;
  requestId?: string;
  traceId?: string;
  traceparent?: string;
  runId?: string;
  at?: string;
  durationMs?: number;
  ok?: boolean;
  errorPresent?: boolean;
}

export interface AgentUiSupportDiagnosticsExport {
  schemaVersion: typeof SUPPORT_DIAGNOSTICS_SCHEMA_VERSION;
  generatedAt: string;
  sessionId: string;
  collectionStatus: "complete" | "partial";
  correlationRecords: AgentUiTurnCorrelationSnapshot[];
  deployment?: AgentUiDeploymentSnapshot;
  runSummaries: AgentUiRunSummarySnapshot[];
  telemetrySummaries: AgentUiTelemetrySummarySnapshot[];
}

export function exportTranscriptMarkdown(messages: readonly SupportTranscriptMessageLike[]): string {
  const sections = messages.flatMap((message) => {
    const role = visibleRole(message.role);
    const text = visibleTextParts(message.parts).join("").trim();
    if (!role || !text) return [];
    return [`## ${role}\n\n${text}`];
  });
  return sections.length > 0 ? `${sections.join("\n\n")}\n` : "";
}

export function createSupportDiagnosticsExport(input: {
  sessionId?: unknown;
  generatedAt?: unknown;
  correlationRecords?: unknown;
  deployment?: unknown;
  runSummaries?: unknown;
  telemetrySummaries?: unknown;
  collectionStatus?: unknown;
  limit?: number;
  now?: () => Date;
}): AgentUiSupportDiagnosticsExport | null {
  const sessionId = scalar(input.sessionId);
  if (!sessionId) return null;
  const limit = boundedLimit(input.limit);
  return {
    schemaVersion: SUPPORT_DIAGNOSTICS_SCHEMA_VERSION,
    generatedAt: scalar(input.generatedAt) ?? input.now?.().toISOString() ?? new Date().toISOString(),
    sessionId,
    collectionStatus: input.collectionStatus === "partial" ? "partial" : "complete",
    correlationRecords: sanitizeCorrelationRecords(input.correlationRecords, sessionId, limit),
    deployment: sanitizeDeploymentSnapshot(input.deployment),
    runSummaries: sanitizeRunSummaries(input.runSummaries, sessionId, limit),
    telemetrySummaries: sanitizeTelemetrySummaries(input.telemetrySummaries, sessionId, limit),
  };
}

function visibleTextParts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    if (record.type !== "text" || typeof record.text !== "string") return [];
    return [record.text];
  });
}

function visibleRole(value: unknown): string | undefined {
  if (value === "user" || value === "assistant") return value;
  return undefined;
}

function sanitizeCorrelationRecords(value: unknown, sessionId: string, limit: number): AgentUiTurnCorrelationSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((entry) => {
      const snapshot = sanitizeTurnCorrelationSnapshot(entry);
      return snapshot && snapshot.sessionId === sessionId ? [snapshot] : [];
    })
    .slice(-limit);
}

function sanitizeRunSummaries(value: unknown, sessionId: string, limit: number): AgentUiRunSummarySnapshot[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      const record = entry as Record<string, unknown>;
      const entrySessionId = scalar(record.sessionId ?? record.session_id);
      if (entrySessionId && entrySessionId !== sessionId) return [];
      return [{
        id: scalar(record.id),
        sessionId: entrySessionId ?? sessionId,
        messageId: scalar(record.messageId ?? record.message_id),
        requestId: scalar(record.requestId ?? record.request_id),
        traceId: scalar(record.traceId ?? record.trace_id),
        traceparent: scalar(record.traceparent),
        agentUiRunId: scalar(record.agentUiRunId ?? record.agent_ui_run_id),
        status: scalar(record.status),
        startedAt: scalar(record.startedAt ?? record.started_at),
        endedAt: scalar(record.endedAt ?? record.ended_at),
        durationMs: finiteNumber(record.durationMs ?? record.duration_ms),
        errorCode: scalar(record.errorCode ?? record.error_code),
      }];
    })
    .map(dropEmpty)
    .slice(-limit);
}

function sanitizeTelemetrySummaries(value: unknown, sessionId: string, limit: number): AgentUiTelemetrySummarySnapshot[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      const record = entry as Record<string, unknown>;
      const entrySessionId = scalar(record.sessionId ?? record.session_id);
      if (entrySessionId && entrySessionId !== sessionId) return [];
      return [{
        event: scalar(record.event),
        source: scalar(record.source),
        phase: scalar(record.phase),
        sessionId: entrySessionId ?? sessionId,
        messageId: scalar(record.messageId ?? record.message_id),
        requestId: scalar(record.requestId ?? record.request_id),
        traceId: scalar(record.traceId ?? record.trace_id),
        traceparent: scalar(record.traceparent),
        runId: scalar(record.runId ?? record.run_id),
        at: scalar(record.at),
        durationMs: finiteNumber(record.durationMs ?? record.duration_ms),
        ok: typeof record.ok === "boolean" ? record.ok : undefined,
        errorPresent: record.error !== undefined || record.errorCode !== undefined || record.error_code !== undefined || record.errorPresent === true,
      }];
    })
    .map(dropEmpty)
    .slice(-limit);
}

function boundedLimit(value: unknown): number {
  return Math.max(1, Math.min(typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : SUPPORT_EXPORT_LIMIT, SUPPORT_EXPORT_LIMIT));
}

function scalar(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return undefined;
  const sanitized = sanitizeTelemetryValue(value);
  return typeof sanitized === "string" || typeof sanitized === "number" || typeof sanitized === "boolean" ? String(sanitized).trim() || undefined : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function dropEmpty<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined && value !== "")) as T;
}

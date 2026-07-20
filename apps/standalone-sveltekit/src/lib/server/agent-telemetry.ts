import { existsSync } from "node:fs";
import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import {
  createTelemetryEvent,
  sanitizeTelemetryEvent,
  type AgentTelemetryEvent,
  type AgentTelemetrySource,
} from "@sonik-agent-ui/agent-observability";
import { activeWorkflowRunId } from "@sonik-agent-ui/tool-contracts/workflow-controller";
import type { AsyncWorkspacePersistenceAdapter } from "@sonik-agent-ui/workspace-session";
import { recordWorkspaceTelemetryEvent } from "./workspace-store.ts";
import { readJsonBodyWithSizeCap } from "./request-abuse-guard.ts";
import { sanitizeFailureRecord } from "./run-error-safety.ts";

export type { AgentTelemetryEvent, AgentTelemetrySource } from "@sonik-agent-ui/agent-observability";

export const MAX_TELEMETRY_REQUEST_BYTES = 64 * 1024;
export const MAX_TELEMETRY_BATCH_EVENTS = 32;
export const MAX_TELEMETRY_EVENT_NAME_CHARS = 128;
export const MAX_TELEMETRY_EVENT_BYTES = 16 * 1024;

export type TelemetryBatchResult =
  | { ok: true; events: AgentTelemetryEvent[] }
  | { ok: false; status: number; error: string };

export async function readTelemetryBatch(request: Request): Promise<TelemetryBatchResult> {
  const parsed = await readJsonBodyWithSizeCap(request, MAX_TELEMETRY_REQUEST_BYTES);
  if (!parsed.ok) return parsed;
  const body = parsed.body && typeof parsed.body === "object" && !Array.isArray(parsed.body) ? parsed.body as Record<string, unknown> : null;
  const values = Array.isArray(body?.events) ? body.events : body?.event ? [body.event] : [];
  if (values.length > MAX_TELEMETRY_BATCH_EVENTS) return { ok: false, status: 413, error: "too_many_events" };
  const events: AgentTelemetryEvent[] = [];
  for (const value of values) {
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_TELEMETRY_EVENT_BYTES) return { ok: false, status: 413, error: "telemetry_event_too_large" };
    const event = coerceTelemetryEvent(value);
    if (!event) return { ok: false, status: 400, error: "invalid_telemetry_event" };
    events.push(event);
  }
  return { ok: true, events };
}

/**
 * Synchronous, fail-safe telemetry boundary for runtimes that cannot await the
 * JSONL/workspace mirrors (for example the AI SDK OpenTelemetry bridge). The
 * worker-log marker receives the same sanitized envelope as writeAgentTelemetry.
 */
export function emitAgentTelemetrySync(event: AgentTelemetryEvent): AgentTelemetryEvent {
  const payload = sanitizeAgentTelemetry({ workflowRunId: activeWorkflowRunId(), ...event });
  emitTelemetryToWorkerLogs(payload);
  return payload;
}

export async function writeAgentTelemetry(event: AgentTelemetryEvent, persistence?: AsyncWorkspacePersistenceAdapter | null): Promise<void> {
  // AC-13 join-key: stamp the active workflow-controller run's runId as workflowRunId, unless the
  // caller already set one explicitly. A no-op outside any controller-driven run (activeWorkflowRunId
  // is undefined there), so every call site that predates this is unchanged.
  const payload = emitAgentTelemetrySync(event);
  const logPath = resolveTelemetryLogPath();
  await appendTelemetryJsonl(logPath, payload);
  const record = {
      session_id: payload.sessionId ?? null,
      request_id: payload.requestId ?? null,
      source: payload.source,
      event: payload.event,
      payload,
      ok: payload.ok ?? null,
      error: payload.error ?? null,
    };
  try {
    if (persistence) await persistence.recordTelemetryEvent(record);
    else recordWorkspaceTelemetryEvent(record);
  } catch {
    // Intentional fail-safe: process/Worker logs remain non-blocking evidence when durable persistence is unavailable.
  }
}

function coerceTelemetryEvent(value: unknown): AgentTelemetryEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const event = typeof record.event === "string" ? record.event.trim() : "";
  if (!event || event.length > MAX_TELEMETRY_EVENT_NAME_CHARS || !/^[a-zA-Z0-9._:-]+$/.test(event)) return null;
  const source = record.source === `ody${"sseus"}-host` ? "workspace-host" : record.source;
  if (source !== "client" && source !== "workspace-host") return null;
  return sanitizeAgentTelemetry({ ...record, source, event } as AgentTelemetryEvent);
}

function emitTelemetryToWorkerLogs(payload: AgentTelemetryEvent): void {
  try {
    console.info(
      "sonik_agent_ui_telemetry",
      JSON.stringify({
        schemaVersion: "agent-ui-telemetry.v1",
        emittedAt: new Date().toISOString(),
        payload,
      }),
    );
  } catch {
    // Telemetry must never break agent generation or tool execution.
  }
}

async function appendTelemetryJsonl(logPath: string, payload: AgentTelemetryEvent): Promise<void> {
  try {
    await mkdir(path.dirname(logPath), { recursive: true });
    await appendFile(logPath, `${JSON.stringify(payload)}\n`, "utf8");
  } catch {
    // Cloudflare Workers do not provide a durable local filesystem. Hosted
    // telemetry must remain non-blocking; Tail Workers / Workers Logs are the
    // deploy-time evidence path, while local dev keeps JSONL when fs exists.
  }
}

export function sanitizeAgentTelemetry(event: AgentTelemetryEvent): AgentTelemetryEvent {
  return sanitizeTelemetryEvent(createTelemetryEvent(sanitizeFailureRecord(normalizeLegacyTelemetrySource(event))));
}

function normalizeLegacyTelemetrySource(event: AgentTelemetryEvent | (Omit<AgentTelemetryEvent, "source"> & { source: AgentTelemetrySource | string })): AgentTelemetryEvent {
  return {
    ...event,
    source: event.source === `ody${"sseus"}-host` ? "workspace-host" : event.source,
  } as AgentTelemetryEvent;
}

function resolveTelemetryLogPath(): string {
  if (process.env.SONIK_AGENT_UI_TELEMETRY_LOG) return process.env.SONIK_AGENT_UI_TELEMETRY_LOG;
  return path.join(findRepoRoot(process.cwd()), ".omx", "logs", "agent-ui-telemetry.jsonl");
}

function findRepoRoot(startDir: string): string {
  let current = startDir;
  for (let index = 0; index < 8; index += 1) {
    if (existsSync(path.join(current, ".omx")) || existsSync(path.join(current, "pnpm-workspace.yaml"))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return startDir;
}

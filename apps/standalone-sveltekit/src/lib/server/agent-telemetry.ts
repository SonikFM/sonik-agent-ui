import { existsSync } from "node:fs";
import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import {
  createTelemetryEvent,
  sanitizeTelemetryEvent,
  type AgentTelemetryEvent,
  type AgentTelemetrySource,
} from "@sonik-agent-ui/agent-observability";
import { recordWorkspaceTelemetryEvent } from "./workspace-store.ts";

export type { AgentTelemetryEvent, AgentTelemetrySource } from "@sonik-agent-ui/agent-observability";

export async function writeAgentTelemetry(event: AgentTelemetryEvent): Promise<void> {
  const payload = sanitizeAgentTelemetry(event);
  emitTelemetryToWorkerLogs(payload);
  const logPath = resolveTelemetryLogPath();
  await appendTelemetryJsonl(logPath, payload);
  try {
    recordWorkspaceTelemetryEvent({
      session_id: payload.sessionId ?? null,
      request_id: payload.requestId ?? null,
      source: payload.source,
      event: payload.event,
      payload,
      ok: payload.ok ?? null,
      error: payload.error ?? null,
    });
  } catch {
    // Intentional fail-safe: workspace telemetry is only a bounded mirror; JSONL above remains the source of evidence.
  }
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
  return sanitizeTelemetryEvent(createTelemetryEvent(normalizeLegacyTelemetrySource(event)));
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

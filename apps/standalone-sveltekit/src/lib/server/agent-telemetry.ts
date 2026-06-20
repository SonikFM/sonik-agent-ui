import { existsSync } from "node:fs";
import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { recordWorkspaceTelemetryEvent } from "./workspace-store.ts";

export type AgentTelemetrySource = "server" | "client" | "odysseus-host";

export interface AgentTelemetryEvent {
  source: AgentTelemetrySource;
  event: string;
  requestId?: string;
  sessionId?: string;
  messageId?: string;
  toolCallId?: string;
  artifactId?: string;
  artifactVersion?: number;
  documentId?: string;
  documentVersion?: number;
  title?: string;
  root?: string;
  elementCount?: number;
  totalMatches?: number;
  query?: string;
  surface?: string;
  route?: string;
  commandFamilies?: string[];
  skillFamilies?: string[];
  commandFamily?: string;
  commandSource?: string;
  commandEffect?: string;
  runtimeStatus?: string;
  runtimeProvider?: string;
  loadMode?: string;
  policyReasons?: string[];
  contextSource?: string;
  reason?: string;
  mode?: string;
  durationMs?: number;
  ok?: boolean;
  error?: string;
  at?: string;
}

const MAX_STRING_LENGTH = 2_000;
const MAX_LIST_ITEMS = 8;

export async function writeAgentTelemetry(event: AgentTelemetryEvent): Promise<void> {
  const payload = sanitizeAgentTelemetry(event);
  const logPath = resolveTelemetryLogPath();
  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify(payload)}\n`, "utf8");
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

export function sanitizeAgentTelemetry(event: AgentTelemetryEvent): AgentTelemetryEvent {
  const payload: AgentTelemetryEvent = {
    source: event.source,
    event: event.event,
    requestId: event.requestId,
    sessionId: event.sessionId,
    messageId: event.messageId,
    toolCallId: event.toolCallId,
    artifactId: event.artifactId,
    artifactVersion: event.artifactVersion,
    documentId: event.documentId,
    documentVersion: event.documentVersion,
    title: event.title,
    root: event.root,
    elementCount: event.elementCount,
    totalMatches: event.totalMatches,
    query: event.query,
    surface: event.surface,
    route: event.route,
    commandFamilies: sanitizeTelemetryStringList(event.commandFamilies),
    skillFamilies: sanitizeTelemetryStringList(event.skillFamilies),
    commandFamily: event.commandFamily,
    commandSource: event.commandSource,
    commandEffect: event.commandEffect,
    runtimeStatus: event.runtimeStatus,
    runtimeProvider: event.runtimeProvider,
    loadMode: event.loadMode,
    policyReasons: sanitizeTelemetryStringList(event.policyReasons),
    contextSource: event.contextSource,
    reason: event.reason,
    mode: event.mode,
    durationMs: event.durationMs,
    ok: event.ok,
    error: event.error,
    at: event.at ?? new Date().toISOString(),
  };

  for (const [key, value] of Object.entries(payload) as Array<[keyof AgentTelemetryEvent, unknown]>) {
    if (value === undefined || value === "") delete payload[key];
    if (typeof value === "string" && value.length > MAX_STRING_LENGTH) {
      payload[key] = `${value.slice(0, MAX_STRING_LENGTH)}…` as never;
    }
  }

  return payload;
}

function sanitizeTelemetryStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value
    .filter((entry): entry is string => typeof entry === "string" && entry !== "")
    .slice(0, MAX_LIST_ITEMS)
    .map((entry) => entry.length > MAX_STRING_LENGTH ? `${entry.slice(0, MAX_STRING_LENGTH)}…` : entry);
  return entries.length > 0 ? entries : undefined;
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

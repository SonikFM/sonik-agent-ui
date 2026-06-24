export const AGENT_UI_TELEMETRY_SCHEMA_VERSION = "sonik.agent_ui.telemetry.v1";

export type AgentTelemetrySource = "server" | "client" | "workspace-host" | "system" | "playwright" | "dev-server";
export type LegacyAgentTelemetrySource = string;

export interface AgentUiPageContextSnapshot {
  route?: string;
  surface?: string;
  pageType?: string;
  title?: string;
  theme?: string;
  mode?: string;
  activeSessionId?: string | null;
  activeEntity?: { type: string; id: string; label?: string };
  activeArtifactId?: string | null;
  activeDocumentId?: string | null;
  artifactType?: string | null;
  conversationStatus?: string;
  messageCount?: number;
  visibleActions?: string[];
  visibleWarnings?: string[];
  visibleErrors?: string[];
  commandFamilies?: string[];
  skillFamilies?: string[];
  at?: string;
}

export interface AgentUiPageAssertions {
  schemaVersion: "sonik.agent_ui.assertions.v1";
  hasActiveSession: boolean;
  isStreaming: boolean;
  canSubmit: boolean;
  submitDisabledReason?: string;
  hasActiveArtifact: boolean;
  hasActiveDocument: boolean;
  messageCount: number;
  visibleErrorCount: number;
  lastPersistStatus?: "idle" | "eligible" | "in_flight" | "success" | "error";
}

export interface AgentUiSemanticActionResult<TState = AgentUiPageAssertions> {
  ok: boolean;
  state: TState;
  message?: string;
  disabledReason?: string;
}

/**
 * Runtime-safe page-control surface for host adapters and local smoke tests.
 * The contract intentionally exposes snapshot reads and semantic actions only;
 * it must not leak live Svelte state objects or raw DOM-control details.
 */
export interface AgentUiPageControl {
  schemaVersion: "sonik.agent_ui.page_control.v1";
  getPageContext: () => AgentUiPageContextSnapshot;
  getAssertions: () => AgentUiPageAssertions;
  actions: {
    createSession: () => AgentUiSemanticActionResult | Promise<AgentUiSemanticActionResult>;
    submitPrompt: (input: { prompt?: string }) => AgentUiSemanticActionResult | Promise<AgentUiSemanticActionResult>;
    stop: () => AgentUiSemanticActionResult | Promise<AgentUiSemanticActionResult>;
    clearChat: () => AgentUiSemanticActionResult | Promise<AgentUiSemanticActionResult>;
    clearArtifact: () => AgentUiSemanticActionResult | Promise<AgentUiSemanticActionResult>;
    openWorkspaceDocument: () => AgentUiSemanticActionResult | Promise<AgentUiSemanticActionResult>;
  };
}

export interface AgentTelemetryErrorPayload {
  name?: string;
  message: string;
  stack?: string;
}

export interface AgentTelemetryEvent<TPayload = Record<string, unknown>> {
  schemaVersion?: typeof AGENT_UI_TELEMETRY_SCHEMA_VERSION;
  eventId?: string;
  runId?: string;
  source: AgentTelemetrySource;
  event: string;
  phase?: string;
  requestId?: string;
  traceId?: string;
  traceparent?: string;
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
  hostSessionSource?: string;
  loadMode?: string;
  policyReasons?: string[];
  contextSource?: string;
  reason?: string;
  mode?: string;
  durationMs?: number;
  ok?: boolean;
  error?: string;
  payload?: TPayload;
  pageContext?: AgentUiPageContextSnapshot;
  at?: string;
}

export interface AgentTelemetryCorrelation {
  requestId: string;
  traceId: string;
  traceparent: string;
}

const MAX_STRING_LENGTH = 2_000;
const MAX_LIST_ITEMS = 8;
const SECRET_KEY_PATTERN = /(authorization|api[-_]?key|token|secret|password|cookie|set-cookie|credential|session[_-]?token|vck_[a-z0-9]+)/i;
const SECRET_VALUE_PATTERN = /\b(vck_[A-Za-z0-9_-]{12,}|sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{12,})\b/g;

export function createRequestId(prefix = "req"): string {
  return `${prefix}_${safeRandomId(18)}`;
}

export function createTraceId(): string {
  return randomHex(16);
}

export function createTraceparent(traceId = createTraceId(), spanId = randomHex(8)): string {
  return `00-${traceId}-${spanId}-01`;
}

export function trustedRequestId(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{6,128}$/.test(value) ? value : undefined;
}

export function trustedTraceId(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{32}$/i.test(value) && !/^0+$/.test(value) ? value.toLowerCase() : undefined;
}

export function trustedTraceparent(value: unknown): string | undefined {
  return typeof value === "string" && /^00-[a-f0-9]{32}-[a-f0-9]{16}-0[01]$/i.test(value) ? value.toLowerCase() : undefined;
}

export function traceIdFromTraceparent(value: unknown): string | undefined {
  const traceparent = trustedTraceparent(value);
  if (!traceparent) return undefined;
  return traceparent.split("-")[1];
}

export function createTelemetryCorrelation(input: { requestId?: unknown; traceparent?: unknown; traceId?: unknown } = {}): AgentTelemetryCorrelation {
  const incomingTraceparent = trustedTraceparent(input.traceparent);
  const traceId = traceIdFromTraceparent(incomingTraceparent) ?? trustedTraceId(input.traceId) ?? createTraceId();
  return {
    requestId: trustedRequestId(input.requestId) ?? createRequestId(),
    traceId,
    traceparent: incomingTraceparent ?? createTraceparent(traceId),
  };
}

export function createTelemetryEvent<TPayload = Record<string, unknown>>(event: AgentTelemetryEvent<TPayload>): AgentTelemetryEvent<TPayload> {
  return sanitizeTelemetryEvent({
    schemaVersion: AGENT_UI_TELEMETRY_SCHEMA_VERSION,
    eventId: event.eventId ?? createRequestId("evt"),
    at: event.at ?? new Date().toISOString(),
    ...event,
  });
}

export function sanitizeTelemetryEvent<TPayload = Record<string, unknown>>(event: AgentTelemetryEvent<TPayload>): AgentTelemetryEvent<TPayload> {
  const payload: AgentTelemetryEvent = {
    ...event,
    schemaVersion: event.schemaVersion ?? AGENT_UI_TELEMETRY_SCHEMA_VERSION,
    eventId: event.eventId ?? createRequestId("evt"),
    source: event.source,
    event: redactTelemetryString(event.event),
    runId: cleanOptionalString(event.runId),
    phase: cleanOptionalString(event.phase),
    requestId: cleanOptionalString(event.requestId),
    traceId: trustedTraceId(event.traceId) ?? traceIdFromTraceparent(event.traceparent) ?? cleanOptionalString(event.traceId),
    traceparent: trustedTraceparent(event.traceparent) ?? cleanOptionalString(event.traceparent),
    sessionId: cleanOptionalString(event.sessionId),
    messageId: cleanOptionalString(event.messageId),
    toolCallId: cleanOptionalString(event.toolCallId),
    artifactId: cleanOptionalString(event.artifactId),
    documentId: cleanOptionalString(event.documentId),
    title: cleanOptionalString(event.title),
    root: cleanOptionalString(event.root),
    query: cleanOptionalString(event.query),
    surface: cleanOptionalString(event.surface),
    route: cleanOptionalString(event.route),
    commandFamilies: sanitizeTelemetryStringList(event.commandFamilies),
    skillFamilies: sanitizeTelemetryStringList(event.skillFamilies),
    commandFamily: cleanOptionalString(event.commandFamily),
    commandSource: cleanOptionalString(event.commandSource),
    commandEffect: cleanOptionalString(event.commandEffect),
    runtimeStatus: cleanOptionalString(event.runtimeStatus),
    runtimeProvider: cleanOptionalString(event.runtimeProvider),
    hostSessionSource: cleanOptionalString(event.hostSessionSource),
    loadMode: cleanOptionalString(event.loadMode),
    policyReasons: sanitizeTelemetryStringList(event.policyReasons),
    contextSource: cleanOptionalString(event.contextSource),
    reason: cleanOptionalString(event.reason),
    mode: cleanOptionalString(event.mode),
    artifactVersion: cleanOptionalNumber(event.artifactVersion),
    documentVersion: cleanOptionalNumber(event.documentVersion),
    elementCount: cleanOptionalNumber(event.elementCount),
    totalMatches: cleanOptionalNumber(event.totalMatches),
    durationMs: cleanOptionalNumber(event.durationMs),
    ok: typeof event.ok === "boolean" ? event.ok : undefined,
    error: cleanOptionalString(event.error),
    payload: sanitizeTelemetryValue(event.payload) as Record<string, unknown> | undefined,
    pageContext: sanitizePageContext(event.pageContext),
    at: event.at ?? new Date().toISOString(),
  };

  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined && value !== "")) as AgentTelemetryEvent<TPayload>;
}

export function sanitizePageContext(value: unknown): AgentUiPageContextSnapshot | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const context: AgentUiPageContextSnapshot = {
    route: cleanOptionalString(record.route),
    surface: cleanOptionalString(record.surface),
    pageType: cleanOptionalString(record.pageType),
    title: cleanOptionalString(record.title),
    theme: cleanOptionalString(record.theme),
    mode: cleanOptionalString(record.mode),
    activeSessionId: cleanNullableString(record.activeSessionId),
    activeEntity: sanitizeActiveEntity(record.activeEntity),
    activeArtifactId: cleanNullableString(record.activeArtifactId),
    activeDocumentId: cleanNullableString(record.activeDocumentId),
    artifactType: cleanNullableString(record.artifactType),
    conversationStatus: cleanOptionalString(record.conversationStatus),
    messageCount: cleanOptionalNumber(record.messageCount),
    visibleActions: sanitizeTelemetryStringList(record.visibleActions),
    visibleWarnings: sanitizeTelemetryStringList(record.visibleWarnings),
    visibleErrors: sanitizeTelemetryStringList(record.visibleErrors),
    commandFamilies: sanitizeTelemetryStringList(record.commandFamilies),
    skillFamilies: sanitizeTelemetryStringList(record.skillFamilies),
    at: cleanOptionalString(record.at),
  };
  const clean = Object.fromEntries(Object.entries(context).filter(([, entry]) => entry !== undefined && entry !== "")) as AgentUiPageContextSnapshot;
  return Object.keys(clean).length > 0 ? clean : undefined;
}

export function sanitizeTelemetryValue(value: unknown, depth = 0): unknown {
  if (value === undefined || value === null) return value;
  if (typeof value === "string") return redactTelemetryString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) return readableError(value);
  if (Array.isArray(value)) return value.slice(0, MAX_LIST_ITEMS).map((entry) => sanitizeTelemetryValue(entry, depth + 1));
  if (typeof value === "object") {
    if (depth > 4) return "[MaxDepth]";
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 48)) {
      output[redactTelemetryString(key)] = SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : sanitizeTelemetryValue(entry, depth + 1);
    }
    return output;
  }
  return String(value);
}

export function redactTelemetryString(value: string): string {
  const truncated = value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
  return truncated.replace(SECRET_VALUE_PATTERN, "[REDACTED]");
}

export function sanitizeTelemetryPath(value: string): string {
  return redactTelemetryString(value.replace(/\/Users\/[^/]+/g, "/Users/[user]"));
}

export function readableError(value: unknown): AgentTelemetryErrorPayload {
  if (value instanceof Error) {
    return {
      name: redactTelemetryString(value.name),
      message: redactTelemetryString(value.message),
      stack: value.stack ? redactTelemetryString(value.stack) : undefined,
    };
  }
  return { message: redactTelemetryString(typeof value === "string" ? value : safeStringify(value)) };
}

function sanitizeActiveEntity(value: unknown): AgentUiPageContextSnapshot["activeEntity"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const type = cleanOptionalString(record.type);
  const id = cleanOptionalString(record.id);
  const label = cleanOptionalString(record.label);
  if (!type || !id) return undefined;
  return { type, id, ...(label ? { label } : {}) };
}

function sanitizeTelemetryStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
    .slice(0, MAX_LIST_ITEMS)
    .map((entry) => redactTelemetryString(entry.trim()));
  return entries.length > 0 ? entries : undefined;
}

function cleanOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? redactTelemetryString(value.trim()) : undefined;
}

function cleanNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return cleanOptionalString(value);
}

function cleanOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function safeRandomId(size: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = new Uint8Array(size);
  globalThis.crypto?.getRandomValues?.(bytes) ?? fillPseudoRandom(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function randomHex(bytesLength: number): string {
  const bytes = new Uint8Array(bytesLength);
  globalThis.crypto?.getRandomValues?.(bytes) ?? fillPseudoRandom(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fillPseudoRandom(bytes: Uint8Array): void {
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
}

function safeStringify(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    return typeof json === "string" ? json : String(value);
  } catch {
    return String(value);
  }
}

export const AGENT_UI_TELEMETRY_SCHEMA_VERSION = "sonik.agent_ui.telemetry.v1";

export type AgentTelemetrySource = "server" | "client" | "workspace-host" | "system" | "playwright" | "dev-server";
export type LegacyAgentTelemetrySource = string;

export type AgentUiWorkflowPhase = "idle" | "intake" | "saving" | "preview_ready" | "approval_requested" | "approved" | "committing" | "committed" | "error";

export interface AgentUiWorkflowQuestionSnapshot {
  id: string;
  title: string;
  required: boolean;
  answerType: string;
  choices?: Array<{ value: string | number | boolean; label: string; disabled?: boolean }>;
}

export interface AgentUiWorkflowVisibleError {
  field?: string;
  code: string;
  message: string;
}

export interface AgentUiWorkflowCommandPreviewSnapshot {
  commandId: string;
  stableInputHash: string;
  effect: "read" | "write" | "destructive";
  approvalRequired: boolean;
}

export interface AgentUiWorkflowSnapshot {
  activeWorkflowId: string | null;
  activeArtifactId: string | null;
  phase: AgentUiWorkflowPhase;
  currentQuestion?: AgentUiWorkflowQuestionSnapshot | null;
  answeredCount: number;
  requiredCount: number;
  unansweredRequiredIds: string[];
  visibleErrors: AgentUiWorkflowVisibleError[];
  canSubmitAnswer: boolean;
  canRequestApproval: boolean;
  canApproveAndRun: boolean;
  disabledReasons: string[];
  commandPreview?: AgentUiWorkflowCommandPreviewSnapshot | null;
}

export interface AgentUiDeploymentSnapshot {
  id?: string;
  tag?: string;
  timestamp?: string;
}

export interface AgentUiTurnCorrelationSnapshot {
  sessionId: string;
  messageId?: string;
  requestId: string;
  traceId?: string;
  traceparent?: string;
  agentUiRunId?: string;
  status: "success" | "error";
  capturedAt: string;
  deployment?: AgentUiDeploymentSnapshot;
}

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
  workflow?: AgentUiWorkflowSnapshot;
  /** Sanitized semantic targets exposed by the trusted host/page; never raw selectors. */
  hostUiTargets?: unknown[];
  /** Optional full target registry envelope for agent/action runtimes. */
  hostUiTargetRegistry?: AgentUiTargetRegistrySnapshot;
  commandFamilies?: string[];
  skillFamilies?: string[];
  /** Privacy-safe deployment/build identifiers explicitly allowlisted for support diagnostics. */
  deployment?: AgentUiDeploymentSnapshot;
  /** Privacy-safe per-turn correlation identifiers explicitly allowlisted for support diagnostics. */
  correlation?: AgentUiTurnCorrelationSnapshot;
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
  /** Current active session at the time the semantic action returns. */
  activeSessionId?: string | null;
  /** Session that the caller requested or that createSession selected. */
  expectedSessionId?: string | null;
}

export interface AgentUiActionDescriptor {
  name: string;
  label: string;
  kind: "semantic" | "host_action";
  enabled: boolean;
  disabledReason?: string;
  effect: "read" | "write" | "destructive" | "environment" | "ui";
  policyMode: "block" | "ask" | "allow" | "require";
  /** Host-action key for driver/tour-capable actions. */
  actionKey?: string;
  /** True when the action needs a semantic target id from getTargetRegistry(). */
  requiresTarget?: boolean;
  targetId?: string;
}

export type AgentUiCanvasControlId = "preview" | "document" | "fullscreen" | "clear";

export type AgentUiCanvasControlDisabledReason =
  | "streaming"
  | "missing_active_artifact"
  | "missing_active_document"
  | "missing_workspace_content";

export interface AgentUiCanvasControlState {
  id: AgentUiCanvasControlId;
  label: string;
  enabled: boolean;
  active: boolean;
  disabledReason?: AgentUiCanvasControlDisabledReason;
}

export type AgentUiCanvasControlStateMap = Record<AgentUiCanvasControlId, AgentUiCanvasControlState>;

export interface AgentUiTargetRegistrySnapshot {
  version: string;
  generatedAt: string;
  provider: string;
  route?: string;
  surface?: string;
  targets: Array<{
    targetId: string;
    targetInstanceId?: string;
    label: string;
    description: string;
    surface: string;
    capabilities: string[];
    visible: boolean;
    enabled: boolean;
    disabledReason?: string;
  }>;
}

export interface AgentUiActionRegistrySnapshot {
  schemaVersion: "sonik.agent_ui.actions.v1";
  actions: AgentUiActionDescriptor[];
}

export interface AgentUiApprovalStateSnapshot {
  schemaVersion: "sonik.agent_ui.approval_state.v1";
  phase: AgentUiWorkflowPhase;
  activeArtifactId: string | null;
  canRequestApproval: boolean;
  canApproveAndRun: boolean;
  disabledReasons: string[];
  commandPreview?: AgentUiWorkflowCommandPreviewSnapshot | null;
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
  getActions: () => AgentUiActionRegistrySnapshot;
  getTargetRegistry: () => AgentUiTargetRegistrySnapshot | null;
  getActiveWorkflowState: () => AgentUiWorkflowSnapshot;
  getApprovalState: () => AgentUiApprovalStateSnapshot;
  /** Snapshot of the four presentation-only canvas controls. */
  getCanvasControls?: () => AgentUiCanvasControlStateMap;
  /** Phase 5 (agent-creation-tool-plan-2026-07-13.md): optional snapshot of
   *  the workflow-builder mode's working state, when that mode is mounted.
   *  Additive/optional so hosts that predate the builder mode see no change. */
  getBuilderState?: () => Record<string, unknown> | null;
  actions: {
    createSession: () => AgentUiSemanticActionResult | Promise<AgentUiSemanticActionResult>;
    submitPrompt: (input: { prompt?: string; sessionId?: string | null }) => AgentUiSemanticActionResult | Promise<AgentUiSemanticActionResult>;
    stop: () => AgentUiSemanticActionResult | Promise<AgentUiSemanticActionResult>;
    clearChat: () => AgentUiSemanticActionResult | Promise<AgentUiSemanticActionResult>;
    clearArtifact: () => AgentUiSemanticActionResult | Promise<AgentUiSemanticActionResult>;
    reloadSession: () => AgentUiSemanticActionResult | Promise<AgentUiSemanticActionResult>;
    openWorkspaceDocument: () => AgentUiSemanticActionResult | Promise<AgentUiSemanticActionResult>;
    stageComposerSkill?: (input: { skillId?: string }) => AgentUiSemanticActionResult | Promise<AgentUiSemanticActionResult>;
    setComposerToolPermission?: (input: { familyId?: string; mode?: "off" | "ask" | "allow" }) => AgentUiSemanticActionResult | Promise<AgentUiSemanticActionResult>;
    pinComposerTool?: (input: { toolId?: string; pinned?: boolean }) => AgentUiSemanticActionResult | Promise<AgentUiSemanticActionResult>;
    removeComposerContext?: (input: { contextId?: string }) => AgentUiSemanticActionResult | Promise<AgentUiSemanticActionResult>;
    attachComposerDocument?: (input: { documentId?: string }) => AgentUiSemanticActionResult | Promise<AgentUiSemanticActionResult>;
    submitAnswer: (input: { questionId?: string; value?: unknown }) => AgentUiSemanticActionResult | Promise<AgentUiSemanticActionResult>;
    markUnknown: (input: { questionId?: string }) => AgentUiSemanticActionResult | Promise<AgentUiSemanticActionResult>;
    saveDraft: () => AgentUiSemanticActionResult | Promise<AgentUiSemanticActionResult>;
    requestApproval: () => AgentUiSemanticActionResult | Promise<AgentUiSemanticActionResult>;
    approveAndRun: () => AgentUiSemanticActionResult | Promise<AgentUiSemanticActionResult>;
    cancelApproval: () => AgentUiSemanticActionResult | Promise<AgentUiSemanticActionResult>;
    exportChat?: () => AgentUiSemanticActionResult | Promise<AgentUiSemanticActionResult>;
    exportDiagnostics?: () => AgentUiSemanticActionResult | Promise<AgentUiSemanticActionResult>;
    requestHostAction?: (input: {
      actionKey?: string;
      targetId?: string;
      targetInstanceId?: string;
      entityRef?: unknown;
      input?: unknown;
      intentLabel?: string;
    }) => AgentUiSemanticActionResult<{ hostActionResult?: unknown } & AgentUiPageAssertions> | Promise<AgentUiSemanticActionResult<{ hostActionResult?: unknown } & AgentUiPageAssertions>>;
    openCanvas?: () => AgentUiSemanticActionResult<{ hostActionResult?: unknown } & AgentUiPageAssertions> | Promise<AgentUiSemanticActionResult<{ hostActionResult?: unknown } & AgentUiPageAssertions>>;
    highlightTarget?: (input: { targetId?: string; targetInstanceId?: string; entityRef?: unknown }) => AgentUiSemanticActionResult<{ hostActionResult?: unknown } & AgentUiPageAssertions> | Promise<AgentUiSemanticActionResult<{ hostActionResult?: unknown } & AgentUiPageAssertions>>;
    focusTarget?: (input: { targetId?: string; targetInstanceId?: string; entityRef?: unknown }) => AgentUiSemanticActionResult<{ hostActionResult?: unknown } & AgentUiPageAssertions> | Promise<AgentUiSemanticActionResult<{ hostActionResult?: unknown } & AgentUiPageAssertions>>;
    requestApprovalPreview?: (input?: { targetId?: string; targetInstanceId?: string; entityRef?: unknown }) => AgentUiSemanticActionResult<{ hostActionResult?: unknown } & AgentUiPageAssertions> | Promise<AgentUiSemanticActionResult<{ hostActionResult?: unknown } & AgentUiPageAssertions>>;
    /** Phase 5: switches the top-level app between the chat/canvas workspace
     *  and the workflow-builder mode. Optional/additive -- absent on hosts
     *  that predate the builder mode. */
    setWorkspaceMode?: (input: { mode: "workspace" | "workflow-builder" }) => AgentUiSemanticActionResult | Promise<AgentUiSemanticActionResult>;
    /** Phase 5: validates and saves the workflow-builder's current working
     *  AgentDefinition as a draft. Fails closed with a disabledReason if the
     *  builder mode is not mounted. */
    saveAgentDefinitionDraft?: () => AgentUiSemanticActionResult | Promise<AgentUiSemanticActionResult>;
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
  /** Phase 10 (agent-creation-tool-plan-2026-07-13.md): join key stamping every event
   *  emitted while a workflow-controller WorkflowRunState is active, distinct from the
   *  per-turn `runId` (agent-ui generation run) already above. Additive/optional --
   *  events emitted outside an active workflow run are unchanged. */
  workflowRunId?: string;
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
const PROVIDER_PRIVATE_KEY_PATTERN = /^(?:provider(?:metadata|data|options|request|response|id|name|ref|reference|references)?|model(?:metadata|data|options|request|response|id|name)?)$/;
const FAILURE_KEY_PATTERN = /(error|failure|exception)/i;
const SAFE_FAILURE_STRING_KEYS = /^(schemaVersion|eventId|source|event|runId|workflowRunId|phase|requestId|traceId|traceparent|sessionId|messageId|toolCallId|toolName|artifactId|documentId|commandId|familyId|operationId|stableInputHash|code|error_code|status|kind|type|manifestType|severity|effect|approval|method|at|surface|commandFamily|commandSource|commandEffect|runtimeStatus|hostSessionSource|loadMode|contextSource|mode|activeSessionId|activeArtifactId|activeDocumentId|pageType|conversationStatus)$/i;
const SAFE_FAILURE_REASON_CODES = new Set(["duplicate", "busy", "blocked", "ledger_read_failed", "ledger_write_failed"]);
const SAFE_TELEMETRY_ERROR = "Run failed";

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
  return sanitizeTelemetryEvent(event);
}

export function sanitizeTelemetryEvent<TPayload = Record<string, unknown>>(event: AgentTelemetryEvent<TPayload>): AgentTelemetryEvent<TPayload> {
  const errorBearing = event.ok === false || typeof event.error === "string" || FAILURE_KEY_PATTERN.test(event.event) || containsFailureKey(event.payload);
  const payload: AgentTelemetryEvent = {
    ...event,
    schemaVersion: event.schemaVersion ?? AGENT_UI_TELEMETRY_SCHEMA_VERSION,
    eventId: event.eventId ?? createRequestId("evt"),
    source: event.source,
    event: redactTelemetryString(event.event),
    runId: cleanOptionalString(event.runId),
    workflowRunId: cleanOptionalString(event.workflowRunId),
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
    error: typeof event.error === "string" ? SAFE_TELEMETRY_ERROR : undefined,
    payload: event.payload as Record<string, unknown> | undefined,
    pageContext: sanitizePageContext(event.pageContext),
    at: event.at ?? new Date().toISOString(),
  };

  const clean = Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined && value !== ""));
  return sanitizeTelemetryValue(clean, 0, errorBearing) as AgentTelemetryEvent<TPayload>;
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
    workflow: sanitizeWorkflowSnapshot(record.workflow),
    // Host UI target data carries action-routing and locator semantics. Keep it out
    // of the generic telemetry sanitizer so embedders must opt into the stricter
    // target-registry sanitizer before anything target-like reaches the agent.
    commandFamilies: sanitizeTelemetryStringList(record.commandFamilies),
    skillFamilies: sanitizeTelemetryStringList(record.skillFamilies),
    deployment: sanitizeDeploymentSnapshot(record.deployment),
    correlation: sanitizeTurnCorrelationSnapshot(record.correlation),
    at: cleanOptionalString(record.at),
  };
  const clean = Object.fromEntries(Object.entries(context).filter(([, entry]) => entry !== undefined && entry !== "")) as AgentUiPageContextSnapshot;
  return Object.keys(clean).length > 0 ? clean : undefined;
}

export function sanitizeDeploymentSnapshot(value: unknown): AgentUiDeploymentSnapshot | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const deployment: AgentUiDeploymentSnapshot = {
    id: cleanOptionalString(record.id),
    tag: cleanOptionalString(record.tag),
    timestamp: cleanOptionalString(record.timestamp),
  };
  const clean = Object.fromEntries(Object.entries(deployment).filter(([, entry]) => entry !== undefined && entry !== "")) as AgentUiDeploymentSnapshot;
  return Object.keys(clean).length > 0 ? clean : undefined;
}

export function sanitizeTurnCorrelationSnapshot(value: unknown): AgentUiTurnCorrelationSnapshot | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const sessionId = cleanOptionalString(record.sessionId);
  const requestId = cleanOptionalString(record.requestId);
  const status = record.status === "success" || record.status === "error" ? record.status : undefined;
  const capturedAt = cleanOptionalString(record.capturedAt);
  if (!sessionId || !requestId || !status || !capturedAt) return undefined;
  const traceparent = trustedTraceparent(record.traceparent) ?? cleanOptionalString(record.traceparent);
  const traceId = trustedTraceId(record.traceId) ?? traceIdFromTraceparent(traceparent) ?? cleanOptionalString(record.traceId);
  return {
    sessionId,
    messageId: cleanOptionalString(record.messageId),
    requestId,
    traceId,
    traceparent,
    agentUiRunId: cleanOptionalString(record.agentUiRunId),
    status,
    capturedAt,
    deployment: sanitizeDeploymentSnapshot(record.deployment),
  };
}

function sanitizeWorkflowSnapshot(value: unknown): AgentUiWorkflowSnapshot | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const phase = typeof record.phase === "string" && ["idle", "intake", "saving", "preview_ready", "approval_requested", "approved", "committing", "committed", "error"].includes(record.phase)
    ? record.phase as AgentUiWorkflowPhase
    : "idle";
  const question = sanitizeWorkflowQuestion(record.currentQuestion);
  const preview = sanitizeWorkflowCommandPreview(record.commandPreview);
  return {
    activeWorkflowId: cleanNullableString(record.activeWorkflowId) ?? null,
    activeArtifactId: cleanNullableString(record.activeArtifactId) ?? null,
    phase,
    currentQuestion: question ?? null,
    answeredCount: cleanOptionalNumber(record.answeredCount) ?? 0,
    requiredCount: cleanOptionalNumber(record.requiredCount) ?? 0,
    unansweredRequiredIds: sanitizeTelemetryStringList(record.unansweredRequiredIds) ?? [],
    visibleErrors: sanitizeWorkflowErrors(record.visibleErrors),
    canSubmitAnswer: record.canSubmitAnswer === true,
    canRequestApproval: record.canRequestApproval === true,
    canApproveAndRun: record.canApproveAndRun === true,
    disabledReasons: sanitizeTelemetryStringList(record.disabledReasons) ?? [],
    commandPreview: preview ?? null,
  };
}

function sanitizeWorkflowQuestion(value: unknown): AgentUiWorkflowQuestionSnapshot | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const id = cleanOptionalString(record.id);
  const title = cleanOptionalString(record.title);
  const answerType = cleanOptionalString(record.answerType);
  if (!id || !title || !answerType) return undefined;
  return {
    id,
    title,
    required: record.required === true,
    answerType,
    choices: sanitizeWorkflowChoices(record.choices),
  };
}

function sanitizeWorkflowChoices(value: unknown): AgentUiWorkflowQuestionSnapshot["choices"] {
  if (!Array.isArray(value)) return undefined;
  return value.slice(0, MAX_LIST_ITEMS).flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const rawValue = record.value;
    if (typeof rawValue !== "string" && typeof rawValue !== "number" && typeof rawValue !== "boolean") return [];
    const label = cleanOptionalString(record.label) ?? String(rawValue);
    return [{ value: rawValue, label, disabled: record.disabled === true }];
  });
}

function sanitizeWorkflowErrors(value: unknown): AgentUiWorkflowVisibleError[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_LIST_ITEMS).flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const code = cleanOptionalString(record.code);
    const message = cleanOptionalString(record.message);
    if (!code || !message) return [];
    return [{ code, message, field: cleanOptionalString(record.field) }];
  });
}

function sanitizeWorkflowCommandPreview(value: unknown): AgentUiWorkflowCommandPreviewSnapshot | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const commandId = cleanOptionalString(record.commandId);
  const stableInputHash = cleanOptionalString(record.stableInputHash);
  const effect = record.effect === "read" || record.effect === "write" || record.effect === "destructive" ? record.effect : undefined;
  if (!commandId || !stableInputHash || !effect) return undefined;
  return { commandId, stableInputHash, effect, approvalRequired: record.approvalRequired === true };
}

export function sanitizeTelemetryValue(value: unknown, depth = 0, errorBearing = false, key = ""): unknown {
  if (value === undefined || value === null) return value;
  if (typeof value === "string") {
    if (!errorBearing || SAFE_FAILURE_STRING_KEYS.test(key) || key === "reason" && SAFE_FAILURE_REASON_CODES.has(value)) return redactTelemetryString(value);
    return SAFE_TELEMETRY_ERROR;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) return errorBearing ? { name: value.name, message: SAFE_TELEMETRY_ERROR } : readableError(value);
  if (Array.isArray(value)) return value.slice(0, MAX_LIST_ITEMS).map((entry) => sanitizeTelemetryValue(entry, depth + 1, errorBearing, key));
  if (typeof value === "object") {
    if (depth > 4) return "[MaxDepth]";
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 48)) {
      if (PROVIDER_PRIVATE_KEY_PATTERN.test(key.replace(/[_-]/g, "").toLowerCase())) continue;
      output[redactTelemetryString(key)] = SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : sanitizeTelemetryValue(entry, depth + 1, errorBearing, key);
    }
    return output;
  }
  return String(value);
}

/** Redacts durable JSON without telemetry's size/depth limits, so safe receipts
 * remain replayable byte-for-byte while secret-bearing keys and values do not. */
export function sanitizePersistenceValue(value: unknown): unknown {
  if (value === undefined || value === null) return value;
  if (typeof value === "string") return value.replace(SECRET_VALUE_PATTERN, "[REDACTED]");
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(sanitizePersistenceValue);
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : sanitizePersistenceValue(entry);
    }
    return output;
  }
  return value;
}

function containsFailureKey(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== "object" || depth > 4) return false;
  if (Array.isArray(value)) return value.some((entry) => containsFailureKey(entry, depth + 1));
  return Object.entries(value as Record<string, unknown>).some(([key, entry]) => FAILURE_KEY_PATTERN.test(key) || containsFailureKey(entry, depth + 1));
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

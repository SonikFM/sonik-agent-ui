import { env } from "$env/dynamic/private";
import { createAgent, hasBookingContextIntakeSkill, resolveAgentPromptComposition, resolveCommandFamilyMountDecision } from "$lib/agent";
import { PRODUCT_OUTPUT_INVARIANT } from "$lib/agent-prompt";
import { minuteRateLimit, dailyRateLimit } from "$lib/rate-limit";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type ModelMessage,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { createGoogle } from "@ai-sdk/google";
import { pipeJsonRender, pipeUiMessageStreamSafety, type Spec } from "@json-render/core";
import { pipeArtifactToolOutputsToSpecParts } from "$lib/artifacts/artifact-stream";
import { logArtifactTelemetry } from "$lib/artifacts/artifact-telemetry";
import { writeAgentTelemetry } from "$lib/server/agent-telemetry";
import { sanitizeRunFailure } from "$lib/server/run-error-safety";
import { createDeploymentMetadataHeaders, resolveDeploymentMetadata } from "$lib/server/deployment-metadata";
import { createTelemetryCorrelation, sanitizePageContext } from "@sonik-agent-ui/agent-observability";
import { sanitizeAgentAnalyticsHints } from "@sonik-agent-ui/tool-contracts";
import {
  hasInvalidExplicitDocumentContext,
  parseAgentRunContextSelection,
  resolveAgentContextSelection,
  type AgentContextSelectionResolution,
  type AgentRunContextSelection,
} from "@sonik-agent-ui/tool-contracts/run-context";
import { instrumentGenerateStream } from "$lib/server/stream-telemetry";
import { createRequestBookingRuntimeFetcher } from "$lib/server/booking-runtime-transport";
import { tapSpecStreamForTelemetry } from "$lib/server/spec-stream-tap-telemetry";
import { createDevSmokeStream, readDevSmokeFailMode, readDevSmokeRunId, readDevSmokeScenario, shouldUseDevSmokeStream, writeDevSmokeStreamTelemetry } from "$lib/server/dev-smoke-stream";
import { persistInitiatingUserMessage, startRunRecorder, teeRunEvents, type RunRecorder } from "$lib/server/run-event-log";
import { getRequestWorkspaceDocument, getRequestWorkspacePersistence, syncRequestActiveWorkspaceDocumentSnapshot, type WorkspaceDocumentRecord, type WorkspaceSessionRecord } from "$lib/server/workspace-request-store";
import { resolveEffectiveContextDocument, syncSessionContextDocument } from "$lib/server/run-context-document";
import { AGENT_UI_GOOGLE_PREPROCESSING_BUDGET_MS, AgentUiFileError, requireAgentUiFileBucket, resolveAgentUiFileContextSelection, resolveAgentUiWorkspaceSession, resolveGoogleAgentUiFileParts, type AgentUiFileBucket, type AgentUiModelFilePart } from "$lib/server/agent-ui-files";
import { createStandaloneCommandIndexSummary } from "$lib/server/tool-manifest";
import { createRuntimeSkillIndexSummary } from "$lib/server/skill-registry";
import { sanitizeAgentRuntimeSettings, summarizeAgentRuntimeSettings, type AgentRuntimeSettings } from "$lib/agent-settings";
import { definitionToRuntimeSettings } from "$lib/agent-runtime-adapter";
import { agentDefinitionAuthorityFromHostSession, assertAgentDefinitionAuthorized, resolveAgentDefinitionStore } from "$lib/server/agent-definition-store";
import { resolveKnowledgeContext, formatKnowledgeContextSections } from "$lib/knowledge/resolve-knowledge-context";
import { defaultKnowledgeRoot } from "$lib/knowledge/knowledge-store";
import { isProductTourIntent, resolveImplicitWorkflowSkillSelection } from "$lib/runtime-skill-intent";
import { createCurrentPageContextSummary } from "$lib/page-context-summary";
import { resolveWorkspaceDocumentIntent } from "$lib/document-intent";
import { listPersistedQuestionIds } from "$lib/server/intake-artifacts";
import {
  createBookingRuntimeAuthContextFromEnv,
  createBookingRuntimeAuthContextFromTrustedHostHeader,
  hasBookingRuntimeCredential,
  createAgentHostSessionEnvelope,
  approvedCommandIdsFromHostSession,
} from "$lib/server/host-command-runtime";
import { AGENT_UI_HOST_CONTEXT_HEADER, resolveSignedTrustedOrganizationDisplayFromRequest, resolveTrustedHostSessionSnapshot } from "$lib/server/workspace-services";
import { sanitizeAgentHostPageContext } from "@sonik-agent-ui/agent-embed";
import type { AgentPageContext } from "@sonik-agent-ui/tool-contracts";
import {
  couldStartWorkspaceSessionTitleMarker,
  deriveWorkspaceSessionTitle,
  extractWorkspaceSessionTitleMarker,
  isDefaultWorkspaceSessionName,
  WORKSPACE_SESSION_TITLE_MARKER_PREFIX,
} from "@sonik-agent-ui/workspace-session";
import {
  optionalRouteString,
  routeString,
  WORKSPACE_CONTENT_MAX_CHARS,
  WORKSPACE_LANGUAGE_MAX_CHARS,
  WORKSPACE_SESSION_ID_MAX_CHARS,
  WORKSPACE_TITLE_MAX_CHARS,
} from "$lib/server/workspace-route-limits";
import type { RequestEvent } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

const PAGE_CONTEXT_FIELD_MAX_CHARS = 160;
const PAGE_CONTEXT_LIST_MAX_ITEMS = 8;
const AGENT_SKILL_IDS_MAX_ITEMS = 8;
const AGENT_SKILL_ID_MAX_CHARS = 160;
const AGENT_UI_RUN_ID_HEADER = "x-sonik-agent-ui-run-id";
const TITLE_GENERATION_BUFFER_MAX_CHARS = 320;

// Per-turn skill ids: donor-style `ChatRequest.skillIds` on the request, unioned
// with the explicit runtime-skill composer chips for this turn. Sourced only from
// EXPLICIT selection (never implicit page-context skill families) so a default
// turn composes exactly today's monolith-equivalent prompt with no appended
// skills. Bounded in count and length; resolved through the skill registry.
function resolveRequestSkillIds(input: { requestSkillIds: unknown; selectedSkillFamilies: string[]; implicitSkillIds?: string[] }): string[] {
  const fromRequest = Array.isArray(input.requestSkillIds)
    ? input.requestSkillIds
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0 && entry.length <= AGENT_SKILL_ID_MAX_CHARS)
    : [];
  return [...new Set([...fromRequest, ...input.selectedSkillFamilies, ...(input.implicitSkillIds ?? [])])].slice(0, AGENT_SKILL_IDS_MAX_ITEMS);
}

function resolveAgentPageContext(value: unknown, defaults: { activeDocument?: WorkspaceDocumentRecord | null } = {}): AgentPageContext | undefined {
  const record = typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const activeEntity = resolveActiveEntity(record.activeEntity);
  const pageContext: AgentPageContext = {
    route: optionalRouteString(record.route, "workspace.pageContext.route", PAGE_CONTEXT_FIELD_MAX_CHARS),
    surface: optionalRouteString(record.surface, "workspace.pageContext.surface", PAGE_CONTEXT_FIELD_MAX_CHARS),
    pageType: optionalRouteString(record.pageType, "workspace.pageContext.pageType", PAGE_CONTEXT_FIELD_MAX_CHARS),
    title: optionalRouteString(record.title, "workspace.pageContext.title", PAGE_CONTEXT_FIELD_MAX_CHARS),
    activeEntity,
    activeArtifactId: optionalRouteString(record.activeArtifactId, "workspace.pageContext.activeArtifactId", PAGE_CONTEXT_FIELD_MAX_CHARS),
    activeDocumentId: optionalRouteString(record.activeDocumentId, "workspace.pageContext.activeDocumentId", PAGE_CONTEXT_FIELD_MAX_CHARS),
    artifactType: optionalRouteString(record.artifactType, "workspace.pageContext.artifactType", PAGE_CONTEXT_FIELD_MAX_CHARS),
    visibleActions: routeStringArray(record.visibleActions, "workspace.pageContext.visibleActions"),
    skillFamilies: routeStringArray(record.skillFamilies, "workspace.pageContext.skillFamilies"),
    commandFamilies: routeStringArray(record.commandFamilies, "workspace.pageContext.commandFamilies"),
    ...resolveHostUiTargetContext(record),
  };
  if (!pageContext.activeDocumentId && defaults.activeDocument?.id) pageContext.activeDocumentId = defaults.activeDocument.id;
  if (!pageContext.artifactType && defaults.activeDocument?.language) pageContext.artifactType = defaults.activeDocument.language;
  if (!pageContext.surface && pageContext.activeDocumentId) pageContext.surface = "document";
  return hasPageContext(pageContext) ? pageContext : undefined;
}

// Layer an explicit composer selection over the implicit host/page context.
// Explicit wins: the selection's page/document/artifact refs set the active
// pointers and its command/skill families union in. Callers only invoke this
// when the selection is explicit; an absent/empty selection leaves the implicit
// page context untouched (graceful degradation to today's behavior).
function applyRunContextSelectionToPageContext(
  base: AgentPageContext | undefined,
  resolution: AgentContextSelectionResolution,
): AgentPageContext | undefined {
  if (!resolution.explicit) return base;
  const next: AgentPageContext = { ...(base ?? {}) };
  if (resolution.page?.route) next.route = resolution.page.route;
  if (resolution.page?.title) next.title = resolution.page.title;
  const selectedDocumentId = resolution.documentIds[0];
  if (selectedDocumentId) next.activeDocumentId = selectedDocumentId;
  const selectedArtifactId = resolution.artifactIds[0];
  if (selectedArtifactId) next.activeArtifactId = selectedArtifactId;
  if (resolution.activeEntity) next.activeEntity = resolution.activeEntity;
  if (resolution.commandFamilies.length > 0) {
    next.commandFamilies = [...new Set([...(next.commandFamilies ?? []), ...resolution.commandFamilies])].slice(0, PAGE_CONTEXT_LIST_MAX_ITEMS);
  }
  if (resolution.skillFamilies.length > 0) {
    next.skillFamilies = [...new Set([...(next.skillFamilies ?? []), ...resolution.skillFamilies])].slice(0, PAGE_CONTEXT_LIST_MAX_ITEMS);
  }
  return hasPageContext(next) ? next : undefined;
}

function resolveHostUiTargetContext(record: Record<string, unknown>): Pick<AgentPageContext, "hostUiTargets" | "hostUiTargetRegistry"> {
  const sanitized = sanitizeAgentHostPageContext({
    hostUiTargets: record.hostUiTargets,
    hostUiTargetRegistry: record.hostUiTargetRegistry,
  });
  return {
    ...(sanitized?.hostUiTargets ? { hostUiTargets: sanitized.hostUiTargets } : {}),
    ...(sanitized?.hostUiTargetRegistry ? { hostUiTargetRegistry: sanitized.hostUiTargetRegistry } : {}),
  };
}

function resolveActiveEntity(value: unknown): AgentPageContext["activeEntity"] | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const type = optionalRouteString(record.type, "workspace.pageContext.activeEntity.type", PAGE_CONTEXT_FIELD_MAX_CHARS);
  const id = optionalRouteString(record.id, "workspace.pageContext.activeEntity.id", PAGE_CONTEXT_FIELD_MAX_CHARS);
  const label = optionalRouteString(record.label, "workspace.pageContext.activeEntity.label", PAGE_CONTEXT_FIELD_MAX_CHARS);
  return type && id ? { type, id, ...(label ? { label } : {}) } : undefined;
}

function routeStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) return undefined;
  return value.slice(0, PAGE_CONTEXT_LIST_MAX_ITEMS).map((entry, index) => routeString(entry, `${field}[${index}]`, PAGE_CONTEXT_FIELD_MAX_CHARS)).filter(Boolean);
}

function hasPageContext(context: AgentPageContext): boolean {
  return Boolean(
    context.route ||
    context.surface ||
    context.pageType ||
    context.title ||
    context.activeEntity ||
    context.activeArtifactId ||
    context.activeDocumentId ||
    context.artifactType ||
    (context.visibleActions && context.visibleActions.length > 0) ||
    (context.skillFamilies && context.skillFamilies.length > 0) ||
    (context.commandFamilies && context.commandFamilies.length > 0) ||
    (context.hostUiTargets && context.hostUiTargets.length > 0) ||
    (context.hostUiTargetRegistry && context.hostUiTargetRegistry.targets.length > 0)
  );
}

function createConversationTitleGenerationPrompt(input: { firstUserMessage: string; fallbackTitle: string }): string {
  return [
    "CONVERSATION TITLE GENERATION:",
    "This is the first turn of a new conversation. Begin the first assistant text block with exactly one hidden title marker:",
    `${WORKSPACE_SESSION_TITLE_MARKER_PREFIX} <2-7 word conversation title>]]`,
    "Use a concise natural title based on the user's first message. Do not quote the title, do not add punctuation inside the marker, and do not mention the marker in the visible response.",
    `First user message: ${input.firstUserMessage}`,
    `If unsure, use a short variant of this fallback title: ${input.fallbackTitle}`,
  ].join("\n");
}

function readUiMessageText(message: UIMessage | undefined): string {
  if (!message || typeof message !== "object") return "";
  const parts = Array.isArray((message as { parts?: unknown }).parts) ? (message as { parts: unknown[] }).parts : [];
  const fromParts = parts
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const candidate = part as { type?: unknown; text?: unknown };
      return candidate.type === "text" && typeof candidate.text === "string" ? candidate.text : "";
    })
    .join("");
  if (fromParts.trim()) return fromParts;
  const fallback = message as unknown as { content?: unknown };
  return typeof fallback.content === "string" ? fallback.content : "";
}

function resolveFirstUserMessage(messages: UIMessage[]): string {
  const userMessage = messages.find((message) => message.role === "user") ?? messages.at(-1);
  return readUiMessageText(userMessage).trim();
}

function resolveLatestUserMessage(messages: UIMessage[]): string {
  const userMessage = [...messages].reverse().find((message) => message.role === "user") ?? messages.at(-1);
  return readUiMessageText(userMessage).trim();
}

function rejectUntrustedFileMessageParts(messages: UIMessage[]): void {
  for (const message of messages) {
    const parts = Array.isArray(message.parts) ? message.parts : [];
    if (parts.some((part) => part && typeof part === "object" && (part as { type?: unknown }).type === "file")) {
      throw new AgentUiFileError(400, "File attachments must use selected file IDs");
    }
  }
}

function shouldRequestConversationTitle(input: { session: WorkspaceSessionRecord | null; analyticsHints?: { isFirstRun?: boolean } | null; fallbackTitle: string }): boolean {
  const session = input.session;
  if (!session) return false;
  if (session.message_count > 0) return false;
  if (input.analyticsHints && input.analyticsHints.isFirstRun === false) return false;
  const name = session.name.trim();
  return isDefaultWorkspaceSessionName(name) || name === input.fallbackTitle;
}

function pipeConversationTitleGeneration(
  stream: ReadableStream<UIMessageChunk>,
  input: {
    sessionId: string;
    firstUserMessage: string;
    fallbackTitle: string;
    initialSessionName: string;
    getSession: (id: string) => Promise<WorkspaceSessionRecord | null>;
    patchSession: (id: string, patch: { name: string }) => Promise<WorkspaceSessionRecord | null>;
  },
): ReadableStream<UIMessageChunk> {
  let resolved = false;
  let buffer = "";
  let patchPromise: Promise<void> | null = null;
  let lastTextDeltaChunk: UIMessageChunk | null = null;

  function canPatchSessionName(name: string): boolean {
    const trimmed = name.trim();
    return isDefaultWorkspaceSessionName(trimmed) || trimmed === input.fallbackTitle || trimmed === input.initialSessionName.trim();
  }

  function persistTitle(title: string): void {
    if (patchPromise) return;
    patchPromise = (async () => {
      const current = await input.getSession(input.sessionId).catch(() => null);
      if (!current || !canPatchSessionName(current.name)) return;
      if (current.name.trim() === title) return;
      await input.patchSession(input.sessionId, { name: title }).catch(() => null);
    })();
  }

  function emitText(controller: TransformStreamDefaultController<UIMessageChunk>, template: UIMessageChunk | null, delta: string): void {
    if (!delta) return;
    controller.enqueue({ ...(template ?? { type: "text-delta", id: "conversation-title" }), delta } as UIMessageChunk);
  }

  function resolveBufferedText(controller: TransformStreamDefaultController<UIMessageChunk>): void {
    if (!buffer) return;
    const extracted = extractWorkspaceSessionTitleMarker(buffer, input.firstUserMessage);
    persistTitle(extracted.title);
    emitText(controller, lastTextDeltaChunk, extracted.markerFound ? extracted.visibleText : buffer);
    buffer = "";
    resolved = true;
  }

  return stream.pipeThrough(new TransformStream<UIMessageChunk, UIMessageChunk>({
    transform(chunk, controller) {
      if (resolved) {
        controller.enqueue(chunk);
        return;
      }
      if (chunk.type !== "text-delta" || typeof chunk.delta !== "string") {
        resolveBufferedText(controller);
        controller.enqueue(chunk);
        return;
      }

      lastTextDeltaChunk = chunk;
      buffer += chunk.delta;
      const extracted = extractWorkspaceSessionTitleMarker(buffer, input.firstUserMessage);
      if (extracted.markerFound) {
        resolved = true;
        persistTitle(extracted.title);
        emitText(controller, chunk, extracted.visibleText);
        return;
      }

      if (buffer.length < TITLE_GENERATION_BUFFER_MAX_CHARS && couldStartWorkspaceSessionTitleMarker(buffer)) return;

      resolved = true;
      persistTitle(input.fallbackTitle);
      emitText(controller, chunk, buffer);
      buffer = "";
    },
    async flush(controller) {
      if (!resolved && buffer) {
        resolveBufferedText(controller);
      } else if (!resolved) {
        persistTitle(input.fallbackTitle);
      }
      await patchPromise;
    },
  }));
}

function resolvePageContextSource(body: Record<string, unknown>, activeDocument: WorkspaceDocumentRecord | null): string {
  if (body.pageContext !== undefined) return "request.pageContext";
  const workspace = isRecord(body.workspace) ? body.workspace : {};
  if (workspace.pageContext !== undefined) return "workspace.pageContext";
  if (activeDocument) return "activeDocument";
  return "none";
}

function createCorrelationHeaders(input: { requestId: string; traceId: string; traceparent: string }): Record<string, string> {
  return {
    "x-sonik-request-id": input.requestId,
    "x-sonik-trace-id": input.traceId,
    traceparent: input.traceparent,
  };
}

class MalformedJsonRequestError extends Error {
  constructor(cause: unknown) {
    super("Malformed JSON request");
    this.name = "MalformedJsonRequestError";
    this.cause = cause;
  }
}

function resolveGenerateFailureStatus(error: unknown): number {
  if (error instanceof MalformedJsonRequestError) return 400;
  if (error instanceof AgentUiFileError) return error.status;
  if ((typeof error === "object" || typeof error === "function") && error !== null && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if ([400, 413].includes(Number(status))) return Number(status);
  }
  return 500;
}

function resolveGenerateFailureMessage(status: number): string {
  return status === 500 ? "Generation failed" : "Invalid request";
}

function createGenerateFailureResponse(input: {
  error: unknown;
  responseHeaders: Record<string, string>;
  runRecorder?: RunRecorder | null;
}): Response {
  const status = resolveGenerateFailureStatus(input.error);
  const typed = input.error instanceof AgentUiFileError ? input.error : null;
  const requestId = input.responseHeaders["x-sonik-request-id"];
  const traceId = input.responseHeaders["x-sonik-trace-id"];
  return new Response(
    JSON.stringify({
      ok: false,
      error: typed?.message ?? resolveGenerateFailureMessage(status),
      code: typed?.code ?? (status === 500 ? "generation_failed" : "invalid_request"),
      phase: typed?.phase ?? (status === 500 ? "post_write" : "pre_stream"),
      safeToRetry: typed?.safeToRetry ?? false,
      ...(requestId ? { requestId } : {}),
      ...(traceId ? { traceId } : {}),
    }),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        ...input.responseHeaders,
        ...(input.runRecorder ? { [AGENT_UI_RUN_ID_HEADER]: input.runRecorder.runId } : {}),
      },
    },
  );
}

async function finalizeRunFailure(runRecorder: RunRecorder | null, error: unknown): Promise<void> {
  if (!runRecorder) return;
  const failure = sanitizeRunFailure(error, { resumable: true });
  await runRecorder.finalize({ status: "failed", error: failure.message, errorCode: failure.code, resumable: true });
}

function appendFilePartsToLatestUserMessage(messages: ModelMessage[], fileParts: AgentUiModelFilePart[]): ModelMessage[] {
  if (fileParts.length === 0) return messages;
  const index = messages.findLastIndex((message) => message.role === "user");
  if (index < 0) throw new AgentUiFileError(400, "A user message is required for file attachments");
  return messages.map((message, messageIndex) => {
    if (messageIndex !== index || message.role !== "user") return message;
    const content = typeof message.content === "string" ? [{ type: "text" as const, text: message.content }] : message.content;
    return { ...message, content: [...content, ...fileParts] };
  });
}

function resolveDirectGoogleModelId(modelId: string | undefined): string {
  if (!modelId?.startsWith("google/")) throw new AgentUiFileError(400, "Selected files require a direct Google model", { code: "selected_files_require_google", phase: "pre_stream" });
  return modelId.slice("google/".length);
}

export const POST: RequestHandler = async (event) => {
  const { request } = event;
  const correlation = createTelemetryCorrelation({
    requestId: request.headers.get("x-sonik-request-id") ?? request.headers.get("x-request-id"),
    traceId: request.headers.get("x-sonik-trace-id"),
    traceparent: request.headers.get("traceparent"),
  });
  const correlationHeaders = createCorrelationHeaders(correlation);
  const responseHeaders = {
    ...correlationHeaders,
    ...createDeploymentMetadataHeaders(resolveDeploymentMetadata(event.platform)),
  };
  const requestId = correlation.requestId;
  const traceId = correlation.traceId;
  const traceparent = correlation.traceparent;
  const startedAt = Date.now();
  const ip = event.getClientAddress();
  let runRecorder: RunRecorder | null = null;
  let telemetryPersistence: ReturnType<typeof getRequestWorkspacePersistence> | null = null;
  let durableRunId: string | undefined;
  const writeRequestTelemetry = (telemetryEvent: Parameters<typeof writeAgentTelemetry>[0]) => writeAgentTelemetry(telemetryEvent, telemetryPersistence);

  try {
  const body = await request.json().catch((error) => {
    throw new MalformedJsonRequestError(error);
  });
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return createGenerateFailureResponse({ error: new AgentUiFileError(400, "Request body object is required", { code: "invalid_request", phase: "pre_stream" }), responseHeaders });
  }
  const rawRunContextSelection = body?.contextSelection ?? body?.workspace?.contextSelection;
  const parsedRunContextSelection = parseAgentRunContextSelection(rawRunContextSelection);
  const selectionResolution = resolveAgentContextSelection(parsedRunContextSelection);
  if (hasInvalidExplicitDocumentContext(rawRunContextSelection) || selectionResolution.invalidDocumentSelection) {
    return createGenerateFailureResponse({ error: new AgentUiFileError(400, "Invalid document context selection", { code: "invalid_request", phase: "pre_stream" }), responseHeaders });
  }
  const requestedWorkspaceSessionId = routeString(body?.workspace?.sessionId, "workspace.sessionId", WORKSPACE_SESSION_ID_MAX_CHARS, "") || undefined;
  const uiMessages = body.messages as UIMessage[];
  if (!Array.isArray(uiMessages) || uiMessages.length === 0) {
    return createGenerateFailureResponse({ error: new AgentUiFileError(400, "Messages array is required", { code: "invalid_request", phase: "pre_stream" }), responseHeaders });
  }
  const hasSelectedWorkspaceContext = selectionResolution.fileIds.length > 0 || selectionResolution.documentIds.length > 0;
  const trustedWorkspace = requestedWorkspaceSessionId && hasSelectedWorkspaceContext
    ? await resolveAgentUiWorkspaceSession(event, { sessionId: requestedWorkspaceSessionId, phase: "pre_stream", safeToRetry: true })
    : null;
  // Host authority is checked before the rate-limit mutation so the one
  // classified pre-stream replay cannot consume a second quota entry.
  const [minuteResult, dailyResult] = await Promise.all([
    minuteRateLimit.limit(ip),
    dailyRateLimit.limit(ip),
  ]);
  if (!minuteResult.success || !dailyResult.success) {
    const isMinuteLimit = !minuteResult.success;
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Rate limit exceeded",
        code: "rate_limit_exceeded",
        phase: "pre_stream",
        safeToRetry: false,
        requestId,
        traceId,
        message: isMinuteLimit
          ? "Too many requests. Please wait a moment before trying again."
          : "Daily limit reached. Please try again tomorrow.",
      }),
      {
        status: 429,
        headers: { "Content-Type": "application/json", ...responseHeaders },
      },
    );
  }
  const workspaceSessionId = trustedWorkspace?.sessionId ?? requestedWorkspaceSessionId;
  const requestPersistence = trustedWorkspace?.persistence ?? getRequestWorkspacePersistence(event);
  telemetryPersistence = requestPersistence;
  if (hasSelectedWorkspaceContext && !workspaceSessionId) {
    throw new AgentUiFileError(400, "Selected file and document context requires a workspace session", { code: "invalid_request", phase: "pre_stream" });
  }
  const activeDocument = await resolveActiveDocumentForRequest(event, body?.workspace?.activeDocument, hasSelectedWorkspaceContext ? workspaceSessionId : undefined);
  const telemetrySessionId = hasSelectedWorkspaceContext ? workspaceSessionId : activeDocument?.session_id ?? workspaceSessionId;
  const smokeRunId = readDevSmokeRunId(request);
  durableRunId = smokeRunId;
  const hostSession = createAgentHostSessionEnvelope(event);
  const trustedHostSession = trustedWorkspace?.auth ?? resolveTrustedHostSessionSnapshot(event);
  // Explicit composer context selection wins over implicit host/page context.
  // When the user deselected the active-document chip, includeActiveDocument is
  // false and the document is neither injected nor exposed to the agent for this
  // turn (authoritative removal at the server boundary). Absent selection keeps
  // the current implicit behavior.
  const runContextSelection: AgentRunContextSelection | undefined = parsedRunContextSelection
    ? await resolveAgentUiFileContextSelection({ selection: parsedRunContextSelection, sessionId: workspaceSessionId, auth: trustedHostSession, persistence: requestPersistence })
    : undefined;
  const authorizedSelectionResolution = resolveAgentContextSelection(runContextSelection);
  // Feed the chip-selected document's content (loaded from session-scoped
  // persistence) rather than always the request's active document, so a non-active
  // document selection actually reaches the agent. Out-of-scope ids are ignored.
  const effectiveActiveDocument = await resolveEffectiveContextDocument({
    includeActiveDocument: authorizedSelectionResolution.includeActiveDocument,
    selectedDocumentId: authorizedSelectionResolution.documentIds[0],
    requestActiveDocument: activeDocument,
    sessionId: telemetrySessionId,
    loadDocument: (id) => getRequestWorkspaceDocument(event, id),
  });
  const pageContext = applyRunContextSelectionToPageContext(
    resolveAgentPageContext(body?.pageContext ?? body?.workspace?.pageContext, { activeDocument: effectiveActiveDocument }),
    authorizedSelectionResolution,
  );
  const telemetryPageContext = sanitizePageContext(body?.pageContext ?? body?.workspace?.pageContext);
  const pageContextSource = resolvePageContextSource(body, activeDocument);
  const bookingServiceBaseUrl = env.SONIK_BOOKING_API_BASE_URL ?? env.BOOKING_SERVICE_BASE_URL ?? null;
  const bookingRuntimeFetcher = createRequestBookingRuntimeFetcher(event);
  const rawHostContextHeaderLength = request.headers.get(AGENT_UI_HOST_CONTEXT_HEADER)?.length ?? 0;
  const bookingRuntimeAuth = createBookingRuntimeAuthContextFromTrustedHostHeader({
    header: request.headers.get(AGENT_UI_HOST_CONTEXT_HEADER),
    fallback: createBookingRuntimeAuthContextFromEnv(env),
  });
  // A present-but-rejected signed host-context header (oversized/malformed)
  // silently downgrades the booking runtime to anonymous — that failure must
  // be loud in telemetry, not discovered via runtime_unavailable denials.
  const hostContextHeaderRejected = rawHostContextHeaderLength > 0 && bookingRuntimeAuth.mode !== "signed-host-context";
  const approvedCommandIds = approvedCommandIdsFromHostSession(hostSession);
  // Analytics-only run hints (entryFrom / turnIndex / isFirstRun /
  // hasExistingArtifact). Sanitized + bounded here and used ONLY for run and
  // telemetry analytics — never passed to createAgent, prompt composition, or
  // tool inputs. Absent/dropped hints reproduce today's behavior.
  const analyticsHints = sanitizeAgentAnalyticsHints(body?.analyticsHints ?? body?.workspace?.analyticsHints);

  rejectUntrustedFileMessageParts(uiMessages);

  const lastMessage = uiMessages.at(-1);
  const hasValidRegenerateTarget = body.trigger !== "regenerate-message" || typeof body.messageId === "string" && body.messageId.trim();
  const activeUserMessage = hasValidRegenerateTarget && lastMessage?.role === "user" && typeof lastMessage.id === "string" && lastMessage.id.trim()
    ? lastMessage
    : undefined;
  const firstUserMessage = resolveFirstUserMessage(uiMessages);
  const latestUserMessage = resolveLatestUserMessage(uiMessages);
  // Load the active artifact's spec up front (F2 fix, 2026-07-08): the skill-intent guard needs
  // to know whether the active artifact is a REGISTERED intake artifact (has QuestionCard
  // questions) before deciding whether to keep booking.context.intake selected, otherwise a
  // generic createJsonArtifact canvas keeps the intake skill (and submitIntakeAnswer) mounted and
  // every chat turn fails with unknown_question_id. Loaded once here and reused below for
  // currentIntakeArtifactSpec instead of a second persistence fetch.
  const activeIntakeArtifactId = pageContext?.activeArtifactId?.trim();
  let activeIntakeArtifactSpec: Spec | null = null;
  let activeArtifactIsRegisteredIntake: boolean | undefined;
  if (activeIntakeArtifactId) {
    try {
      const artifact = await requestPersistence.getArtifact<Spec>(activeIntakeArtifactId);
      activeIntakeArtifactSpec = artifact?.kind === "json-render" ? artifact.content ?? null : null;
      activeArtifactIsRegisteredIntake = activeIntakeArtifactSpec
        ? listPersistedQuestionIds(activeIntakeArtifactSpec).length > 0
        : false;
    } catch {
      // Load failure: caller can't tell, so preserve prior any-active-artifact behavior.
      activeArtifactIsRegisteredIntake = undefined;
    }
  }
  const workspaceDocumentIntent = resolveWorkspaceDocumentIntent(latestUserMessage);
  const productTourIntent = isProductTourIntent(latestUserMessage);
  const implicitSkillSelection = resolveImplicitWorkflowSkillSelection({ userMessage: latestUserMessage, pageContext, activeArtifactIsRegisteredIntake });
  const implicitSkillIds = productTourIntent ? [] : implicitSkillSelection.skillIds;
  // Phase 4 (agent-creation-tool-plan-2026-07-13.md): resolve a PUBLISHED agent
  // definition via the Task-A adapter when the request names one -- edit ->
  // publish -> next conversation uses it, zero code deploy. Optional and
  // fallback-safe: absent `publishedAgentId` (every request today), this is a
  // no-op and behavior is byte-identical to before this change. Session tweaks
  // are the RAW client-submitted settings, not pre-sanitized -- sanitizeAgentRuntimeSettings
  // always fully materializes every family with a default, so sanitizing first
  // would mask every grant the published definition sets (definitionToRuntimeSettings
  // sanitizes once, at the end, after merging the definition's defaults with
  // whatever sparse overrides the client actually sent).
  // P0 #1 (production-readiness ledger): Neon-backed when a DB env is
  // configured, in-memory fallback otherwise -- see agent-definition-store.ts.
  const requestAgentDefinitionStore = resolveAgentDefinitionStore(event.platform?.env as Record<string, unknown> | undefined);
  const publishedAgentId = typeof body?.publishedAgentId === "string" ? body.publishedAgentId : null;
  const draftAgentId = typeof body?.draftAgentId === "string" ? body.draftAgentId : null;
  const requestedAgentDefinition = Boolean(publishedAgentId || draftAgentId);
  const agentDefinitionAuthority = agentDefinitionAuthorityFromHostSession(hostSession);
  if (requestedAgentDefinition) {
    try {
      assertAgentDefinitionAuthorized(agentDefinitionAuthority, "start");
    } catch (error) {
      const message = error instanceof Error ? error.message : "agent_definition_authorization_failed";
      const forbidden = message.endsWith("_forbidden");
      throw new AgentUiFileError(forbidden ? 403 : 401, message, { code: forbidden ? "invalid_request" : "host_auth_required", phase: "pre_stream" });
    }
  }
  const publishedAgentDefinition = publishedAgentId && agentDefinitionAuthority
    ? await requestAgentDefinitionStore.resolvePublished(agentDefinitionAuthority, publishedAgentId, "start")
    : null;
  // Phase 5 workflow-builder Debug & Preview: a narrow mirror of the
  // publishedAgentId path above, resolving an unpublished DRAFT definition by
  // id so the builder can test edits before publish. Same fallback-safe null
  // handling; absent `draftAgentId` (every non-builder request), this is a
  // no-op. publishedAgentId takes precedence if a request somehow sent both.
  const draftAgentDefinition = !publishedAgentDefinition && draftAgentId && agentDefinitionAuthority
    ? (await requestAgentDefinitionStore.getDraft(agentDefinitionAuthority, draftAgentId, "start"))?.definition ?? null
    : null;
  const resolvedAgentDefinition = publishedAgentDefinition ?? draftAgentDefinition;
  const resolvedRuntimeSettings = resolvedAgentDefinition
    ? definitionToRuntimeSettings(resolvedAgentDefinition, (body?.agentSettings ?? body?.workspace?.agentSettings) as Partial<AgentRuntimeSettings> | undefined)
    : sanitizeAgentRuntimeSettings(body?.agentSettings ?? body?.workspace?.agentSettings);
  // Phase 6 gate, server-set only (sanitize drops any client-sent copy): the
  // draftWorkflow tool mounts only for builder Debug & Preview DRAFT requests.
  const agentRuntimeSettings: AgentRuntimeSettings = draftAgentDefinition
    ? { ...resolvedRuntimeSettings, workflowBuilderMode: true }
    : resolvedRuntimeSettings;
  const skillIds = productTourIntent
    ? []
    : resolveRequestSkillIds({
        requestSkillIds: [...(Array.isArray(body?.skillIds ?? body?.workspace?.skillIds) ? (body?.skillIds ?? body?.workspace?.skillIds) : []), ...agentRuntimeSettings.skillIds],
        selectedSkillFamilies: authorizedSelectionResolution.skillFamilies,
        implicitSkillIds,
      });
  // Slice E toolset stability (2026-07-08): decide + telemetry the booking command-family mount
  // once here so createAgent (below) and this turn's churn telemetry agree on the same decision.
  const commandFamilyDecision = resolveCommandFamilyMountDecision({ skillIds, toolsetContinuitySkillIds: implicitSkillSelection.continuitySkillIds, suppressCommandCatalog: productTourIntent });
  // Patch-first refinement contract (Phase 2.1): when the intake skill is active over an
  // already-active artifact, expose its current spec so the composed prompt can tell the model
  // to refine it via submitIntakeAnswer instead of regenerating it via createBookingIntakeArtifact.
  const currentIntakeArtifactSpec = hasBookingContextIntakeSkill(skillIds) ? activeIntakeArtifactSpec : null;
  const promptComposition = resolveAgentPromptComposition({ pageContext, skillIds, bookingRuntimeAuth, bookingServiceBaseUrl, agentSettings: agentRuntimeSettings, currentIntakeArtifactSpec, workspaceDocumentIntent, productTourIntent });
  const fallbackConversationTitle = firstUserMessage ? deriveWorkspaceSessionTitle(firstUserMessage) : "";
  const titleSession = workspaceSessionId ? await requestPersistence.getSession(workspaceSessionId).catch(() => null) : null;
  const titleGenerationEnabled = Boolean(
    workspaceSessionId &&
    firstUserMessage &&
    fallbackConversationTitle &&
    shouldRequestConversationTitle({ session: titleSession, analyticsHints, fallbackTitle: fallbackConversationTitle }),
  );
  const startEvent = {
    source: "server" as const,
    event: "api.generate.start",
    requestId,
    traceId,
    traceparent,
    runId: smokeRunId,
    sessionId: telemetrySessionId,
    messageId: lastMessage?.id,
    documentId: activeDocument?.id,
    documentVersion: activeDocument?.version_count,
    title: activeDocument?.title,
    ok: true,
  };
  logArtifactTelemetry(startEvent);
  void writeRequestTelemetry(startEvent).catch(() => undefined);

  const modelMessages = await convertToModelMessages(uiMessages);
  const selectedFileIds = authorizedSelectionResolution.fileIds;
  if (selectedFileIds.length > 0 && agentRuntimeSettings.requireZdr) {
    throw new AgentUiFileError(400, "Selected files are incompatible with Gateway zero-data-retention mode", { code: "selected_files_zdr_incompatible", phase: "pre_stream" });
  }
  if (selectedFileIds.length > 0 && !env.GOOGLE_GENERATIVE_AI_API_KEY) {
    throw new AgentUiFileError(503, "Google file processing is unavailable", { code: "file_processing_failed", phase: "pre_stream" });
  }
  const directGoogleModelId = selectedFileIds.length > 0 ? resolveDirectGoogleModelId(agentRuntimeSettings.modelId) : null;
  const googleDeadlineAt = selectedFileIds.length > 0 ? Date.now() + AGENT_UI_GOOGLE_PREPROCESSING_BUDGET_MS : undefined;
  const googleAbortController = selectedFileIds.length > 0 ? new AbortController() : null;
  const googleDeadlineTimer = googleAbortController ? setTimeout(() => googleAbortController.abort(), AGENT_UI_GOOGLE_PREPROCESSING_BUDGET_MS) : null;
  const google = googleAbortController
    ? createGoogle({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY, fetch: (url, init) => fetch(url, { ...init, signal: init?.signal ? AbortSignal.any([googleAbortController.signal, init.signal]) : googleAbortController.signal }) })
    : null;
  let fileParts: AgentUiModelFilePart[] = [];
  try {
    fileParts = google && workspaceSessionId
      ? await resolveGoogleAgentUiFileParts({
          fileIds: selectedFileIds,
          sessionId: workspaceSessionId,
          auth: trustedHostSession,
          persistence: requestPersistence,
          bucket: requireAgentUiFileBucket(event.platform?.env?.AGENT_UI_FILES_BUCKET as AgentUiFileBucket | undefined),
          filesApi: google.files(),
          deadlineAt: googleDeadlineAt,
          abortSignal: googleAbortController?.signal,
        })
      : [];
  } finally {
    if (googleDeadlineTimer) clearTimeout(googleDeadlineTimer);
  }
  const messagesWithFiles = appendFilePartsToLatestUserMessage(modelMessages, fileParts);
  const contextSummary = summarizeWorkspaceContext({ activeDocument: effectiveActiveDocument });
  const includeStartupIndexes = !productTourIntent;
  const commandIndexSummary = includeStartupIndexes
    ? createStandaloneCommandIndexSummary({ includeApprovalRequired: true, includeHostRuntime: true, hostSession: hostSession ?? undefined, hostSessionMode: hostSession ? undefined : "standalone-demo", sessionId: telemetrySessionId, pageContext, bookingServiceBaseUrl, bookingRuntimeAuth, approvedCommandIds, toolPermissionModes: agentRuntimeSettings.toolPermissionModes })
    : "";
  const skillIndexSummary = includeStartupIndexes
    ? createRuntimeSkillIndexSummary({
        ...pageContext,
        authenticated: hostSession?.authenticated,
        organizationId: hostSession?.organizationId,
        scopes: hostSession?.scopes,
      })
    : "";
  const trustedOrganizationDisplay = resolveSignedTrustedOrganizationDisplayFromRequest(event);
  const pageContextSummary = createCurrentPageContextSummary({ context: pageContext, trustedOrganizationDisplay, productTourIntent });
  const conversationTitlePrompt = titleGenerationEnabled
    ? createConversationTitleGenerationPrompt({ firstUserMessage, fallbackTitle: fallbackConversationTitle })
    : "";
  const agentSettingsSummary = summarizeAgentRuntimeSettings(agentRuntimeSettings);
  const startupIndexContext = includeStartupIndexes
    ? [`CONTEXT-RELEVANT SKILL STARTUP INDEX:\n${skillIndexSummary}`, `CONTRACT-DERIVED COMMAND STARTUP INDEX:\n${commandIndexSummary}`]
    : [];
  // Knowledge v1 read-side (AC-10, verify-wave fix): a resolved definition's
  // knowledgeRefs are read from the file store and folded into system context
  // so the live agent actually answers from attached info.
  const knowledgeContext = resolvedAgentDefinition?.knowledgeRefs?.length
    ? formatKnowledgeContextSections(await resolveKnowledgeContext(resolvedAgentDefinition.knowledgeRefs, { rootDir: defaultKnowledgeRoot(), env: event.platform?.env as Record<string, unknown> | undefined }))
    : "";
  const systemContext = [contextSummary, pageContextSummary, agentSettingsSummary, knowledgeContext, conversationTitlePrompt, ...startupIndexContext, PRODUCT_OUTPUT_INVARIANT].filter(Boolean).join("\n\n");
  const contextualModelMessages = systemContext
    ? [{ role: "system" as const, content: systemContext }, ...messagesWithFiles]
    : messagesWithFiles;
  void writeRequestTelemetry({
    source: "server",
    event: "api.generate.command_index_context",
    requestId,
    traceId,
    traceparent,
    runId: smokeRunId,
    sessionId: telemetrySessionId,
    messageId: lastMessage?.id,
    elementCount: commandIndexSummary ? commandIndexSummary.split("\n- ").length - 1 : 0,
    surface: pageContext?.surface,
    route: pageContext?.route,
    commandFamilies: pageContext?.commandFamilies,
    skillFamilies: pageContext?.skillFamilies,
    contextSource: pageContextSource,
    pageContext: telemetryPageContext,
    payload: {
      bookingRuntimeAuthMode: bookingRuntimeAuth.mode,
      bookingRuntimeCredentialed: hasBookingRuntimeCredential(bookingRuntimeAuth),
      hostContextHeaderLength: rawHostContextHeaderLength,
      hostContextHeaderRejected,
      hostSessionSource: hostSession?.source ?? null,
      approvedCommandCount: approvedCommandIds.length,
      // Slice E toolset stability (2026-07-08): whether the booking command family was mounted
      // this turn, and whether the continuity rule averted a churn (it would have been dropped
      // without the rule). commandFamilyChurnAverted true == a "commands gone -> back" flicker
      // the user did NOT see because a preview-only skill was carried over by continuity only.
      commandFamilyMounted: commandFamilyDecision.mounted,
      commandFamilyChurnAverted: commandFamilyDecision.mounted && !commandFamilyDecision.wouldMountWithoutStability,
      // Analytics-only run hints, stamped onto the run telemetry / Pipe-B so a
      // session's run sequence is queryable. Never influences behavior.
      analyticsHints: analyticsHints ?? null,
      agentSettings: agentRuntimeSettings,
      workspaceDocumentIntent,
    },
    ok: true,
  }).catch(() => undefined);
  if (hostContextHeaderRejected) {
    void writeRequestTelemetry({
      source: "server",
      event: "api.generate.host_context_header_rejected",
      requestId,
      traceId,
      traceparent,
      sessionId: telemetrySessionId,
      payload: { headerLength: rawHostContextHeaderLength, fallbackAuthMode: bookingRuntimeAuth.mode },
      ok: false,
      reason: "signed_host_context_header_present_but_rejected",
    }).catch(() => undefined);
  }
  void writeRequestTelemetry({
    source: "server",
    event: "api.generate.skill_index_context",
    requestId,
    traceId,
    traceparent,
    runId: smokeRunId,
    sessionId: telemetrySessionId,
    messageId: lastMessage?.id,
    elementCount: skillIndexSummary ? skillIndexSummary.split("\n- ").length - 1 : 0,
    surface: pageContext?.surface,
    route: pageContext?.route,
    commandFamilies: pageContext?.commandFamilies,
    skillFamilies: pageContext?.skillFamilies,
    contextSource: pageContextSource,
    pageContext: telemetryPageContext,
    ok: true,
  }).catch(() => undefined);
  // A run is one persisted, resumable agent turn. Requests without a session keep
  // the existing non-persisted stream; session-backed turns fail before model
  // execution if the durable run cannot be created.
  if (telemetrySessionId) {
    await persistInitiatingUserMessage({ persistence: requestPersistence, sessionId: telemetrySessionId, message: activeUserMessage });
    runRecorder = await startRunRecorder(requestPersistence, {
      sessionId: telemetrySessionId,
      userMessageId: activeUserMessage?.id ?? null,
      correlation,
      contextSelection: runContextSelection ?? null,
      promptComposition: { moduleIds: promptComposition.moduleIds, skillIds: promptComposition.skillIds, implicitSkillIds },
      analyticsHints: analyticsHints ?? null,
    });
  }
  durableRunId = runRecorder?.runId ?? smokeRunId;
  await writeRequestTelemetry({
    source: "server",
    event: "api.generate.run_started",
    requestId,
    traceId,
    traceparent,
    runId: durableRunId,
    sessionId: telemetrySessionId,
    messageId: lastMessage?.id,
    ok: true,
  });

  if (shouldUseDevSmokeStream(request)) {
    const smokeInput = {
      requestId,
      traceId,
      traceparent,
      runId: durableRunId,
      sessionId: telemetrySessionId,
      messageId: lastMessage?.id,
      startedAt,
      failMode: readDevSmokeFailMode(request),
      scenario: readDevSmokeScenario(request),
    };
    await writeDevSmokeStreamTelemetry(smokeInput);
    const smokeStream = createDevSmokeStream(smokeInput);
    const titledSmokeStream = titleGenerationEnabled && workspaceSessionId && titleSession
      ? pipeConversationTitleGeneration(smokeStream, {
          sessionId: workspaceSessionId,
          firstUserMessage,
          fallbackTitle: fallbackConversationTitle,
          initialSessionName: titleSession.name,
          getSession: (id) => requestPersistence.getSession(id),
          patchSession: (id, patch) => requestPersistence.patchSession(id, patch),
        })
      : smokeStream;
    const response = createUIMessageStreamResponse({
      stream: runRecorder ? teeRunEvents(titledSmokeStream, runRecorder) : titledSmokeStream,
    });
    for (const [key, value] of Object.entries(responseHeaders)) response.headers.set(key, value);
    if (runRecorder) response.headers.set(AGENT_UI_RUN_ID_HEADER, runRecorder.runId);
    return response;
  }

  const agent = createAgent({ activeDocument: effectiveActiveDocument, sessionId: telemetrySessionId, pageContext, hostSession, approvedCommandIds, bookingServiceBaseUrl, bookingRuntimeAuth, bookingRuntimeFetcher, persistence: requestPersistence, skillIds, agentSettings: agentRuntimeSettings, currentIntakeArtifactSpec, toolsetContinuitySkillIds: implicitSkillSelection.continuitySkillIds, workspaceDocumentIntent, productTourIntent, model: google && directGoogleModelId ? google(directGoogleModelId) : undefined, aiTelemetry: { requestId, traceId, traceparent, sessionId: telemetrySessionId, runId: durableRunId } });

  try {
    const result = await agent.stream({ messages: contextualModelMessages });

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        const parsedStream = tapSpecStreamForTelemetry(
          pipeJsonRender<UIMessageChunk>(result.toUIMessageStream()),
          {
            requestId,
            traceId,
            traceparent,
            runId: durableRunId,
            sessionId: telemetrySessionId,
            messageId: lastMessage?.id,
            documentId: activeDocument?.id,
            documentVersion: activeDocument?.version_count,
            startedAt,
          },
        );
        const aiStream = pipeUiMessageStreamSafety(
          pipeArtifactToolOutputsToSpecParts(parsedStream),
          {
            onStats: (stats) => {
              void writeRequestTelemetry({
                source: "server",
                event: "api.generate.stream_safety",
                requestId,
                traceId,
                traceparent,
                runId: durableRunId,
                sessionId: telemetrySessionId,
                messageId: lastMessage?.id,
                durationMs: Date.now() - startedAt,
                ok: true,
                reason: "stream_safety_filter_applied",
                payload: {
                  textDeltaChunksIn: stats.textDeltaChunksIn,
                  textDeltaChunksOut: stats.textDeltaChunksOut,
                  textDeltaCharsOut: stats.textDeltaCharsOut,
                },
              }).catch(() => undefined);
            },
          },
        );
        const titleStream = titleGenerationEnabled && workspaceSessionId && titleSession
          ? pipeConversationTitleGeneration(aiStream, {
              sessionId: workspaceSessionId,
              firstUserMessage,
              fallbackTitle: fallbackConversationTitle,
              initialSessionName: titleSession.name,
              getSession: (id) => requestPersistence.getSession(id),
              patchSession: (id, patch) => requestPersistence.patchSession(id, patch),
            })
          : aiStream;
        const instrumented = instrumentGenerateStream(titleStream, {
          requestId,
          traceId,
          traceparent,
          runId: durableRunId,
          sessionId: telemetrySessionId,
          messageId: lastMessage?.id,
          documentId: activeDocument?.id,
          documentVersion: activeDocument?.version_count,
          startedAt,
          waitingMs: 10_000,
          waitingIntervalMs: 20_000,
        });
        writer.merge(instrumented as ReadableStream<UIMessageChunk>);
        void writeRequestTelemetry({
          source: "server",
          event: "api.generate.stream_attached",
          requestId,
          traceId,
          traceparent,
          runId: durableRunId,
          sessionId: telemetrySessionId,
          messageId: lastMessage?.id,
          documentId: activeDocument?.id,
          documentVersion: activeDocument?.version_count,
          durationMs: Date.now() - startedAt,
          ok: true,
        }).catch(() => undefined);
      },
      onError: (error) => {
        const failure = sanitizeRunFailure(error, { fallbackCode: "AGENT_STREAM_FAILED", resumable: true });
        void writeRequestTelemetry({
          source: "server",
          event: "api.generate.stream_error",
          requestId,
          traceId,
          traceparent,
          runId: durableRunId,
          sessionId: telemetrySessionId,
          messageId: lastMessage?.id,
          durationMs: Date.now() - startedAt,
          ok: false,
          error: failure.message,
        }).catch(() => undefined);
        return "Generation failed";
      },
    });

    const response = createUIMessageStreamResponse({ stream: runRecorder ? teeRunEvents(stream, runRecorder) : stream });
    for (const [key, value] of Object.entries(responseHeaders)) response.headers.set(key, value);
    if (runRecorder) response.headers.set(AGENT_UI_RUN_ID_HEADER, runRecorder.runId);
    return response;
  } catch (error) {
    const failure = sanitizeRunFailure(error, { resumable: true });
    await finalizeRunFailure(runRecorder, error);
    void writeRequestTelemetry({
      source: "server",
      event: "api.generate.error",
      requestId,
      traceId,
      traceparent,
      runId: durableRunId,
      sessionId: telemetrySessionId,
      messageId: lastMessage?.id,
      durationMs: Date.now() - startedAt,
      ok: false,
      error: failure.message,
    }).catch(() => undefined);
    return createGenerateFailureResponse({ error, responseHeaders, runRecorder });
  }
  } catch (error) {
    const failure = sanitizeRunFailure(error, { resumable: true });
    await finalizeRunFailure(runRecorder, error);
    void writeRequestTelemetry({
      source: "server",
      event: "api.generate.error",
      requestId,
      traceId,
      traceparent,
      runId: durableRunId,
      durationMs: Date.now() - startedAt,
      ok: false,
      error: failure.message,
    }).catch(() => undefined);
    return createGenerateFailureResponse({ error, responseHeaders, runRecorder });
  }
};

async function resolveActiveDocumentForRequest(event: RequestEvent, value: unknown, sessionId?: string): Promise<WorkspaceDocumentRecord | null> {
  const snapshot = _resolveActiveDocument(value, { sync: false });
  if (!snapshot?.id) return snapshot;
  if (!sessionId) return syncRequestActiveWorkspaceDocumentSnapshot(event, snapshot);
  return syncSessionContextDocument({
    document: snapshot,
    sessionId,
    loadDocument: (id) => getRequestWorkspaceDocument(event, id),
    syncDocument: (document) => syncRequestActiveWorkspaceDocumentSnapshot(event, document),
  });
}

export function _resolveActiveDocument(value: unknown, options: { sync?: boolean } = {}): WorkspaceDocumentRecord | null {
  if (!isRecord(value)) return null;
  const id = routeString(value.id, "workspace.activeDocument.id", WORKSPACE_SESSION_ID_MAX_CHARS, "");
  if (typeof value.title !== "string" || typeof value.current_content !== "string") return null;

  const snapshot: WorkspaceDocumentRecord = {
    id: id || "active-document",
    session_id: routeString(value.session_id, "workspace.activeDocument.session_id", WORKSPACE_SESSION_ID_MAX_CHARS, "") || null,
    title: routeString(value.title, "workspace.activeDocument.title", WORKSPACE_TITLE_MAX_CHARS),
    language: routeString(value.language, "workspace.activeDocument.language", WORKSPACE_LANGUAGE_MAX_CHARS, "markdown"),
    current_content: routeString(value.current_content, "workspace.activeDocument.current_content", WORKSPACE_CONTENT_MAX_CHARS),
    version_count: typeof value.version_count === "number" ? value.version_count : 1,
    is_active: true,
    archived: false,
    created_at: typeof value.created_at === "string" ? value.created_at : new Date().toISOString(),
    updated_at: typeof value.updated_at === "string" ? value.updated_at : new Date().toISOString(),
  };

  return snapshot;
}

function summarizeWorkspaceContext(input: { activeDocument?: WorkspaceDocumentRecord | null; maxChars?: number } = {}): string | null {
  const document = input.activeDocument;
  if (!document) return null;
  const maxChars = input.maxChars ?? 3000;
  const content = document.current_content.length > maxChars
    ? `${document.current_content.slice(0, maxChars)}\n... (${document.current_content.length} chars total)`
    : document.current_content;
  return [
    "Active Workspace/Sonik document context:",
    `- id: ${document.id}`,
    `- title: ${document.title}`,
    `- language: ${document.language}`,
    `- version: ${document.version_count}`,
    "Document content:",
    "```" + document.language,
    content,
    "```",
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

import { env } from "$env/dynamic/private";
import { createAgent, resolveAgentPromptComposition } from "$lib/agent";
import { minuteRateLimit, dailyRateLimit } from "$lib/rate-limit";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { pipeJsonRender, pipeUiMessageStreamSafety } from "@json-render/core";
import { pipeArtifactToolOutputsToSpecParts } from "$lib/artifacts/artifact-stream";
import { logArtifactTelemetry } from "$lib/artifacts/artifact-telemetry";
import { writeAgentTelemetry } from "$lib/server/agent-telemetry";
import { createTelemetryCorrelation, sanitizePageContext } from "@sonik-agent-ui/agent-observability";
import { classifyRunErrorCode, sanitizeAgentAnalyticsHints } from "@sonik-agent-ui/tool-contracts";
import {
  parseAgentRunContextSelection,
  resolveAgentContextSelection,
  type AgentContextSelectionResolution,
  type AgentRunContextSelection,
} from "@sonik-agent-ui/tool-contracts/run-context";
import { instrumentGenerateStream } from "$lib/server/stream-telemetry";
import { createDevSmokeStream, readDevSmokeFailMode, readDevSmokeRunId, readDevSmokeScenario, shouldUseDevSmokeStream, writeDevSmokeStreamTelemetry } from "$lib/server/dev-smoke-stream";
import { startRunRecorder, teeRunEvents, type RunRecorder } from "$lib/server/run-event-log";
import { getRequestWorkspaceDocument, getRequestWorkspacePersistence, syncRequestActiveWorkspaceDocumentSnapshot, type WorkspaceDocumentRecord, type WorkspaceSessionRecord } from "$lib/server/workspace-request-store";
import { resolveEffectiveContextDocument } from "$lib/server/run-context-document";
import { createStandaloneCommandIndexSummary } from "$lib/server/tool-manifest";
import { createRuntimeSkillIndexSummary } from "$lib/server/skill-registry";
import {
  createBookingRuntimeAuthContextFromEnv,
  createBookingRuntimeAuthContextFromTrustedHostHeader,
  hasBookingRuntimeCredential,
} from "$lib/server/host-command-runtime";
import { AGENT_UI_HOST_CONTEXT_HEADER, resolveTrustedHostSessionSnapshot } from "$lib/server/workspace-services";
import type { HostSessionEnvelope } from "@sonik-agent-ui/platform-adapters";
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
const APPROVED_COMMAND_IDS_MAX_ITEMS = 128;
const AGENT_SKILL_IDS_MAX_ITEMS = 8;
const AGENT_SKILL_ID_MAX_CHARS = 160;
const AGENT_UI_RUN_ID_HEADER = "x-sonik-agent-ui-run-id";
const TITLE_GENERATION_BUFFER_MAX_CHARS = 320;

// Per-turn skill ids: donor-style `ChatRequest.skillIds` on the request, unioned
// with the explicit runtime-skill composer chips for this turn. Sourced only from
// EXPLICIT selection (never implicit page-context skill families) so a default
// turn composes exactly today's monolith-equivalent prompt with no appended
// skills. Bounded in count and length; resolved through the skill registry.
function resolveRequestSkillIds(input: { requestSkillIds: unknown; selectedSkillFamilies: string[] }): string[] {
  const fromRequest = Array.isArray(input.requestSkillIds)
    ? input.requestSkillIds
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0 && entry.length <= AGENT_SKILL_ID_MAX_CHARS)
    : [];
  return [...new Set([...fromRequest, ...input.selectedSkillFamilies])].slice(0, AGENT_SKILL_IDS_MAX_ITEMS);
}


function createServiceBindingFetcher(binding: unknown): typeof fetch | undefined {
  if (!binding || typeof binding !== "object") return undefined;
  const candidate = binding as { fetch?: typeof fetch };
  if (typeof candidate.fetch !== "function") return undefined;
  const bindingFetch = candidate.fetch.bind(candidate);
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => bindingFetch(input, init)) as typeof fetch;
}

function createAgentHostSessionEnvelope(event: RequestEvent): HostSessionEnvelope | null {
  const snapshot = resolveTrustedHostSessionSnapshot(event);
  if (!snapshot.authenticated || !snapshot.organizationId) return null;
  return {
    source: "amplify-embedded",
    sessionId: snapshot.sessionId ?? null,
    userId: snapshot.userId ?? null,
    principalId: snapshot.principalId ?? snapshot.userId ?? null,
    organizationId: snapshot.organizationId,
    authenticated: true,
    scopes: snapshot.scopes ?? [],
    expiresAt: snapshot.expiresAt ?? null,
    metadata: snapshot.metadata,
  };
}

function approvedCommandIdsFromHostSession(hostSession: HostSessionEnvelope | null): string[] {
  const value = hostSession?.metadata?.approvedCommandIds;
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        .map((entry) => entry.trim()),
    ),
  ].slice(0, APPROVED_COMMAND_IDS_MAX_ITEMS);
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
  if (resolution.commandFamilies.length > 0) {
    next.commandFamilies = [...new Set([...(next.commandFamilies ?? []), ...resolution.commandFamilies])].slice(0, PAGE_CONTEXT_LIST_MAX_ITEMS);
  }
  if (resolution.skillFamilies.length > 0) {
    next.skillFamilies = [...new Set([...(next.skillFamilies ?? []), ...resolution.skillFamilies])].slice(0, PAGE_CONTEXT_LIST_MAX_ITEMS);
  }
  return hasPageContext(next) ? next : undefined;
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
    (context.commandFamilies && context.commandFamilies.length > 0)
  );
}

function createCurrentPageContextSummary(context: AgentPageContext | undefined): string {
  if (!context) return "";
  const lines = ["CURRENT HOST/PAGE CONTEXT:"];
  if (context.title) lines.push(`- title: ${context.title}`);
  if (context.route) lines.push(`- route: ${context.route}`);
  if (context.surface) lines.push(`- surface: ${context.surface}`);
  if (context.pageType) lines.push(`- pageType: ${context.pageType}`);
  if (context.activeEntity) {
    lines.push(`- activeEntity: ${context.activeEntity.type} ${context.activeEntity.label ?? context.activeEntity.id} (${context.activeEntity.id})`);
  }
  if (context.commandFamilies?.length) lines.push(`- commandFamilies: ${context.commandFamilies.join(", ")}`);
  if (context.skillFamilies?.length) lines.push(`- skillFamilies: ${context.skillFamilies.join(", ")}`);
  if (context.visibleActions?.length) lines.push(`- visibleActions: ${context.visibleActions.join(", ")}`);
  lines.push("If the user asks where they are, what page this is, or what context is attached, answer directly from this block. Do not create an artifact or dashboard unless the user explicitly asks for one.");
  return lines.join("\n");
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

export const POST: RequestHandler = async (event) => {
  const { request } = event;
  const correlation = createTelemetryCorrelation({
    requestId: request.headers.get("x-sonik-request-id") ?? request.headers.get("x-request-id"),
    traceId: request.headers.get("x-sonik-trace-id"),
    traceparent: request.headers.get("traceparent"),
  });
  const correlationHeaders = createCorrelationHeaders(correlation);
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0] ?? "anonymous";

  const [minuteResult, dailyResult] = await Promise.all([
    minuteRateLimit.limit(ip),
    dailyRateLimit.limit(ip),
  ]);

  if (!minuteResult.success || !dailyResult.success) {
    const isMinuteLimit = !minuteResult.success;
    return new Response(
      JSON.stringify({
        error: "Rate limit exceeded",
        message: isMinuteLimit
          ? "Too many requests. Please wait a moment before trying again."
          : "Daily limit reached. Please try again tomorrow.",
      }),
      {
        status: 429,
        headers: { "Content-Type": "application/json", ...correlationHeaders },
      },
    );
  }

  const body = await request.json();
  const uiMessages: UIMessage[] = body.messages;
  const requestPersistence = getRequestWorkspacePersistence(event);
  const activeDocument = await resolveActiveDocumentForRequest(event, body?.workspace?.activeDocument);
  const requestId = correlation.requestId;
  const traceId = correlation.traceId;
  const traceparent = correlation.traceparent;
  const workspaceSessionId = routeString(body?.workspace?.sessionId, "workspace.sessionId", WORKSPACE_SESSION_ID_MAX_CHARS, "") || undefined;
  const telemetrySessionId = activeDocument?.session_id ?? workspaceSessionId;
  const smokeRunId = readDevSmokeRunId(request);
  // Explicit composer context selection wins over implicit host/page context.
  // When the user deselected the active-document chip, includeActiveDocument is
  // false and the document is neither injected nor exposed to the agent for this
  // turn (authoritative removal at the server boundary). Absent selection keeps
  // the current implicit behavior.
  const runContextSelection: AgentRunContextSelection | undefined = parseAgentRunContextSelection(body?.contextSelection ?? body?.workspace?.contextSelection);
  const selectionResolution = resolveAgentContextSelection(runContextSelection);
  // Feed the chip-selected document's content (loaded from session-scoped
  // persistence) rather than always the request's active document, so a non-active
  // document selection actually reaches the agent. Out-of-scope ids are ignored.
  const effectiveActiveDocument = await resolveEffectiveContextDocument({
    includeActiveDocument: selectionResolution.includeActiveDocument,
    selectedDocumentId: selectionResolution.documentIds[0],
    requestActiveDocument: activeDocument,
    sessionId: telemetrySessionId,
    loadDocument: (id) => getRequestWorkspaceDocument(event, id),
  });
  const pageContext = applyRunContextSelectionToPageContext(
    resolveAgentPageContext(body?.pageContext ?? body?.workspace?.pageContext, { activeDocument: effectiveActiveDocument }),
    selectionResolution,
  );
  const telemetryPageContext = sanitizePageContext(body?.pageContext ?? body?.workspace?.pageContext);
  const pageContextSource = resolvePageContextSource(body, activeDocument);
  const bookingServiceBaseUrl = env.SONIK_BOOKING_API_BASE_URL ?? env.BOOKING_SERVICE_BASE_URL ?? null;
  const bookingRuntimeFetcher = createServiceBindingFetcher(event.platform?.env?.BOOKING_SERVICE);
  const bookingRuntimeAuth = createBookingRuntimeAuthContextFromTrustedHostHeader({
    header: request.headers.get(AGENT_UI_HOST_CONTEXT_HEADER),
    fallback: createBookingRuntimeAuthContextFromEnv(env),
  });
  const hostSession = createAgentHostSessionEnvelope(event);
  const approvedCommandIds = approvedCommandIdsFromHostSession(hostSession);
  const skillIds = resolveRequestSkillIds({
    requestSkillIds: body?.skillIds ?? body?.workspace?.skillIds,
    selectedSkillFamilies: selectionResolution.skillFamilies,
  });
  // Analytics-only run hints (entryFrom / turnIndex / isFirstRun /
  // hasExistingArtifact). Sanitized + bounded here and used ONLY for run and
  // telemetry analytics — never passed to createAgent, prompt composition, or
  // tool inputs. Absent/dropped hints reproduce today's behavior.
  const analyticsHints = sanitizeAgentAnalyticsHints(body?.analyticsHints ?? body?.workspace?.analyticsHints);
  // Compose the per-turn prompt once so the same module/skill ids we record on
  // the run are the ones createAgent seeds below (deterministic for this context).
  const promptComposition = resolveAgentPromptComposition({ pageContext, skillIds, bookingRuntimeAuth, bookingServiceBaseUrl });
  const startedAt = Date.now();

  if (!uiMessages || !Array.isArray(uiMessages) || uiMessages.length === 0) {
    return new Response(
      JSON.stringify({ error: "messages array is required" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json", ...correlationHeaders },
      },
    );
  }

  const lastMessage = uiMessages.at(-1);
  const firstUserMessage = resolveFirstUserMessage(uiMessages);
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
  void writeAgentTelemetry(startEvent).catch(() => undefined);

  const modelMessages = await convertToModelMessages(uiMessages);
  const contextSummary = summarizeWorkspaceContext({ activeDocument: effectiveActiveDocument });
  const commandIndexSummary = createStandaloneCommandIndexSummary({ includeApprovalRequired: true, includeHostRuntime: true, hostSession: hostSession ?? undefined, hostSessionMode: hostSession ? undefined : "standalone-demo", sessionId: telemetrySessionId, pageContext, bookingServiceBaseUrl, bookingRuntimeAuth });
  const skillIndexSummary = createRuntimeSkillIndexSummary({
    ...pageContext,
    authenticated: hostSession?.authenticated,
    organizationId: hostSession?.organizationId,
    scopes: hostSession?.scopes,
  });
  const pageContextSummary = createCurrentPageContextSummary(pageContext);
  const conversationTitlePrompt = titleGenerationEnabled
    ? createConversationTitleGenerationPrompt({ firstUserMessage, fallbackTitle: fallbackConversationTitle })
    : "";
  const systemContext = [contextSummary, pageContextSummary, conversationTitlePrompt, `CONTEXT-RELEVANT SKILL STARTUP INDEX:\n${skillIndexSummary}`, `CONTRACT-DERIVED COMMAND STARTUP INDEX:\n${commandIndexSummary}`].filter(Boolean).join("\n\n");
  const contextualModelMessages = systemContext
    ? [{ role: "system" as const, content: systemContext }, ...modelMessages]
    : modelMessages;
  void writeAgentTelemetry({
    source: "server",
    event: "api.generate.command_index_context",
    requestId,
    traceId,
    traceparent,
    runId: smokeRunId,
    sessionId: telemetrySessionId,
    messageId: lastMessage?.id,
    elementCount: commandIndexSummary.split("\n- ").length - 1,
    surface: pageContext?.surface,
    route: pageContext?.route,
    commandFamilies: pageContext?.commandFamilies,
    skillFamilies: pageContext?.skillFamilies,
    contextSource: pageContextSource,
    pageContext: telemetryPageContext,
    payload: {
      bookingRuntimeAuthMode: bookingRuntimeAuth.mode,
      bookingRuntimeCredentialed: hasBookingRuntimeCredential(bookingRuntimeAuth),
      hostSessionSource: hostSession?.source ?? null,
      approvedCommandCount: approvedCommandIds.length,
      // Analytics-only run hints, stamped onto the run telemetry / Pipe-B so a
      // session's run sequence is queryable. Never influences behavior.
      analyticsHints: analyticsHints ?? null,
    },
    ok: true,
  }).catch(() => undefined);
  void writeAgentTelemetry({
    source: "server",
    event: "api.generate.skill_index_context",
    requestId,
    traceId,
    traceparent,
    runId: smokeRunId,
    sessionId: telemetrySessionId,
    messageId: lastMessage?.id,
    elementCount: skillIndexSummary.split("\n- ").length - 1,
    surface: pageContext?.surface,
    route: pageContext?.route,
    commandFamilies: pageContext?.commandFamilies,
    skillFamilies: pageContext?.skillFamilies,
    contextSource: pageContextSource,
    pageContext: telemetryPageContext,
    ok: true,
  }).catch(() => undefined);
  // A run is one persisted, resumable agent turn. Requires a session to key the
  // run to; without one (or when cloud persistence lacks host context) the
  // recorder is null and we degrade to the existing non-persisted streaming.
  const runRecorder: RunRecorder | null = telemetrySessionId
    ? await startRunRecorder(requestPersistence, {
        sessionId: telemetrySessionId,
        messageId: null,
        correlation,
        contextSelection: runContextSelection ?? null,
        promptComposition: { moduleIds: promptComposition.moduleIds, skillIds: promptComposition.skillIds },
        analyticsHints: analyticsHints ?? null,
      })
    : null;

  if (shouldUseDevSmokeStream(request)) {
    const smokeInput = {
      requestId,
      traceId,
      traceparent,
      runId: smokeRunId,
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
    for (const [key, value] of Object.entries(correlationHeaders)) response.headers.set(key, value);
    if (runRecorder) response.headers.set(AGENT_UI_RUN_ID_HEADER, runRecorder.runId);
    return response;
  }

  const agent = createAgent({ activeDocument: effectiveActiveDocument, sessionId: telemetrySessionId, pageContext, hostSession, approvedCommandIds, bookingServiceBaseUrl, bookingRuntimeAuth, bookingRuntimeFetcher, persistence: requestPersistence, skillIds });

  try {
    const result = await agent.stream({ messages: contextualModelMessages });

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        const parsedStream = pipeJsonRender<UIMessageChunk>(result.toUIMessageStream());
        const aiStream = pipeUiMessageStreamSafety(
          pipeArtifactToolOutputsToSpecParts(parsedStream),
          {
            onStats: (stats) => {
              void writeAgentTelemetry({
                source: "server",
                event: "api.generate.stream_safety",
                requestId,
                traceId,
                traceparent,
                runId: smokeRunId,
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
          runId: smokeRunId,
          sessionId: telemetrySessionId,
          messageId: lastMessage?.id,
          documentId: activeDocument?.id,
          documentVersion: activeDocument?.version_count,
          startedAt,
          waitingMs: 10_000,
          waitingIntervalMs: 20_000,
        });
        writer.merge((runRecorder ? teeRunEvents(instrumented, runRecorder) : instrumented) as ReadableStream<UIMessageChunk>);
        void writeAgentTelemetry({
          source: "server",
          event: "api.generate.stream_attached",
          requestId,
          traceId,
          traceparent,
          runId: smokeRunId,
          sessionId: telemetrySessionId,
          messageId: lastMessage?.id,
          documentId: activeDocument?.id,
          documentVersion: activeDocument?.version_count,
          durationMs: Date.now() - startedAt,
          ok: true,
        }).catch(() => undefined);
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        void runRecorder?.finalize({ status: "failed", error: message, errorCode: classifyRunErrorCode({ message }), resumable: true });
        void writeAgentTelemetry({
          source: "server",
          event: "api.generate.stream_error",
          requestId,
          traceId,
          traceparent,
          runId: smokeRunId,
          sessionId: telemetrySessionId,
          messageId: lastMessage?.id,
          durationMs: Date.now() - startedAt,
          ok: false,
          error: message,
        }).catch(() => undefined);
        return message;
      },
    });

    const response = createUIMessageStreamResponse({ stream });
    for (const [key, value] of Object.entries(correlationHeaders)) response.headers.set(key, value);
    if (runRecorder) response.headers.set(AGENT_UI_RUN_ID_HEADER, runRecorder.runId);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void runRecorder?.finalize({ status: "failed", error: message, errorCode: classifyRunErrorCode({ message }), resumable: true });
    void writeAgentTelemetry({
      source: "server",
      event: "api.generate.error",
      requestId,
      traceId,
      traceparent,
      runId: smokeRunId,
      sessionId: telemetrySessionId,
      messageId: lastMessage?.id,
      durationMs: Date.now() - startedAt,
      ok: false,
      error: message,
    }).catch(() => undefined);
    throw error;
  }
};


async function resolveActiveDocumentForRequest(event: RequestEvent, value: unknown): Promise<WorkspaceDocumentRecord | null> {
  const snapshot = _resolveActiveDocument(value, { sync: false });
  return snapshot?.id ? syncRequestActiveWorkspaceDocumentSnapshot(event, snapshot) : snapshot;
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

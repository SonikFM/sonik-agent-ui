import { createAgent } from "$lib/agent";
import { minuteRateLimit, dailyRateLimit } from "$lib/rate-limit";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from "ai";
import { pipeJsonRender } from "@json-render/core";
import { pipeArtifactToolOutputsToSpecParts } from "$lib/artifacts/artifact-stream";
import { logArtifactTelemetry } from "$lib/artifacts/artifact-telemetry";
import { writeAgentTelemetry } from "$lib/server/agent-telemetry";
import { createTelemetryCorrelation, sanitizePageContext } from "@sonik-agent-ui/agent-observability";
import { instrumentGenerateStream } from "$lib/server/stream-telemetry";
import { createDevSmokeStream, readDevSmokeRunId, shouldUseDevSmokeStream, writeDevSmokeStreamTelemetry } from "$lib/server/dev-smoke-stream";
import { summarizeWorkspaceContext, syncActiveWorkspaceDocumentSnapshot, type WorkspaceDocumentRecord } from "$lib/server/workspace-store";
import { createStandaloneCommandIndexSummary } from "$lib/server/tool-manifest";
import type { AgentPageContext } from "@sonik-agent-ui/tool-contracts";
import {
  optionalRouteString,
  routeString,
  WORKSPACE_CONTENT_MAX_CHARS,
  WORKSPACE_LANGUAGE_MAX_CHARS,
  WORKSPACE_SESSION_ID_MAX_CHARS,
  WORKSPACE_TITLE_MAX_CHARS,
} from "$lib/server/workspace-route-limits";
import type { RequestHandler } from "./$types";

const PAGE_CONTEXT_FIELD_MAX_CHARS = 160;
const PAGE_CONTEXT_LIST_MAX_ITEMS = 8;

function resolveAgentPageContext(value: unknown, defaults: { activeDocument?: WorkspaceDocumentRecord | null } = {}): AgentPageContext | undefined {
  const record = typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const activeEntity = resolveActiveEntity(record.activeEntity);
  const pageContext: AgentPageContext = {
    route: optionalRouteString(record.route, "workspace.pageContext.route", PAGE_CONTEXT_FIELD_MAX_CHARS),
    surface: optionalRouteString(record.surface, "workspace.pageContext.surface", PAGE_CONTEXT_FIELD_MAX_CHARS),
    pageType: optionalRouteString(record.pageType, "workspace.pageContext.pageType", PAGE_CONTEXT_FIELD_MAX_CHARS),
    activeEntity,
    activeArtifactId: optionalRouteString(record.activeArtifactId, "workspace.pageContext.activeArtifactId", PAGE_CONTEXT_FIELD_MAX_CHARS),
    activeDocumentId: optionalRouteString(record.activeDocumentId, "workspace.pageContext.activeDocumentId", PAGE_CONTEXT_FIELD_MAX_CHARS),
    artifactType: optionalRouteString(record.artifactType, "workspace.pageContext.artifactType", PAGE_CONTEXT_FIELD_MAX_CHARS),
    skillFamilies: routeStringArray(record.skillFamilies, "workspace.pageContext.skillFamilies"),
    commandFamilies: routeStringArray(record.commandFamilies, "workspace.pageContext.commandFamilies"),
  };
  if (!pageContext.activeDocumentId && defaults.activeDocument?.id) pageContext.activeDocumentId = defaults.activeDocument.id;
  if (!pageContext.artifactType && defaults.activeDocument?.language) pageContext.artifactType = defaults.activeDocument.language;
  if (!pageContext.surface && pageContext.activeDocumentId) pageContext.surface = "document";
  return hasPageContext(pageContext) ? pageContext : undefined;
}

function resolveActiveEntity(value: unknown): AgentPageContext["activeEntity"] | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const type = optionalRouteString(record.type, "workspace.pageContext.activeEntity.type", PAGE_CONTEXT_FIELD_MAX_CHARS);
  const id = optionalRouteString(record.id, "workspace.pageContext.activeEntity.id", PAGE_CONTEXT_FIELD_MAX_CHARS);
  return type && id ? { type, id } : undefined;
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
    context.activeEntity ||
    context.activeArtifactId ||
    context.activeDocumentId ||
    context.artifactType ||
    (context.skillFamilies && context.skillFamilies.length > 0) ||
    (context.commandFamilies && context.commandFamilies.length > 0)
  );
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

export const POST: RequestHandler = async ({ request }) => {
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
  const activeDocument = _resolveActiveDocument(body?.workspace?.activeDocument);
  const requestId = correlation.requestId;
  const traceId = correlation.traceId;
  const traceparent = correlation.traceparent;
  const workspaceSessionId = routeString(body?.workspace?.sessionId, "workspace.sessionId", WORKSPACE_SESSION_ID_MAX_CHARS, "") || undefined;
  const telemetrySessionId = activeDocument?.session_id ?? workspaceSessionId;
  const smokeRunId = readDevSmokeRunId(request);
  const pageContext = resolveAgentPageContext(body?.pageContext ?? body?.workspace?.pageContext, { activeDocument });
  const telemetryPageContext = sanitizePageContext(body?.pageContext ?? body?.workspace?.pageContext);
  const pageContextSource = resolvePageContextSource(body, activeDocument);
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
  const contextSummary = summarizeWorkspaceContext({ activeDocument });
  const commandIndexSummary = createStandaloneCommandIndexSummary({ includeApprovalRequired: true, includeHostRuntime: true, hostSessionMode: "standalone-demo", sessionId: telemetrySessionId, pageContext });
  const systemContext = [contextSummary, `CONTRACT-DERIVED COMMAND STARTUP INDEX:\n${commandIndexSummary}`].filter(Boolean).join("\n\n");
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
    ok: true,
  }).catch(() => undefined);
  if (shouldUseDevSmokeStream(request)) {
    const smokeInput = {
      requestId,
      traceId,
      traceparent,
      runId: smokeRunId,
      sessionId: telemetrySessionId,
      messageId: lastMessage?.id,
      startedAt,
    };
    await writeDevSmokeStreamTelemetry(smokeInput);
    const response = createUIMessageStreamResponse({
      stream: createDevSmokeStream(smokeInput),
    });
    for (const [key, value] of Object.entries(correlationHeaders)) response.headers.set(key, value);
    return response;
  }

  const agent = createAgent({ activeDocument, sessionId: telemetrySessionId, pageContext });

  try {
    const result = await agent.stream({ messages: contextualModelMessages });

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        const aiStream = pipeArtifactToolOutputsToSpecParts(pipeJsonRender(result.toUIMessageStream()));
        writer.merge(instrumentGenerateStream(aiStream, {
          requestId,
          traceId,
          traceparent,
          runId: smokeRunId,
          sessionId: telemetrySessionId,
          messageId: lastMessage?.id,
          documentId: activeDocument?.id,
          documentVersion: activeDocument?.version_count,
          startedAt,
        }));
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
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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


export function _resolveActiveDocument(value: unknown): WorkspaceDocumentRecord | null {
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

  return id ? syncActiveWorkspaceDocumentSnapshot(snapshot) : snapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

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
import { summarizeWorkspaceContext, syncActiveWorkspaceDocumentSnapshot, type WorkspaceDocumentRecord } from "$lib/server/workspace-store";
import { createStandaloneToolManifestSummary } from "$lib/server/tool-manifest";
import {
  routeString,
  WORKSPACE_CONTENT_MAX_CHARS,
  WORKSPACE_LANGUAGE_MAX_CHARS,
  WORKSPACE_SESSION_ID_MAX_CHARS,
  WORKSPACE_TITLE_MAX_CHARS,
} from "$lib/server/workspace-route-limits";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ request }) => {
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
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const body = await request.json();
  const uiMessages: UIMessage[] = body.messages;
  const activeDocument = _resolveActiveDocument(body?.workspace?.activeDocument);
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();

  if (!uiMessages || !Array.isArray(uiMessages) || uiMessages.length === 0) {
    return new Response(
      JSON.stringify({ error: "messages array is required" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const lastMessage = uiMessages.at(-1);
  const startEvent = {
    source: "server" as const,
    event: "api.generate.start",
    requestId,
    messageId: lastMessage?.id,
    documentId: activeDocument?.id,
    documentVersion: activeDocument?.version_count,
    title: activeDocument?.title,
    ok: true,
  };
  logArtifactTelemetry(startEvent);
  await writeAgentTelemetry(startEvent);

  const modelMessages = await convertToModelMessages(uiMessages);
  const contextSummary = summarizeWorkspaceContext({ activeDocument });
  const toolManifestSummary = createStandaloneToolManifestSummary({ includeApprovalRequired: true });
  const systemContext = [contextSummary, `CONTRACT-DERIVED TOOL MANIFEST:\n${toolManifestSummary}`].filter(Boolean).join("\n\n");
  const contextualModelMessages = systemContext
    ? [{ role: "system" as const, content: systemContext }, ...modelMessages]
    : modelMessages;
  await writeAgentTelemetry({
    source: "server",
    event: "api.generate.tool_manifest_context",
    requestId,
    messageId: lastMessage?.id,
    elementCount: toolManifestSummary.split("\n- ").length - 1,
    ok: true,
  });
  const agent = createAgent({ activeDocument });

  try {
    const result = await agent.stream({ messages: contextualModelMessages });

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        writer.merge(pipeArtifactToolOutputsToSpecParts(pipeJsonRender(result.toUIMessageStream())));
        await writeAgentTelemetry({
          source: "server",
          event: "api.generate.stream_attached",
          requestId,
          messageId: lastMessage?.id,
          documentId: activeDocument?.id,
          documentVersion: activeDocument?.version_count,
          durationMs: Date.now() - startedAt,
          ok: true,
        });
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        void writeAgentTelemetry({
          source: "server",
          event: "api.generate.stream_error",
          requestId,
          messageId: lastMessage?.id,
          durationMs: Date.now() - startedAt,
          ok: false,
          error: message,
        });
        return message;
      },
    });

    return createUIMessageStreamResponse({ stream });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeAgentTelemetry({
      source: "server",
      event: "api.generate.error",
      requestId,
      messageId: lastMessage?.id,
      durationMs: Date.now() - startedAt,
      ok: false,
      error: message,
    });
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

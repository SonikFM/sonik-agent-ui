import { error, json } from "@sveltejs/kit";
import { dev } from "$app/environment";
import { sanitizePageContext, type AgentUiPageContextSnapshot } from "@sonik-agent-ui/agent-observability";
import { writeAgentTelemetry } from "$lib/server/agent-telemetry";

let latestPageContext: { reason: string; pageContext: AgentUiPageContextSnapshot; receivedAt: string } | null = null;

function assertDevPageContextEnabled(): void {
  if (!dev && process.env.SONIK_AGENT_UI_ENABLE_DEV_CONTEXT !== "true") error(404, "Dev page context is disabled");
}

export async function GET() {
  assertDevPageContextEnabled();
  return json({
    ok: Boolean(latestPageContext),
    latest: latestPageContext,
    note: latestPageContext ? undefined : "No browser page context has been posted yet in this dev server process.",
  });
}

export async function POST({ request }) {
  assertDevPageContextEnabled();
  const body = await request.json().catch(() => null);
  const pageContext = sanitizePageContext(body?.pageContext ?? body);
  const reason = typeof body?.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 160) : "client.page_context";
  if (!pageContext) return json({ ok: false, error: "Invalid or empty page context" }, { status: 400 });
  latestPageContext = { reason, pageContext, receivedAt: new Date().toISOString() };
  await writeAgentTelemetry({
    source: "client",
    event: "client.page_context.updated",
    sessionId: pageContext.activeSessionId ?? undefined,
    artifactId: pageContext.activeArtifactId ?? undefined,
    documentId: pageContext.activeDocumentId ?? undefined,
    runtimeStatus: pageContext.conversationStatus,
    surface: pageContext.surface,
    route: pageContext.route,
    commandFamilies: pageContext.commandFamilies,
    skillFamilies: pageContext.skillFamilies,
    reason,
    pageContext,
    ok: true,
  }).catch(() => undefined);
  return json({ ok: true, latest: latestPageContext });
}

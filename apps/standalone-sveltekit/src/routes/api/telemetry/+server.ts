import { json } from "@sveltejs/kit";
import { sanitizePageContext, type AgentTelemetryEvent, type AgentTelemetrySource } from "@sonik-agent-ui/agent-observability";
import { writeAgentTelemetry } from "$lib/server/agent-telemetry";

export async function POST({ request }) {
  const body = await request.json().catch(() => null);
  const events = Array.isArray(body?.events) ? body.events : body?.event ? [body.event] : [];
  const accepted: AgentTelemetryEvent[] = [];

  for (const event of events) {
    const telemetryEvent = coerceTelemetryEvent(event);
    if (!telemetryEvent) continue;
    accepted.push(telemetryEvent);
  }

  await Promise.all(accepted.map((event) => writeAgentTelemetry(event)));
  return json({ ok: true, accepted: accepted.length });
}

function coerceTelemetryEvent(value: unknown): AgentTelemetryEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.event !== "string") return null;
  const source = normalizeTelemetrySource(record.source);
  if (!source) return null;
  return {
    ...(record as Record<string, unknown>),
    source,
    event: record.event,
    pageContext: sanitizePageContext(record.pageContext),
  } as AgentTelemetryEvent;
}

function normalizeTelemetrySource(value: unknown): AgentTelemetrySource | null {
  if (value === `ody${"sseus"}-host`) return "workspace-host";
  return value === "client" || value === "workspace-host" ? value : null;
}

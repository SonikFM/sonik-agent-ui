import { json } from "@sveltejs/kit";
import { readTelemetryBatch, writeAgentTelemetry } from "$lib/server/agent-telemetry";
import { getRequestWorkspacePersistence } from "$lib/server/workspace-request-store";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async (event) => {
  const batch = await readTelemetryBatch(event.request);
  if (!batch.ok) return json({ ok: false, error: batch.error }, { status: batch.status });
  const persistence = getRequestWorkspacePersistence(event);
  const sessionIds = [...new Set(batch.events.map((item) => item.sessionId).filter((id): id is string => Boolean(id)))];

  for (const sessionId of sessionIds) {
    if (!await persistence.getSession(sessionId)) return json({ ok: false, error: "session_not_found" }, { status: 404 });
  }

  await Promise.all(batch.events.map((item) => writeAgentTelemetry(item, persistence)));
  return json({ ok: true, accepted: batch.events.length });
};

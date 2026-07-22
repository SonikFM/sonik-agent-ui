import { json } from "@sveltejs/kit";
import { readTelemetryBatch, writeAgentTelemetry } from "$lib/server/agent-telemetry";
import { getRequestWorkspacePersistence } from "$lib/server/workspace-request-store";
import { WorkspaceRuntimeResolutionError } from "$lib/server/workspace-services";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async (event) => {
  const batch = await readTelemetryBatch(event.request);
  if (!batch.ok) return json({ ok: false, error: batch.error }, { status: batch.status });

  // Anonymous/missing-host-context deploys have no workspace runtime to persist telemetry
  // against: degrade like GET /api/sessions does (503) instead of letting the throw become
  // an uncaught 500 that clients retry forever.
  let persistence;
  try {
    persistence = getRequestWorkspacePersistence(event);
  } catch (error) {
    if (error instanceof WorkspaceRuntimeResolutionError) {
      return json({ ok: false, error: "Workspace cloud runtime is not available.", code: error.code }, { status: 503 });
    }
    throw error;
  }

  const sessionIds = [...new Set(batch.events.map((item) => item.sessionId).filter((id): id is string => Boolean(id)))];

  for (const sessionId of sessionIds) {
    if (!await persistence.getSession(sessionId)) return json({ ok: false, error: "session_not_found" }, { status: 404 });
  }

  await Promise.all(batch.events.map((item) => writeAgentTelemetry(item, persistence)));
  return json({ ok: true, accepted: batch.events.length });
};

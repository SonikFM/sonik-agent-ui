import { resolveStandaloneCapabilityReadiness } from "$lib/server/capability-readiness";
import { createAgentHostSessionEnvelope } from "$lib/server/host-command-runtime";
import { approvedCommandIdsFromHostSession } from "$lib/server/host-command-runtime";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = (event) => {
  const hostSession = createAgentHostSessionEnvelope(event);
  return Response.json({
    readiness: resolveStandaloneCapabilityReadiness({
      hostSession,
      approvedCommandIds: approvedCommandIdsFromHostSession(hostSession),
    }),
  });
};


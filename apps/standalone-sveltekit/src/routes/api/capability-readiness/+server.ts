import { resolveStandaloneCapabilityReadiness } from "$lib/server/standalone-capability-readiness";
import { createAgentHostSessionEnvelope } from "$lib/server/host-command-runtime";
import { approvedCommandIdsFromHostSession } from "$lib/server/host-command-runtime";
import { agentDefinitionSchema } from "@sonik-agent-ui/tool-contracts/marketplace";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async (event) => {
  const parsed = agentDefinitionSchema.shape.toolPolicy.safeParse(
    (await event.request.json().catch(() => null) as { toolPolicy?: unknown } | null)?.toolPolicy,
  );
  if (!parsed.success) return Response.json({ error: "invalid_tool_policy" }, { status: 400 });
  const hostSession = createAgentHostSessionEnvelope(event);
  const approvedCommandIds = approvedCommandIdsFromHostSession(hostSession);
  return Response.json({
    readiness: resolveStandaloneCapabilityReadiness({
      hostSession,
      approvedCommandIds,
      toolPermissionModes: parsed.data,
      defaultToolPermissionMode: "off",
    }),
    policyChangeReadiness: resolveStandaloneCapabilityReadiness({ hostSession, approvedCommandIds }),
  });
};

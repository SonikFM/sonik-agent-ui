import {
  learnGlobalCommand,
  parseCommandLearnAspects,
} from "$lib/server/global-command-registry";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url }) => {
  const commandId = url.searchParams.get("id") ?? url.searchParams.get("commandId");
  if (!commandId) return Response.json({ ok: false, error: "MISSING_COMMAND_ID" }, { status: 400 });
  return Response.json(learnGlobalCommand({ commandId, aspects: parseCommandLearnAspects(url.searchParams.get("aspects")) }));
};

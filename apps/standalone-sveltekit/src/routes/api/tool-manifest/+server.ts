import { createStandaloneAvailableToolManifest } from "$lib/server/tool-manifest";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url }) => {
  const sourceMode = parseSourceMode(url.searchParams.get("sourceMode"));
  const manifest = createStandaloneAvailableToolManifest({
    authenticated: false,
    organizationId: null,
    scopes: [],
    sourceMode,
    includeApprovalRequired: url.searchParams.get("includeApprovalRequired") !== "false",
  });
  return Response.json(manifest);
};

function parseSourceMode(value: string | null) {
  if (value === "orpc-app-state" || value === "mcp" || value === "sandbox" || value === "local-ui") return value;
  return "all";
}

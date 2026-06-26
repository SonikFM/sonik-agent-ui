import {
  getGlobalCommandRegistryArtifact,
  parseGlobalCommandRegistryContextFromSearchParams,
} from "$lib/server/global-command-registry";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url }) => {
  const includeFull = url.searchParams.get("detail") === "full";
  const startupLimitParam = url.searchParams.get("startupLimit");
  const startupLimit = startupLimitParam ? Number(startupLimitParam) : undefined;
  const context = parseGlobalCommandRegistryContextFromSearchParams(url.searchParams);
  return Response.json(getGlobalCommandRegistryArtifact({ includeFull, startupLimit, context }));
};

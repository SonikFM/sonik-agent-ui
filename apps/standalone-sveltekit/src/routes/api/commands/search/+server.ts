import {
  parseGlobalCommandRegistryContextFromSearchParams,
  searchGlobalCommandRegistry,
} from "$lib/server/global-command-registry";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url }) => {
  const query = url.searchParams.get("q") ?? url.searchParams.get("query") ?? "";
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;
  const context = parseGlobalCommandRegistryContextFromSearchParams(url.searchParams);
  return Response.json(searchGlobalCommandRegistry({ query, limit, context }));
};

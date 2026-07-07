import type { RequestHandler } from "./$types";
import { json } from "@sveltejs/kit";
import { fetchGatewayModelCatalog } from "$lib/ai-gateway-model-catalog";

export const GET: RequestHandler = async ({ fetch, setHeaders }) => {
  const catalog = await fetchGatewayModelCatalog(fetch);
  setHeaders({
    "Cache-Control": "public, max-age=300, stale-while-revalidate=1800",
  });
  return json(catalog);
};

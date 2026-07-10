import type { RequestHandler } from "./$types";
import { createDeploymentMetadataHeaders, resolveDeploymentMetadata } from "../../../lib/server/deployment-metadata.ts";

export const GET: RequestHandler = async (event) => {
  const metadata = resolveDeploymentMetadata(event.platform);
  return Response.json(
    {
      version: metadata?.tag ?? metadata?.id ?? null,
      id: metadata?.id ?? null,
      tag: metadata?.tag ?? null,
      timestamp: metadata?.timestamp ?? null,
    },
    {
      headers: {
        "Cache-Control": "no-store",
        ...createDeploymentMetadataHeaders(metadata),
      },
    },
  );
};

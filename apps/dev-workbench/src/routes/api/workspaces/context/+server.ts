import { env } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { workspaceContextSyncSchema } from "$lib/contracts/workbench";
import { isOriginAllowed } from "$lib/client/host-context-bridge";
import { DEV_WORKBENCH_SESSION_COOKIE } from "$lib/server/session-cookie";
import { readDevWorkbenchConfig } from "$lib/server/workbench-config";
import { writeWorkspacePageContext } from "$lib/server/workspace-service";

const NO_STORE = { "cache-control": "no-store, max-age=0" };
const MAX_CONTEXT_BYTES = 64 * 1_024;
const MAX_OPENAPI_BYTES = 4 * 1_024 * 1_024;

export const config = { runtime: "nodejs24.x", maxDuration: 60 };

export const PUT: RequestHandler = async ({ cookies, request }) => {
  const sessionId = cookies.get(DEV_WORKBENCH_SESSION_COOKIE);
  if (!sessionId) return json({ error: "No Dev Workbench session is attached." }, { status: 404, headers: NO_STORE });
  const configuration = readDevWorkbenchConfig(env);
  if (!configuration.ok) return json({ error: configuration.reason }, { status: 503, headers: NO_STORE });

  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_CONTEXT_BYTES) {
    return json({ error: "Page context exceeds the 64 KiB limit." }, { status: 413, headers: NO_STORE });
  }
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return json({ error: "Page context must be valid JSON." }, { status: 400, headers: NO_STORE });
  }
  const parsed = workspaceContextSyncSchema.safeParse(input);
  if (!parsed.success) return json({ error: "Page context is invalid." }, { status: 400, headers: NO_STORE });
  if (parsed.data.host && !isOriginAllowed(parsed.data.host.origin, publicEnv.PUBLIC_DEV_WORKBENCH_ALLOWED_HOST_ORIGINS)) {
    return json({ error: "The host origin is not allowed." }, { status: 403, headers: NO_STORE });
  }

  const openApiDocument = parsed.data.host
    ? await fetchHostOpenApi(parsed.data.host.origin, parsed.data.host.authority?.header ?? null, request.signal)
    : null;
  const result = await writeWorkspacePageContext(sessionId, parsed.data, openApiDocument, request.signal);
  if (!result.ok) return json({ error: result.error }, { status: result.error.retryable ? 502 : 400, headers: NO_STORE });
  return json(result.value, { headers: NO_STORE });
};

async function fetchHostOpenApi(origin: string, authority: string | null, signal: AbortSignal): Promise<unknown | null> {
  try {
    const response = await fetch(new URL("/openapi.json", origin), {
      headers: {
        accept: "application/json",
        ...(authority ? { "x-sonik-agent-ui-host-context": authority } : {}),
      },
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    });
    if (!response.ok) return null;
    const declaredBytes = Number(response.headers.get("content-length") ?? "0");
    if (declaredBytes > MAX_OPENAPI_BYTES) return null;
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_OPENAPI_BYTES) return null;
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

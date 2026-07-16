import { env } from "$env/dynamic/private";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { pageContextMirrorSchema } from "$lib/contracts/workbench";
import { DEV_WORKBENCH_SESSION_COOKIE } from "$lib/server/session-cookie";
import { readDevWorkbenchConfig } from "$lib/server/workbench-config";
import { writeWorkspacePageContext } from "$lib/server/workspace-service";

const NO_STORE = { "cache-control": "no-store, max-age=0" };
const MAX_CONTEXT_BYTES = 64 * 1_024;

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
  const parsed = pageContextMirrorSchema.safeParse(input);
  if (!parsed.success) return json({ error: "Page context is invalid." }, { status: 400, headers: NO_STORE });

  const result = await writeWorkspacePageContext(sessionId, parsed.data, request.signal);
  if (!result.ok) return json({ error: result.error }, { status: result.error.retryable ? 502 : 400, headers: NO_STORE });
  return json(result.value, { headers: NO_STORE });
};

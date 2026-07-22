import { env } from "$env/dynamic/private";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { readDevWorkbenchConfig } from "$lib/server/workbench-config";
import { restartWorkspacePreview } from "$lib/server/workspace-service";
import { DEV_WORKBENCH_SESSION_COOKIE } from "$lib/server/session-cookie";

const NO_STORE = { "cache-control": "no-store, max-age=0" };

export const config = { runtime: "nodejs24.x", maxDuration: 120 };

export const POST: RequestHandler = async ({ cookies, request }) => {
  const sessionId = cookies.get(DEV_WORKBENCH_SESSION_COOKIE);
  if (!sessionId) {
    return json({ ok: false, status: "unavailable", reason: "No Dev Workbench session is attached." }, { status: 404, headers: NO_STORE });
  }
  const configuration = readDevWorkbenchConfig(env);
  if (!configuration.ok) {
    return json({ ok: false, status: "unavailable", reason: configuration.reason }, { status: 503, headers: NO_STORE });
  }

  const result = await restartWorkspacePreview(sessionId, configuration.value, request.signal);
  if (!result.ok) {
    return json(
      { ok: false, status: "unavailable", reason: result.error.message },
      { status: result.error.retryable ? 502 : 400, headers: NO_STORE },
    );
  }
  return json({ ok: true, status: "executed", restartedAt: result.value.restartedAt }, { headers: NO_STORE });
};

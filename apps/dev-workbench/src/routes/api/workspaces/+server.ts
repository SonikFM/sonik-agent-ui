import { env } from "$env/dynamic/private";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { readDevWorkbenchConfig } from "$lib/server/workbench-config";
import { provisionWorkspace, reconnectWorkspace, stopWorkspace } from "$lib/server/workspace-service";
import { DEV_WORKBENCH_SESSION_COOKIE } from "$lib/server/session-cookie";

const NO_STORE = { "cache-control": "no-store, max-age=0" };

export const config = { runtime: "nodejs24.x", maxDuration: 800 };

export const GET: RequestHandler = async ({ cookies, request }) => {
  const sessionId = cookies.get(DEV_WORKBENCH_SESSION_COOKIE);
  if (!sessionId) return json({ error: "No Dev Workbench session is attached." }, { status: 404, headers: NO_STORE });
  const configuration = readDevWorkbenchConfig(env);
  if (!configuration.ok) return json({ error: configuration.reason }, { status: 503, headers: NO_STORE });

  const result = await reconnectWorkspace(sessionId, request.signal);
  if (!result.ok) {
    if (!result.error.retryable) cookies.delete(DEV_WORKBENCH_SESSION_COOKIE, { path: "/" });
    return json({ error: result.error }, { status: result.error.retryable ? 502 : 404, headers: NO_STORE });
  }
  return json({ workspace: result.value }, { headers: NO_STORE });
};

export const POST: RequestHandler = async ({ cookies, request, url }) => {
  const configuration = readDevWorkbenchConfig(env);
  if (!configuration.ok) {
    return json({ error: configuration.reason }, { status: 503, headers: NO_STORE });
  }

  const existingSessionId = cookies.get(DEV_WORKBENCH_SESSION_COOKIE);
  if (existingSessionId) {
    const existing = await reconnectWorkspace(existingSessionId, request.signal);
    if (existing.ok) return json({ workspace: existing.value }, { headers: NO_STORE });
    if (existing.error.retryable) return json({ error: existing.error }, { status: 502, headers: NO_STORE });
    cookies.delete(DEV_WORKBENCH_SESSION_COOKIE, { path: "/" });
  }

  const result = await provisionWorkspace(configuration.value, request.signal);
  if (!result.ok) return json({ error: result.error }, { status: 502, headers: NO_STORE });

  cookies.set(DEV_WORKBENCH_SESSION_COOKIE, result.value.sessionId, {
    httpOnly: true,
    sameSite: "strict",
    secure: url.protocol === "https:",
    path: "/",
    maxAge: Math.floor(configuration.value.timeoutMs / 1_000),
  });
  return json({ workspace: result.value }, { status: 201, headers: NO_STORE });
};

export const DELETE: RequestHandler = async ({ cookies }) => {
  const sessionId = cookies.get(DEV_WORKBENCH_SESSION_COOKIE);
  if (!sessionId) return json({ stopped: true }, { headers: NO_STORE });

  const result = await stopWorkspace(sessionId);
  if (!result.ok) return json({ error: result.error }, { status: 502, headers: NO_STORE });
  cookies.delete(DEV_WORKBENCH_SESSION_COOKIE, { path: "/" });
  return json(result.value, { headers: NO_STORE });
};

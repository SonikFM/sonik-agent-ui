import { env } from "$env/dynamic/private";
import type { Handle } from "@sveltejs/kit";
import { authorizeDevWorkbenchRequest } from "$lib/server/basic-auth";

export const handle: Handle = async ({ event, resolve }) => {
  const decision = authorizeDevWorkbenchRequest({
    enabled: env.DEV_WORKBENCH_ENABLED === "true",
    username: env.DEV_WORKBENCH_BASIC_AUTH_USERNAME,
    password: env.DEV_WORKBENCH_BASIC_AUTH_PASSWORD,
    authorization: event.request.headers.get("authorization"),
    protocol: event.url.protocol,
    hostname: event.url.hostname,
  });
  if (decision.allowed) return resolve(event);

  return new Response(decision.message, {
    status: decision.status,
    headers: decision.status === 401
      ? { "www-authenticate": 'Basic realm="Sonik Dev Workbench", charset="UTF-8"', "cache-control": "no-store" }
      : { "cache-control": "no-store" },
  });
};

import type { Handle } from "@sveltejs/kit";
import { AGENT_UI_HOST_CONTEXT_HEADER } from "$lib/server/workspace-services";
import {
  isAmplifyLoginProxyEnabled,
  resolveLoginProxyHostContextHeader,
  type AmplifyLoginProxyEnv,
} from "$lib/server/amplify-login-proxy";

// Gated by SONIK_AGENT_UI_ENABLE_AMPLIFY_LOGIN_PROXY, default OFF: when unset
// (or not "true"), this hook is a pure passthrough and every request behaves
// exactly as it did before the login proxy existed.
//
// When enabled, and only when the incoming request does not already carry a
// signed host-context header (an embedded host's own handshake always wins),
// this reads agent-ui's own login-proxy session cookie and, if present,
// injects the cached/refreshed signed envelope as the same
// `x-sonik-agent-ui-host-context` header the embedded-host and dev-smoke
// paths already produce. No new validation path is introduced: downstream
// code (workspace-services.ts) verifies this header exactly as it always has.
export const handle: Handle = async ({ event, resolve }) => {
  const env = (event.platform?.env ?? {}) as AmplifyLoginProxyEnv;
  if (isAmplifyLoginProxyEnabled(env) && !event.request.headers.get(AGENT_UI_HOST_CONTEXT_HEADER)) {
    const header = await resolveLoginProxyHostContextHeader(event.cookies, env);
    if (header) {
      const headers = new Headers(event.request.headers);
      headers.set(AGENT_UI_HOST_CONTEXT_HEADER, header);
      event.request = new Request(event.request, { headers });
    }
  }
  return resolve(event);
};

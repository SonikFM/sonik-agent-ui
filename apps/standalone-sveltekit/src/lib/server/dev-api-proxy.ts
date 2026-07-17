export function resolveAgentUiDevApiProxyTarget(env: Record<string, string | undefined>): string | null {
  const configured = env.SONIK_AGENT_UI_DEV_API_ORIGIN?.trim();
  if (!configured) return null;
  const url = new URL(configured);
  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error("SONIK_AGENT_UI_DEV_API_ORIGIN must use HTTPS unless it targets localhost.");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("SONIK_AGENT_UI_DEV_API_ORIGIN must be an origin without credentials, path, query, or hash.");
  }
  return url.origin;
}

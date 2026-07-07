// User-facing error copy for the session rail and workspace surfaces.
// Raw error detail stays in the console/telemetry; users get a plain sentence.

const KNOWN_HINTS: Array<{ pattern: RegExp; hint: string }> = [
  { pattern: /ORG_CONTEXT_REQUIRED|AUTH_REQUIRED|host context|signed context/i, hint: "Reconnect the workspace and try again." },
  { pattern: /HTTP 401|HTTP 403|unauthorized|forbidden/i, hint: "Your session may have expired — refresh the page." },
  { pattern: /HTTP 5\d\d|network|failed to fetch|timeout|unreachable/i, hint: "The workspace service is unreachable — try again in a moment." },
];

export function friendlySessionError(summary: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  if (typeof console !== "undefined") {
    console.warn(`[sonik-agent-ui] ${summary}`, detail);
  }
  const hint = KNOWN_HINTS.find((known) => known.pattern.test(detail))?.hint ?? "Please try again.";
  return `${summary} ${hint}`;
}

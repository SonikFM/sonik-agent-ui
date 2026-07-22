import { appendFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export type ObservationEvent = { kind: "console" | "network"; [key: string]: unknown };

// Real sessions are minted by workspace-service's randomUUID(); test/dev
// fixtures use hyphenated slugs. Neither ever needs "/", "\", or "." segments,
// so a strict allow-list closes off path traversal via a tampered cookie.
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export class InvalidSessionIdError extends Error {
  constructor() {
    super("Invalid Dev Workbench session id.");
    this.name = "InvalidSessionIdError";
  }
}

export async function appendObservationEvents(
  paths: { consolePath: string; networkPath: string },
  events: readonly ObservationEvent[],
): Promise<void> {
  const byPath = new Map<string, string>();
  for (const event of events) {
    const target = event.kind === "network" ? paths.networkPath : paths.consolePath;
    byPath.set(target, `${byPath.get(target) ?? ""}${JSON.stringify(event)}\n`);
  }
  for (const [target, lines] of byPath) {
    await mkdir(path.dirname(target), { recursive: true });
    await appendFile(target, lines, "utf8");
  }
}

// ponytail: real console.jsonl/network.jsonl paths come from the sandbox
// bootstrap env (R2 follow-on, not wired yet); until then mirror to a local
// per-session scratch dir so the live-feed route has a real seam to call.
export async function recordSessionObservationBatch(
  sessionId: string,
  events: readonly ObservationEvent[],
): Promise<{ accepted: number }> {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new InvalidSessionIdError();
  }
  const sessionRoot = path.join(tmpdir(), "sonik-dev-workbench-observations", sessionId);
  await appendObservationEvents(
    { consolePath: path.join(sessionRoot, "console.jsonl"), networkPath: path.join(sessionRoot, "network.jsonl") },
    events,
  );
  return { accepted: events.length };
}

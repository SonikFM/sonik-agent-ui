import { env } from "$env/dynamic/private";
import { json } from "@sveltejs/kit";
import { z } from "zod";
import type { RequestHandler } from "./$types";
import { observeConsoleEntrySchema, observeNetworkEntrySchema } from "@sonik-agent-ui/tool-contracts/observe";
import { redactTelemetryString } from "@sonik-agent-ui/agent-observability";
import { DEV_WORKBENCH_SESSION_COOKIE } from "$lib/server/session-cookie";
import { readDevWorkbenchConfig } from "$lib/server/workbench-config";
import { recordSessionObservationBatch, InvalidSessionIdError } from "$lib/server/observation-mirror";

const NO_STORE = { "cache-control": "no-store, max-age=0" };
const MAX_BATCH_EVENTS = 100;
const MAX_BATCH_BYTES = 64 * 1_024;

const observationBatchSchema = z.object({
  events: z.array(
    z.discriminatedUnion("kind", [
      observeConsoleEntrySchema.extend({ kind: z.literal("console") }),
      observeNetworkEntrySchema.extend({ kind: z.literal("network") }),
    ]),
  ),
});

// ponytail: per-session seen-seq dedupe held in memory for this process;
// fine for a single dev-workbench instance, revisit if this ever runs
// behind multiple server instances for the same session.
const seenBySession = new Map<string, Set<string>>();

export const config = { runtime: "nodejs24.x", maxDuration: 30 };

export const POST: RequestHandler = async ({ cookies, request }) => {
  const sessionId = cookies.get(DEV_WORKBENCH_SESSION_COOKIE);
  if (!sessionId) {
    return json({ ok: false, status: "unavailable", reason: "No Dev Workbench session is attached." }, { status: 404, headers: NO_STORE });
  }
  const configuration = readDevWorkbenchConfig(env);
  if (!configuration.ok) {
    return json({ ok: false, status: "unavailable", reason: configuration.reason }, { status: 503, headers: NO_STORE });
  }

  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BATCH_BYTES) {
    return json({ ok: false, reason: "Observation batch exceeds the 64 KiB limit." }, { status: 413, headers: NO_STORE });
  }
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return json({ ok: false, reason: "Observation batch must be valid JSON." }, { status: 400, headers: NO_STORE });
  }
  const parsed = observationBatchSchema.safeParse(input);
  if (!parsed.success) {
    return json({ ok: false, reason: "Observation batch payload is invalid." }, { status: 400, headers: NO_STORE });
  }
  if (parsed.data.events.length > MAX_BATCH_EVENTS) {
    return json({ ok: false, reason: `Observation batch exceeds ${MAX_BATCH_EVENTS} events.` }, { status: 400, headers: NO_STORE });
  }

  const seen = seenBySession.get(sessionId) ?? new Set<string>();
  seenBySession.set(sessionId, seen);
  const freshEvents = parsed.data.events.filter((event) => !seen.has(`${event.kind}:${event.seq}`));
  if (freshEvents.length === 0) {
    return json({ ok: true, accepted: 0 }, { headers: NO_STORE });
  }

  // Defense-in-depth: re-run the shared redactor server-side even though the
  // capture layer should already have redacted secrets before sending.
  const redactedEvents = freshEvents.map((event) =>
    event.kind === "console"
      ? { ...event, message: redactTelemetryString(event.message) }
      : { ...event, url: redactTelemetryString(event.url) },
  );

  // Mark seqs as seen BEFORE the write, not after: two concurrent identical
  // batches would otherwise both pass the `seen.has` filter above and both
  // append. On a failed write, roll the seqs back out of `seen` so the batch
  // remains retryable rather than being silently swallowed.
  const freshKeys = freshEvents.map((event) => `${event.kind}:${event.seq}`);
  for (const key of freshKeys) seen.add(key);

  let result: { accepted: number };
  try {
    result = await recordSessionObservationBatch(sessionId, redactedEvents);
  } catch (error) {
    for (const key of freshKeys) seen.delete(key);
    if (error instanceof InvalidSessionIdError) {
      return json({ ok: false, reason: "Dev Workbench session is invalid." }, { status: 400, headers: NO_STORE });
    }
    return json({ ok: false, reason: "Failed to record the observation batch." }, { status: 503, headers: NO_STORE });
  }
  return json({ ok: true, accepted: result.accepted }, { headers: NO_STORE });
};

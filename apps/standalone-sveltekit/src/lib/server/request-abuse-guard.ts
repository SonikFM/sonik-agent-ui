// P1 #6 (production-readiness-agent-creation-2026-07-13.md): abuse guards for
// unauthenticated mutable routes (agent-definitions save_draft/publish today).
// ponytail: per-process only -- there's no org context yet to key a real
// distributed limiter on (that's the auth/infra lane); this bounds a single
// isolate's exposure until then. Upgrade path: key by organizationId once
// resolveOrgContext() lands, move the bucket store to shared infra.

export const MAX_JSON_BODY_BYTES = 256 * 1024; // definitions carry prompts/config, not file blobs (those go through the knowledge store).

export type SizeCappedJsonResult =
  | { ok: true; body: unknown }
  | { ok: false; status: number; error: string };

/** Reads a request body as JSON, rejecting oversize payloads before and
 *  after buffering (Content-Length can be absent or wrong, so both are checked). */
export async function readJsonBodyWithSizeCap(request: Request, maxBytes = MAX_JSON_BODY_BYTES): Promise<SizeCappedJsonResult> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > maxBytes) {
    return { ok: false, status: 413, error: "payload_too_large" };
  }
  const raw = await request.text();
  if (raw.length > maxBytes) {
    return { ok: false, status: 413, error: "payload_too_large" };
  }
  try {
    return { ok: true, body: JSON.parse(raw) };
  } catch {
    return { ok: false, status: 400, error: "invalid_json_body" };
  }
}

export interface RateLimiter {
  tryConsume(key: string): boolean;
}

/** In-memory token bucket, one bucket per key. */
export function createTokenBucketRateLimiter(opts: { capacity: number; refillPerMs: number; now?: () => number }): RateLimiter {
  const buckets = new Map<string, { tokens: number; last: number }>();
  const now = opts.now ?? Date.now;
  return {
    tryConsume(key: string): boolean {
      const nowMs = now();
      const bucket = buckets.get(key) ?? { tokens: opts.capacity, last: nowMs };
      const refilled = Math.min(opts.capacity, bucket.tokens + Math.max(0, nowMs - bucket.last) * opts.refillPerMs);
      if (refilled < 1) {
        buckets.set(key, { tokens: refilled, last: nowMs });
        return false;
      }
      buckets.set(key, { tokens: refilled - 1, last: nowMs });
      return true;
    },
  };
}

// 30 requests/minute/key -- generous for interactive draft-save/publish use,
// tight enough to blunt a scripted flood of one isolate.
export const agentDefinitionsRateLimiter: RateLimiter = createTokenBucketRateLimiter({ capacity: 30, refillPerMs: 30 / 60_000 });

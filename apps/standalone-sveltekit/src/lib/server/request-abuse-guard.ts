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
  // P3: byte length, not UTF-16 code-unit length -- multi-byte characters (emoji,
  // most non-Latin scripts) make `raw.length` undercount the actual payload size.
  // TextEncoder (not Buffer) so this works identically under the Cloudflare adapter.
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
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
  /** Number of buckets currently held. Mainly for tests/observability of the idle-eviction guard below. */
  size(): number;
}

/** In-memory token bucket, one bucket per key.
 *  P2: unbounded key spaces (e.g. keyed by client IP) would otherwise grow this
 *  map forever. Idle buckets (untouched for `idleEvictMs`) are swept lazily on
 *  a call rather than on a timer -- ponytail: no background interval to leak or
 *  clean up, and the sweep itself is throttled to once per idleEvictMs so it
 *  doesn't turn every call into an O(map size) scan. */
export function createTokenBucketRateLimiter(opts: { capacity: number; refillPerMs: number; now?: () => number; idleEvictMs?: number }): RateLimiter {
  const buckets = new Map<string, { tokens: number; last: number }>();
  const now = opts.now ?? Date.now;
  const idleEvictMs = opts.idleEvictMs ?? 10 * 60_000;
  let lastSweep = now();

  function evictIdleBuckets(nowMs: number): void {
    if (nowMs - lastSweep < idleEvictMs) return;
    lastSweep = nowMs;
    for (const [key, bucket] of buckets) {
      if (nowMs - bucket.last >= idleEvictMs) buckets.delete(key);
    }
  }

  return {
    tryConsume(key: string): boolean {
      const nowMs = now();
      evictIdleBuckets(nowMs);
      const bucket = buckets.get(key) ?? { tokens: opts.capacity, last: nowMs };
      const refilled = Math.min(opts.capacity, bucket.tokens + Math.max(0, nowMs - bucket.last) * opts.refillPerMs);
      if (refilled < 1) {
        buckets.set(key, { tokens: refilled, last: nowMs });
        return false;
      }
      buckets.set(key, { tokens: refilled - 1, last: nowMs });
      return true;
    },
    size(): number {
      return buckets.size;
    },
  };
}

// 30 requests/minute/key -- generous for interactive draft-save/publish use,
// tight enough to blunt a scripted flood of one isolate.
export const agentDefinitionsRateLimiter: RateLimiter = createTokenBucketRateLimiter({ capacity: 30, refillPerMs: 30 / 60_000 });

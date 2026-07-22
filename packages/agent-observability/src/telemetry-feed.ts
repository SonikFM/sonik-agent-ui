export interface TelemetryFeedEvent {
  seq: number;
  emittedAt: number;
  [key: string]: unknown;
}

export interface TelemetryFeedReadResult {
  events: TelemetryFeedEvent[];
  latestSeq: number;
  latestEmittedAt: number | null;
  lagMs: number;
  stale: boolean;
}

// ponytail: unbounded growth footgun for a long-lived in-memory feed; cap the
// buffer and drop the oldest events once it fills.
const MAX_BUFFERED_EVENTS = 1000;

export function createTelemetryFeed(options: { heartbeatIntervalMs: number; now?: () => number }) {
  const { heartbeatIntervalMs, now = Date.now } = options;
  const events: TelemetryFeedEvent[] = [];
  let seq = 0;
  let lastActivityAt: number | null = null;

  function append(event: Record<string, unknown>): TelemetryFeedEvent {
    seq += 1;
    const emittedAt = now();
    lastActivityAt = emittedAt;
    const stored: TelemetryFeedEvent = { ...event, seq, emittedAt };
    events.push(stored);
    if (events.length > MAX_BUFFERED_EVENTS) events.shift();
    return stored;
  }

  function heartbeat(): void {
    lastActivityAt = now();
  }

  function read({ sinceSeq = 0, limit = 100 }: { sinceSeq?: number; limit?: number } = {}): TelemetryFeedReadResult {
    const filtered = events.filter((event) => event.seq > sinceSeq).slice(0, limit);
    const latestSeq = events.length > 0 ? events[events.length - 1]!.seq : 0;
    const lagMs = lastActivityAt === null ? 0 : now() - lastActivityAt;
    const stale = lastActivityAt !== null && lagMs > heartbeatIntervalMs * 2;
    return { events: filtered, latestSeq, latestEmittedAt: lastActivityAt, lagMs, stale };
  }

  return { append, heartbeat, read };
}

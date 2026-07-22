import {
  CONSOLE_RING_CAPACITY,
  NETWORK_RING_CAPACITY,
  OBSERVE_RESPONSE_MAX_BYTES,
  observeConsoleReadInputSchema,
  observeConsoleReadResultSchema,
  observeNetworkReadInputSchema,
  observeNetworkReadResultSchema,
  type ObserveConsoleEntry,
  type ObserveConsoleLevel,
  type ObserveConsoleReadInput,
  type ObserveConsoleReadResult,
  type ObserveNetworkEntry,
  type ObserveNetworkReadInput,
  type ObserveNetworkReadResult,
} from "@sonik-agent-ui/tool-contracts/observe";
import { redactTelemetryString, sanitizePersistenceValue } from "@sonik-agent-ui/agent-observability";

// Only these fields are ever stored for a network call. Anything else the
// caller passes (headers, cookies, bodies) is accepted but discarded below —
// it never touches the ring, so it can never leak through a read.
export type ObservationNetworkRecordInput = Pick<ObserveNetworkEntry, "method" | "url" | "status" | "durationMs" | "sizeBytes"> &
  Record<string, unknown>;

export type ObservationCaptureOptions = Record<string, never>;

type RingSnapshot<T> = { entries: T[]; droppedCount: number; nextSeq: number };

export type ObservationSnapshot = {
  console: RingSnapshot<ObserveConsoleEntry>;
  network: RingSnapshot<ObserveNetworkEntry>;
};

// The schemas apply a default to `limit`, so callers may omit it — accept the
// same partial shape zod's own .parse() accepts as input.
type ConsoleReadInput = Partial<ObserveConsoleReadInput>;
type NetworkReadInput = Partial<ObserveNetworkReadInput>;

export type ObservationCapture = {
  recordConsole(level: ObserveConsoleLevel, args: unknown[]): void;
  recordNetwork(entry: ObservationNetworkRecordInput): void;
  readConsole(input?: ConsoleReadInput): ObserveConsoleReadResult;
  readNetwork(input?: NetworkReadInput): ObserveNetworkReadResult;
  serialize(): ObservationSnapshot;
  restore(snapshot: ObservationSnapshot): void;
  reset(): void;
};

function createRing<T>(capacity: number) {
  let entries: T[] = [];
  let droppedCount = 0;
  let nextSeq = 0;
  return {
    push(build: (seq: number) => T): void {
      entries.push(build(nextSeq));
      nextSeq += 1;
      if (entries.length > capacity) {
        entries.shift();
        droppedCount += 1;
      }
    },
    entries: (): readonly T[] => entries,
    droppedCount: (): number => droppedCount,
    snapshot: (): RingSnapshot<T> => ({ entries: [...entries], droppedCount, nextSeq }),
    restore(snapshot: RingSnapshot<T>): void {
      entries = [...snapshot.entries];
      droppedCount = snapshot.droppedCount;
      nextSeq = snapshot.nextSeq;
    },
    reset(): void {
      entries = [];
      droppedCount = 0;
      nextSeq = 0;
    },
  };
}

// Trims the oldest entries in the window (if any) until the serialized
// result fits OBSERVE_RESPONSE_MAX_BYTES, folding each trim into droppedCount
// so callers can see truncation happened.
function finalizeWithinBudget<TEntry, TResult>(
  windowedEntries: TEntry[],
  droppedCount: number,
  build: (entries: TEntry[], droppedCount: number) => TResult,
  schema: { parse(value: unknown): TResult },
): TResult {
  let window = windowedEntries;
  let extraDropped = 0;
  for (;;) {
    const candidate = build(window, droppedCount + extraDropped);
    const size = new TextEncoder().encode(JSON.stringify(candidate)).length;
    if (window.length === 0 || size <= OBSERVE_RESPONSE_MAX_BYTES) {
      return schema.parse(candidate);
    }
    window = window.slice(1);
    extraDropped += 1;
  }
}

function createReceiptId(prefix: string): string {
  const random = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return `${prefix}_${random}`;
}

function buildConsoleResult(entries: ObserveConsoleEntry[], droppedCount: number): ObserveConsoleReadResult {
  return {
    ok: true,
    status: "executed",
    receiptId: createReceiptId("observe_console"),
    capturedAt: new Date().toISOString(),
    entries,
    droppedCount,
    stale: false,
  };
}

function buildNetworkResult(entries: ObserveNetworkEntry[], droppedCount: number): ObserveNetworkReadResult {
  return {
    ok: true,
    status: "executed",
    receiptId: createReceiptId("observe_network"),
    capturedAt: new Date().toISOString(),
    entries,
    droppedCount,
    stale: false,
  };
}

// Stringifies a console arg for storage, redacting secret-bearing keys/values
// via the shared agent-observability sanitizer first so nothing sensitive
// ever reaches the ring.
function stringifyRedactedArg(arg: unknown): string {
  const safe = sanitizePersistenceValue(arg);
  if (typeof safe === "string") return safe;
  try {
    return JSON.stringify(safe) ?? String(safe);
  } catch {
    return String(safe);
  }
}

export function createObservationCapture(_options: ObservationCaptureOptions = {}): ObservationCapture {
  const consoleRing = createRing<ObserveConsoleEntry>(CONSOLE_RING_CAPACITY);
  const networkRing = createRing<ObserveNetworkEntry>(NETWORK_RING_CAPACITY);

  function recordConsole(level: ObserveConsoleLevel, args: unknown[]): void {
    const message = args.map(stringifyRedactedArg).join(" ");
    consoleRing.push((seq) => ({ seq, level, message, timestamp: new Date().toISOString() }));
  }

  function recordNetwork(entry: ObservationNetworkRecordInput): void {
    const { method, url, status, durationMs, sizeBytes } = entry;
    networkRing.push((seq) => ({ seq, method, url: redactTelemetryString(url), status, durationMs, sizeBytes }));
  }

  function readConsole(input: ConsoleReadInput = {}): ObserveConsoleReadResult {
    const parsed = observeConsoleReadInputSchema.parse(input);
    const filtered = consoleRing.entries().filter(
      (entry) =>
        (parsed.level === undefined || entry.level === parsed.level) &&
        (parsed.sinceId === undefined || entry.seq > parsed.sinceId),
    );
    const windowed = filtered.slice(-parsed.limit);
    return finalizeWithinBudget(windowed, consoleRing.droppedCount(), buildConsoleResult, observeConsoleReadResultSchema);
  }

  function readNetwork(input: NetworkReadInput = {}): ObserveNetworkReadResult {
    const parsed = observeNetworkReadInputSchema.parse(input);
    const filtered = networkRing.entries().filter(
      (entry) =>
        (parsed.status === undefined || entry.status === parsed.status) &&
        (parsed.urlPattern === undefined || entry.url.includes(parsed.urlPattern)) &&
        (parsed.sinceId === undefined || entry.seq > parsed.sinceId),
    );
    const windowed = filtered.slice(-parsed.limit);
    return finalizeWithinBudget(windowed, networkRing.droppedCount(), buildNetworkResult, observeNetworkReadResultSchema);
  }

  function serialize(): ObservationSnapshot {
    return { console: consoleRing.snapshot(), network: networkRing.snapshot() };
  }

  function restore(snapshot: ObservationSnapshot): void {
    consoleRing.restore(snapshot.console);
    networkRing.restore(snapshot.network);
  }

  function reset(): void {
    consoleRing.reset();
    networkRing.reset();
  }

  return { recordConsole, recordNetwork, readConsole, readNetwork, serialize, restore, reset };
}

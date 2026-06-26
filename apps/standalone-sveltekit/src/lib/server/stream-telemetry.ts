import { writeAgentTelemetry, type AgentTelemetryEvent } from "./agent-telemetry.ts";

export interface GenerateStreamObservation {
  event: string;
  phase?: string;
  reason?: string;
  durationMs?: number;
  ok?: boolean;
}

export type GenerateStreamObserver = (event: GenerateStreamObservation) => void | Promise<void>;

export interface GenerateStreamTelemetryContext {
  requestId: string;
  traceId?: string;
  traceparent?: string;
  runId?: string;
  sessionId?: string;
  messageId?: string;
  documentId?: string;
  documentVersion?: number;
  startedAt: number;
  /** Emit sanitized visible-output wait telemetry when no user-visible chunk has arrived. */
  waitingMs?: number;
  /** Repeat sanitized visible-output wait telemetry at this interval while silence continues. */
  waitingIntervalMs?: number;
  /** Optional future adapter seam for LangSmith/LangChain/onlooker observers; receives no raw model content. */
  observer?: GenerateStreamObserver;
}

export type GenerateStreamTelemetryWriter = (event: AgentTelemetryEvent) => Promise<void>;

/**
 * Mirrors stream terminal state into telemetry without letting telemetry I/O
 * change stream semantics. A log write failure must never convert a successful
 * model stream into a failed user response.
 */
export function instrumentGenerateStream<T>(
  stream: ReadableStream<T>,
  context: GenerateStreamTelemetryContext,
  writeTelemetry: GenerateStreamTelemetryWriter = writeAgentTelemetry,
): ReadableStream<T> {
  let settled = false;
  let reader: ReadableStreamDefaultReader<T> | null = null;
  let firstVisibleChunkRecorded = false;
  let firstTextRecorded = false;
  let firstToolRecorded = false;
  let firstSpecRecorded = false;
  let lastVisibleChunkAt = context.startedAt;
  let lastWaitTelemetryAt: number | null = null;
  let waitTimer: ReturnType<typeof setTimeout> | null = null;
  const waitingMs = Math.max(0, context.waitingMs ?? 15_000);
  const waitingIntervalMs = Math.max(waitingMs, context.waitingIntervalMs ?? 30_000);

  function telemetryBase() {
    return {
      source: "server" as const,
      requestId: context.requestId,
      traceId: context.traceId,
      traceparent: context.traceparent,
      runId: context.runId,
      sessionId: context.sessionId,
      messageId: context.messageId,
      documentId: context.documentId,
      documentVersion: context.documentVersion,
    };
  }

  function write(event: AgentTelemetryEvent): void {
    try {
      const observed = context.observer?.({
        event: event.event,
        phase: event.phase,
        reason: event.reason,
        durationMs: event.durationMs,
        ok: event.ok,
      });
      if (observed && typeof (observed as Promise<void>).catch === "function") {
        void (observed as Promise<void>).catch(() => undefined);
      }
    } catch {
      // Observer adapters are diagnostic only; they must never alter stream semantics.
    }
    void writeTelemetry(event).catch(() => undefined);
  }

  function record(event: string, ok: boolean, error?: unknown): void {
    if (settled) return;
    settled = true;
    clearWaitTimer();
    write({
      ...telemetryBase(),
      event,
      durationMs: Date.now() - context.startedAt,
      ok,
      error: error instanceof Error ? error.message : error ? String(error) : undefined,
    });
  }

  function clearWaitTimer(): void {
    if (!waitTimer) return;
    clearTimeout(waitTimer);
    waitTimer = null;
  }

  function scheduleWaitTimer(): void {
    clearWaitTimer();
    if (waitingMs <= 0 || settled) return;
    const now = Date.now();
    const baseline = Math.max(lastVisibleChunkAt, lastWaitTelemetryAt ?? 0);
    const threshold = lastWaitTelemetryAt && lastWaitTelemetryAt >= lastVisibleChunkAt ? waitingIntervalMs : firstVisibleChunkRecorded ? waitingIntervalMs : waitingMs;
    const delay = Math.max(0, threshold - (now - baseline));
    waitTimer = setTimeout(() => {
      if (settled) return;
      const now = Date.now();
      lastWaitTelemetryAt = now;
      const durationMs = now - lastVisibleChunkAt;
      write({
        ...telemetryBase(),
        event: "api.generate.stream_waiting",
        phase: firstVisibleChunkRecorded ? "after_visible_output" : "before_visible_output",
        reason: firstVisibleChunkRecorded ? "awaiting_more_visible_output" : "awaiting_first_visible_output",
        durationMs,
        ok: true,
      });
      scheduleWaitTimer();
    }, delay);
  }

  function chunkType(value: unknown): string | undefined {
    return value && typeof value === "object" && "type" in value ? String((value as { type?: unknown }).type) : undefined;
  }

  function hasVisibleTextDelta(value: unknown): boolean {
    return Boolean(
      value &&
        typeof value === "object" &&
        "delta" in value &&
        typeof (value as { delta?: unknown }).delta === "string" &&
        (value as { delta: string }).delta.length > 0,
    );
  }

  function isVisibleOutputChunk(value: unknown, type: string | undefined): boolean {
    if (!type) return true;
    if (type === "text-delta") return hasVisibleTextDelta(value);
    return type === "data-spec" || type.startsWith("tool-");
  }

  function recordMilestones(value: T): void {
    const now = Date.now();
    const type = chunkType(value);
    if (!isVisibleOutputChunk(value, type)) return;

    lastVisibleChunkAt = now;
    lastWaitTelemetryAt = null;
    if (!firstVisibleChunkRecorded) {
      firstVisibleChunkRecorded = true;
      write({ ...telemetryBase(), event: "api.generate.stream_first_visible_chunk", phase: type, durationMs: now - context.startedAt, ok: true });
    }
    if (!firstTextRecorded && type === "text-delta") {
      firstTextRecorded = true;
      write({ ...telemetryBase(), event: "api.generate.stream_first_visible_text", phase: type, durationMs: now - context.startedAt, ok: true });
    }
    if (!firstToolRecorded && type?.startsWith("tool-")) {
      firstToolRecorded = true;
      write({ ...telemetryBase(), event: "api.generate.stream_first_tool", phase: type.replace(/^tool-/, ""), durationMs: now - context.startedAt, ok: true });
    }
    if (!firstSpecRecorded && type === "data-spec") {
      firstSpecRecorded = true;
      write({ ...telemetryBase(), event: "api.generate.stream_first_artifact_spec", phase: "data-spec", durationMs: now - context.startedAt, ok: true });
    }
  }

  return new ReadableStream<T>({
    async start(controller) {
      reader = stream.getReader();
      scheduleWaitTimer();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          recordMilestones(value);
          scheduleWaitTimer();
          controller.enqueue(value);
        }
        record("api.generate.stream_finished", true);
        controller.close();
      } catch (error) {
        record("api.generate.stream_failed", false, error);
        controller.error(error);
      } finally {
        clearWaitTimer();
        reader.releaseLock();
        reader = null;
      }
    },
    async cancel(reason) {
      clearWaitTimer();
      record("api.generate.stream_cancelled", false, reason);
      await reader?.cancel(reason).catch(() => undefined);
    },
  });
}

import { createEventStore, tapJsonRenderStream } from "@json-render/devtools";
import type { StreamChunk } from "@json-render/core";
import { writeAgentTelemetry, type AgentTelemetryEvent } from "./agent-telemetry.ts";

/** Cap on real-time per-patch telemetry events per generation, unless verbose mode is on. */
const MAX_PER_PATCH_EVENTS = 50;
/** Cap on distinct element keys collected for the summary event's `elementKeys` list. */
const MAX_ELEMENT_KEYS = 25;

export interface SpecStreamTapContext {
  requestId: string;
  traceId?: string;
  traceparent?: string;
  runId?: string;
  sessionId?: string;
  messageId?: string;
  documentId?: string;
  documentVersion?: number;
  startedAt: number;
}

export type SpecStreamTapTelemetryWriter = (event: AgentTelemetryEvent) => Promise<void>;

function isVerboseStreamTapEnabled(): boolean {
  return process.env.SONIK_AGENT_UI_STREAM_TAP_VERBOSE === "true";
}

function elementKeyFromPatchPath(path: string): string | undefined {
  return /^\/elements\/([^/]+)/.exec(path)?.[1];
}

/**
 * Wraps the `pipeJsonRender` output with the json-render devtools stream tap
 * so spec patches persist to telemetry (Pipe-B), without changing the
 * client-visible stream in any way (the tap forks a copy via `tee()`).
 *
 * Emits one bounded `api.generate.spec_stream_summary` event at stream end
 * with aggregated stats, plus a bounded `api.generate.spec_stream_patch`
 * event per patch in real time (durability) while the patch count stays at
 * or under `MAX_PER_PATCH_EVENTS`, or unconditionally when
 * `SONIK_AGENT_UI_STREAM_TAP_VERBOSE=true`.
 *
 * A failure anywhere in tap construction or aggregation must never break the
 * user-visible stream: construction is wrapped defensively and falls back to
 * the original stream, and per-event aggregation errors are swallowed.
 */
export function tapSpecStreamForTelemetry<T>(
  stream: ReadableStream<T>,
  context: SpecStreamTapContext,
  writeTelemetry: SpecStreamTapTelemetryWriter = writeAgentTelemetry,
): ReadableStream<T> {
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
    void writeTelemetry(event).catch(() => undefined);
  }

  try {
    const events = createEventStore({ bufferSize: 1000 });
    const verbose = isVerboseStreamTapEnabled();
    let patchCount = 0;
    let textChunkCount = 0;
    let firstPatchAt: number | null = null;
    let lastPatchAt: number | null = null;
    const elementKeys = new Set<string>();
    let summaryEmitted = false;

    const unsubscribe = events.subscribe(() => {
      try {
        const snapshot = events.snapshot();
        const last = snapshot[snapshot.length - 1];
        if (!last) return;

        if (last.kind === "stream-patch") {
          patchCount += 1;
          firstPatchAt ??= last.at;
          lastPatchAt = last.at;
          const elementKey = elementKeyFromPatchPath(last.patch.path);
          if (elementKey && elementKeys.size < MAX_ELEMENT_KEYS) elementKeys.add(elementKey);
          if (verbose || patchCount <= MAX_PER_PATCH_EVENTS) {
            write({
              ...telemetryBase(),
              event: "api.generate.spec_stream_patch",
              ok: true,
              payload: { patchIndex: patchCount, op: last.patch.op, path: last.patch.path, elementKey, source: last.source },
            });
          }
        } else if (last.kind === "stream-text") {
          textChunkCount += 1;
        } else if (last.kind === "stream-lifecycle" && last.phase === "end") {
          if (!summaryEmitted) {
            summaryEmitted = true;
            write({
              ...telemetryBase(),
              event: "api.generate.spec_stream_summary",
              durationMs: Date.now() - context.startedAt,
              ok: last.ok !== false,
              payload: {
                patchCount,
                textChunkCount,
                elementKeys: Array.from(elementKeys),
                firstPatchAt,
                lastPatchAt,
              },
            });
          }
          unsubscribe();
        }
      } catch {
        // Aggregation bugs must never break the tapped stream or its listeners.
      }
    });

    return tapJsonRenderStream(stream as unknown as ReadableStream<StreamChunk>, events) as unknown as ReadableStream<T>;
  } catch (err) {
    write({
      ...telemetryBase(),
      event: "api.generate.spec_stream_tap_error",
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
    return stream;
  }
}

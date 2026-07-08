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
 * Save-claim language that implies a state change was persisted. Deliberately
 * excludes soft acknowledgments ("noted", "got it") — those are the CORRECT
 * no-tool response when there is nothing to persist. Telemetry-only detector;
 * some false positives are acceptable and the matched phrase is captured for
 * tuning (pressure-test finding F1, 2026-07-08).
 */
const SAVE_CLAIM_PATTERN = /\brecorded\b|\bI['\u2019]ve (saved|recorded|captured|submitted|updated)\b|\bhas been (saved|recorded|updated|submitted)\b|\bmarked (it|that|this|[^.!?]{0,30}) as (answered|complete|done)\b|\bupdated (the|your) (form|intake|canvas|answers?)\b|\banswers? (is|are) (saved|recorded)\b/i;

/** Tool-output kinds that prove a real state change happened this turn. */
const STATE_CHANGING_OUTPUT_KINDS = new Set(["intake-answer-receipt", "json-render-artifact"]);

/**
 * Claim-vs-receipt drift detector (F1): if the assistant's text claims
 * something was recorded/saved but the turn produced zero successful
 * state-changing tool outputs, emit `api.generate.claim_without_receipt`.
 * Detection only — never blocks, rewrites, or annotates the stream.
 */
function createClaimReceiptDetector<T>(
  write: (event: AgentTelemetryEvent) => void,
  telemetryBase: () => Record<string, unknown>,
): TransformStream<T, T> {
  let text = "";
  let stateChangingReceipts = 0;
  const toolOutputKinds = new Set<string>();
  return new TransformStream<T, T>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      try {
        const c = chunk as { type?: string; delta?: unknown; textDelta?: unknown; output?: unknown };
        if (typeof c?.delta === "string") text += c.delta;
        else if (typeof c?.textDelta === "string") text += c.textDelta;
        if (c?.type === "tool-output-available" && c.output && typeof c.output === "object") {
          const out = c.output as { kind?: unknown; ok?: unknown; receipt?: { ok?: unknown } };
          const kind = typeof out.kind === "string" ? out.kind : "unknown";
          if (toolOutputKinds.size < 12) toolOutputKinds.add(kind);
          if (STATE_CHANGING_OUTPUT_KINDS.has(kind) && out.ok !== false) stateChangingReceipts += 1;
          if (kind === "command-receipt" && out.receipt?.ok === true) stateChangingReceipts += 1;
        }
      } catch {
        // The detector must never break the user-visible stream.
      }
    },
    flush() {
      try {
        if (stateChangingReceipts > 0 || text.length === 0) return;
        const match = SAVE_CLAIM_PATTERN.exec(text);
        if (!match) return;
        write({
          ...telemetryBase(),
          event: "api.generate.claim_without_receipt",
          ok: false,
          reason: "save_claim_with_no_state_changing_receipt",
          payload: {
            matchedPhrase: match[0].slice(0, 80),
            textChars: text.length,
            toolOutputKinds: Array.from(toolOutputKinds),
          },
        } as AgentTelemetryEvent);
      } catch {
        // Detection failures are silent by design.
      }
    },
  });
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

    const tapped = tapJsonRenderStream(stream as unknown as ReadableStream<StreamChunk>, events) as unknown as ReadableStream<T>;
    return tapped.pipeThrough(createClaimReceiptDetector<T>(write, telemetryBase));
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

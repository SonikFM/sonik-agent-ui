import { writeAgentTelemetry, type AgentTelemetryEvent } from "./agent-telemetry.ts";

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

  function record(event: string, ok: boolean, error?: unknown): void {
    if (settled) return;
    settled = true;
    void writeTelemetry({
      source: "server",
      event,
      requestId: context.requestId,
      traceId: context.traceId,
      traceparent: context.traceparent,
      runId: context.runId,
      sessionId: context.sessionId,
      messageId: context.messageId,
      documentId: context.documentId,
      documentVersion: context.documentVersion,
      durationMs: Date.now() - context.startedAt,
      ok,
      error: error instanceof Error ? error.message : error ? String(error) : undefined,
    }).catch(() => undefined);
  }

  return new ReadableStream<T>({
    async start(controller) {
      reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        record("api.generate.stream_finished", true);
        controller.close();
      } catch (error) {
        record("api.generate.stream_failed", false, error);
        controller.error(error);
      } finally {
        reader.releaseLock();
        reader = null;
      }
    },
    async cancel(reason) {
      record("api.generate.stream_cancelled", false, reason);
      await reader?.cancel(reason).catch(() => undefined);
    },
  });
}

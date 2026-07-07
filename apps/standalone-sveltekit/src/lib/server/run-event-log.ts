import { SPEC_DATA_PART_TYPE } from "@json-render/core";
export { SPEC_DATA_PART_TYPE } from "@json-render/core";
import { classifyRunErrorCode } from "@sonik-agent-ui/tool-contracts";
import type { AgentAnalyticsHints, PersistedRunEvent, RunCorrelation, RunErrorCode } from "@sonik-agent-ui/tool-contracts";
import type { AgentRunContextSelection } from "@sonik-agent-ui/tool-contracts/run-context";
import type { WorkspaceRunContextSelection, WorkspaceRunEventRecord, WorkspaceRunRecord, WorkspaceRunStatus } from "@sonik-agent-ui/workspace-session";

// Flush the coalesced text/reasoning buffer once it grows past this, so a
// mid-turn interrupt still persists most of what streamed (bounded row count).
const TEXT_FLUSH_CHARS = 400;

interface ChunkLike {
  type?: unknown;
  id?: unknown;
  delta?: unknown;
  text?: unknown;
  toolCallId?: unknown;
  toolName?: unknown;
  input?: unknown;
  output?: unknown;
  errorText?: unknown;
  error?: unknown;
  data?: unknown;
  usage?: unknown;
  totalUsage?: unknown;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Maps live UI-message stream chunks to the persisted run event union. Text and
 * reasoning deltas are coalesced (flushed on their `*-end`, when a different
 * event interleaves, or past TEXT_FLUSH_CHARS) so the log mirrors the stream
 * without persisting raw transport chunks.
 */
export function createRunEventMapper() {
  let textBuffer = "";
  let reasoningBuffer = "";

  function flushText(out: PersistedRunEvent[]): void {
    if (textBuffer) {
      out.push({ kind: "text", text: textBuffer });
      textBuffer = "";
    }
  }
  function flushReasoning(out: PersistedRunEvent[]): void {
    if (reasoningBuffer) {
      out.push({ kind: "reasoning", text: reasoningBuffer });
      reasoningBuffer = "";
    }
  }
  function flushPending(out: PersistedRunEvent[]): void {
    flushText(out);
    flushReasoning(out);
  }

  return {
    map(chunk: unknown): PersistedRunEvent[] {
      const out: PersistedRunEvent[] = [];
      const candidate = (chunk ?? {}) as ChunkLike;
      const type = typeof candidate.type === "string" ? candidate.type : undefined;
      if (!type) return out;

      if (type === "text-delta") {
        const delta = asString(candidate.delta) || asString(candidate.text);
        if (delta) {
          textBuffer += delta;
          if (textBuffer.length >= TEXT_FLUSH_CHARS) flushText(out);
        }
        return out;
      }
      if (type === "text-end") {
        flushText(out);
        return out;
      }
      if (type === "reasoning-delta") {
        const delta = asString(candidate.delta) || asString(candidate.text);
        if (delta) {
          reasoningBuffer += delta;
          if (reasoningBuffer.length >= TEXT_FLUSH_CHARS) flushReasoning(out);
        }
        return out;
      }
      if (type === "reasoning-end") {
        flushReasoning(out);
        return out;
      }
      if (type === "tool-input-available") {
        flushPending(out);
        out.push({ kind: "tool_use", id: asString(candidate.toolCallId), name: asString(candidate.toolName), input: candidate.input });
        return out;
      }
      if (type === "tool-output-available") {
        flushPending(out);
        out.push({ kind: "tool_result", toolCallId: asString(candidate.toolCallId), output: candidate.output, isError: false });
        return out;
      }
      if (type === "tool-output-error") {
        flushPending(out);
        out.push({ kind: "tool_result", toolCallId: asString(candidate.toolCallId), output: { errorText: asString(candidate.errorText) }, isError: true });
        return out;
      }
      if (type === SPEC_DATA_PART_TYPE) {
        flushPending(out);
        const data = candidate.data as { spec?: unknown } | undefined;
        out.push({ kind: "artifact", spec: data?.spec, dataPart: candidate.data });
        return out;
      }
      if (type === "error") {
        flushPending(out);
        out.push({ kind: "error", message: asString(candidate.errorText) || asString(candidate.error) || "Stream error" });
        return out;
      }
      if (type === "finish" || type === "finish-step") {
        const usage = (candidate.totalUsage ?? candidate.usage) as Record<string, unknown> | undefined;
        if (usage) {
          out.push({
            kind: "usage",
            inputTokens: numberOrUndefined(usage.inputTokens ?? usage.input_tokens),
            outputTokens: numberOrUndefined(usage.outputTokens ?? usage.output_tokens),
            totalTokens: numberOrUndefined(usage.totalTokens ?? usage.total_tokens),
          });
        }
        return out;
      }
      return out;
    },
    finalize(): PersistedRunEvent[] {
      const out: PersistedRunEvent[] = [];
      flushPending(out);
      return out;
    },
  };
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// The AI-SDK UI-message stream opens with a `start` chunk that may carry the
// assistant message id the client renders/persists under. Captured (when present)
// so the run can be keyed to that same id.
function readAssistantMessageId(chunk: unknown): string | null {
  if (!chunk || typeof chunk !== "object") return null;
  const candidate = chunk as { type?: unknown; messageId?: unknown };
  if (candidate.type === "start" && typeof candidate.messageId === "string" && candidate.messageId) return candidate.messageId;
  return null;
}

export interface RebuiltToolPart {
  type: string;
  toolCallId: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}
export interface RebuiltTextPart {
  type: "text";
  text: string;
}
export interface RebuiltSpecPart {
  type: typeof SPEC_DATA_PART_TYPE;
  data: unknown;
}
export type RebuiltMessagePart = RebuiltTextPart | RebuiltToolPart | RebuiltSpecPart;

/**
 * Replays persisted run events (in seq order) into UI-message parts so a reload
 * can rebuild an in-flight or completed assistant turn, including tool and
 * artifact parts. The shape matches what the chat surface already renders for
 * persisted messages (text parts, `tool-<name>` parts, the `data-spec` part).
 */
export function rebuildRunMessageParts(events: Array<Pick<WorkspaceRunEventRecord<PersistedRunEvent>, "event">> | PersistedRunEvent[]): RebuiltMessagePart[] {
  const parts: RebuiltMessagePart[] = [];
  const toolPartIndexById = new Map<string, number>();

  for (const entry of events) {
    const event = ("event" in (entry as object) ? (entry as { event: PersistedRunEvent }).event : entry) as PersistedRunEvent;
    if (!event || typeof event !== "object") continue;
    switch (event.kind) {
      case "text": {
        if (event.text) parts.push({ type: "text", text: event.text });
        break;
      }
      case "tool_use": {
        const part: RebuiltToolPart = {
          type: `tool-${event.name || "unknown"}`,
          toolCallId: event.id,
          state: "input-available",
          input: event.input,
        };
        if (event.id) toolPartIndexById.set(event.id, parts.length);
        parts.push(part);
        break;
      }
      case "tool_result": {
        const index = event.toolCallId ? toolPartIndexById.get(event.toolCallId) : undefined;
        const errorText = event.isError
          ? asString((event.output as { errorText?: unknown } | null | undefined)?.errorText) || "Tool error"
          : undefined;
        if (index !== undefined) {
          const part = parts[index] as RebuiltToolPart;
          part.state = event.isError ? "output-error" : "output-available";
          part.output = event.isError ? undefined : event.output;
          if (errorText) part.errorText = errorText;
        } else {
          parts.push({
            type: `tool-${event.toolName || "unknown"}`,
            toolCallId: event.toolCallId,
            state: event.isError ? "output-error" : "output-available",
            output: event.isError ? undefined : event.output,
            ...(errorText ? { errorText } : {}),
          });
        }
        break;
      }
      case "artifact": {
        parts.push({ type: SPEC_DATA_PART_TYPE, data: event.dataPart ?? { type: "flat", spec: event.spec } });
        break;
      }
      // reasoning / usage / status / error carry provenance but are not
      // reattached as rendered message parts.
      default:
        break;
    }
  }

  return parts;
}

export function rebuildRunMessageText(events: Array<Pick<WorkspaceRunEventRecord<PersistedRunEvent>, "event">> | PersistedRunEvent[]): string {
  let text = "";
  for (const entry of events) {
    const event = ("event" in (entry as object) ? (entry as { event: PersistedRunEvent }).event : entry) as PersistedRunEvent;
    if (event && typeof event === "object" && event.kind === "text") text += event.text;
  }
  return text;
}

// The client persists an interrupted turn (user + partial assistant) together once
// the tab survives to a not-streaming state, under the assistant message's own id.
// Reattaching the same turn from the run event log would then double it. A run's
// assistant turn is already persisted when its back-filled message_id is among the
// persisted messages, or — when that id was never captured — when the persisted
// assistant messages already cover every run (runs are 1:1 with turns, so an
// assistant count below the run count means the latest turn was never persisted).
export function runAssistantTurnPersisted(
  run: { message_id?: string | null },
  runCount: number,
  messages: ReadonlyArray<{ id: string; role: string }>,
): boolean {
  if (run.message_id && messages.some((message) => message.id === run.message_id)) return true;
  const assistantCount = messages.reduce((count, message) => (message.role === "assistant" ? count + 1 : count), 0);
  return assistantCount >= runCount;
}

export interface RunReattachMessage {
  id: string;
  role: "assistant";
  content: string;
  parts: RebuiltMessagePart[];
}

// Builds the assistant message to reattach for a non-succeeded latest run, or null
// when there is nothing to reattach (succeeded, already persisted client-side, or
// no rebuildable parts). Keyed to the run's back-filled message_id when known so it
// dedupes against the persisted turn; falls back to `run:<id>` otherwise.
export function buildRunReattachMessage(input: {
  run: { id: string; status: WorkspaceRunStatus; message_id?: string | null };
  runCount: number;
  messages: ReadonlyArray<{ id: string; role: string }>;
  events: Array<Pick<WorkspaceRunEventRecord<PersistedRunEvent>, "event">> | PersistedRunEvent[];
}): RunReattachMessage | null {
  const { run } = input;
  if (run.status === "succeeded") return null;
  if (runAssistantTurnPersisted(run, input.runCount, input.messages)) return null;
  const parts = rebuildRunMessageParts(input.events);
  if (parts.length === 0) return null;
  return { id: run.message_id ?? `run:${run.id}`, role: "assistant", content: rebuildRunMessageText(input.events), parts };
}

// Minimal persistence surface the recorder needs. Accepts sync or async
// implementations (in-memory adapter is sync; cloud is async) by awaiting.
export interface RunPersistencePort {
  createRun(input: { session_id?: string | null; message_id?: string | null; request_id?: string | null; trace_id?: string | null; traceparent?: string | null; context_selection?: WorkspaceRunContextSelection | null }): WorkspaceRunRecord | Promise<WorkspaceRunRecord>;
  appendRunEvent(input: { run_id: string; session_id?: string | null; kind: string; event: PersistedRunEvent }): unknown;
  updateRun(id: string, input: { status?: WorkspaceRunStatus; resumable?: boolean; error?: string | null; error_code?: string | null; message_id?: string | null }): unknown;
}

export interface RunFinalizeInput {
  status: WorkspaceRunStatus;
  error?: string | null;
  errorCode?: RunErrorCode | null;
  resumable?: boolean;
}

export interface RunRecorder {
  runId: string;
  record(chunk: unknown): void;
  finalize(input: RunFinalizeInput): Promise<void>;
}

/**
 * Creates a run and returns a recorder that persists mapped stream events in
 * order and finalizes run status. Returns null when a run cannot be created
 * (e.g. cloud persistence without host context) so the caller degrades to the
 * existing, non-persisted streaming behavior.
 */
export interface RunPromptComposition {
  moduleIds: string[];
  skillIds: string[];
  implicitSkillIds?: string[];
}

export async function startRunRecorder(
  persistence: RunPersistencePort,
  input: { sessionId: string; messageId?: string | null; correlation: RunCorrelation; contextSelection?: AgentRunContextSelection | null; promptComposition?: RunPromptComposition | null; analyticsHints?: AgentAnalyticsHints | null },
): Promise<RunRecorder | null> {
  let run: WorkspaceRunRecord;
  try {
    run = await persistence.createRun({
      session_id: input.sessionId,
      message_id: input.messageId ?? null,
      request_id: input.correlation.requestId,
      trace_id: input.correlation.traceId,
      traceparent: input.correlation.traceparent,
      // The composer selection for this turn is persisted on the run so it can be
      // replayed as provenance and re-hydrated on reload (removed chips stay
      // removed). Structurally compatible with WorkspaceRunContextSelection.
      context_selection: input.contextSelection ?? null,
    });
  } catch {
    return null;
  }

  const mapper = createRunEventMapper();
  let finalized = false;
  // The assistant message id from the stream's `start` chunk, back-filled onto the
  // run on finalize so a persisted assistant turn and its run share one id namespace
  // (reattach can then tell an already-persisted turn from an interrupted one).
  let assistantMessageId: string | null = null;
  // Set when the mapper persists an error event from an AI-SDK `error` chunk, so a
  // turn that emitted an error part but still closed the stream normally finalizes
  // failed rather than succeeded.
  let recordedErrorMessage: string | null = null;
  // Serialize persistence so appended events keep a monotonic seq and never
  // race, while the stream itself is never blocked on a persistence write.
  let tail: Promise<unknown> = Promise.resolve();
  const enqueue = (fn: () => unknown): void => {
    tail = tail.then(fn).catch(() => undefined);
  };
  const persistEvents = (events: PersistedRunEvent[]): void => {
    for (const event of events) {
      enqueue(() => persistence.appendRunEvent({ run_id: run.id, session_id: input.sessionId, kind: event.kind, event }));
    }
  };

  // Record the composed prompt module ids + per-turn skill ids as a small status
  // event so per-run prompt drift is diagnosable without persisting prompt text.
  // Ignored by rebuildRunMessageParts, so it never alters the reattached message.
  if (input.promptComposition) {
    persistEvents([{
      kind: "status",
      label: "prompt_composition",
      detail: JSON.stringify(input.promptComposition),
    }]);
  }

  // Record the analytics-only hints for this turn as a status event so a run is
  // analysable ("did this session reach an artifact, and on which turn?")
  // without persisting them into the agent path. Analytics-only: never trusted
  // for behavior, and ignored by rebuildRunMessageParts so it never alters the
  // reattached message.
  if (input.analyticsHints) {
    persistEvents([{
      kind: "status",
      label: "analytics_hints",
      detail: JSON.stringify(input.analyticsHints),
    }]);
  }

  return {
    runId: run.id,
    record(chunk: unknown): void {
      try {
        if (!assistantMessageId) {
          const id = readAssistantMessageId(chunk);
          if (id) assistantMessageId = id;
        }
        const events = mapper.map(chunk);
        for (const event of events) {
          if (event.kind === "error" && !recordedErrorMessage) recordedErrorMessage = event.message || "Stream error";
        }
        persistEvents(events);
      } catch {
        // Persistence must never break the user-visible stream.
      }
    },
    async finalize(finalizeInput: RunFinalizeInput): Promise<void> {
      if (finalized) return;
      finalized = true;
      persistEvents(mapper.finalize());
      let status = finalizeInput.status;
      let error = finalizeInput.error ?? null;
      let errorCode: RunErrorCode | null = finalizeInput.errorCode ?? null;
      let resumable = finalizeInput.resumable ?? false;
      // A turn that emitted an AI-SDK error part but still closed the stream
      // normally has really failed: finalize it failed + resumable so it reattaches
      // and offers Continue rather than masquerading as a clean success.
      if (status === "succeeded" && recordedErrorMessage) {
        status = "failed";
        error = error ?? recordedErrorMessage;
        errorCode = errorCode ?? classifyRunErrorCode({ message: recordedErrorMessage });
        resumable = true;
      }
      // Synthesize a typed error event only when the stream failed without the
      // mapper already logging one (e.g. a transport rejection). An error part that
      // flowed through the mapper is already persisted.
      if (status === "failed" && errorCode && !recordedErrorMessage) {
        enqueue(() =>
          persistence.appendRunEvent({
            run_id: run.id,
            session_id: input.sessionId,
            kind: "error",
            event: { kind: "error", message: error ?? "Run failed", code: errorCode ?? undefined },
          }),
        );
      }
      await tail;
      try {
        await persistence.updateRun(run.id, {
          status,
          resumable,
          error,
          error_code: errorCode,
          ...(assistantMessageId ? { message_id: assistantMessageId } : {}),
        });
      } catch {
        // Best-effort: a status write failure must not surface as a stream error.
      }
    },
  };
}

/**
 * Tees a UI-message stream into a run event log without changing stream
 * semantics: chunks pass through untouched, mapped events persist as they flow,
 * and the run is finalized on completion (succeeded), error (failed +
 * AGENT_STREAM_FAILED, resumable), or cancel/disconnect (canceled, resumable).
 * Uses a ReadableStream wrapper so a real cancel hook fires when the client
 * disconnects mid-turn.
 */
export function teeRunEvents<T>(source: ReadableStream<T>, recorder: RunRecorder): ReadableStream<T> {
  let reader: ReadableStreamDefaultReader<T> | null = null;
  return new ReadableStream<T>({
    async start(controller) {
      reader = source.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          recorder.record(value);
          controller.enqueue(value);
        }
        await recorder.finalize({ status: "succeeded" });
        controller.close();
      } catch (error) {
        await recorder.finalize({
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
          errorCode: "AGENT_STREAM_FAILED",
          resumable: true,
        });
        controller.error(error);
      } finally {
        try {
          reader?.releaseLock();
        } catch {
          // reader already released
        }
        reader = null;
      }
    },
    async cancel(reason) {
      await recorder.finalize({
        status: "canceled",
        error: reason ? String(reason) : null,
        errorCode: "AGENT_STREAM_FAILED",
        resumable: true,
      });
      await reader?.cancel(reason).catch(() => undefined);
    },
  });
}

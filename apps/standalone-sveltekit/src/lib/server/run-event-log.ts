import { SPEC_DATA_PART_TYPE } from "@json-render/core";
export { SPEC_DATA_PART_TYPE } from "@json-render/core";
import { classifyRunErrorCode } from "@sonik-agent-ui/tool-contracts";
import type { AgentAnalyticsHints, PersistedRunEvent, RunCorrelation, RunErrorCode } from "@sonik-agent-ui/tool-contracts";
import type { AgentRunContextSelection } from "@sonik-agent-ui/tool-contracts/run-context";
import type { WorkspaceRunContextSelection, WorkspaceRunEventRecord, WorkspaceRunRecord, WorkspaceRunStatus } from "@sonik-agent-ui/workspace-session";
import type { AsyncWorkspacePersistenceAdapter } from "@sonik-agent-ui/workspace-session";
import type { UIMessage } from "ai";
import { AgentUiFileError } from "./agent-ui-files.ts";
import { sanitizeRunFailure } from "./run-error-safety.ts";

export async function persistInitiatingUserMessage(input: {
  persistence: AsyncWorkspacePersistenceAdapter;
  sessionId: string;
  message: UIMessage | undefined;
}): Promise<void> {
  const message = input.message;
  if (!message?.id || message.role !== "user") throw new AgentUiFileError(400, "A user message with an id is required");
  const session = await input.persistence.getSession(input.sessionId);
  if (!session) throw new AgentUiFileError(404, "Session not found");
  const parts = Array.isArray(message.parts) ? message.parts : [];
  const content = parts.map((part) => part && typeof part === "object" && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "").join("");
  const persistedParts = parts.length > 0 ? parts : null;
  const persisted = await input.persistence.appendMessage({ session_id: session.id, id: message.id, role: "user", content, parts: persistedParts });
  if (persisted.id !== message.id || persisted.session_id !== session.id || persisted.role !== "user" || persisted.content !== content || stableJsonStringify(persisted.parts) !== stableJsonStringify(persistedParts)) {
    throw new AgentUiFileError(400, "User message provenance is invalid");
  }
}

function stableJsonStringify(value: unknown): string | undefined {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().filter((key) => record[key] !== undefined).map((key) => [key, sortJsonValue(record[key])]));
}

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
        const failure = sanitizeRunFailure(candidate.errorText, { fallbackCode: "AGENT_STREAM_FAILED" });
        out.push({ kind: "tool_result", toolCallId: asString(candidate.toolCallId), output: { errorText: failure.message }, isError: true });
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
        const failure = sanitizeRunFailure(asString(candidate.errorText) || asString(candidate.error) || "Stream error", { fallbackCode: "AGENT_STREAM_FAILED" });
        out.push({ kind: "error", message: failure.message, code: failure.code });
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
          ? sanitizeRunFailure(asString((event.output as { errorText?: unknown } | null | undefined)?.errorText) || "Tool error", { fallbackCode: "AGENT_STREAM_FAILED" }).message
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
// assistant turn is already persisted only when its back-filled message_id matches
// a persisted assistant message.
export function runAssistantTurnPersisted(
  run: { message_id?: string | null },
  messages: ReadonlyArray<{ id: string; role: string }>,
): boolean {
  return Boolean(run.message_id && messages.some((message) => message.role === "assistant" && message.id === run.message_id));
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
  messages: ReadonlyArray<{ id: string; role: string }>;
  events: Array<Pick<WorkspaceRunEventRecord<PersistedRunEvent>, "event">> | PersistedRunEvent[];
}): RunReattachMessage | null {
  const { run } = input;
  if (run.status === "succeeded") return null;
  if (runAssistantTurnPersisted(run, input.messages)) return null;
  const parts = rebuildRunMessageParts(input.events);
  if (parts.length === 0) return null;
  return { id: run.message_id ?? `run:${run.id}`, role: "assistant", content: rebuildRunMessageText(input.events), parts };
}

// Minimal persistence surface the recorder needs. Accepts sync or async
// implementations (in-memory adapter is sync; cloud is async) by awaiting.
export interface RunPersistencePort {
  createRun(input: { session_id?: string | null; user_message_id?: string | null; message_id?: string | null; request_id?: string | null; trace_id?: string | null; traceparent?: string | null; context_selection?: WorkspaceRunContextSelection | null }): WorkspaceRunRecord | Promise<WorkspaceRunRecord>;
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
 * order and finalizes run status. Run creation fails closed so a validated,
 * session-backed user message cannot execute without its durable run record.
 */
export interface RunPromptComposition {
  moduleIds: string[];
  skillIds: string[];
  implicitSkillIds?: string[];
}

export async function startRunRecorder(
  persistence: RunPersistencePort,
  input: { sessionId: string; userMessageId?: string | null; correlation: RunCorrelation; contextSelection?: AgentRunContextSelection | null; promptComposition?: RunPromptComposition | null; analyticsHints?: AgentAnalyticsHints | null },
): Promise<RunRecorder> {
  const run = await persistence.createRun({
    session_id: input.sessionId,
    user_message_id: input.userMessageId ?? null,
    message_id: null,
    request_id: input.correlation.requestId,
    trace_id: input.correlation.traceId,
    traceparent: input.correlation.traceparent,
    // The composer selection for this turn is persisted on the run so it can be
    // replayed as provenance and re-hydrated on reload (removed chips stay
    // removed). Structurally compatible with WorkspaceRunContextSelection.
    context_selection: input.contextSelection ?? null,
  });

  const mapper = createRunEventMapper();
  let finalized = false;
  let finalizing: Promise<void> | null = null;
  let terminalInput: RunFinalizeInput | null = null;
  let terminalErrorQueued = false;
  // The assistant message id from the stream's `start` chunk, back-filled onto the
  // run on finalize so a persisted assistant turn and its run share one id namespace
  // (reattach can then tell an already-persisted turn from an interrupted one).
  let assistantMessageId: string | null = null;
  // Set when the mapper persists an error event from an AI-SDK `error` chunk, so a
  // turn that emitted an error part but still closed the stream normally finalizes
  // failed rather than succeeded.
  let recordedErrorMessage: string | null = null;
  let recordedErrorCode: RunErrorCode | null = null;
  // Serialize persistence so appended events keep a monotonic seq and never
  // race, while the stream itself is never blocked on a persistence write.
  let tail: Promise<unknown> = Promise.resolve();
  let appendFailed = false;
  let appendFailure: unknown;
  let appendFailureReported = false;
  const retryAppends: Array<() => unknown> = [];
  const enqueue = (fn: () => unknown): void => {
    tail = tail.then(() => {
      if (appendFailed) {
        retryAppends.push(fn);
        return;
      }
      return fn();
    }).catch((error) => {
      retryAppends.push(fn);
      appendFailed = true;
      appendFailure ??= error;
    });
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
          if (event.kind === "error" && !recordedErrorMessage) {
            recordedErrorMessage = event.message || "Run interrupted";
            recordedErrorCode = event.code ?? "AGENT_STREAM_FAILED";
          }
        }
        persistEvents(events);
      } catch {
        // Persistence must never break the user-visible stream.
      }
    },
    async finalize(finalizeInput: RunFinalizeInput): Promise<void> {
      if (finalized) return;
      if (finalizing) return finalizing;
      terminalInput ??= finalizeInput;
      finalizing = (async () => {
        if (appendFailureReported) {
          appendFailed = false;
          appendFailure = undefined;
          appendFailureReported = false;
          for (const retry of retryAppends.splice(0)) enqueue(retry);
        }
        persistEvents(mapper.finalize());
        let status = terminalInput.status;
        let error = terminalInput.error ?? null;
        let errorCode: RunErrorCode | null = terminalInput.errorCode ?? null;
        let resumable = terminalInput.resumable ?? false;
        // A turn that emitted an AI-SDK error part but still closed the stream
        // normally has really failed: finalize it failed + resumable so it reattaches
        // and offers Continue rather than masquerading as a clean success.
        if (status === "succeeded" && recordedErrorMessage) {
          status = "failed";
          error = error ?? recordedErrorMessage;
          errorCode = errorCode ?? recordedErrorCode ?? classifyRunErrorCode({ message: recordedErrorMessage });
          resumable = true;
        }
        // Synthesize a typed error event only when the stream failed without the
        // mapper already logging one (e.g. a transport rejection). An error part that
        // flowed through the mapper is already persisted.
        const safeFailure = sanitizeRunFailure(error, {
          code: errorCode,
          fallbackCode: status === "failed" ? "AGENT_STREAM_FAILED" : undefined,
          resumable,
        });
        error = error === null ? null : safeFailure.message;
        errorCode = errorCode ?? (status === "failed" ? safeFailure.code : null);
        if (status === "failed" && errorCode && !recordedErrorMessage && !terminalErrorQueued) {
          terminalErrorQueued = true;
          enqueue(() =>
            persistence.appendRunEvent({
              run_id: run.id,
              session_id: input.sessionId,
              kind: "error",
              event: { kind: "error", message: error ?? safeFailure.message, code: errorCode ?? undefined },
            }),
          );
        }
        await tail;
        if (appendFailed) {
          appendFailureReported = true;
          throw appendFailure;
        }
        await persistence.updateRun(run.id, {
          status,
          resumable,
          error,
          error_code: errorCode,
          ...(assistantMessageId ? { message_id: assistantMessageId } : {}),
        });
        finalized = true;
      })();
      try {
        await finalizing;
      } finally {
        if (!finalized) finalizing = null;
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
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            recorder.record(value);
            controller.enqueue(value);
          }
        } catch (error) {
          const failure = sanitizeRunFailure(error, { fallbackCode: "AGENT_STREAM_FAILED", resumable: true });
          try {
            await recorder.finalize({
              status: "failed",
              error: failure.message,
              errorCode: failure.code,
              resumable: true,
            });
          } catch (persistenceError) {
            console.error("Run terminal persistence failed", persistenceError);
          }
          controller.error(new Error(failure.message));
          return;
        }
        await recorder.finalize({ status: "succeeded" });
        controller.close();
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
      try {
        await recorder.finalize({
          status: "canceled",
          error: reason ? String(reason) : null,
          errorCode: "AGENT_STREAM_FAILED",
          resumable: true,
        });
      } finally {
        await reader?.cancel(reason).catch(() => undefined);
      }
    },
  });
}

import assert from "node:assert/strict";
import { once } from "node:events";
import { createUIMessageStream } from "ai";
import {
  SPEC_DATA_PART_TYPE,
  buildRunReattachMessage,
  createRunEventMapper,
  rebuildRunMessageParts,
  rebuildRunMessageText,
  runAssistantTurnPersisted,
  startRunRecorder,
  teeRunEvents,
} from "../../apps/standalone-sveltekit/src/lib/server/run-event-log.ts";
import { sanitizeRunFailure, sanitizeSessionFailureProjection, sanitizeSessionMessages } from "../../apps/standalone-sveltekit/src/lib/server/run-error-safety.ts";
import {
  appendWorkspaceMessage,
  appendWorkspaceRunEvent,
  createWorkspaceRun,
  createWorkspaceSession,
  getWorkspaceRun,
  listWorkspaceRunEvents,
  updateWorkspaceRun,
} from "../../apps/standalone-sveltekit/src/lib/server/workspace-store.ts";

// --- mapper: coalesces text, maps tools/artifact, ignores transport-only chunks ---
{
  const mapper = createRunEventMapper();
  assert.deepEqual(mapper.map({ type: "start" }), [], "lifecycle chunks are not persisted");
  assert.deepEqual(mapper.map({ type: "text-start", id: "t1" }), []);
  assert.deepEqual(mapper.map({ type: "text-delta", id: "t1", delta: "Hello " }), [], "text is buffered, not emitted per delta");
  assert.deepEqual(mapper.map({ type: "text-delta", id: "t1", delta: "world" }), []);
  const afterTextEnd = mapper.map({ type: "text-end", id: "t1" });
  assert.deepEqual(afterTextEnd, [{ kind: "text", text: "Hello world" }], "text flushes coalesced on text-end");

  const toolUse = mapper.map({ type: "tool-input-available", toolCallId: "call-1", toolName: "createJsonArtifact", input: { title: "X" } });
  assert.deepEqual(toolUse, [{ kind: "tool_use", id: "call-1", name: "createJsonArtifact", input: { title: "X" } }]);
  const toolOut = mapper.map({ type: "tool-output-available", toolCallId: "call-1", output: { ok: true } });
  assert.deepEqual(toolOut, [{ kind: "tool_result", toolCallId: "call-1", output: { ok: true }, isError: false }]);

  const artifact = mapper.map({ type: SPEC_DATA_PART_TYPE, data: { type: "flat", spec: { root: "main", elements: {}, state: {} } } });
  assert.equal(artifact.length, 1);
  assert.equal(artifact[0].kind, "artifact");
  assert.deepEqual(artifact[0].dataPart, { type: "flat", spec: { root: "main", elements: {}, state: {} } });
}

// --- mapper: live tool-input streaming chunks are NOT persisted as run events ---
// (donor marks tool_input_delta NOT persisted; only the completed tool_use is)
{
  const mapper = createRunEventMapper();
  assert.deepEqual(mapper.map({ type: "tool-input-start", toolCallId: "c", toolName: "createJsonArtifact" }), [], "tool-input-start is transport-only");
  assert.deepEqual(mapper.map({ type: "tool-input-delta", toolCallId: "c", inputTextDelta: '{"spec":' }), [], "tool-input-delta is transport-only");
  assert.deepEqual(mapper.map({ type: "tool-input-delta", toolCallId: "c", inputTextDelta: '{"root":"main"}}' }), [], "additional deltas are still not persisted");
  const toolUse = mapper.map({ type: "tool-input-available", toolCallId: "c", toolName: "createJsonArtifact", input: { spec: { root: "main" } } });
  assert.deepEqual(toolUse, [{ kind: "tool_use", id: "c", name: "createJsonArtifact", input: { spec: { root: "main" } } }], "only the completed tool input persists");
}

// --- mapper: interleaved text flushes before a tool event to preserve order ---
{
  const mapper = createRunEventMapper();
  mapper.map({ type: "text-delta", id: "t", delta: "before tool" });
  const events = mapper.map({ type: "tool-input-available", toolCallId: "c", toolName: "doThing", input: {} });
  assert.deepEqual(events[0], { kind: "text", text: "before tool" }, "pending text flushes before the tool event");
  assert.equal(events[1].kind, "tool_use");
  // finalize flushes any trailing buffer (interrupt-safety without a text-end)
  mapper.map({ type: "text-delta", id: "t", delta: "trailing" });
  assert.deepEqual(mapper.finalize(), [{ kind: "text", text: "trailing" }]);
}

// --- rebuild: text + tool + spec parts, tool result fills the tool part ---
{
  const events = [
    { kind: "status", label: "started" },
    { kind: "text", text: "Working on it. " },
    { kind: "tool_use", id: "call-9", name: "createJsonArtifact", input: { title: "Dash" } },
    { kind: "tool_result", toolCallId: "call-9", output: { spec: { root: "main" } }, isError: false },
    { kind: "artifact", spec: { root: "main", elements: {}, state: {} }, dataPart: { type: "flat", spec: { root: "main", elements: {}, state: {} } } },
    { kind: "usage", inputTokens: 5, outputTokens: 9 },
  ];
  const parts = rebuildRunMessageParts(events);
  assert.equal(parts[0].type, "text");
  assert.equal(parts[0].text, "Working on it. ");
  assert.equal(parts[1].type, "tool-createJsonArtifact");
  assert.equal(parts[1].toolCallId, "call-9");
  assert.equal(parts[1].state, "output-available", "tool result upgrades the tool part state");
  assert.deepEqual(parts[1].output, { spec: { root: "main" } });
  assert.equal(parts[2].type, SPEC_DATA_PART_TYPE);
  assert.equal(rebuildRunMessageText(events), "Working on it. ");

  // error tool result surfaces errorText and no output
  const errorParts = rebuildRunMessageParts([
    { kind: "tool_use", id: "c", name: "boom", input: {} },
    { kind: "tool_result", toolCallId: "c", output: { errorText: "kaboom" }, isError: true },
  ]);
  assert.equal(errorParts[0].state, "output-error");
  assert.equal(errorParts[0].errorText, "Run interrupted");
  assert.equal(errorParts[0].output, undefined);
}

function streamOf(chunks, { failAt } = {}) {
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      const chunk = chunks[i];
      i += 1;
      if (failAt !== undefined && i - 1 === failAt) {
        controller.error(new Error("upstream dropped"));
        return;
      }
      controller.enqueue(chunk);
    },
  });
}

async function drain(stream) {
  const reader = stream.getReader();
  const out = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push(value);
  }
  return out;
}

const port = {
  createRun: (input) => createWorkspaceRun(input),
  appendRunEvent: (input) => appendWorkspaceRunEvent(input),
  updateRun: (id, input) => updateWorkspaceRun(id, input),
};

const rawProviderError = "Google provider files/raw-ref at https://example.invalid/private said arbitrary model text";

assert.deepEqual(sanitizeRunFailure(`rate limit: ${rawProviderError}`), { code: "RATE_LIMITED", message: "Rate limit reached", resumable: true });
assert.deepEqual(sanitizeRunFailure(rawProviderError), { code: "UNKNOWN", message: "Run failed", resumable: false });
assert.deepEqual(sanitizeRunFailure(rawProviderError, { fallbackCode: "AGENT_STREAM_FAILED" }), { code: "AGENT_STREAM_FAILED", message: "Run interrupted", resumable: true });

// --- error-bearing chunks never persist arbitrary provider detail -----------
{
  const mapper = createRunEventMapper();
  const events = [
    ...mapper.map({ type: "tool-output-error", toolCallId: "tool-unsafe", errorText: rawProviderError }),
    ...mapper.map({ type: "error", errorText: rawProviderError }),
  ];
  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes("files/raw-ref"), false);
  assert.equal(serialized.includes("arbitrary model text"), false);
  assert.ok(events.every((event) => event.kind !== "error" || event.code === "AGENT_STREAM_FAILED"));
}

// --- recorder observes the client-facing AI SDK outer message identity -------
for (const terminal of ["succeeded", "failed", "canceled"]) {
  const session = createWorkspaceSession({ id: `run-log-outer-${terminal}`, name: terminal, mode: "chat" });
  const recorder = await startRunRecorder(port, { sessionId: session.id, correlation: { requestId: `req_outer_${terminal}`, traceId: "0123456789abcdef0123456789abcdef", traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01" } });
  const messageId = `outer-assistant-${terminal}`;
  const outer = createUIMessageStream({
    generateId: () => messageId,
    execute: ({ writer }) => {
      writer.write({ type: "start" });
      writer.write({ type: "text-delta", id: "t", delta: terminal === "failed" ? "partial" : "answer" });
      if (terminal === "failed") writer.write({ type: "error", errorText: "model stream error" });
      else writer.write({ type: "text-end", id: "t" });
    },
  });
  const reader = teeRunEvents(outer, recorder).getReader();
  const first = await reader.read();
  assert.deepEqual(first.value, { type: "start", messageId }, `${terminal} exposes the generated outer assistant id`);
  if (terminal === "canceled") {
    const sdkCancellation = once(process, "unhandledRejection");
    await reader.cancel();
    await sdkCancellation;
  } else while (!(await reader.read()).done) {}
  const run = getWorkspaceRun(recorder.runId);
  assert.equal(run.status, terminal, `outer ${terminal} controls durable terminal status`);
  assert.equal(run.message_id, messageId, `outer ${terminal} persists the exact client assistant id`);
}

// --- recorder: terminal persistence is observable and retryable -------------
{
  const session = createWorkspaceSession({ id: "run-log-terminal-retry", name: "terminal retry", mode: "chat" });
  const updates = [];
  const recorder = await startRunRecorder({
    ...port,
    updateRun: (id, input) => {
      updates.push(input);
      if (updates.length === 1) throw new Error("update unavailable");
      return updateWorkspaceRun(id, input);
    },
  }, { sessionId: session.id, correlation: { requestId: "req_retry", traceId: "0123456789abcdef0123456789abcdef", traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01" } });
  await assert.rejects(() => recorder.finalize({ status: "succeeded" }), /update unavailable/);
  assert.equal(getWorkspaceRun(recorder.runId).status, "running", "a failed terminal write leaves the run retryable");
  await recorder.finalize({ status: "succeeded" });
  await recorder.finalize({ status: "failed", error: "must be ignored" });
  assert.equal(updates.length, 2, "successful terminal persistence finalizes exactly once after retry");
  assert.deepEqual(updates.map(({ status }) => status), ["succeeded", "succeeded"], "retry preserves the original terminal intent");
}

// --- tee: a sole terminal write failure surfaces without rewriting status ---
{
  const session = createWorkspaceSession({ id: "run-log-terminal-fail", name: "terminal fail", mode: "chat" });
  const updates = [];
  const recorder = await startRunRecorder({
    ...port,
    updateRun: (_id, input) => {
      updates.push(input);
      throw new Error("terminal persistence failed");
    },
  }, { sessionId: session.id, correlation: { requestId: "req_permanent", traceId: "0123456789abcdef0123456789abcdef", traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01" } });
  const reader = teeRunEvents(streamOf([{ type: "text-delta", id: "t", delta: "visible" }, { type: "text-end", id: "t" }]), recorder).getReader();
  assert.deepEqual((await reader.read()).value, { type: "text-delta", id: "t", delta: "visible" });
  assert.deepEqual((await reader.read()).value, { type: "text-end", id: "t" });
  await assert.rejects(() => reader.read(), /terminal persistence failed/);
  assert.deepEqual(updates.map(({ status }) => status), ["succeeded"], "terminal persistence failure is not rewritten as a model failure");
  assert.equal(getWorkspaceRun(recorder.runId).status, "running");
}

// --- recorder: retrying failed finalization does not duplicate error events --
{
  const session = createWorkspaceSession({ id: "run-log-failed-retry", name: "failed retry", mode: "chat" });
  let updates = 0;
  const recorder = await startRunRecorder({
    ...port,
    updateRun: (id, input) => {
      updates += 1;
      if (updates === 1) throw new Error("update unavailable");
      return updateWorkspaceRun(id, input);
    },
  }, { sessionId: session.id, correlation: { requestId: "req_failed_retry", traceId: "0123456789abcdef0123456789abcdef", traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01" } });
  const failure = { status: "failed", error: "upstream dropped", errorCode: "AGENT_STREAM_FAILED", resumable: true };
  await assert.rejects(() => recorder.finalize(failure), /update unavailable/);
  await recorder.finalize(failure);
  assert.equal(listWorkspaceRunEvents(recorder.runId).filter((entry) => entry.event.kind === "error").length, 1, "retry appends one synthesized terminal error");
}

// --- recorder: durable run creation is required and fails closed ------------
{
  await assert.rejects(
    () => startRunRecorder({
      ...port,
      createRun: async () => { throw new Error("database unavailable"); },
    }, {
      sessionId: "run-log-database-outage",
      correlation: { requestId: "req_db", traceId: "0123456789abcdef0123456789abcdef", traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01" },
    }),
    /database unavailable/,
  );
}

// --- recorder: an event write failure prevents successful finalization -------
{
  const session = createWorkspaceSession({ id: "run-log-event-fail", name: "event fail", mode: "chat" });
  const updates = [];
  const recorder = await startRunRecorder({
    ...port,
    appendRunEvent: async () => { throw new Error("event persistence failed"); },
    updateRun: (_id, input) => { updates.push(input); },
  }, { sessionId: session.id, correlation: { requestId: "req_event_fail", traceId: "0123456789abcdef0123456789abcdef", traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01" } });
  recorder.record({ type: "text-delta", id: "t", delta: "not durable" });
  recorder.record({ type: "text-end", id: "t" });
  await assert.rejects(() => recorder.finalize({ status: "succeeded" }), /event persistence failed/);
  assert.deepEqual(updates, [], "the run cannot become succeeded while a queued event is not durable");
}

// --- recorder: a transient append failure retries in order without duplicates -
{
  const session = createWorkspaceSession({ id: "run-log-event-retry", name: "event retry", mode: "chat" });
  let available = false;
  const attempts = [];
  const persisted = [];
  const recorder = await startRunRecorder({
    ...port,
    appendRunEvent: async (input) => {
      attempts.push(input.event.kind);
      if (!available) throw new Error("event persistence unavailable");
      persisted.push(input.event.kind);
      return port.appendRunEvent(input);
    },
  }, {
    sessionId: session.id,
    correlation: { requestId: "req_event_retry", traceId: "0123456789abcdef0123456789abcdef", traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01" },
    promptComposition: { moduleIds: ["module-a"], skillIds: [] },
  });
  recorder.record({ type: "text-delta", id: "t", delta: "durable text" });
  recorder.record({ type: "text-end", id: "t" });
  await assert.rejects(() => recorder.finalize({ status: "succeeded" }), /event persistence unavailable/);
  available = true;
  await recorder.finalize({ status: "succeeded" });
  assert.deepEqual(persisted, ["status", "text"], "retry preserves event order and persists each event once");
  assert.deepEqual(attempts, ["status", "status", "text"], "only the failed head event is retried");
  assert.equal(getWorkspaceRun(recorder.runId).status, "succeeded");
}

// --- recorder + tee: happy path persists an ordered log and finalizes succeeded ---
{
  const session = createWorkspaceSession({ id: "run-log-ok", name: "ok", mode: "chat" });
  const recorder = await startRunRecorder(port, { sessionId: session.id, correlation: { requestId: "req_a", traceId: "0123456789abcdef0123456789abcdef", traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01" } });
  assert.ok(recorder, "recorder should start when a session exists");
  const chunks = [
    { type: "text-start", id: "t" },
    { type: "text-delta", id: "t", delta: "Hi " },
    { type: "text-delta", id: "t", delta: "there" },
    { type: "text-end", id: "t" },
    { type: SPEC_DATA_PART_TYPE, data: { type: "flat", spec: { root: "main", elements: {}, state: {} } } },
  ];
  const passed = await drain(teeRunEvents(streamOf(chunks), recorder));
  assert.equal(passed.length, chunks.length, "tee passes every chunk through untouched");
  const run = getWorkspaceRun(recorder.runId);
  assert.equal(run.status, "succeeded");
  assert.equal(run.resumable, false);
  assert.ok(run.ended_at);
  const events = listWorkspaceRunEvents(recorder.runId);
  const kinds = events.map((entry) => entry.event.kind);
  assert.deepEqual(kinds, ["text", "artifact"], "log holds the coalesced text then the artifact");
  const parts = rebuildRunMessageParts(events);
  assert.equal(parts[0].text, "Hi there");
  assert.equal(parts[1].type, SPEC_DATA_PART_TYPE);
}

// --- recorder + tee: mid-stream failure marks the run failed + resumable ---
{
  const session = createWorkspaceSession({ id: "run-log-fail", name: "fail", mode: "chat" });
  const recorder = await startRunRecorder(port, { sessionId: session.id, correlation: { requestId: "req_b", traceId: "0123456789abcdef0123456789abcdef", traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01" } });
  const chunks = [
    { type: "text-delta", id: "t", delta: "partial answer that never finished" },
    { type: "text-end", id: "t" },
    { type: "never", id: "x" },
  ];
  await assert.rejects(drain(teeRunEvents(streamOf(chunks, { failAt: 2 }), recorder)), /Run interrupted/);
  const run = getWorkspaceRun(recorder.runId);
  assert.equal(run.status, "failed");
  assert.equal(run.resumable, true, "interrupted runs are resumable");
  assert.equal(run.error_code, "AGENT_STREAM_FAILED");
  const events = listWorkspaceRunEvents(recorder.runId);
  assert.ok(events.some((entry) => entry.event.kind === "text"), "partial text before the drop is persisted");
  assert.ok(events.some((entry) => entry.event.kind === "error"), "a typed error event is recorded on failure");
}

// --- recorder + tee: client cancel marks the run canceled + resumable ---
{
  const session = createWorkspaceSession({ id: "run-log-cancel", name: "cancel", mode: "chat" });
  const recorder = await startRunRecorder(port, { sessionId: session.id, correlation: { requestId: "req_c", traceId: "0123456789abcdef0123456789abcdef", traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01" } });
  const stream = teeRunEvents(streamOf([{ type: "text-delta", id: "t", delta: "hello" }, { type: "text-end", id: "t" }]), recorder);
  const reader = stream.getReader();
  await reader.read();
  await reader.cancel("client-disconnect");
  const run = getWorkspaceRun(recorder.runId);
  assert.equal(run.status, "canceled");
  assert.equal(run.resumable, true, "a canceled/interrupted run stays resumable so it can be continued");
  assert.equal(run.error_code, "AGENT_STREAM_FAILED");
  const events = listWorkspaceRunEvents(recorder.runId);
  assert.ok(events.some((entry) => entry.event.kind === "text" && entry.event.text === "hello"), "cancel finalization flushes buffered partial text for reattach");
  const reattached = buildRunReattachMessage({ run, messages: [], events });
  assert.equal(reattached?.content, "hello", "a canceled unpersisted turn can be rebuilt for the Continue panel");
}

// --- recorder: analytics hints are stamped on the run as a status event ------
// Analytics-only: recorded so the run is analysable, ignored by the message
// rebuild (never alters the reattached message), and absent when no hints given.
{
  const session = createWorkspaceSession({ id: "run-log-hints", name: "hints", mode: "chat" });
  const recorder = await startRunRecorder(port, {
    sessionId: session.id,
    correlation: { requestId: "req_h", traceId: "0123456789abcdef0123456789abcdef", traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01" },
    analyticsHints: { entryFrom: "workflow_launcher", turnIndex: 2, isFirstRun: false, hasExistingArtifact: true },
  });
  await drain(teeRunEvents(streamOf([{ type: "text-delta", id: "t", delta: "hi" }, { type: "text-end", id: "t" }]), recorder));
  const events = listWorkspaceRunEvents(recorder.runId);
  const hintsEvent = events.find((entry) => entry.event.kind === "status" && entry.event.label === "analytics_hints");
  assert.ok(hintsEvent, "an analytics_hints status event is stamped on the run");
  assert.deepEqual(JSON.parse(hintsEvent.event.detail), { entryFrom: "workflow_launcher", turnIndex: 2, isFirstRun: false, hasExistingArtifact: true });
  // status events are provenance only — they never become rebuilt message parts.
  const parts = rebuildRunMessageParts(events);
  assert.ok(parts.every((part) => part.type !== "status"), "analytics hints never surface as a rendered message part");
  assert.equal(parts[0]?.text, "hi");
}

// --- recorder: no analytics_hints event when hints are absent -----------------
{
  const session = createWorkspaceSession({ id: "run-log-no-hints", name: "no hints", mode: "chat" });
  const recorder = await startRunRecorder(port, {
    sessionId: session.id,
    correlation: { requestId: "req_nh", traceId: "0123456789abcdef0123456789abcdef", traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01" },
  });
  await drain(teeRunEvents(streamOf([{ type: "text-delta", id: "t", delta: "hi" }, { type: "text-end", id: "t" }]), recorder));
  const events = listWorkspaceRunEvents(recorder.runId);
  assert.ok(!events.some((entry) => entry.event.kind === "status" && entry.event.label === "analytics_hints"), "absent hints leave the run event log unchanged");
}

// --- recorder + tee: an error part that closes the stream normally finalizes
//     failed + resumable (not succeeded), with exactly one error event and the
//     assistant message id back-filled from the `start` chunk ---
{
  const session = createWorkspaceSession({ id: "run-log-error-part", name: "error part", mode: "chat" });
  appendWorkspaceMessage({ id: "user-error-part", session_id: session.id, role: "user", content: "Trigger error" });
  const recorder = await startRunRecorder(port, { sessionId: session.id, userMessageId: "user-error-part", correlation: { requestId: "req_e", traceId: "0123456789abcdef0123456789abcdef", traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01" } });
  const chunks = [
    { type: "start", messageId: "msg-error-part" },
    { type: "text-delta", id: "t", delta: "Partial before the error" },
    { type: "text-end", id: "t" },
    { type: "error", errorText: rawProviderError },
  ];
  // The source closes normally (no failAt) even though it emitted an error part.
  await drain(teeRunEvents(streamOf(chunks), recorder));
  const run = getWorkspaceRun(recorder.runId);
  assert.equal(run.status, "failed", "an error part downgrades a normal close to failed");
  assert.equal(run.resumable, true, "error-part runs stay resumable so they reattach and offer Continue");
  assert.ok(run.error_code, "a run error code is classified from the error part");
  assert.equal(run.message_id, "msg-error-part", "the assistant message id is back-filled from the start chunk");
  assert.equal(run.user_message_id, "user-error-part", "the initiating user message id remains distinct from the assistant id");
  const events = listWorkspaceRunEvents(recorder.runId);
  const errorEvents = events.filter((entry) => entry.event.kind === "error");
  assert.equal(errorEvents.length, 1, "the mapped error part is the only error event (no synthesized duplicate)");
  assert.equal(run.error, "Run interrupted");
  assert.equal(run.error_code, "AGENT_STREAM_FAILED");
  assert.equal(JSON.stringify({ run, events }).includes("files/raw-ref"), false);
  assert.equal(JSON.stringify({ run, events }).includes("arbitrary model text"), false);
}

// --- reattach dedup requires the run's exact assistant message identity -------
{
  const session = createWorkspaceSession({ id: "run-reattach-dedup", name: "dedup", mode: "chat" });
  const run = createWorkspaceRun({ session_id: session.id });
  appendWorkspaceRunEvent({ run_id: run.id, session_id: session.id, kind: "text", event: { kind: "text", text: "Partial answer that never finished" } });
  updateWorkspaceRun(run.id, { status: "failed", resumable: true, error_code: "AGENT_STREAM_FAILED" });
  const failedRun = getWorkspaceRun(run.id);
  const events = listWorkspaceRunEvents(run.id);

  // An unrelated assistant cannot prove this run's turn was persisted.
  const unrelatedAssistant = buildRunReattachMessage({
    run: failedRun,
    messages: [
      { id: "user-1", role: "user" },
      { id: "msg-assistant-1", role: "assistant" },
    ],
    events,
  });
  assert.ok(unrelatedAssistant, "an assistant count without the run's message id cannot suppress reattach");

  // Tab was killed mid-stream: nothing was persisted client-side.
  const tabKilled = buildRunReattachMessage({ run: failedRun, messages: [], events });
  assert.ok(tabKilled, "an unpersisted interrupted turn is reattached from the event log");
  assert.equal(tabKilled.role, "assistant");
  assert.match(tabKilled.content, /Partial answer/);

  // Back-filled message id present among the persisted messages: also skipped.
  const withMessageId = getWorkspaceRun(updateWorkspaceRun(run.id, { message_id: "msg-assistant-1" }).id);
  const byMessageId = buildRunReattachMessage({
    run: withMessageId,
    messages: [{ id: "msg-assistant-1", role: "assistant" }],
    events,
  });
  assert.equal(byMessageId, null, "a run whose back-filled message id is already persisted is not reattached");
}

// --- session/client projection sanitizes legacy dirty failure rows -----------
{
  const safeExtension = {
    modeling: "safe",
    tokenCount: 3,
    homepage: "https://docs.example.com/extensions/safe",
    endpoint: "https://api.example.com/public",
    file: "files/guide.md",
    label: "skateboarding",
    "api-key-label": "public API key label",
    "request-url-label": "public request URL label",
    nested: { enabled: true, labels: ["a", "b"] },
  };
  const successfulParts = [{
    type: "tool-test",
    state: "output-available",
    output: {
      message: rawProviderError,
      provider_metadata: { reference: "files/raw-ref" },
      credentials: { apiKey: "sk-test-secret-value" },
      client_secret: "successful-client-secret",
      model_id: "successful-model-id",
      raw_response: "successful-raw-response",
      request_url: "https://provider.invalid/success",
      extension: safeExtension,
    },
  }];
  const dirtyPart = {
    type: "tool-test",
    toolCallId: "tool-dirty",
    toolName: "searchCatalog",
    state: "output-error",
    errorText: rawProviderError,
    detail: rawProviderError,
    url: "https://example.invalid/private",
    providerRef: "files/raw-ref",
    client_secret: "snake-client-secret",
    "private-key": "kebab-private-key",
    access_token: "snake-access-token",
    "model-id": "private-model-id",
    "raw-response": "private-raw-response",
    provider_reference: "files/private-ref",
    "api-key": "sk-kebab-secret-value",
    "request-url": "https://provider.invalid/private?signed=yes",
    credentials: { apiKey: "secret-provider-key" },
    clientSecret: "client-secret-value",
    providerMetadata: { google: { rawReference: "files/raw-ref", model: "arbitrary model text" } },
    output: {
      message: rawProviderError,
      providerText: "arbitrary model text",
      rawText: "arbitrary provider response",
      code: "PROVIDER_TIMEOUT",
      error_code: "AGENT_STREAM_FAILED",
      attempt: 2,
      retryable: true,
      toolCallId: "nested-tool-id",
      spec: { root: "main", elements: {}, state: { count: 1, providerRef: "files/raw-ref", password: "sk-test-secret-value", sessionToken: "session-token-value", url: "https://example.invalid/private", extension: safeExtension } },
    },
  };
  const projected = sanitizeSessionFailureProjection({
    runs: [{ id: "run-dirty", status: "failed", resumable: true, error: rawProviderError, error_code: "AGENT_STREAM_FAILED" }],
    messages: [
      { id: "legacy-dirty", role: "assistant", content: "Safe persisted text", parts: [dirtyPart] },
      { id: "successful", role: "assistant", content: "Safe docs at https://docs.example.com/files/guide.md", parts: successfulParts },
    ],
    reattach: {
      run: { id: "run-dirty", status: "failed", resumable: true, error: rawProviderError, error_code: "AGENT_STREAM_FAILED" },
      message: { id: "run:run-dirty", role: "assistant", content: "Partial safe text", parts: [{ type: "tool-test", toolCallId: "tool-dirty", state: "output-error", errorText: rawProviderError }] },
    },
    telemetry: [{ event: "api.generate.error", error: rawProviderError, payload: { event: "api.generate.error", error: rawProviderError } }],
  });
  const projectedSerialized = JSON.stringify(projected);
  const failureSerialized = JSON.stringify({ ...projected, messages: [projected.messages[0]] });
  assert.equal(failureSerialized.includes("files/raw-ref"), false);
  assert.equal(failureSerialized.includes("example.invalid"), false);
  assert.equal(failureSerialized.includes("arbitrary model text"), false);
  assert.equal(projectedSerialized.includes("sk-test-secret-value"), false);
  assert.equal(projectedSerialized.includes("client-secret-value"), false);
  assert.equal(projectedSerialized.includes("session-token-value"), false);
  assert.equal(projectedSerialized.includes("snake-client-secret"), false);
  assert.equal(projectedSerialized.includes("kebab-private-key"), false);
  assert.equal(projectedSerialized.includes("snake-access-token"), false);
  assert.equal(projectedSerialized.includes("private-model-id"), false);
  assert.equal(projectedSerialized.includes("private-raw-response"), false);
  assert.equal(projectedSerialized.includes("provider.invalid"), false);
  assert.equal(projectedSerialized.includes("successful-client-secret"), false);
  assert.equal(projectedSerialized.includes("successful-model-id"), false);
  assert.equal(projectedSerialized.includes("successful-raw-response"), false);
  assert.equal(projected.runs[0].error_code, "AGENT_STREAM_FAILED");
  assert.equal(projected.runs[0].resumable, true);
  assert.equal(projected.reattach.message.content, "Partial safe text");
  assert.equal(projected.reattach.message.parts[0].errorText, "Run interrupted");
  assert.equal(projected.messages[0].content, "Safe persisted text");
  assert.equal(projected.messages[0].parts[0].errorText, "Run interrupted");
  assert.equal(projected.messages[0].parts[0].detail, "Run interrupted");
  assert.equal(projected.messages[0].parts[0].toolName, "searchCatalog");
  assert.equal("providerMetadata" in projected.messages[0].parts[0], false);
  assert.equal("url" in projected.messages[0].parts[0], false);
  assert.equal("providerRef" in projected.messages[0].parts[0], false);
  assert.equal("credentials" in projected.messages[0].parts[0], false);
  assert.equal(projected.messages[0].parts[0].output.message, "Run interrupted");
  assert.equal("providerText" in projected.messages[0].parts[0].output, false);
  assert.equal("rawText" in projected.messages[0].parts[0].output, false);
  assert.equal(projected.messages[0].parts[0].output.code, "PROVIDER_TIMEOUT");
  assert.equal(projected.messages[0].parts[0].output.error_code, "AGENT_STREAM_FAILED");
  assert.equal(projected.messages[0].parts[0].output.attempt, 2);
  assert.equal(projected.messages[0].parts[0].output.retryable, true);
  assert.equal(projected.messages[0].parts[0].output.toolCallId, "nested-tool-id");
  assert.deepEqual(projected.messages[0].parts[0].output.spec, { root: "main", elements: {}, state: { count: 1, extension: safeExtension } });
  assert.equal(projected.messages[1].content, "Safe docs at https://docs.example.com/files/guide.md", "ordinary message links remain unchanged");
  assert.deepEqual(sanitizeSessionMessages([
    { content: "Bearer bonds are fixed-income securities." },
    { content: "Bearer authentication" },
    { content: "Bearer authorization" },
    { content: "Bearer authentication." },
    { content: "Bearer authorization." },
    { content: "Bearer authentication!" },
    { content: "Bearer authorization?" },
    { content: "Bearer authentication is required for this endpoint." },
    { content: "Please see files/handbook" },
    { content: "Read /files/handbook before launch." },
    { content: "See https://docs.example.com/files/handbook" },
  ]), [
    { content: "Bearer bonds are fixed-income securities." },
    { content: "Bearer authentication" },
    { content: "Bearer authorization" },
    { content: "Bearer authentication." },
    { content: "Bearer authorization." },
    { content: "Bearer authentication!" },
    { content: "Bearer authorization?" },
    { content: "Bearer authentication is required for this endpoint." },
    { content: "Please see files/handbook" },
    { content: "Read /files/handbook before launch." },
    { content: "See https://docs.example.com/files/handbook" },
  ], "ordinary bearer prose, file paths, and safe links remain unchanged");
  assert.deepEqual(sanitizeSessionMessages([
    { content: "Bearer abcdefghijklmnop" },
    { content: "Bearer abc123def456ghi" },
    { content: "Bearer authentication.xyz" },
    { content: "Google reference files/opaque-ref" },
    { content: "API key AIzaOpaqueProviderKey" },
  ]), [
    { content: "Run interrupted" },
    { content: "Run interrupted" },
    { content: "Run interrupted" },
    { content: "Run interrupted" },
    { content: "Run interrupted" },
  ], "structured bearer tokens, opaque provider references, and API keys are redacted");
  assert.deepEqual(projected.messages[1].parts[0].output.extension, safeExtension, "ordinary successful extension payloads remain unchanged");
  assert.equal(JSON.stringify(projected.messages[1]).includes("files/raw-ref"), false);
  assert.equal(JSON.stringify(projected.messages[1]).includes("example.invalid"), false);
  assert.equal(JSON.stringify(projected.messages[1]).includes("sk-test-secret-value"), false);
  assert.equal(JSON.stringify(projected.messages[1]).includes(rawProviderError), false);
  assert.deepEqual(sanitizeSessionMessages(projected.messages), projected.messages, "the narrow message projection is idempotent");
}

// --- only an exact assistant message identity suppresses reattach --------------
{
  assert.equal(
    runAssistantTurnPersisted({ message_id: null }, [
      { id: "user-1", role: "user" },
      { id: "assistant-1", role: "assistant" },
      { id: "user-2", role: "user" },
      { id: "assistant-2", role: "assistant" },
    ]),
    false,
    "assistant counts cannot dedupe a run without a matching durable message id",
  );
  assert.equal(
    runAssistantTurnPersisted({ message_id: "shared-id" }, [{ id: "shared-id", role: "user" }]),
    false,
    "a matching user-message id must not suppress assistant reattach",
  );
}

console.log("run-event-log tests passed");

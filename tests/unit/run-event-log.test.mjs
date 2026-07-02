import assert from "node:assert/strict";
import {
  SPEC_DATA_PART_TYPE,
  createRunEventMapper,
  rebuildRunMessageParts,
  rebuildRunMessageText,
  startRunRecorder,
  teeRunEvents,
} from "../../apps/standalone-sveltekit/src/lib/server/run-event-log.ts";
import {
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
  assert.equal(errorParts[0].errorText, "kaboom");
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
  await assert.rejects(drain(teeRunEvents(streamOf(chunks, { failAt: 2 }), recorder)), /upstream dropped/);
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

console.log("run-event-log tests passed");

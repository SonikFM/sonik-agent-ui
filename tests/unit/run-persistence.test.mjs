import assert from "node:assert/strict";
import {
  appendWorkspaceRunEvent,
  createWorkspaceRun,
  createWorkspaceSession,
  deleteWorkspaceSession,
  getWorkspaceRun,
  listWorkspaceRunEvents,
  listWorkspaceRuns,
  updateWorkspaceRun,
  workspaceProcedures,
} from "../../apps/standalone-sveltekit/src/lib/server/workspace-store.ts";

const session = createWorkspaceSession({ id: "run-session", name: "Run Session", mode: "chat" });

const run = createWorkspaceRun({
  session_id: session.id,
  message_id: "assistant-msg-1",
  request_id: "req_run_1",
  trace_id: "0123456789abcdef0123456789abcdef",
  traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
});
assert.equal(run.status, "running", "new runs start running");
assert.equal(run.resumable, false, "new runs are not resumable until they fail");
assert.equal(run.ended_at, null, "running runs have no ended_at");
assert.equal(run.session_id, session.id);
assert.equal(run.message_id, "assistant-msg-1");
assert.equal(run.request_id, "req_run_1");

// Ordered event log; auto-incrementing seq.
const first = appendWorkspaceRunEvent({ run_id: run.id, session_id: session.id, kind: "status", event: { kind: "status", label: "started" } });
const second = appendWorkspaceRunEvent({ run_id: run.id, session_id: session.id, kind: "text", event: { kind: "text", text: "Hello" } });
const third = appendWorkspaceRunEvent({ run_id: run.id, session_id: session.id, kind: "artifact", event: { kind: "artifact", spec: { root: "main", elements: {}, state: {} } } });
assert.deepEqual([first.seq, second.seq, third.seq], [0, 1, 2], "run event seq should auto-increment from 0");

const events = listWorkspaceRunEvents(run.id);
assert.equal(events.length, 3);
assert.deepEqual(events.map((entry) => entry.seq), [0, 1, 2], "listRunEvents returns events in seq order");
assert.equal(events[1].event.text, "Hello", "text event payload should round-trip");
assert.equal(events[2].kind, "artifact");

// Terminal failure: resumable + typed error code + ended_at set automatically.
const failed = updateWorkspaceRun(run.id, { status: "failed", resumable: true, error: "stream dropped", error_code: "AGENT_STREAM_FAILED" });
assert.equal(failed?.status, "failed");
assert.equal(failed?.resumable, true);
assert.equal(failed?.error_code, "AGENT_STREAM_FAILED");
assert.ok(failed?.ended_at, "terminal runs get an ended_at even when not supplied");
assert.equal(getWorkspaceRun(run.id)?.status, "failed");

// Succeeded run in the same session, listed in creation order.
const run2 = createWorkspaceRun({ session_id: session.id });
updateWorkspaceRun(run2.id, { status: "succeeded" });
const runs = listWorkspaceRuns(session.id);
assert.equal(runs.length, 2);
assert.deepEqual(runs.map((entry) => entry.id), [run.id, run2.id], "runs listed in creation order");
assert.equal(runs[1].status, "succeeded");
assert.equal(runs[1].resumable, false);

// Procedures surface is registered.
assert.equal(typeof workspaceProcedures["workspace.run.create"], "function");
assert.equal(typeof workspaceProcedures["workspace.run.event.append"], "function");

// Deleting the session drops its runs and their events.
assert.equal(deleteWorkspaceSession(session.id), true);
assert.equal(getWorkspaceRun(run.id), null, "deleting a session removes its runs");
assert.equal(listWorkspaceRunEvents(run.id).length, 0, "deleting a session removes its run events");

console.log("run-persistence tests passed");

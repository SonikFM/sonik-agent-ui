import assert from "node:assert/strict";
import { startRunRecorder } from "../../apps/standalone-sveltekit/src/lib/server/run-event-log.ts";

function createFakePort() {
  const events = [];
  let seq = 0;
  return {
    events,
    createRun() {
      return {
        id: "run_1",
        session_id: "session_1",
        message_id: null,
        status: "running",
        resumable: false,
        error: null,
        error_code: null,
        request_id: null,
        trace_id: null,
        traceparent: null,
        context_selection: null,
        started_at: "",
        ended_at: null,
        created_at: "",
        updated_at: "",
      };
    },
    appendRunEvent(input) {
      events.push(input);
      return { id: `event_${seq++}` };
    },
    updateRun() {
      return null;
    },
  };
}

const correlation = { requestId: "req_1", traceId: "trace_1", traceparent: "tp_1" };

// Composed module ids + per-turn skill ids are recorded as a single small status
// event so per-run prompt drift is diagnosable without persisting prompt text.
{
  const port = createFakePort();
  const recorder = await startRunRecorder(port, {
    sessionId: "session_1",
    correlation,
    promptComposition: { moduleIds: ["core", "booking-commands"], skillIds: ["booking.reservation.create"] },
  });
  assert.ok(recorder, "recorder should be created");
  await recorder.finalize({ status: "succeeded" });

  const statusEvent = port.events.find((entry) => entry.kind === "status" && entry.event?.label === "prompt_composition");
  assert.ok(statusEvent, "a prompt_composition status event must be recorded");
  const detail = JSON.parse(statusEvent.event.detail);
  assert.deepEqual(detail.moduleIds, ["core", "booking-commands"], "recorded module ids must match the composition");
  assert.deepEqual(detail.skillIds, ["booking.reservation.create"], "recorded skill ids must match the composition");
}

// Regression guard: callers that do not pass a composition record no such event
// (the pre-existing run-lifecycle behavior is unchanged).
{
  const port = createFakePort();
  const recorder = await startRunRecorder(port, { sessionId: "session_1", correlation });
  assert.ok(recorder, "recorder should be created");
  await recorder.finalize({ status: "succeeded" });
  assert.ok(
    !port.events.some((entry) => entry.event?.label === "prompt_composition"),
    "no prompt_composition event when composition is not provided",
  );
}

console.log(JSON.stringify({ ok: true, checked: "run-prompt-composition-record" }));

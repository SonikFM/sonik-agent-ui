import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  MAX_LIMIT,
  parseJsonlEvents,
  queryEvents,
} from "../../scripts/lib/agent-ui-evidence-query.mjs";

const execFileAsync = promisify(execFile);

const events = [
  { at: "2026-07-10T00:00:00.000Z", event: "first", requestId: "req-1", source: "unit", payload: { message: "contains req-2 as text" } },
  { at: "2026-07-10T00:01:00.000Z", event: "second", traceId: "trace-1", source: "unit", payload: { toolCallId: "tool-1" } },
  { at: "2026-07-10T00:02:00.000Z", event: "third", sessionId: "session-1", runId: "run-1", source: "unit", payload: { nested: { requestId: "nested-only" } } },
  { at: "2026-07-10T00:03:00.000Z", event: "fourth", messageId: "message-1", source: "other" },
];

const downloadedPipeBEnvelope = {
  objectKey: "workers/sonik-agent-ui/g005-pipe-b.json",
  request: { body: { prompt: "mentions req-text-only but is not telemetry correlation" } },
  logs: [
    {
      message: ["sonik_agent_ui_telemetry", {
        payload: {
          at: "2026-07-10T01:00:00.000Z",
          event: "api.generate.start",
          requestId: "req-pipe-b",
          traceId: "trace-pipe-b",
          note: "downloaded text also mentions req-text-only",
        },
      }],
    },
    {
      message: ["unrelated_log_tag", {
        payload: { at: "2026-07-10T01:01:00.000Z", event: "ignored.log", requestId: "req-ignored" },
      }],
    },
  ],
  unrelated: {
    logs: [{
      message: ["sonik_agent_ui_telemetry", {
        payload: { at: "2026-07-10T01:02:00.000Z", event: "nested.must-not-match", requestId: "req-nested" },
      }],
    }],
  },
};

{
  const result = queryEvents(events, { correlationId: "trace-1" });
  assert.deepEqual(result.events.map((event) => event.event), ["second"], "top-level explicit identifier fields match exactly");
}

{
  const result = queryEvents(events, { correlationId: "tool-1" });
  assert.deepEqual(result.events.map((event) => event.event), ["second"], "payload one-level explicit identifier fields match exactly");
}

{
  const result = queryEvents(events, { correlationId: "req-2" });
  assert.deepEqual(result.events, [], "correlationId never uses substring/full-blob search");
}

{
  const result = queryEvents(events, { correlationId: "nested-only" });
  assert.deepEqual(result.events, [], "correlationId does not search nested payload fields beyond one level");
}

{
  const result = queryEvents(events, { source: "unit", runId: "run-1" });
  assert.deepEqual(result.events.map((event) => event.event), ["third"], "existing exact filters are preserved");
}

{
  const firstPage = queryEvents(events, { limit: "2" });
  assert.deepEqual(firstPage.events.map((event) => event.event), ["first", "second"], "events are oldest-first");
  assert.equal(firstPage.nextCursor, "2", "nextCursor points to the next chronological offset");

  const secondPage = queryEvents(events, { limit: "2", cursor: firstPage.nextCursor });
  assert.deepEqual(secondPage.events.map((event) => event.event), ["third", "fourth"], "cursor resumes in chronological order");
  assert.equal(secondPage.nextCursor, null, "last page has no nextCursor");
}

{
  const unsortedEvents = [
    { at: "2026-07-10T00:02:00.000Z", event: "third" },
    { at: "2026-07-10T00:01:00.000Z", event: "second-a" },
    { at: "2026-07-10T00:03:00.000Z", event: "fourth" },
    { at: "2026-07-10T00:01:00.000Z", event: "second-b" },
    { at: "2026-07-10T00:00:00.000Z", event: "first" },
  ];
  const firstPage = queryEvents(unsortedEvents, { limit: "3" });
  assert.deepEqual(firstPage.events.map((event) => event.event), ["first", "second-a", "second-b"], "queryEvents sorts unsorted input by at with input-order tie-breaks before pagination");
  assert.equal(firstPage.nextCursor, "3");

  const secondPage = queryEvents(unsortedEvents, { limit: "3", cursor: firstPage.nextCursor });
  assert.deepEqual(secondPage.events.map((event) => event.event), ["third", "fourth"], "offset cursor is applied after deterministic chronological sorting");
  assert.equal(secondPage.nextCursor, null);
}

{
  const result = queryEvents(events, {
    since: "2026-07-10T00:01:00.000Z",
    until: "2026-07-10T00:02:00.000Z",
  });
  assert.deepEqual(result.events.map((event) => event.event), ["second", "third"], "since/until are inclusive ISO bounds");
}

{
  const parsed = parseJsonlEvents(`${JSON.stringify(events[0])}\nnot json\n${JSON.stringify(events[1])}\n`);
  assert.equal(parsed.length, 3, "malformed JSONL lines are retained as parse_error events");
  assert.equal(parsed[1].event, "telemetry.parse_error");
  assert.equal(parsed[1].ok, false);
  assert.equal(parsed[1].line, 2);
}

{
  const parsed = parseJsonlEvents(JSON.stringify(downloadedPipeBEnvelope, null, 2));
  assert.deepEqual(parsed.map((event) => event.event), ["api.generate.start"], "downloaded Pipe-B logs normalize only tagged telemetry tuples");
  assert.deepEqual(queryEvents(parsed, { correlationId: "req-pipe-b" }).events.map((event) => event.event), ["api.generate.start"], "downloaded Pipe-B requestId is exactly queryable");
  assert.deepEqual(queryEvents(parsed, { correlationId: "trace-pipe-b" }).events.map((event) => event.event), ["api.generate.start"], "downloaded Pipe-B traceId is exactly queryable");
  assert.deepEqual(queryEvents(parsed, { correlationId: "req-text-only" }).events, [], "downloaded Pipe-B text substrings cannot satisfy correlation");
  assert.deepEqual(queryEvents(parsed, { correlationId: "req-nested" }).events, [], "normalization does not recursively search unrelated nested JSON");
}

{
  const parsed = parseJsonlEvents([
    JSON.stringify({ at: "2026-07-10T02:00:00.000Z", event: "direct.event" }),
    JSON.stringify({ payload: { at: "2026-07-10T02:01:00.000Z", event: "direct.payload.event" } }),
    JSON.stringify({ message: ["sonik_agent_ui_telemetry", { payload: { at: "2026-07-10T02:01:30.000Z", event: "direct.message.tuple" } }] }),
    JSON.stringify({
      events: [
        { at: "2026-07-10T02:02:00.000Z", event: "events.direct" },
        { payload: { at: "2026-07-10T02:03:00.000Z", event: "events.payload" } },
        { message: ["sonik_agent_ui_telemetry", { payload: { at: "2026-07-10T02:03:30.000Z", event: "events.message.tuple" } }] },
        { logs: [{ message: ["sonik_agent_ui_telemetry", { payload: { at: "2026-07-10T02:04:00.000Z", event: "events.logs.tuple" } }] }] },
        { requestId: "req-container-only", note: "an unknown container member is not telemetry" },
      ],
    }),
  ].join("\n"));
  assert.deepEqual(
    parsed.map((event) => event.event),
    ["direct.event", "direct.payload.event", "direct.message.tuple", "events.direct", "events.payload", "events.message.tuple", "events.logs.tuple"],
    "direct events and the explicit events, logs, payload, and tagged tuple shapes normalize without arbitrary recursion",
  );
  assert.deepEqual(queryEvents(parsed, { correlationId: "req-container-only" }).events, [], "unknown events container members do not cross the telemetry privacy boundary");
}

{
  const many = Array.from({ length: MAX_LIMIT + 25 }, (_, index) => ({ at: `2026-07-10T00:${String(index % 60).padStart(2, "0")}:00.000Z`, event: `event-${index}` }));
  const result = queryEvents(many, { limit: String(MAX_LIMIT + 999) });
  assert.equal(result.events.length, MAX_LIMIT, "limit is hard-capped at MAX_LIMIT");
  assert.equal(result.nextCursor, String(MAX_LIMIT));
}

{
  const directory = await mkdtemp(path.join(tmpdir(), "agent-ui-evidence-query-"));
  const logPath = path.join(directory, "events.jsonl");
  await writeFile(logPath, events.map((event) => JSON.stringify(event)).join("\n") + "\n", "utf8");
  const { stdout } = await execFileAsync(process.execPath, ["scripts/agent-ui-evidence-query.mjs", "--log", logPath, "--correlationId", "message-1"], { cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..") });
  const output = JSON.parse(stdout);
  assert.equal(output.ok, true, "CLI emits machine-readable JSON");
  assert.deepEqual(output.events.map((event) => event.event), ["fourth"], "CLI uses the same JSONL query helpers");
  assert.equal(output.nextCursor, null);

  const downloadedPath = path.join(directory, "downloaded-pipe-b.json");
  await writeFile(downloadedPath, JSON.stringify(downloadedPipeBEnvelope, null, 2), "utf8");
  const downloadedRun = await execFileAsync(process.execPath, ["scripts/agent-ui-evidence-query.mjs", "--log", downloadedPath, "--correlationId", "trace-pipe-b"], { cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..") });
  const downloadedOutput = JSON.parse(downloadedRun.stdout);
  assert.equal(downloadedOutput.ok, true, "CLI reads a downloaded Pipe-B JSON object");
  assert.deepEqual(downloadedOutput.events.map((event) => event.event), ["api.generate.start"]);
}

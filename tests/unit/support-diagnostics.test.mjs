import assert from "node:assert/strict";
import {
  sanitizePageContext,
  sanitizeTurnCorrelationSnapshot,
} from "../../packages/agent-observability/src/index.ts";
import {
  createTurnCorrelationSnapshot,
  selectTurnCorrelationRecord,
  upsertTurnCorrelationRecord,
} from "../../apps/standalone-sveltekit/src/lib/chat-correlation.ts";
import {
  createSupportDiagnosticsExport,
  exportTranscriptMarkdown,
} from "../../apps/standalone-sveltekit/src/lib/support-export.ts";

const secret = `sk-${"supportsecret".repeat(2)}`;
const traceparent = "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01";

{
  const context = sanitizePageContext({
    route: "/chat",
    surface: "workspace",
    activeSessionId: "sess-1",
    deployment: {
      id: `deploy-${secret}`,
      tag: "preview",
      timestamp: "2026-07-10T00:00:00.000Z",
      headers: { authorization: secret },
      signedHostContext: "must-not-export",
    },
    correlation: {
      sessionId: "sess-1",
      messageId: "msg-1",
      requestId: "req-support-1",
      traceparent,
      agentUiRunId: "run-1",
      status: "success",
      capturedAt: "2026-07-10T00:00:00.000Z",
      deployment: { id: `build-${secret}`, cookie: secret },
      headers: { cookie: secret },
      payload: { prompt: "private prompt" },
    },
    headers: { authorization: secret },
    cookies: secret,
  });

  const serialized = JSON.stringify(context);
  assert.equal(context?.deployment?.tag, "preview");
  assert.equal(context?.correlation?.traceId, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(serialized.includes(secret), false, "page context support fields redact secret-shaped values");
  assert.equal(serialized.includes("headers"), false, "page context does not allowlist headers");
  assert.equal(serialized.includes("signedHostContext"), false, "page context does not allowlist signed host context");
  assert.equal(serialized.includes("private prompt"), false, "page context correlation excludes prompt payloads");
}

{
  assert.equal(sanitizeTurnCorrelationSnapshot({ sessionId: "sess", requestId: "req", status: "pending", capturedAt: "now" }), undefined);
  const record = createTurnCorrelationSnapshot({
    sessionId: "sess-a",
    messageId: "msg-a",
    requestId: "req-a",
    status: "error",
  }, () => new Date("2026-07-10T01:00:00.000Z"));
  assert.equal(record?.status, "error");
  assert.equal(record?.capturedAt, "2026-07-10T01:00:00.000Z");
}

{
  let records = [];
  records = upsertTurnCorrelationRecord(records, { sessionId: "sess-a", messageId: "msg-1", requestId: "req-old", status: "success", capturedAt: "2026-07-10T00:00:00.000Z" });
  records = upsertTurnCorrelationRecord(records, { sessionId: "sess-b", messageId: "msg-1", requestId: "req-other-session", status: "success", capturedAt: "2026-07-10T00:05:00.000Z" });
  records = upsertTurnCorrelationRecord(records, { sessionId: "sess-a", messageId: "msg-1", requestId: "req-new", status: "error", capturedAt: "2026-07-10T00:10:00.000Z" });

  assert.equal(records.length, 2, "same session+message upsert replaces the old record only");
  assert.equal(selectTurnCorrelationRecord(records, { sessionId: "sess-a", messageId: "msg-1" })?.requestId, "req-new");
  assert.equal(selectTurnCorrelationRecord(records, { sessionId: "sess-b", messageId: "msg-1" })?.requestId, "req-other-session");
  assert.equal(selectTurnCorrelationRecord(records, { sessionId: "sess-missing" }) == null, true, "latest selection never falls back across sessions");

  const bounded = Array.from({ length: 60 }, (_, index) => upsertTurnCorrelationRecord([], {
    sessionId: "sess-bound",
    messageId: `msg-${index}`,
    requestId: `req-${index}`,
    capturedAt: `2026-07-10T00:${String(index).padStart(2, "0")}:00.000Z`,
  })).flat();
  const boundedUpserts = bounded.reduce((list, record) => upsertTurnCorrelationRecord(list, record), []);
  assert.equal(boundedUpserts.length, 50, "correlation records are bounded");
  assert.equal(boundedUpserts[0].messageId, "msg-10", "oldest records are dropped when bounding");
}

{
  const markdown = exportTranscriptMarkdown([
    {
      role: "user",
      content: "fallback text should be ignored when visible parts exist",
      parts: [
        { type: "text", text: "Hello " },
        { type: "tool-createJsonArtifact", input: { prompt: "secret tool input" }, output: { content: "secret tool output" } },
        { type: "data-spec", spec: { props: { text: "secret artifact" } } },
        { type: "reasoning", text: "hidden chain of thought" },
        { type: "text", text: "world" },
      ],
      metadata: { token: secret },
    },
    { role: "assistant", parts: [{ type: "text", text: "Visible assistant text" }, { type: "document", content: "secret document" }] },
    { role: "tool", content: "tool role output should not export", parts: [{ type: "text", text: "tool text" }] },
  ]);

  assert.equal(markdown.includes("## user"), true);
  assert.equal(markdown.includes("Hello world"), true);
  assert.equal(markdown.includes("Visible assistant text"), true);
  assert.equal(markdown.includes("fallback text should be ignored"), false, "message content fallback is not a visible text part");
  assert.equal(markdown.includes("secret tool"), false);
  assert.equal(markdown.includes("secret artifact"), false);
  assert.equal(markdown.includes("hidden chain"), false);
  assert.equal(markdown.includes("secret document"), false);
  assert.equal(markdown.includes("system policy text"), false);
  assert.equal(markdown.includes("## system"), false);
  assert.equal(markdown.includes("tool role output"), false);
  assert.equal(markdown.includes(secret), false);
}

{
  const diagnostics = createSupportDiagnosticsExport({
    generatedAt: "2026-07-10T02:00:00.000Z",
    sessionId: "sess-support",
    deployment: { id: "dep-1", tag: "preview", timestamp: "2026-07-10T02:00:00.000Z", headers: secret },
    correlationRecords: [
      { sessionId: "sess-support", messageId: "msg-1", requestId: "req-1", status: "success", capturedAt: "2026-07-10T02:00:00.000Z" },
      { sessionId: "sess-support", messageId: "msg-2", requestId: `req-${secret}`, status: "error", capturedAt: "2026-07-10T02:01:00.000Z" },
    ],
    runSummaries: Array.from({ length: 60 }, (_, index) => ({
      sessionId: "sess-support",
      runId: `run-${index}`,
      status: "success",
      durationMs: index,
      promptText: "must not export",
      rawMessage: { content: "must not export" },
      headers: secret,
      payload: { input: "must not export" },
    })),
    telemetrySummaries: [{ sessionId: "sess-support", event: "api.generate.done", ok: true, payload: { token: secret }, authorization: secret, error: `failed ${secret}` }, { sessionId: "other-session", event: "must-not-export" }],
    limit: 25,
  });

  const serialized = JSON.stringify(diagnostics);
  assert.equal(serialized.includes("must-not-export"), false, "diagnostics filter out other sessions");
  assert.equal(diagnostics?.schemaVersion, "sonik.agent_ui.support_diagnostics.v1");
  assert.equal(diagnostics?.runSummaries.length, 25, "run summaries are bounded");
  assert.equal(diagnostics?.telemetrySummaries[0].event, "api.generate.done");
  assert.equal(serialized.includes(secret), false, "diagnostics redacts secret-shaped scalar values");
  assert.equal(serialized.includes("promptText"), false, "diagnostics excludes prompt text fields");
  assert.equal(serialized.includes("rawMessage"), false, "diagnostics excludes raw message objects");
  assert.equal(serialized.includes("payload"), false, "diagnostics excludes payload objects");
  assert.equal(serialized.includes("authorization"), false, "diagnostics excludes auth/header fields");
}

console.log("support diagnostics tests passed");

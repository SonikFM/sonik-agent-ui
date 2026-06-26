import assert from "node:assert/strict";
import {
  AGENT_UI_TELEMETRY_SCHEMA_VERSION,
  createTelemetryCorrelation,
  createTelemetryEvent,
  readableError,
  sanitizePageContext,
  sanitizeTelemetryEvent,
  sanitizeTelemetryPath,
  sanitizeTelemetryValue,
  traceIdFromTraceparent,
} from "../../packages/agent-observability/src/index.ts";

const sampleVercelKey = ["v", "ck", "_", "TESTREDACTME123"].join("");
const sampleBearer = `Bearer ${["super", "secret", "value", "123456789"].join("-")}`;

{
  const event = sanitizeTelemetryEvent({
    source: "server",
    event: "api.generate.start",
    requestId: "req_test_123",
    traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
    commandFamilies: ["artifact", "", 42, ...Array.from({ length: 20 }, (_, index) => `family-${index}`)],
    payload: {
      Authorization: sampleBearer,
      nested: { apiKey: sampleVercelKey },
    },
    ok: true,
  });

  assert.equal(event.schemaVersion, AGENT_UI_TELEMETRY_SCHEMA_VERSION);
  assert.equal(event.traceId, "0123456789abcdef0123456789abcdef");
  assert.equal(event.commandFamilies?.length, 8);
  assert.equal(event.payload?.Authorization, "[REDACTED]");
  assert.equal(event.payload?.nested.apiKey, "[REDACTED]");
}

{
  const correlation = createTelemetryCorrelation({ traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01", requestId: "req-existing" });
  assert.equal(correlation.requestId, "req-existing");
  assert.equal(correlation.traceId, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(traceIdFromTraceparent(correlation.traceparent), correlation.traceId);
}

{
  const context = sanitizePageContext({
    route: "/campaigns/new",
    surface: "wizard",
    activeSessionId: "sess-1",
    activeEntity: { type: "campaign", id: "cmp_1", label: "Launch Campaign" },
    activeArtifactId: null,
    messageCount: 2,
    commandFamilies: ["booking", "campaign", "", "booking"],
  });
  assert.equal(context?.surface, "wizard");
  assert.equal(context?.activeEntity?.label, "Launch Campaign");
  assert.equal(context?.activeArtifactId, null);
  assert.deepEqual(context?.commandFamilies, ["booking", "campaign", "booking"]);
}

{
  const created = createTelemetryEvent({ source: "client", event: "chat.submit.start", payload: { token: sampleVercelKey } });
  assert.equal(created.source, "client");
  assert.equal(typeof created.eventId, "string");
  assert.equal(created.payload?.token, "[REDACTED]");
}

{
  assert.equal(sanitizeTelemetryPath(`/Users/danielletterio/Documents/key-${sampleVercelKey}`), "/Users/[user]/Documents/key-[REDACTED]");
  assert.equal(sanitizeTelemetryValue({ password: "abc", keep: "value" }).password, "[REDACTED]");
  assert.equal(readableError(new Error("boom")).message, "boom");
}

console.log("agent-observability tests passed");

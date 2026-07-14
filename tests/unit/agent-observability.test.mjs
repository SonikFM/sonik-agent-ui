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
import { logArtifactTelemetry } from "../../apps/standalone-sveltekit/src/lib/artifacts/artifact-telemetry.ts";
import { sanitizeAgentTelemetry } from "../../apps/standalone-sveltekit/src/lib/server/agent-telemetry.ts";

const sampleVercelKey = ["v", "ck", "_", "TESTREDACTME123"].join("");
const sampleBearer = `Bearer ${["super", "secret", "value", "123456789"].join("-")}`;
const rawProviderError = "Google provider files/raw-ref at https://example.invalid/private said arbitrary model text";

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
  const event = sanitizeAgentTelemetry({ source: "server", event: "api.generate.error", error: rawProviderError, payload: { error: rawProviderError }, ok: false });
  const serialized = JSON.stringify(event);
  assert.equal(event.error, "Run failed");
  assert.equal(event.payload?.error, "Run failed");
  assert.equal(serialized.includes("files/raw-ref"), false);
  assert.equal(serialized.includes("arbitrary model text"), false);
}

{
  const dirtyPayload = {
    detail: rawProviderError,
    code: "AGENT_STREAM_FAILED",
    commandId: "booking.safe.command",
    nested: { providerMetadata: { google: { rawReference: "files/raw-ref" } }, model: "arbitrary model text" },
    url: "https://example.invalid/private",
    credential: sampleVercelKey,
  };
  for (const event of [
    sanitizeAgentTelemetry({ source: "server", event: "api.generate.error", ok: false, payload: dirtyPayload }),
    sanitizeTelemetryEvent({ source: "client", event: "artifact.error", error: "failed", payload: dirtyPayload }),
    sanitizeTelemetryEvent({ source: "client", event: "artifact.telemetry", payload: { error: rawProviderError, nested: dirtyPayload } }),
  ]) {
    const serialized = JSON.stringify(event);
    assert.equal(serialized.includes("files/raw-ref"), false);
    assert.equal(serialized.includes("example.invalid"), false);
    assert.equal(serialized.includes("arbitrary model text"), false);
    assert.equal(serialized.includes(sampleVercelKey), false);
    assert.equal(serialized.includes("providerMetadata"), false);
    assert.ok(serialized.includes("Run failed"));
    if ("detail" in event.payload) assert.equal(event.payload.detail, "Run failed");
    const structured = "detail" in event.payload ? event.payload : event.payload.nested;
    assert.equal(structured.code, "AGENT_STREAM_FAILED");
    assert.equal(structured.commandId, "booking.safe.command");
  }
}

{
  const event = sanitizeTelemetryEvent({
    source: "server",
    event: "artifact.success",
    ok: true,
    payload: { nested: { provider_reference: "files/opaque-secret-ref", "provider-metadata": { request_url: "https://provider.invalid/private", access_token: "secret-token" }, model_id: "private-model-id", providerPreference: "direct", providerLabel: "Google" } },
  });
  assert.deepEqual(event.payload.nested, { providerPreference: "direct", providerLabel: "Google" });
}

{
  assert.equal(sanitizeTelemetryPath(`/Users/danielletterio/Documents/key-${sampleVercelKey}`), "/Users/[user]/Documents/key-[REDACTED]");
  assert.equal(sanitizeTelemetryValue({ password: "abc", keep: "value" }).password, "[REDACTED]");
  assert.equal(readableError(new Error("boom")).message, "boom");
}

{
  const rawSecret = `sk-${"test".repeat(4)}`;
  const lines = [];
  const originalInfo = console.info;
  const originalWarn = console.warn;
  console.info = (...args) => lines.push(args.join(" "));
  console.warn = (...args) => lines.push(args.join(" "));

  try {
    logArtifactTelemetry({
      source: "client",
      event: "artifact.secret-redaction.regression",
      title: `Generated title ${rawSecret}`,
      reason: `Rejected because ${rawSecret}`,
      lossy: true,
      fixCount: 1,
    });
    logArtifactTelemetry({
      source: "client",
      event: "artifact.provider-error.regression",
      error: rawProviderError,
      payload: { detail: rawProviderError, providerMetadata: { raw: "files/raw-ref" }, safeCount: 2, retryable: true },
    });
  } finally {
    console.info = originalInfo;
    console.warn = originalWarn;
  }

  assert.equal(lines.length, 2);
  assert.ok(!lines[0].includes(rawSecret), "artifact telemetry console output must not include raw secret-shaped values");
  assert.ok(lines[0].includes("[REDACTED]"), "artifact telemetry console output should include the redaction marker");
  assert.ok(lines[0].includes('"lossy":true'), "artifact telemetry should preserve custom boolean fields");
  assert.ok(lines[0].includes('"fixCount":1'), "artifact telemetry should preserve custom numeric fields");
  assert.equal(lines[1].includes("files/raw-ref"), false);
  assert.equal(lines[1].includes("example.invalid"), false);
  assert.equal(lines[1].includes("arbitrary model text"), false);
  assert.equal(lines[1].includes("providerMetadata"), false);
  assert.ok(lines[1].includes('"error":"Run failed"'));
  assert.ok(lines[1].includes('"safeCount":2'));
  assert.ok(lines[1].includes('"retryable":true'));
}

console.log("agent-observability tests passed");

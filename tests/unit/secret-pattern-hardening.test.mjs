import assert from "node:assert/strict";
import { redactTelemetryString } from "../../packages/agent-observability/src/index.ts";
import { sanitizeAgentHostPageContext } from "../../packages/agent-embed/src/index.ts";

// SECRET_VALUE_PATTERN in agent-observability/src/index.ts and agent-embed/src/index.ts
// require 12+ characters after a sk-/vck_ prefix, so realistic-length secrets like
// "sk-live-abc123" (11 post-prefix chars) slip through both value-redaction paths.
// This suite pins the fix at the smallest post-prefix threshold that catches the
// known-bad fixtures without redacting benign hyphenated/prefixed strings.

const secretCases = [
  ["sk-live-abc123", "sk- prefix, 11 post-prefix chars"],
  ["sk-abc12345", "sk- prefix, 8 post-prefix chars"],
  ["vck_short123", "vck_ prefix, 8 post-prefix chars"],
  ["reply included Bearer sk-live-abc123 mid-sentence", "bearer-style token embedded mid-sentence"],
];

const benignCases = [
  ["turn-0", "turn id"],
  ["task-123", "task id"],
  ["risk-assessment", "word containing sk- without a boundary"],
  ["desk-lamp", "word containing sk- without a boundary"],
  ["a1b2c3d4-e5f6-7890-abcd-ef1234567890", "plain uuid"],
];

// agent-observability: redactTelemetryString is the exported value-redaction seam.
for (const [value, why] of secretCases) {
  const result = redactTelemetryString(value);
  assert.equal(result.includes("[REDACTED]"), true, `agent-observability must redact: ${why} (${value})`);
  assert.equal(result.includes(value.replace(/^.*?(sk-|vck_|Bearer\s+)/, "")), false, `agent-observability must not leak raw secret text: ${why}`);
}
for (const [value, why] of benignCases) {
  assert.equal(redactTelemetryString(value), value, `agent-observability must not redact benign string: ${why} (${value})`);
}

// agent-embed: sanitizeAgentHostPageContext is the exported entry point whose
// activeEntity.label passes through the local cleanText() -> SECRET_VALUE_PATTERN seam.
for (const [value, why] of secretCases) {
  const context = sanitizeAgentHostPageContext({ activeEntity: { type: "booking", id: "booking_1", label: value } });
  assert.equal(context?.activeEntity?.label?.includes("[REDACTED]"), true, `agent-embed must redact: ${why} (${value})`);
}
for (const [value, why] of benignCases) {
  const context = sanitizeAgentHostPageContext({ activeEntity: { type: "booking", id: "booking_1", label: value } });
  assert.equal(context?.activeEntity?.label, value, `agent-embed must not redact benign string: ${why} (${value})`);
}

console.log("secret-pattern-hardening: ok");

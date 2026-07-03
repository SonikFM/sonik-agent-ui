import assert from "node:assert/strict";
import {
  DEFAULT_AGENT_MODEL_ID,
  createDefaultAgentToolPermissionModes,
  sanitizeAgentRuntimeSettings,
  summarizeAgentRuntimeSettings,
  isAgentToolFamilyEnabled,
  resolveAgentToolPermissionMode,
} from "../../apps/standalone-sveltekit/src/lib/agent-settings.ts";

const defaults = createDefaultAgentToolPermissionModes();
assert.equal(defaults.booking, "ask");
assert.equal(defaults.bookings, "ask");

const sanitized = sanitizeAgentRuntimeSettings({
  modelId: "deepseek/deepseek-v4-pro",
  skillIds: ["booking.context.intake", "unknown", "booking.context.intake", "booking.reservation.create"],
  toolPermissionModes: {
    booking: "off",
    bookings: "allow",
    nope: "allow",
    "booking-holds": "bogus",
  },
});
assert.equal(sanitized.modelId, "deepseek/deepseek-v4-pro");
assert.deepEqual(sanitized.skillIds, ["booking.context.intake", "booking.reservation.create"]);
assert.equal(sanitized.toolPermissionModes.booking, "off");
assert.equal(sanitized.toolPermissionModes.bookings, "allow");
assert.equal(resolveAgentToolPermissionMode("booking", sanitized.toolPermissionModes), "off");
assert.equal(isAgentToolFamilyEnabled("booking", sanitized.toolPermissionModes), false);
assert.equal(isAgentToolFamilyEnabled("bookings", sanitized.toolPermissionModes), true);
assert.equal(sanitized.toolPermissionModes["booking-holds"], "ask");
assert.ok(!("nope" in sanitized.toolPermissionModes));
assert.match(summarizeAgentRuntimeSettings(sanitized), /host approval/);

const fallback = sanitizeAgentRuntimeSettings({ modelId: "not-a-model", skillIds: ["bad"], toolPermissionModes: { booking: "bad" } });
assert.equal(fallback.modelId, DEFAULT_AGENT_MODEL_ID);
assert.deepEqual(fallback.skillIds, []);
console.log("agent-settings.test: ok");

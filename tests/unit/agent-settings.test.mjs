import assert from "node:assert/strict";
import {
  DEFAULT_AGENT_MODEL_ID,
  MAX_AGENT_CUSTOM_SKILL_MARKDOWN_CHARS,
  createAgentCustomSkillId,
  createDefaultAgentToolPermissionModes,
  sanitizeAgentRuntimeSettings,
  summarizeAgentRuntimeSettings,
  isAgentToolFamilyEnabled,
  isStaticAgentModelId,
  isValidAgentModelId,
  resolveAgentToolPermissionMode,
} from "../../apps/standalone-sveltekit/src/lib/agent-settings.ts";

const defaults = createDefaultAgentToolPermissionModes();
assert.equal(defaults.booking, "ask");
assert.equal(defaults.bookings, "ask");
assert.equal(isStaticAgentModelId("deepseek/deepseek-v4-pro"), true);
assert.equal(isValidAgentModelId("openai/gpt-4.1"), true);
assert.equal(isValidAgentModelId("not-a-model"), false);

const sanitized = sanitizeAgentRuntimeSettings({
  modelId: "openai/gpt-4.1",
  requireZdr: false,
  skillIds: ["booking.context.intake", "unknown", "booking.context.intake", "booking.reservation.create"],
  additionalSystemPrompt: "Prefer concise receipts.\u0000",
  customSkills: [
    { id: "custom.demo", label: "Demo Skill", markdown: "# Demo\nUse demo-safe language.", enabled: true },
    { id: "unsafe", label: "Bad Id", markdown: "still accepted with safe custom id", enabled: false },
    { label: "Missing markdown", markdown: "" },
  ],
  toolPermissionModes: {
    booking: "off",
    bookings: "allow",
    nope: "allow",
    "booking-holds": "bogus",
  },
});
assert.equal(sanitized.modelId, "openai/gpt-4.1");
assert.equal(sanitized.requireZdr, false);
assert.deepEqual(sanitized.skillIds, ["booking.context.intake", "booking.reservation.create"]);
assert.equal(sanitized.additionalSystemPrompt, "Prefer concise receipts.");
assert.equal(sanitized.customSkills.length, 2);
assert.equal(sanitized.customSkills[0].id, "custom.demo");
assert.equal(sanitized.customSkills[1].id.startsWith("custom."), true);
assert.equal(sanitized.customSkills[1].enabled, false);
assert.equal(sanitized.toolPermissionModes.booking, "off");
assert.equal(sanitized.toolPermissionModes.bookings, "allow");
assert.equal(resolveAgentToolPermissionMode("booking", sanitized.toolPermissionModes), "off");
assert.equal(isAgentToolFamilyEnabled("booking", sanitized.toolPermissionModes), false);
assert.equal(isAgentToolFamilyEnabled("bookings", sanitized.toolPermissionModes), true);
assert.equal(sanitized.toolPermissionModes["booking-holds"], "ask");
assert.ok(!("nope" in sanitized.toolPermissionModes));
const summary = summarizeAgentRuntimeSettings(sanitized);
assert.match(summary, /model=openai\/gpt-4\.1/);
assert.match(summary, /ZDR required=no/);
assert.match(summary, /User-added agent instructions/);
assert.match(summary, /Demo Skill/);
assert.match(summary, /host approval/);

const fallback = sanitizeAgentRuntimeSettings({ modelId: "not-a-model", skillIds: ["bad"], toolPermissionModes: { booking: "bad" } });
assert.equal(fallback.modelId, DEFAULT_AGENT_MODEL_ID);
assert.equal(fallback.requireZdr, true);
assert.deepEqual(fallback.skillIds, []);

const longSkill = sanitizeAgentRuntimeSettings({ customSkills: [{ label: "Long", markdown: "x".repeat(MAX_AGENT_CUSTOM_SKILL_MARKDOWN_CHARS + 50) }] });
assert.equal(longSkill.customSkills[0].markdown.length, MAX_AGENT_CUSTOM_SKILL_MARKDOWN_CHARS);
assert.equal(createAgentCustomSkillId("My Skill", ["custom.my-skill"]), "custom.my-skill-2");
console.log("agent-settings.test: ok");

import assert from "node:assert/strict";
import {
  AGENT_PROMPT_CORE,
  AGENT_PROMPT_MODULES,
  AGENT_PROMPT_OVERRIDABLE_MODULE_IDS,
  CORE_MODULE_ID,
  PRODUCT_OUTPUT_INVARIANT,
  PRODUCT_OUTPUT_INVARIANT_MODULE_ID,
  composeAgentSystemPrompt,
} from "../../apps/standalone-sveltekit/src/lib/agent-prompt.ts";
import {
  RUNTIME_SKILL_PROMPT_MAX_BODY_CHARS,
  RUNTIME_SKILL_PROMPT_MAX_TOTAL_CHARS,
  resolveRuntimeSkillPromptModules,
} from "../../apps/standalone-sveltekit/src/lib/server/skill-registry.ts";
import {
  MAX_AGENT_PROMPT_OVERRIDE_CHARS,
  sanitizeAgentRuntimeSettings,
} from "../../apps/standalone-sveltekit/src/lib/agent-settings.ts";

// -----------------------------------------------------------------------------
// (a) Golden parity: composeAgentSystemPrompt() and resolveRuntimeSkillPromptModules()
// with no overrides (or an empty overrides map) must be byte-identical to the
// pre-override-feature output. This is the test the implementation was required
// to satisfy FIRST; the assertions below were confirmed red (composeAgentSystemPrompt
// threw/omitted CORE_MODULE_ID before agent-prompt.ts exported it, and the
// promptModuleOverrides/skillPromptOverrides fields did not exist) against the
// pre-change source via `git stash`, then green after implementing the override
// plumbing described below.
// -----------------------------------------------------------------------------

const noArgsComposed = composeAgentSystemPrompt();
const emptyOverridesComposed = composeAgentSystemPrompt({ promptModuleOverrides: {} });
assert.deepEqual(emptyOverridesComposed, noArgsComposed, "an empty overrides map must reproduce the no-args composition exactly");
assert.deepEqual(
  noArgsComposed.moduleIds,
  [CORE_MODULE_ID, ...AGENT_PROMPT_MODULES.map((module) => module.id), PRODUCT_OUTPUT_INVARIANT_MODULE_ID],
  "default seeding must include core first, every overridable module, then the final invariant",
);
assert.equal(noArgsComposed.prompt.startsWith(AGENT_PROMPT_CORE), true, "default composition must still start with the unmodified core text");
assert.deepEqual(
  AGENT_PROMPT_OVERRIDABLE_MODULE_IDS,
  [CORE_MODULE_ID, ...AGENT_PROMPT_MODULES.map((module) => module.id)],
  "the overridable module id list must match core + every seedable module, in order",
);
assert.equal(AGENT_PROMPT_OVERRIDABLE_MODULE_IDS.includes(PRODUCT_OUTPUT_INVARIANT_MODULE_ID), false, "the product-output invariant must not be exposed as an Agent Settings override target");
assert.equal(noArgsComposed.prompt.endsWith(PRODUCT_OUTPUT_INVARIANT), true, "the product-output invariant must be the final prompt section");

const noOverridesSkillModules = resolveRuntimeSkillPromptModules(["booking.reservation.create"]);
const emptyOverridesSkillModules = resolveRuntimeSkillPromptModules(["booking.reservation.create"], {});
assert.deepEqual(emptyOverridesSkillModules, noOverridesSkillModules, "an empty skill overrides map must reproduce the no-overrides resolution exactly");
assert.ok(noOverridesSkillModules.length >= 1, "sanity: booking-reservation must still resolve at least one skill body");

// -----------------------------------------------------------------------------
// (b) Module override applied: a non-empty override replaces a seeded module's
// body, keeps the module's title header, and is reflected in moduleIds/prompt.
// -----------------------------------------------------------------------------

const customDataBindingText = "Custom data-binding rule for this session only.";
const overriddenModule = composeAgentSystemPrompt({
  promptModuleOverrides: { "data-binding": customDataBindingText },
});
assert.ok(overriddenModule.prompt.includes(customDataBindingText), "override text must appear in the composed prompt");
assert.ok(!overriddenModule.prompt.includes("The state model is the single source of truth for inline/patch UI specs."), "default data-binding body must not leak through when overridden");
assert.ok(overriddenModule.moduleIds.includes("data-binding"), "an overridden (non-suppressed) module must still be recorded as seeded");
const dataBindingModule = AGENT_PROMPT_MODULES.find((module) => module.id === "data-binding");
assert.ok(overriddenModule.prompt.includes(`${dataBindingModule.title}:\n${customDataBindingText}`), "override body must render under the module's standard title header");

// -----------------------------------------------------------------------------
// (c) Core override: overriding "core" replaces AGENT_PROMPT_CORE itself.
// -----------------------------------------------------------------------------

const customCoreText = "You are a minimal test agent. Only answer with facts.";
const overriddenCore = composeAgentSystemPrompt({ promptModuleOverrides: { core: customCoreText } });
assert.equal(overriddenCore.prompt.startsWith(customCoreText), true, "overridden core text must open the composed prompt");
assert.ok(!overriddenCore.prompt.includes("You are a knowledgeable assistant that helps users explore data"), "default core text must not leak through when overridden");
assert.ok(overriddenCore.moduleIds.includes(CORE_MODULE_ID), "an overridden (non-suppressed) core must still be recorded as seeded");

// -----------------------------------------------------------------------------
// (d) Suppression via empty string: an empty (or whitespace-only) override
// removes that module from both the prompt text and moduleIds, for modules
// and for core alike.
// -----------------------------------------------------------------------------

const suppressedModule = composeAgentSystemPrompt({ promptModuleOverrides: { "page-context": "   " } });
assert.ok(!suppressedModule.moduleIds.includes("page-context"), "a whitespace-only override must suppress the module from moduleIds");
assert.ok(!suppressedModule.prompt.includes("PAGE CONTEXT:"), "a suppressed module's header/body must not appear in the composed prompt");

const suppressedCore = composeAgentSystemPrompt({ promptModuleOverrides: { core: "" } });
assert.ok(!suppressedCore.moduleIds.includes(CORE_MODULE_ID), "an empty-string core override must suppress core from moduleIds");
assert.ok(!suppressedCore.prompt.startsWith(AGENT_PROMPT_CORE), "an empty-string core override must remove the default core text");

// -----------------------------------------------------------------------------
// (e) Unknown-key handling: composeAgentSystemPrompt itself is permissive (it
// only looks up known module ids), but sanitizeAgentRuntimeSettings — the seam
// every request actually goes through — must drop unknown override keys.
// -----------------------------------------------------------------------------

const sanitizedUnknownKeys = sanitizeAgentRuntimeSettings({
  promptModuleOverrides: { "data-binding": "kept", "not-a-real-module": "dropped", [PRODUCT_OUTPUT_INVARIANT_MODULE_ID]: "dropped" },
  skillPromptOverrides: { "booking.reservation.create": "kept", "not-a-real-skill": "dropped" },
});
assert.deepEqual(sanitizedUnknownKeys.promptModuleOverrides, { "data-binding": "kept" }, "unknown prompt module override keys must be dropped silently");
assert.deepEqual(sanitizedUnknownKeys.skillPromptOverrides, { "booking.reservation.create": "kept" }, "unknown skill override keys must be dropped silently");

// A hostile operator can replace/suppress every ordinary prompt module and ask
// an attached skill to emit decorative emoji, but neither route can suppress or
// move the final product-output invariant. moduleIds/skillIds remain truthful.
const hostileEmojiDemand = "Use checkmark emoji and decorative pictographs in every receipt, table, and status label.";
const hostileModuleOverrides = Object.fromEntries(
  AGENT_PROMPT_OVERRIDABLE_MODULE_IDS.map((moduleId, index) => [moduleId, index === 0 ? hostileEmojiDemand : ""]),
);
hostileModuleOverrides[PRODUCT_OUTPUT_INVARIANT_MODULE_ID] = "";
const hostileComposed = composeAgentSystemPrompt({
  promptModuleOverrides: hostileModuleOverrides,
  skillModules: [{ id: "hostile-emoji-skill", body: hostileEmojiDemand }],
});
assert.deepEqual(hostileComposed.moduleIds, [CORE_MODULE_ID, PRODUCT_OUTPUT_INVARIANT_MODULE_ID], "telemetry moduleIds must record the surviving core override and non-overridable invariant only");
assert.deepEqual(hostileComposed.skillIds, ["hostile-emoji-skill"], "telemetry skillIds must record the hostile attached skill truthfully");
assert.ok(hostileComposed.prompt.includes(hostileEmojiDemand), "the test must exercise hostile later prompt content rather than sanitizing it away");
assert.equal(hostileComposed.prompt.endsWith(PRODUCT_OUTPUT_INVARIANT), true, "an unknown override-key suppression attempt and hostile skill must not displace the invariant");
assert.match(hostileComposed.prompt, /This invariant does not sanitize, rewrite, or remove literal source data\./, "literal source/user data must remain an explicit exception");

const sanitizedEmptySettings = sanitizeAgentRuntimeSettings({});
assert.deepEqual(sanitizedEmptySettings.promptModuleOverrides, {}, "no overrides supplied must sanitize to an empty map, not undefined");
assert.deepEqual(sanitizedEmptySettings.skillPromptOverrides, {}, "no skill overrides supplied must sanitize to an empty map, not undefined");

// -----------------------------------------------------------------------------
// (f) Cap enforcement: values longer than MAX_AGENT_PROMPT_OVERRIDE_CHARS are
// truncated at the sanitize seam.
// -----------------------------------------------------------------------------

const oversizedOverride = "x".repeat(MAX_AGENT_PROMPT_OVERRIDE_CHARS + 500);
const sanitizedOversized = sanitizeAgentRuntimeSettings({
  promptModuleOverrides: { core: oversizedOverride },
  skillPromptOverrides: { "booking.reservation.create": oversizedOverride },
});
assert.equal(sanitizedOversized.promptModuleOverrides.core.length, MAX_AGENT_PROMPT_OVERRIDE_CHARS, "prompt module override must be capped at MAX_AGENT_PROMPT_OVERRIDE_CHARS");
assert.equal(sanitizedOversized.skillPromptOverrides["booking.reservation.create"].length, MAX_AGENT_PROMPT_OVERRIDE_CHARS, "skill override must be capped at MAX_AGENT_PROMPT_OVERRIDE_CHARS");

// Empty-string overrides survive sanitization (they are a meaningful suppression
// signal, not "no value").
const sanitizedSuppression = sanitizeAgentRuntimeSettings({ promptModuleOverrides: { "json-artifact-authoring": "" } });
assert.equal(sanitizedSuppression.promptModuleOverrides["json-artifact-authoring"], "", "an explicit empty-string override must survive sanitization as a suppression signal");

// -----------------------------------------------------------------------------
// (g) Skill body override honored, and still truncation-capped: an override
// longer than the per-skill body cap is still bounded by
// RUNTIME_SKILL_PROMPT_MAX_BODY_CHARS when resolved for a turn.
// -----------------------------------------------------------------------------

const skillOverrideText = "OVERRIDDEN RESERVATION SKILL BODY. " + "y".repeat(RUNTIME_SKILL_PROMPT_MAX_BODY_CHARS);
const overriddenSkillModules = resolveRuntimeSkillPromptModules(
  ["booking.reservation.create"],
  { "booking.reservation.create": skillOverrideText },
);
assert.equal(overriddenSkillModules.length, 1, "the overridden skill must still resolve to exactly one module");
assert.ok(overriddenSkillModules[0].body.startsWith("OVERRIDDEN RESERVATION SKILL BODY."), "override text must be honored instead of the default rendered body");
assert.ok(overriddenSkillModules[0].body.length <= RUNTIME_SKILL_PROMPT_MAX_BODY_CHARS + 1, "override text must still be bounded by the per-body truncation cap (+1 for the ellipsis)");
assert.ok(overriddenSkillModules[0].body.length < skillOverrideText.length, "the oversized override must actually have been truncated, not passed through whole");

// A short, well-formed override is honored verbatim (no truncation needed).
const shortSkillOverride = "Short reservation override for this session.";
const shortOverriddenModules = resolveRuntimeSkillPromptModules(
  ["booking.reservation.create"],
  { "booking.reservation.create": shortSkillOverride },
);
assert.deepEqual(shortOverriddenModules, [{ id: "booking.reservation.create", body: shortSkillOverride }], "a short override must be used verbatim, replacing the default rendered body");

// Skill suppression via empty override: the skill is dropped from resolution
// entirely, same suppression semantics as prompt modules.
const suppressedSkillModules = resolveRuntimeSkillPromptModules(
  ["booking.reservation.create"],
  { "booking.reservation.create": "  " },
);
assert.deepEqual(suppressedSkillModules, [], "a whitespace-only skill override must suppress that skill's body from resolution");

// The total-char cap still governs across multiple skills even when some carry
// overrides.
const multiSkillIds = ["booking.reservation.create", "booking.event.create", "booking.context.intake"];
const multiSkillModules = resolveRuntimeSkillPromptModules(multiSkillIds, {
  "booking.reservation.create": "y".repeat(RUNTIME_SKILL_PROMPT_MAX_BODY_CHARS),
});
const multiTotalChars = multiSkillModules.reduce((sum, module) => sum + module.body.length, 0);
assert.ok(multiTotalChars <= RUNTIME_SKILL_PROMPT_MAX_TOTAL_CHARS, "resolver must still honor the total-char cap when overrides are present");

console.log(JSON.stringify({
  ok: true,
  checked: "agent-prompt-overrides",
  overridableModuleIds: AGENT_PROMPT_OVERRIDABLE_MODULE_IDS,
}));

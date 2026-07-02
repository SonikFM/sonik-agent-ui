import assert from "node:assert/strict";
import {
  AGENT_PROMPT_CORE,
  AGENT_PROMPT_MODULES,
  composeAgentSystemPrompt,
} from "../../apps/standalone-sveltekit/src/lib/agent-prompt.ts";
import {
  resolveRuntimeSkillPromptModules,
  RUNTIME_SKILL_PROMPT_MAX_MODULES,
  RUNTIME_SKILL_PROMPT_MAX_BODY_CHARS,
  RUNTIME_SKILL_PROMPT_MAX_TOTAL_CHARS,
} from "../../apps/standalone-sveltekit/src/lib/server/skill-registry.ts";

// (a) Content equivalence: every distinctive rule block of the pre-refactor
// monolith must still reach the model under default (no-skill) seeding. These
// fragments are copied verbatim from the original AGENT_INSTRUCTIONS; if the
// decomposition dropped or reworded any rule, the corresponding assertion fails.
const MONOLITH_RULE_FRAGMENTS = [
  // identity + workflow (core)
  "You are a knowledgeable assistant that helps users explore data and learn about any topic.",
  "Call the appropriate tools to gather relevant data. Use webSearch for general topics not covered by specialized tools.",
  "For explicit document/editor requests, call createDocumentArtifact or updateDocumentArtifact so the workspace document canvas opens.",
  // safety + capability questions (core)
  "Always call tools FIRST to get real data when live data is needed. Never make up data.",
  "For questions about your own tool capabilities or this app, do not call external data tools, including webSearch.",
  "Call listAvailableTools when the user asks for the compact ORPC/MCP/sandbox/local-ui manifest",
  // rendering basics (core)
  "NEVER nest a Card inside another Card. If you need sub-sections inside a Card, use Stack, Separator, Heading, or Accordion instead.",
  "Use PieChart for compositional/proportional data (market share, breakdowns, distributions).",
  "Use Timeline for historical events, processes, step-by-step explanations, or milestones.",
  "When teaching about a topic, combine multiple component types to create a rich, engaging experience.",
  // interactivity + actions + inputs (core)
  "You can use visible, repeat, on.press, and $cond/$then/$else freely.",
  "pushState: Append to an array. params: { statePath: \"/items\", value: { ... } }",
  "RadioGroup: Renders radio buttons. Writes selected value to statePath automatically.",
  // catalog custom rule (core, from explorerCatalog.prompt)
  "NEVER use viewport height classes (min-h-screen, h-screen)",
  // json-artifact-authoring module
  "you MUST call createJsonArtifact exactly once after any needed data tools.",
  "createJsonArtifact requires a valid flat spec: spec.root MUST be \"main\" and spec.elements.main MUST exist.",
  "Do not call createJsonArtifact more than once for a single user turn.",
  // document-tools module
  "use createDocumentArtifact or updateDocumentArtifact instead of forcing JSON-render.",
  "set preferredView to \"preview\" for rendered Markdown/HTML/SVG/XML the user should visually inspect",
  // page-context module
  "answer directly from the CURRENT HOST/PAGE CONTEXT system block.",
  // booking-commands module
  "The command catalog is CLI-first and context-efficient: search, learn, then execute/commit.",
  "prefer executeCommand/commitCommand with inputJson (a JSON string of the direct command input)",
  "the canonical workflow is booking.get.availability -> booking.create.guest -> booking.create.booking.",
  "Do NOT use booking.create.hold for reservation, booking, or tee-time intents unless the user explicitly asks for a temporary hold.",
  "A standalone fixture-backed read-only booking host command may be mounted for local testing;",
  // data-binding module
  "For inline JSON-render responses outside createJsonArtifact, embed fetched data directly in /state paths so components can reference it.",
  "The state model is the single source of truth for inline/patch UI specs.",
  "Always use the { \"$state\": \"/foo\" } object syntax for inline/patch data binding.",
];

const defaultComposed = composeAgentSystemPrompt();
for (const fragment of MONOLITH_RULE_FRAGMENTS) {
  assert.ok(
    defaultComposed.prompt.includes(fragment),
    `default composed prompt is missing a monolith rule: ${JSON.stringify(fragment.slice(0, 60))}`,
  );
}

// The artifact tool object guidance (interpolated verbatim in the old monolith)
// must still be present under default seeding.
assert.ok(defaultComposed.prompt.includes("ARTIFACT TOOL OBJECT EXAMPLES"), "artifact tool object examples header missing");

// Default seeding records the always-on core plus every module and no skills.
assert.deepEqual(
  defaultComposed.moduleIds,
  ["core", ...AGENT_PROMPT_MODULES.map((module) => module.id)],
  "default seeding must include the core and every module",
);
assert.deepEqual(defaultComposed.skillIds, [], "default seeding must not append any skills");

// Every module seeds under default (empty) context — reproduces today's monolith.
for (const module of AGENT_PROMPT_MODULES) {
  assert.equal(module.seedWhen({}), true, `module ${module.id} must seed under default context`);
}

// (b) Per-turn skill bodies append AFTER the core and modules, and are recorded.
const skillModules = resolveRuntimeSkillPromptModules(["booking-reservation"]);
assert.ok(skillModules.length >= 1, "expected the booking-reservation family to resolve at least one skill body");
const composedWithSkills = composeAgentSystemPrompt({ skillModules });
const coreIndex = composedWithSkills.prompt.indexOf(AGENT_PROMPT_CORE.slice(0, 80));
const skillHeaderIndex = composedWithSkills.prompt.indexOf("RUNTIME SKILLS (attached for this turn only):");
assert.ok(coreIndex >= 0, "core block must be present when skills are appended");
assert.ok(skillHeaderIndex > coreIndex, "skill bodies must be appended AFTER the core");
assert.ok(
  composedWithSkills.skillIds.includes(skillModules[0].id),
  "composed skillIds must record the appended skill",
);
// The appended prompt is a superset of the default prompt (skills are additive).
assert.ok(composedWithSkills.prompt.length > defaultComposed.prompt.length, "skills must extend the prompt");

// (c) Caps enforced. A large, duplicated, partly-unknown request must stay
// within the count and total-char bounds, dedupe, and drop unknown ids.
const oversizedRequest = [
  "booking-reservation",
  "booking-reservation", // duplicate id → deduped
  "booking-event",
  "booking-context-intake",
  "amplify-campaign-template",
  "totally-unknown-skill", // unknown → ignored
  "another-unknown",
];
const capped = resolveRuntimeSkillPromptModules(oversizedRequest);
assert.ok(capped.length <= RUNTIME_SKILL_PROMPT_MAX_MODULES, "resolver must honor the module count cap");
const cappedIds = capped.map((module) => module.id);
assert.equal(new Set(cappedIds).size, cappedIds.length, "resolver must dedupe skills");
assert.ok(!cappedIds.includes("totally-unknown-skill"), "resolver must drop unknown skill ids");
const totalChars = capped.reduce((sum, module) => sum + module.body.length, 0);
assert.ok(totalChars <= RUNTIME_SKILL_PROMPT_MAX_TOTAL_CHARS, "resolver must honor the total-char cap");
for (const module of capped) {
  assert.ok(module.body.length <= RUNTIME_SKILL_PROMPT_MAX_BODY_CHARS + 1, "each skill body must honor the per-body cap");
}

// Empty / whitespace ids are ignored and produce the default prompt.
assert.deepEqual(resolveRuntimeSkillPromptModules([]), [], "empty request resolves to no skills");
assert.deepEqual(resolveRuntimeSkillPromptModules(["", "   "]), [], "blank ids resolve to no skills");

console.log(JSON.stringify({
  ok: true,
  checked: "agent-prompt-composition",
  coreChars: AGENT_PROMPT_CORE.length,
  defaultPromptChars: defaultComposed.prompt.length,
  moduleIds: defaultComposed.moduleIds,
}));

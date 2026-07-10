// Per-turn system-prompt composition for the Sonik Agent UI.
//
// The agent's standing instructions used to be one monolithic `AGENT_INSTRUCTIONS`
// string. This module decomposes that text into a minimal always-on core plus
// named, seedable modules, so a run can compose exactly the rules it needs and
// record which modules reached the model. Per-turn skill bodies (resolved from
// the runtime skill registry) append after the core for that run only.
//
// Most modules seed unconditionally by default (`seedWhen` returns true) so the
// monolith's current unconditional behavior is preserved. The booking commands
// module intentionally remains default-on and seeds unless the host explicitly
// reports that no booking runtime is available. See the per-module notes below.
//
// This file imports only the render catalog and the artifact tool guidance
// (both pure), never the AI SDK or the tool graph, so the prompt-assembly test
// can import and assert on it in isolation.

import { explorerCatalog } from "./render/catalog.ts";
import { JSON_ARTIFACT_TOOL_OBJECT_GUIDANCE } from "./artifacts/artifact-generation-guidance.ts";
import { buildUserPrompt, isNonEmptySpec, type Spec } from "@json-render/core";

/** Context the composition seam evaluates each module's `seedWhen` against.
 *  Every field is optional; an empty context reproduces today's effective prompt
 *  because all default `seedWhen` predicates return true. */
export interface AgentPromptSeedContext {
  /** True when a booking runtime/command surface is available for this turn.
   *  When explicitly false, booking command conventions are not seeded; omitted
   *  preserves the historical default-on prompt behavior. */
  hasBookingRuntime?: boolean;
  /** True when the document tools are mounted. Reserved; unused today. */
  hasDocumentTools?: boolean;
  /** True when host/page context is attached. Reserved; unused today. */
  hasPageContext?: boolean;
  /** True when an attached preview/intake skill must not see command execution guidance. */
  previewOnlySkillActive?: boolean;
}

/** A skill body resolved from the runtime skill registry for this turn only. */
export interface AgentPromptSkillModule {
  id: string;
  body: string;
}

export interface AgentPromptModule {
  id: string;
  /** Human-readable section header emitted above the body. */
  title: string;
  /** The verbatim rule text moved out of the old monolith. */
  body: string;
  /** Whether this module seeds for the given context. Defaults to always-on to
   *  reproduce today's unconditional monolith. */
  seedWhen: (context: AgentPromptSeedContext) => boolean;
}

const ALWAYS_ON = (): boolean => true;

// ---------------------------------------------------------------------------
// Always-on core: identity, safety, tool-first workflow, and rendering basics
// (component-choice guidance, interactivity, input components, and the render
// catalog). These reach the model on every turn today and continue to.
// ---------------------------------------------------------------------------

export const AGENT_PROMPT_CORE = `You are a knowledgeable assistant that helps users explore data and learn about any topic. You look up real-time information, build visual dashboards, and create rich educational content.

WORKFLOW:
1. Call the appropriate tools to gather relevant data. Use webSearch for general topics not covered by specialized tools.
2. Respond with a brief, conversational summary of what you found.
3. For inline visual responses, output the JSONL UI spec wrapped in a \`\`\`spec fence. For explicit artifact/canvas/dashboard/report/page/workspace requests, call createJsonArtifact with the complete json-render spec so the canvas can promote it deterministically. For explicit document/editor requests, call createDocumentArtifact or updateDocumentArtifact so the workspace document canvas opens.

RULES:
- Always call tools FIRST to get real data when live data is needed. Never make up data.
- For questions about your own tool capabilities or this app, do not call external data tools, including webSearch. Call searchSkillCatalog/learnSkill for user-language workflow discovery, then searchCommandCatalog/learnCommand for concrete command schemas and executeCommand for mounted read-only commands. Draft-only invariant: your ceiling for anything that creates or publishes is a submitted draft/preview — there is no model-callable commit tool; publishing only happens when a human clicks Approve on the preview card, outside your turn. Call listAvailableTools when the user asks for the compact ORPC/MCP/sandbox/local-ui manifest, approval gates, UI targets, or contract-derived source inventory. Call createJsonArtifact if a JSON-render artifact/canvas was requested; call createDocumentArtifact if a document/editor artifact was requested.
- Use Card components to group related information.
- NEVER nest a Card inside another Card. If you need sub-sections inside a Card, use Stack, Separator, Heading, or Accordion instead.
- Use Grid for multi-column layouts.
- Use Metric for key numeric values (temperature, stars, price, etc.).
- Use Table for lists of items (stories, forecasts, languages, etc.).
- Use BarChart or LineChart for numeric trends and time-series data.
- Use PieChart for compositional/proportional data (market share, breakdowns, distributions).
- Use Tabs when showing multiple categories of data side by side.
- Use Badge for status indicators.
- Use Callout for key facts, tips, warnings, or important takeaways.
- Use Accordion to organize detailed sections the user can expand for deeper reading.
- Use Timeline for historical events, processes, step-by-step explanations, or milestones.
- When teaching about a topic, combine multiple component types to create a rich, engaging experience.

INTERACTIVITY:
- You can use visible, repeat, on.press, and $cond/$then/$else freely.
- visible: Conditionally show/hide elements based on state. e.g. "visible": { "$state": "/q1/answer", "eq": "a" }
- repeat: Iterate over state arrays. e.g. "repeat": { "statePath": "/items" }
- on.press: Trigger actions on button clicks. e.g. "on": { "press": { "action": "setState", "params": { "statePath": "/submitted", "value": true } } }
- $cond/$then/$else: Conditional prop values. e.g. { "$cond": { "$state": "/correct" }, "$then": "Correct!", "$else": "Try again" }

BUILT-IN ACTIONS (use with on.press):
- setState: Set a value at a state path. params: { statePath: "/foo", value: "bar" }
- pushState: Append to an array. params: { statePath: "/items", value: { ... } }
- removeState: Remove by index. params: { statePath: "/items", index: 0 }

${explorerCatalog.prompt({
  mode: "inline",
  customRules: [
    "NEVER use viewport height classes (min-h-screen, h-screen) — the UI renders inside a fixed-size container.",
    "Prefer Grid with columns='2' or columns='3' for side-by-side layouts.",
    "Use Metric components for key numbers instead of plain Text.",
    "Put chart data arrays in /state and reference them with { $state: '/path' } on the data prop.",
    "Keep the UI clean and information-dense — no excessive padding or empty space.",
    "For educational prompts ('teach me about', 'explain', 'what is'), use a mix of Callout, Accordion, Timeline, and charts to make the content visually rich.",
  ],
})}`;

// ---------------------------------------------------------------------------
// Seedable modules. Each body is verbatim text moved out of the old monolith.
// ---------------------------------------------------------------------------

const JSON_ARTIFACT_AUTHORING_MODULE: AgentPromptModule = {
  id: "json-artifact-authoring",
  title: "JSON ARTIFACT AUTHORING",
  // Do not seed when a preview-only registered skill hides the generic createJsonArtifact tool.
  seedWhen: (context) => context.previewOnlySkillActive !== true,
  body: `- If the user asks to create a visual artifact, canvas, dashboard, report, page, or workspace, you MUST call createJsonArtifact exactly once after any needed data tools. Do not stop after data tool calls. The createJsonArtifact tool is the JSON-render artifact creation trigger.
- createJsonArtifact requires a valid flat spec: spec.root MUST be "main" and spec.elements.main MUST exist. For simple artifacts, use one root Card with children: [] and put body text in the Card description. For createJsonArtifact tool input, use catalog-valid inline prop values rather than $state bindings unless the tool schema explicitly allows them. Use the object-form guidance below; do not use inline JSONL patch fences as tool input.
- Do not repeat the same tool call with the same arguments in a single response. Do not call createJsonArtifact more than once for a single user turn. Use the first result you already have.

ARTIFACT TOOL OBJECT EXAMPLES:
${JSON_ARTIFACT_TOOL_OBJECT_GUIDANCE}`,
};

const DOCUMENT_TOOLS_MODULE: AgentPromptModule = {
  id: "document-tools",
  title: "DOCUMENT TOOLS",
  // Today: unconditional. Document tools are always created by createAgent.
  seedWhen: ALWAYS_ON,
  body: `- If the user asks to create or edit a Markdown/HTML/code/text document in the document editor, use createDocumentArtifact or updateDocumentArtifact instead of forcing JSON-render. Use readActiveDocument before editing the active document, or readDocumentArtifact when you need a specific document id. After creating a document, subsequent document reads/updates in the same turn target that created document unless the user names another document.
- For document tools, set preferredView to "preview" for rendered Markdown/HTML/SVG/XML the user should visually inspect, "edit" for source/code-first work, and "auto" only when indifferent.`,
};

const PAGE_CONTEXT_MODULE: AgentPromptModule = {
  id: "page-context",
  title: "PAGE CONTEXT",
  // Today: unconditional. The rule is safe even when no page context is attached
  // (it simply never triggers), so it always seeds to preserve current behavior.
  seedWhen: ALWAYS_ON,
  body: `- For questions like "where am I?", "what page am I on?", "tell me about this page", or "what context is attached?", answer directly from the CURRENT HOST/PAGE CONTEXT system block. Do not create a JSON artifact, do not create a document, and do not call createJsonArtifact for page-context questions unless the user explicitly asks for an artifact/canvas/dashboard.`,
};

const BOOKING_COMMANDS_MODULE: AgentPromptModule = {
  id: "booking-commands",
  title: "BOOKING COMMAND CONVENTIONS",
  // Default-on to preserve the old monolith and empty-context behavior, but do
  // not seed command execution conventions when the host explicitly reports that
  // no booking runtime/command surface is available for this turn.
  seedWhen: (context) => context.hasBookingRuntime !== false,
  body: `- The command catalog is CLI-first and context-efficient: search, learn, then execute. For any booking or ORPC-backed command, call learnCommand before executeCommand unless you already have the exact schema from this same turn. Never call executeCommand with {} unless learnCommand says the command has no required fields.
- For generated booking/OpenAPI commands, prefer executeCommand with inputJson (a JSON string of the direct command input) instead of a loose input object. This avoids record-schema stripping and keeps the schema-aware preflight validator authoritative.
- If executeCommand returns policy.reasons including command_input_preflight_failed, missing_required_fields, unsupported_input_fields, or summary.kind == "command_input_preflight_failed", do not repeat the same bad call. Immediately call learnCommand for that command, copy the requiredFields/exampleInput shape, remove unsupported fields, and retry once with corrected direct command input via inputJson.
- Draft-only invariant: executeCommand can only run reads. There is no model-callable commit tool for any write — the agent's ceiling for anything that creates or publishes is a submitted draft/preview, and only a human clicking Approve on the preview card can publish it, outside your turn. Do not attempt to call a commit/write tool.
- Booking command input convention: pass path/query/body fields directly in inputJson. Do not wrap JSON request bodies in body unless learnCommand says the schema requires body. For availability use contextId, from, to, and optional partySize/source; do not use a date field. For reservation/booking creation, the canonical workflow is booking.get.availability -> previewBookingReservationCommand -> human Approve click. Do not call booking.create.guest or booking.create.booking yourself; those writes run only through /api/reservation/commit after the user approves the preview card. Do NOT use booking.create.hold for reservation, booking, or tee-time intents unless the user explicitly asks for a temporary hold. Keep trusted actor/principal fields separate from guest/customer identity: do not invent, edit, or provision userId/principalId/organizationId from model reasoning, and do not create a guest/customer record to satisfy a trusted host principal error. When schema examples contain CURRENT_HOST_PRINCIPAL_ID, pass that literal only if learnCommand/page context explicitly requires the host principal sentinel; the trusted runtime binds it to the current host principal. For reservation previews, provide guest fields plus booking contextId, startsAt, endsAt, source, partySize, and clientRequestId; never provide booking.userId.
- A standalone fixture-backed read-only booking host command may be mounted for local testing; other ORPC business commands remain metadata-only unless a live adapter explicitly marks them mounted and executable.`,
};

const DATA_BINDING_MODULE: AgentPromptModule = {
  id: "data-binding",
  title: "DATA BINDING FOR INLINE SPEC FENCES AND NON-TOOL UI SPECS",
  // Today: unconditional. Inline spec binding guidance is always present.
  seedWhen: ALWAYS_ON,
  body: `- For inline JSON-render responses outside createJsonArtifact, embed fetched data directly in /state paths so components can reference it.
- This section applies to inline spec fences and renderer patches, not to createJsonArtifact tool input unless that tool schema explicitly allows the binding.
- The state model is the single source of truth for inline/patch UI specs. Put fetched data in /state, then reference it with { "$state": "/json/pointer" } in any prop.
- In inline/patch specs, $state works on ANY prop at ANY nesting level. The renderer resolves expressions before components receive props.
- Scalar binding: "title": { "$state": "/quiz/title" }
- Array binding: "items": { "$state": "/quiz/questions" } (for Accordion, Timeline, etc.)
- For inline/patch Table, BarChart, LineChart, and PieChart specs, use { "$state": "/path" } on the data prop to bind read-only data from state.
- Always emit /state patches BEFORE the inline/patch elements that reference them, so data is available when the UI renders.
- Always use the { "$state": "/foo" } object syntax for inline/patch data binding.`,
};

// Registration order is the composition order for seeded modules; content
// equivalence with the old monolith is modulo section ordering and headers.
export const AGENT_PROMPT_MODULES: readonly AgentPromptModule[] = [
  JSON_ARTIFACT_AUTHORING_MODULE,
  DOCUMENT_TOOLS_MODULE,
  PAGE_CONTEXT_MODULE,
  BOOKING_COMMANDS_MODULE,
  DATA_BINDING_MODULE,
];

/**
 * Patch-first refinement contract (Phase 2.1). When an active intake artifact's
 * spec is supplied, tells the model the artifact already exists so it must
 * refine it in place rather than regenerate it: reuses the library's
 * `buildUserPrompt` patch-mode composition (RFC 6902 framing + "CURRENT UI
 * STATE, DO NOT recreate existing elements") for the currentSpec framing, then
 * maps that patch semantics onto this surface's actual patch tool
 * (submitIntakeAnswer is a tool call, not inline JSON Patch text). Returns null
 * when there is no active spec to refine, so callers can omit the section.
 */
export function buildIntakeRefinementContractSection(currentSpec: Spec | null | undefined): string | null {
  if (!isNonEmptySpec(currentSpec)) return null;
  const editContext = buildUserPrompt({ prompt: "", currentSpec, editModes: ["patch"] });
  return `REFINEMENT CONTRACT (active intake artifact):\n${editContext}\n\nFor this booking-context intake artifact, apply the patch above by calling submitIntakeAnswer(questionId, value) against the existing artifact. Never emit raw JSON Patch lines in chat text, and never call createBookingIntakeArtifact again while this artifact is active. An answer counts as recorded ONLY when a submitIntakeAnswer receipt for it appears in this turn — never write "recorded", "saved", or a progress checklist for an answer you did not submit via the tool this turn, even if earlier turns in this conversation did so.`;
}

export interface ComposedAgentPrompt {
  /** The full system-prompt string to hand to the agent as `instructions`. */
  prompt: string;
  /** Ids of the modules that seeded this turn (core is always first). Recorded
   *  on the run so drift is diagnosable per run without persisting prompt text. */
  moduleIds: string[];
  /** Ids of the runtime skills whose bodies were appended this turn. */
  skillIds: string[];
}

export const CORE_MODULE_ID = "core";

/** Every module id an Agent Settings override key may target: the always-on
 *  core plus each seedable module, in composition order. Exported so callers
 *  that build an override editor (e.g. Agent Settings) don't have to hardcode
 *  or duplicate this list. */
export const AGENT_PROMPT_OVERRIDABLE_MODULE_IDS: readonly string[] = [
  CORE_MODULE_ID,
  ...AGENT_PROMPT_MODULES.map((module) => module.id),
];

function renderModule(module: AgentPromptModule, body: string): string {
  return `${module.title}:\n${body}`;
}

/**
 * Composes the system prompt from the always-on core, the modules that seed for
 * the given context, and any per-turn skill bodies (appended AFTER the core and
 * modules so standing rules always precede run-scoped skill guidance). Returns
 * the composed prompt plus the module/skill ids that reached the model.
 *
 * With no seed context and no skill modules, the result reproduces today's
 * effective monolith content (modulo section ordering and headers).
 *
 * `promptModuleOverrides` lets a caller replace a module's body (keyed by
 * module id, `"core"` for {@link AGENT_PROMPT_CORE}) with operator-edited text
 * for this run. An override value that is empty (or whitespace-only) after
 * trimming suppresses that module entirely — it is dropped from both the
 * prompt and `moduleIds`, as if it never seeded. A module with no entry in
 * `promptModuleOverrides` uses its default body, so an empty overrides map
 * reproduces today's output exactly.
 */
export function composeAgentSystemPrompt(input: {
  context?: AgentPromptSeedContext;
  skillModules?: AgentPromptSkillModule[];
  promptModuleOverrides?: Record<string, string>;
  /** Current spec of the active intake artifact, when one exists this turn.
   *  Drives the patch-first refinement contract (see {@link buildIntakeRefinementContractSection}). */
  currentIntakeArtifactSpec?: Spec | null;
} = {}): ComposedAgentPrompt {
  const context = input.context ?? {};
  const overrides = input.promptModuleOverrides ?? {};
  const seeded = AGENT_PROMPT_MODULES.filter((module) => {
    if (context.previewOnlySkillActive && module.id === "booking-commands") return false;
    return module.seedWhen(context);
  });
  const skillModules = (input.skillModules ?? []).filter((module) => module.id && module.body.trim().length > 0);

  const sections: string[] = [];
  const moduleIds: string[] = [];

  const coreOverride = overrides[CORE_MODULE_ID];
  if (coreOverride === undefined || coreOverride.trim().length > 0) {
    sections.push(coreOverride !== undefined ? coreOverride : AGENT_PROMPT_CORE);
    moduleIds.push(CORE_MODULE_ID);
  }

  for (const module of seeded) {
    const override = overrides[module.id];
    if (override !== undefined && override.trim().length === 0) continue;
    sections.push(renderModule(module, override !== undefined ? override : module.body));
    moduleIds.push(module.id);
  }

  if (skillModules.length > 0) {
    const skillBlock = skillModules.map((module) => module.body.trim()).join("\n\n");
    sections.push(`RUNTIME SKILLS (attached for this turn only):\n${skillBlock}`);
  }

  const refinementSection = buildIntakeRefinementContractSection(input.currentIntakeArtifactSpec);
  if (refinementSection) sections.push(refinementSection);

  return {
    prompt: sections.join("\n\n"),
    moduleIds,
    skillIds: skillModules.map((module) => module.id),
  };
}

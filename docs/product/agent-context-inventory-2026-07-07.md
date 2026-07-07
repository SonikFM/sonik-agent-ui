# Agent Context Inventory — the Predictability Audit

Status: v1 · 2026-07-07 · Read-only sweep of everything that shapes live-agent behavior.
Correction applied by lead: the original sweep flagged `decideTrustedIntakeControllerAction` as dead code; VERIFIED FALSE — it is imported and called at `+page.svelte:78, 2801` (the sweep's grep missed .svelte files). All other findings relayed as reported; verify before acting on any single line.

## 1. System prompt = TWO independent messages (no drift protection between them)

- **A. `ToolLoopAgent.instructions`** — `agent.ts:82-94` → `composeAgentSystemPrompt` (`agent-prompt.ts:217-239`): `AGENT_PROMPT_CORE` (:61-113) + render catalog + 5 seedable modules (json-artifact-authoring :119-130 — skipped when preview-only skill active; document-tools :132-139; page-context :141-148; booking-commands :150-163 — also dropped when preview-only; data-binding :166-180) + runtime skill bodies (capped 6 modules / 2000 chars each / 8000 total, `skill-registry.ts:275-277`) + ZDR wrapper when `requireZdr` (default true).
- **B. Prepended `{role:"system"}` message** — `routes/api/generate/+server.ts:502`: workspace context + page-context summary (:199-214) + agent-settings summary + first-turn title prompt + skill index + command index. **A different message than instructions; nothing pins their content against each other.**

## 2. Runtime skills

Registry `server/skill-registry.ts:35-264`; 5 families (booking-event 96, amplify-campaign-template 93, booking-context-intake 95, booking-context-create 99, booking-reservation 100). **All 5 are `loadPolicy.mode:"surface-eager"`** — no lazy/manual/hidden actually implemented. Turn selection = explicit chips ∪ settings.skillIds ∪ `resolveImplicitWorkflowSkillIds` keyword matching (`runtime-skill-intent.ts`).

## 3. Tools exposed to the model (`agent.ts:96-130`)

Always: weather/github/crypto/HN/webSearch, documentTools, artifactStateTools (read/preview), toolManifest, skillCatalog, marketplaceWorkflow tools. Conditional: `createBookingIntakeArtifact` ⟷ `createJsonArtifact` (mutually exclusive on intake-skill activity, :119); **commandCatalogTools entirely removed** when preview-only or context-create active (:102-104); `commitActiveIntakeCommand` mounted only when `allowIntakeCommandCommit` (:105, `artifact-state.ts:328`). `toolPermissionModes` (all families default "ask") gate at CALL time — an "off" family still appears in the tool schema and only fails on invocation (`command-catalog.ts:176-181`).

## 4. Trusted injected turns

`templates.ts:100-127` launchPrompt strings (hand-written behavioral constraints, duplicating skill-catalog guardrails in prose); trusted-intake-controller prompts (LIVE at `+page.svelte:2801` — see correction). `ToolLoopAgent`: `stopWhen: stepCountIs(12)`, `temperature: 0.35` — fixed.

## 5. Defaults

Model **`deepseek/deepseek-v4-pro`** (fallback claude-haiku-4.5), 4 static options all `source:"fallback"`/`zdrStatus:"unknown"`; 7 tool families all default "ask"; user prompt cap 2000 chars; custom skills 8×4000 chars (both appended to message B, not A).

## 6. Drift risks (verified-as-reported except where noted)

- Two loadPolicy vocabularies: settings UI (`startup/surface/manual`, agent-settings.ts:25) vs runtime catalog (only `surface-eager`) — Settings implies lazy loading that doesn't exist.
- Page-context instruction duplicated: `agent-prompt.ts:147` AND `+server.ts:212` — two authors, silent divergence.
- `booking.context.create` (the only mutation-committing family) has NO Agent Settings entry — reachable only via keyword matching or raw request `skillIds`.
- launchPrompt strings + prompt-module bodies are unversioned prose — composition test pins module IDs, not content.
- Command gating in two independent places that can disagree (tool-list build-time vs call-time modes).

## TOP-7 UNPREDICTABILITY SUSPECTS (ranked; original #5 removed as false)

1. **`resolveImplicitWorkflowSkillIds` keyword matching** (`runtime-skill-intent.ts:28-112`) — bare words ("create", "approve", "run it") silently swap artifact tools, remove/restore the command catalog, and can mount the mutation-capable commit tool — per turn, from phrasing, no confirmation.
2. **Three overlapping skill-id classification sets** (`agent.ts:26-59`) — each independently decides tools + prompt modules; a new skill id not added to all three silently misclassifies.
3. **Two-system-message architecture** — no single "the system prompt"; drift between them untested.
4. **Off-family still in tool schema** — disabled families fail at invocation instead of not existing (visible tool errors).
5. **Silent skill-prompt truncation** (`skill-registry.ts:275-277`) — over caps, content is dropped with no telemetry; interacts with #1's over-eager selection.
6. **Settings-UI ⟷ runtime mismatch** — Settings is a poor predictor of actual behavior (loadPolicy fiction; unreachable context-create).
7. **Hand-authored launchPrompt guardrails** duplicating catalog guardrails — two prose sources, neither generated from the other.

## Fix directions (map to existing plans)

#1/#2 → make skill/tool selection declarative + phase-scoped (ratified DR-4 / risk-tags item); #3 → merge into one composed prompt or add a drift test; #4 → omit off-families from the schema (extends the landed toolPolicy slice); #5 → truncation telemetry; #6 → align Settings vocab with catalog; #7 → generate launchPrompts from the skill catalog.

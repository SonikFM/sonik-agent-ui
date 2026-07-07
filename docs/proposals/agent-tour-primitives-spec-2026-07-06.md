# Agent Tour Primitives — Design Spec

Date: 2026-07-06
Status: DRAFT — needs Dan's UI approval before implementation
Source: docs/handoffs/agent-onscreen-control-vision-hitlist-2026-07-06.md §2

## Summary

Today the agent can converse, render its own JSON artifacts, and read back machine-readable page state via `getPageContext()`/`getAssertions()`, but it cannot gesture at the host UI — no highlight, no spotlight, no "look here." This spec adds agent-guided onboarding tours (driver.js-powered) as a fourth, tightly-scoped channel: the agent emits a declarative tour spec naming stable target IDs; a trusted client runtime plays it back. It extends, rather than bypasses, the existing trust model: named targets instead of selectors (mirrors the component allowlist), server-validated declarative specs instead of imperative stepping (mirrors JSON-render artifacts), and read-only highlight/popover only — advanceOn:click waits for the real user to click the real control.

## Why greenfield

The research pass (hitlist §2) found no prior art of an LLM agent driving driver.js or Shepherd at runtime — every existing driver.js/Shepherd integration is authored by a human developer ahead of time, not emitted per-turn by a model. This is unclaimed territory, so the design below leans on Sonik's own precedents (allowlist resolution, declarative specs, typed rejection) rather than an existing agent-tour pattern.

## Target registry spec

Highlightable regions get a stable semantic ID, never a CSS selector — the same posture as the 33-component render allowlist.

- **Sidecar-owned targets** (P1): registered by the chat surface itself, e.g. `composer.input`, `rail.newChat`, `suggestions.venueSetup`. Registration API lives alongside the existing `AgentUiPageControl` surface in `packages/agent-observability/src/index.ts`:
  ```ts
  interface AgentUiTourTargetRegistry {
    register(targetId: string, element: HTMLElement | (() => HTMLElement | null)): () => void; // returns unregister
    resolve(targetId: string): HTMLElement | null;
    has(targetId: string): boolean;
    list(): string[]; // for conformance checks
  }
  ```
  A Svelte action (`use:tourTarget={"composer.input"}`) registers/unregisters on mount/destroy — same lifecycle shape as existing `annotateHostElement` calls in `packages/agent-embed/src/index.ts`.
- **Host-donated targets** (P2): the host already sends page context over the embed handshake (`AgentHostPageContext` / `ALLOWED_CONTEXT_KEYS` in `packages/agent-embed/src/index.ts`). Extend that envelope with an additional allowlisted key, `tourTargets: string[]` (IDs only, e.g. `booking.nav.calendar`) — declares *which* IDs exist, not DOM refs; the host page resolves its own IDs to elements via the same registry pattern, scoped to its own frame. Add `tourTargets` to `ALLOWED_CONTEXT_KEYS` and thread it through `sanitizeAgentHostPageContext`/`mergeAgentHostPageContext` (capped at `MAX_LIST_ITEMS`-style limit, e.g. 64 IDs, each matching `/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/`).
- **Unknown ID → typed rejection.** `startTour` validates every `targetId` in a submitted spec against the merged registry (sidecar + host-donated) before playback starts. A single unresolved ID rejects the whole tour with `{ ok: false, disabledReason: "unknown_target", details: { targetId } }` — no partial tours.

## Tour spec schema

One JSON tour per agent turn, zod-validated server-side before it reaches the client runtime (same posture as `askUserQuestionSpecSchema` / `interactiveSurfaceSpecSchema` in `packages/tool-contracts/src/index.ts`):

```ts
const tourStepSchema = z.object({
  targetId: z.string().min(1).max(128),
  title: z.string().min(1).max(80),      // sanitized like all agent-supplied text
  body: z.string().min(1).max(400),
  side: z.enum(["top", "right", "bottom", "left", "auto"]).default("auto"),
  advanceOn: z.union([
    z.literal("next"),
    z.string().regex(/^click:[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/), // "click:<targetId>"
    z.literal("manual"),
  ]).default("next"),
});

const tourSpecSchema = z.object({
  version: z.literal("sonik-agent-ui.tour.v1"),
  id: z.string().min(1),
  title: z.string().min(1).max(80).optional(),
  steps: z.array(tourStepSchema).min(1).max(12), // MAX_TOUR_STEPS = 12
}).superRefine((tour, ctx) => {
  const stepIds = tour.steps.map((s) => s.targetId);
  // uniqueness not required (a step may revisit a target), but every
  // click:<id> in advanceOn must reference a targetId present somewhere
  // in the registry — checked at validation time against the live registry,
  // not against stepIds, since the click target may differ from the
  // highlighted target.
});
```

Text fields run through the same redaction/truncation pipeline as `cleanText`/`redactTelemetryString` (`packages/agent-observability/src/index.ts`, `packages/agent-embed/src/index.ts`) — strip secret-shaped substrings, cap length, no HTML (driver.js popovers render as text, not `innerHTML`, closing off the injection vector `assistant-ui`'s allowlist pattern was built to avoid).

## Runtime behavior + lifecycle

- Client tour runtime (thin wrapper over driver.js) owns playback once a spec passes validation. The agent does not step the tour turn-by-turn.
- **No mid-tour re-targeting.** If the agent needs to react to something mid-tour (user asks a question, page state changes), that's a new turn emitting a *replacement* tour spec via `startTour` again — the runtime tears down the old tour and starts the new one. There is no "patch this step" verb.
- Lifecycle is reported back into page context, extending `AgentUiPageContextSnapshot` (`packages/agent-observability/src/index.ts`) with an optional `tour` field:
  ```ts
  interface AgentUiTourSnapshot {
    tourActive: boolean;
    tourId: string | null;
    currentStepIndex: number | null;
    totalSteps: number | null;
    status: "idle" | "playing" | "completed" | "skipped" | "target_unavailable";
  }
  ```
  The agent observes progress purely by calling `getPageContext()` — same read-back model as workflow phase today, no new polling channel.

## New actions

Two additions to the existing 13-verb registry on `AgentUiPageControl["actions"]` (`packages/agent-observability/src/index.ts`), bringing the total to 15:

- `startTour(spec: TourSpec) => AgentUiSemanticActionResult` — validates against the registry, replaces any active tour, returns `{ ok: false, disabledReason: "unknown_target" | "too_many_steps" | "invalid_advance_on" }` on rejection.
- `endTour() => AgentUiSemanticActionResult` — dismisses the active tour (agent-initiated skip); user-initiated dismissal (e.g. an "X" on the popover) goes through the same runtime path but is reported as `status: "skipped"` either way.

Both return the standard `AgentUiSemanticActionResult` envelope already used by all 13 actions — no new result shape.

## Security/sanitization

- Registry lookups are the only DOM-touching surface; the agent never receives a DOM reference, only IDs — identical invariant to the render allowlist ("agent can't reach the DOM directly").
- Tour text is agent-authored and sanitized exactly like other agent-supplied props (§4 of the hitlist: "sanitize agent-supplied href/src" pattern from `assistant-ui`).
- Tours are read-only UX: `advanceOn: "click:<targetId>"` waits for a real user pointer/keyboard event on the real control — the runtime never synthesizes that click. This keeps tours outside the mutation/approval trust boundary entirely (no `approvedCommandIds` involvement, no `toolPolicy` gate needed) — they can't do anything a user didn't already choose to do.
- Step/text limits (12 steps, 80/400-char title/body) bound the token cost of an adversarial or runaway tour and match the size discipline already used for telemetry (`MAX_STRING_LENGTH`, `MAX_LIST_ITEMS` in `packages/agent-observability/src/index.ts`).

## Svelte implementation sketch

- **Types + schema**: `packages/agent-observability/src/index.ts` — `AgentUiTourSnapshot`, extend `AgentUiPageContextSnapshot.tour`; `packages/tool-contracts/src/index.ts` — `tourSpecSchema`/`tourStepSchema` alongside the existing zod contracts.
- **Registry + runtime**: new `lib/tour/` in `apps/standalone-sveltekit/src/` — `registry.svelte.ts` (rune-backed `AgentUiTourTargetRegistry`), `runtime.ts` (driver.js wrapper: spec → driver.js `DriveStep[]`, lifecycle → page-context writes), `TourTarget.svelte.ts` (the `use:tourTarget` action).
- **Host envelope**: `packages/agent-embed/src/index.ts` — add `tourTargets` to `ALLOWED_CONTEXT_KEYS`, thread through `sanitizeAgentHostPageContext`.
- **Dependency**: `driver.js` (~5KB gzipped, MIT license) added to `apps/standalone-sveltekit/package.json` only for P1 — no new dependency needed in shared packages until a host adopts P2.

## Phased rollout

- **P1 — sidecar-only targets.** Registry + tour spec + `startTour`/`endTour` scoped entirely to sidecar-owned DOM (composer, rail, suggestion chips). No host envelope changes. Ships the whole trust model end-to-end on the smallest surface.
- **P2 — host-donated targets.** Extend the embed handshake with `tourTargets`; host page implements its own registry and resolves its own IDs. Lets tours point at booking-app chrome (nav, calendar) without the agent ever seeing host DOM.
- **P3 — `TourNode` marketplace node type** (decision point for Dan, not scoped here): a tenth workflow node type alongside the existing nine (`TriggerNode`, `AskUserNode`, `SkillNode`, `ArtifactNode`, `ToolPreviewNode`, `ApprovalNode`, `ToolCommitNode`, `RemoteExecutionNode`, `EvidenceNode` — `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/COMPONENT-INVENTORY.md`). Would let a marketplace template embed a canned tour as a build-time node rather than an agent-authored runtime spec. Deliberately deferred — needs its own state machine (`unconfigured, configured, active`-style) and interacts with the still-unresolved template versioning/moderation gaps flagged in the hitlist (§6).

## Testing

Deterministic, no-LLM conformance in `tests/agent-eval/`, following the existing `scenarios/page-control-contract.eval.mjs` + `lib/page-control-driver.mjs` pattern (Playwright driving `window.__sonikAgentUI` directly, asserting typed shapes rather than scraping text):

1. **Registry conformance** — every `targetId` declared by the sidecar (and, once P2 lands, every host-donated ID) resolves to a live element via `registry.resolve()`; add `tour.list()`-style introspection the eval driver can call the same way `getActionNames()` checks the 13/15 actions today.
2. **Tour validation rejects unknown targets** — call `startTour` with a spec containing a bogus `targetId`; assert `{ ok: false, disabledReason: "unknown_target" }` and that no tour becomes active (`getPageContext().tour.tourActive === false`).
3. **Lifecycle events in page context** — call `startTour` with a valid single-step spec; assert `tour.tourActive === true`, `tour.currentStepIndex === 0`; call `endTour`; assert `tour.status === "skipped"`. Extend `PAGE_CONTROL_ACTION_NAMES` in `lib/page-control-driver.mjs` to the new 15-entry list so the existing "all actions registered" check in `page-control-contract.eval.mjs` covers `startTour`/`endTour` for free.

## UI questions needing Dan's approval

1. **Popover styling** — does the driver.js popover get a fully custom Sonik theme (bento/neumorphic tokens per `amplify-theming`) or a light CSS override of driver.js defaults for P1?
2. **Progress indicator** — step counter ("2 of 5") inside the popover, a separate persistent rail element, or omitted entirely for short tours?
3. **Skip affordance** — always-visible "Skip tour" vs. an implicit escape-key/click-outside dismiss only; and whether skip is visually distinct from "X close."

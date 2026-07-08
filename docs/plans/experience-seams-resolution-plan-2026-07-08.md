# Experience-Seams Resolution Plan — 2026-07-08

**Trigger:** Dan's live demo transcript (templates → "make a visual" → reservation) + the investigation handoff (`streaming-canvas-artifact-ux-investigation-2026-07-08.md`).
**Framing (Dan's, and correct):** "This is not mainly the model being dumb." Every failure in that transcript is a **rendered-surface seam** — canvas didn't open, a recoverable tool error looked like a hard failure, streaming didn't stick to the bottom, the approval card never appeared, the tool set visibly churned mid-session. None of it is wire-level logic.

---

## 0. A correction I owe you first

Earlier this session I reported the pressure test as **"safety: clean, no unapproved writes."** That was true in the trust sense but **misleading about the control you actually touched.** The transcript proves it: you set the booking family to **"ask,"** asked for a 6:30 booking, and it **committed anyway** as `policy_allowed`.

**Root cause (verified in code):** `commitCommand` resolves approval from `context.approvedCommandIds?.includes(commandId)` (`command-catalog.ts:155`). The booking host ships a standing grant list (~113 approved command ids in the signed envelope). So a write auto-approves whenever the host already granted it — **the per-family "ask" toggle never enters the decision.** "Ask" today means *visible/callable*, not *prompt-me-each-time*. No untrusted write occurred, but the approval **UX** you expected does not exist. This is item **R5** below and I'm treating it as the highest-trust-risk item, not a polish item.

---

## 1. Why hundreds of reviews and my own tests missed all of this

This is the part worth internalizing, because it's structural, not carelessness.

| Test layer we have | What it actually exercises | Why it is blind to the transcript |
|---|---|---|
| **Persona/pressure harness** (`scripts/harness`) | The **SSE wire** — tool receipts, spec patches, phase. Headless. | No DOM, no iframe, no canvas surface, no scroll, no mode-switch. It literally cannot see "canvas didn't open" or "the failure looked scary." The wire was green the whole time. |
| **Eval gate** (`embedded-experience.eval.mjs`) | Session resume, switcher present, signed-envelope `/api/session` 200. | A **contract** test. It opens the sidecar but never creates an artifact, never watches a tool error render, never checks auto-scroll or canvas auto-open. |
| **Unit suite** (~90 files) | Functions, schemas, source-pins. | Asserts `commitCommand` returns `needs_approval` **in a unit context with no host grant**. The live path where a host grant overrides "ask" was never exercised end-to-end. That's exactly why R5 slipped. |
| **Human PR reviews** | Diffs and code. | You cannot see a canvas-open animation or a scary red error block in a unified diff. |

**One sentence:** every layer we have reviews *code and contracts*; **nothing drives the rendered, multi-turn experience in a real browser.** The entire transcript is invisible to all of them by construction. The fix is not "review harder" — it's a test lane that renders (R7).

**On analyze-copy-retrofit / the research:** the parity ledger already flagged the disease — we vendored the *primitives* and never wired the *behaviors*. `JsonInlineRenderer` is a dead export. The Odysseus canvas (GSAP-smooth, self-managing) sits in `static/vendor/odysseus`, unwired. The open-design retrofit's auto-open-on-create and inline-question-card patterns were studied and not adopted. The upstream repos **already solved** auto-open-canvas, smooth rollout, inline ask-user, and deterministic approve. We have the parts in `packages/` and `static/vendor/`; we shipped the plumbing and skipped the experience — the same mistake as the demo-tools headline (F3).

---

## 2. Issue → root cause → the primitive we already own

| # | What the user saw | Root cause (file) | We already have the fix in… |
|---|---|---|---|
| R1 | Canvas didn't auto-open on "creating an artifact"; "I don't see a canvas" | `+page.svelte` forces `artifactOpen=false` in chat mode; artifact creation never requests `canvas.open` | `agent-embed` **already exposes `canvas.open` host action** (`index.ts:793`); `artifact.stream.preview_mounted` telemetry already fires — just not wired to request open |
| R2 | Recoverable tool failure shown as scary red block ("Canvas creation failed" ×4) | `ToolCallBlock` renders `output-error` immediately; no "recoverable during stream" policy | `@json-render/core` `autoFixSpec` + our `repairSpec` (shipped) handle *structural* repair; the missing layer is **presentation policy**, not logic |
| R3 | Streaming doesn't stick to the bottom; looks cut off | `ConversationContent` scrolls only if already `isAtBottom`; conservative | `packages/chat-surface/src/vendor/amplify-chat` conversation-context has the near-bottom tracking — needs a "follow while streaming" mode |
| R4 | No inline ask-user-question; a reservation forces a full canvas intake | We only mount the QuestionCard flow inside the intake artifact; no compact chat card | **`JsonInlineRenderer` — dead export in `packages/json-ui-runtime`** is exactly this surface. QuestionCard already renders inline-capable. |
| R5 | Set family to "ask," write committed anyway | `commitCommand approved = approvedCommandIds.includes(id)` (`command-catalog.ts:155`) — host grant overrides "ask" | Needs a new gate: "ask" must force an interactive approval turn even when host-granted. The **deterministic approval card** (`AgentConversation` approval affordance) already exists to host it. |
| R6 | Tool set visibly churned ("booking commands are gone" → "check again" → back) | Per-turn skill selection (`runtime-skill-intent`) + `agent.ts:100` suppressing command tools when a preview-only skill mounts | Our own guard-narrowing (F2) is the same subsystem; this is the #1 unpredictability suspect and needs a stability rule, not more keywords |
| R7 | None of the above was caught | Headless harness + contract eval only | `@json-render/devtools` (vendored) + Playwright (already a dep) → a **rendered E2E lane** |
| R8 | "How do we not have telemetry on all this" | Telemetry exists in fragments; no turn timeline | Our **stream tap** (shipped) + devtools Stream/Actions panels already capture the events — they need joining into one operator-readable turn timeline |
| R9 | No durable template install; agent recreated 18 rows by hand | `marketplace-workflows.ts:31` installs into `installedBySession = new Map()` | Out of scope for demo-readiness; flagged, not slotted |
| R10 | Settings not saved per org | `+page.svelte` holds them as client state only | Out of demo-critical path; flagged |

---

## 3. Resolution plan — ordered by demo-trust impact

Each slice names the primitive it wires. Gate everything behind the new rendered E2E lane (R7) so we can't reopen these blind.

### Slice A — Draft-only invariant (R5) · **highest trust risk** · Dan-ratified 2026-07-08
The doctrine (replaces the earlier "make ask interactive" idea — this is cleaner):

> **The agent's ceiling for anything that creates or publishes is a submitted draft. The only code path that publishes is a human pressing Approve on the preview card.**

- **Remove the publish/commit tools from the agent's mounted set for creation/publish flows.** The agent can build a draft and call `requestApproval` (surface the preview card) — it must **not** hold `commitCommand`/`approveAndRun` for these flows. This makes publishing *physically impossible* for the model regardless of host `approvedCommandIds` — the R5 bug can't exist because the tool isn't there.
- **Two distinct gates (Dan's separation):** "ask" gates *initiation* (may the agent start this workflow); the draft→publish boundary gates *publication* (always a human click). "allow" means "build the draft without asking first" — never "publish."
- **Reads stay open** (availability, list) — the invariant is about writes/creates/publishes, not lookups.
- **"Publish where others can see" is free** — it falls out of the invariant; nothing reaches a shared/published state without a human approve.
- **Test that closes the blind spot:** assert the publish/commit tool is **absent** from the agent's mounted tools in creation flows (a pure structural check the headless harness *can* run) + an E2E (Slice G) that a creation request stops at a preview and only publishes on the button click.
- **Needs Dan's sign-off before I touch the commit path** — it's the trust boundary. Deferred: whether some publishes need more than one approve click (parked per Dan).

### Slice B — Canvas/document auto-open + smooth rollout (R1, R3)
- On `artifact.stream.preview_mounted` (first renderable partial) request `canvas.open` from the host via the **existing `agent-embed` action**; on document promotion open the document surface.
- Animate the rollout: wire the **Odysseus GSAP** vendor (`static/vendor/odysseus`) or a reduced-motion CSS transition in the host canvas mount — Dan explicitly asked for "GSAP smooth, not out of nowhere."
- Add a "follow while streaming" scroll mode to `ConversationContent` (stick to bottom unless the user scrolls up).
- Fallback affordance: if the host declines `canvas.open`, show an inline **"Open canvas"** button (never leave the user with "I don't see a canvas").

### Slice C — Recoverable-failure presentation policy (R2)
- While a turn is streaming, collapse tool `output-error`/`output-denied` into a neutral **"checking / retrying"** activity label; only promote to a user-facing failure if the **turn ends** without recovery.
- Keep the technical receipt expandable (operators still see everything).
- Telemetry: `tool.failure.recovered` vs `tool.failure.terminal` — this is the join the user's "should show it asked, not that it failed" comment needs.
- Note: this is **presentation only** — the model's own follow-through loop (apologizing instead of retrying) is a prompt/skill fix, tracked separately, but the UI must stop amplifying it.

### Slice D — Inline ask-user-question for simple flows (R4)
- Wire the **dead `JsonInlineRenderer`** so a reservation with a missing field renders a **compact chat question card** (not a full canvas intake).
- Reservation skill: when no booking context is anchored, the **first** question is "where?" (Dan's explicit ask) — encode as an enforced script in the skill body.
- Answers submit through the deterministic page-control action path, not vague chat text.

### Slice E — Skill/tool-set stability (R6)
- Add a stability rule to `runtime-skill-intent`: once a workflow skill is active with an artifact, **don't drop the booking command family mid-workflow** on a keyword miss (the transcript's "commands are gone → check again → back" is this churn). This is the same subsystem as tonight's F2 guard; extend it to command-family mounting, not just the intake skill.
- Telemetry: `agent.toolset.churned` when the mounted family set changes turn-over-turn within one workflow.

### Slice F — Turn-timeline telemetry (R8)
- Join the events we **already emit** (`api.generate.stream_*`, `tool.*`, `artifact.stream.preview_mounted`, `claim_without_receipt`, the new R2/R5/R6 events) into one **operator-readable turn timeline** keyed by requestId. The `@json-render/devtools` Stream/Actions panels are the dev-side view of this; surface a Pipe-B query/report as the ops-side view.

### Slice G — Rendered E2E test lane (R7) · **the thing that closes the blind spot**
- New Playwright lane (Playwright is already a dependency) that drives the **real embedded surface**: send "make a visual" → assert canvas actually opens; force a Timeline-missing-date artifact → assert the failure does NOT render as a hard error mid-stream; flip family to "ask" → assert a write **prompts** instead of committing; switch chat↔canvas mid-stream → assert the message survives.
- Use `@json-render/devtools` hooks + `data-*` testids already in the components.
- **Every slice above lands with an E2E case here, or it isn't done.** This is the durable fix for "why did reviews miss it."

### Deferred (flag, not slotted now): R9 durable marketplace install, R10 org-scoped profiles.

---

## Odysseus editor — corrected status + deferred plan (Dan 2026-07-08)

**Correction:** the earlier claim (mine, the parity ledger, phase-8 doc) that Odysseus was "vendored but unwired" is **wrong**. `static/vendor/workspace` symlinks to `vendor/odysseus`; the live Documents button → `WorkspaceDocumentFrame` → `workspace-document-host.html` imports `document.js`, whose graph pulls in **all 32 vendored files + the full 37k-line `style.css`**. It executes in client browsers today.

**License:** AGPL-3.0 (`pewdiepie-archdaemon/odysseus`), now network-served/executing → a real compliance obligation for client rollout, **not hypothetical**.

**Dan's decision (2026-07-08):**
- **AGPL: deferred to pre-release.** Don't act now. Strategy = **rewrite and manage** Odysseus-derived surfaces once we have a solid product, then run a compliance scan. Rewrite along the way where cheap. Ship the client demo before resolving; resolve before public release.
- **Library modal (`#doc-import-btn` → Chats/Documents/Research/Archive):** Dan hasn't seen Library usage that's worth keeping — treat it as **remove/hide**, not adopt. It's also the biggest foreign-copy + AGPL surface.
- **Foreign copy leak:** documented (see test-plan known issues), not fixed now.
- **Markdown-preview styling:** keepable and small — extract the `.doc-md-preview` / `.doc-editor-*` / `.doc-md-toolbar` rules (theme-token driven, already bridged to Sonik CSS vars) into a scoped stylesheet when we rewrite; don't carry the 37k-line sheet.

## Chat-as-dynamic-modal — product direction (Dan 2026-07-08)

Dan wants the chat to feel like a **high-quality, maneuverable modal**, not a speed-dial launcher:
- Opens on the **left**, **sticky**, **pops up from the bottom**, draggable/dynamic (Linear's bottom-row pop-up chat is the reference; we don't have to copy it exactly).
- Move **off the ✦ speed-dial launcher** — reads as corny/dated. Not urgent, but the target.
- **Reuse candidate:** Odysseus's `modalManager` already embeds chat and its `windowDrag`/`windowResize`/`modalSnap`/`tileManager` modules are the maneuverable-window machinery (currently loaded-but-dormant in the doc-only host). This is behavior we can translate (per the Svelte-runes retrofit precedent), not necessarily keep the AGPL source. Folds into Slice B (canvas/surface animation) as a sibling.

## Reference survey: open-webui + onyx (2026-07-08, both local under sonik-dev/amplify)

Surveyed for the six seam areas. Licenses: open-webui = BSD-3-style w/ branding clause (patterns safe); onyx = MIT outside `ee/` (everything surveyed is MIT).

**Chat-as-dynamic-modal:** neither has it. open-webui is docked resizable panes (`paneforge`); onyx's widget is a Lit shadow-DOM launcher→fixed-panel (same speed-dial pattern we're leaving). **Conclusion: the Linear-style draggable/sticky chat modal has no upstream to copy — Odysseus's modalManager/windowDrag machinery (behavior-translated) remains the only real reference. Slice B owns it.**

**Adopt into Slice B (streaming/scroll):** onyx `ChatScrollContainer.tsx` is the best-in-class pattern — MutationObserver (structure) + ResizeObserver (height), deliberately NOT observing characterData so token-level mutations don't thrash; ref-held `isAtBottom`; disable-follow only on upward scroll past threshold; mask-image edge fade. Port to Svelte 5 runes. open-webui's simpler threshold check is the fallback. Optional: onyx's BlinkingBar cursor during stream.

**Adopt into Slice C (tool presentation):** open-webui `ToolCallDisplay.svelte` (collapsed-by-default card, spinner→check, truncated-result-with-expand) + onyx's packet rule (`isToolComplete` treats ERROR as terminal-complete; errors render inline in the timeline without halting the turn). Neither hides recoverable errors — our mid-stream suppression policy is still our own addition on top.

**Adopt into Slice B/canvas (later):** onyx `PreviewModal` variant-registry (one modal shell, dispatch-by-content-type renderers) — clean shape for multi-type artifact rendering.

**Approval/HITL:** neither repo has draft→approve→publish. **Our draft-only invariant (Slice A) is ahead of both references — build it ourselves.**

**Telemetry:** onyx ships admin-configurable tracing with `TracingProviderType = "braintrust" | "langfuse"` — direct precedent for our Langfuse+PostHog direction (theirs is admin-pluggable; ours can start env-configured).

**Embed architecture note:** onyx's `widget/` (standalone Vite+Lit custom element, script-tag embed, CSS-custom-property theming, own stream parser) is the cleanest embed-isolation reference if we ever revisit how agent-ui mounts into hosts.

## Telemetry direction — corrected (Dan 2026-07-08)

Dan clarified he meant **Langfuse**, not langchain. Confirmed path: **Langfuse + PostHog as the future LLM observability** (we already have the PostHog plugin). Both are drop-in alongside the Vercel AI SDK — no agent-core rewrite. tiktoken remains not-useful (we already capture provider-truth token usage in `run-event-log.ts:117`). Near-term lever is still Slice F (turn timeline from events we already emit); Langfuse/PostHog is the productized layer on top of that.

---

## 4. Sequencing recommendation

1. **Slice A (approval)** first — it's the only trust/safety item and it corrects a live gap I mis-reported.
2. **Slice G (E2E lane)** second, even minimal — so A and everything after can't regress invisibly.
3. **B, C, D** — the visible demo experience, in that order (canvas-open is the most-felt).
4. **E, F** — stability + observability.
5. Defer G-marketplace and org-profiles until post-demo unless you say otherwise.

Slices A–D are the demo-blocking set. B/C/D each wire a primitive we already paid to vendor.

## 5. What I am NOT claiming
- I have not re-run the transcript live against the current deploy; the code citations are from `origin/main aba57bf`.
- Slice A changes write-approval behavior — it needs your explicit sign-off before I touch the commit path, since it's the trust boundary.
- The model's own retry-follow-through (apologizing instead of re-calling the tool) is a real contributor the UI can only mask, not cure; that's a prompt/skill slice I'd scope separately.

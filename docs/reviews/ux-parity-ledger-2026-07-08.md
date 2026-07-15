# UX Parity Ledger — 2026-07-08

## Summary

The regressions Dan flagged are real and traceable to specific commits/docs, not just vibes. Two are actual code duplication bugs (double "Sonik Chat" title, four different surface labels for one concept). Three are things that were vendored as raw reference material but deliberately never wired into the live app (Odysseus drag/window-manager JS, slash commands/skill pills, a dynamic canvas). One ("no session switcher") is already in progress on an **open, unmerged** PR (#11) — not fixed yet. The rest (workflow-card badge text, button/gear sizing) are shipped-but-rough polish, not missing features.

## Reference → current-state table

| Experience | Reference (source) | What reference did | What we ship today | Gap class | Effort |
|---|---|---|---|---|---|
| Draggable/resizable canvas windows | `apps/standalone-sveltekit/static/vendor/odysseus/static/js/windowDrag.js`, `windowResize.js`, `modalManager.js`, `tileManager.js`, `toolWindowZOrder.js` (vendored, unused) | Free window drag, resize, z-order stacking, tiling for canvas panes | `packages/workspace-core/src/components/CanvasViewport.svelte` — static CSS grid layout (`WorkspaceRoot.svelte:71` fixed `grid-template-columns`); only draggable/resizable element in the whole canvas is a `<textarea>` with CSS `resize: vertical` (`CanvasViewport.svelte:284`) | Lost (vendored, never wired) | L |
| Odysseus skills system | `chatRenderer.js:1133` — `import('./skills.js').then(...)` | Dynamic skill loading/UI in the chat renderer | `skills.js` was never copied into the vendor snapshot — the dynamic import is a dangling reference to a file that doesn't exist in this repo | Lost (partial vendor, incomplete) | M |
| Per-turn skill composition / skill pills | `docs/handoffs/agent-ui-open-design-architecture-gap-analysis-2026-07-01.md:98-103` (Gap 4): "Open Design: `ChatRequest.skillIds` are @-mentioned in the composer and concatenated into the system prompt for that run only — never persisted onto the project." | @-mention skill selection per message, ephemeral (not saved) | No @-mention affordance in `packages/chat-surface/src/components/` composer; skills only surface as a static list in `AgentSettingsPanel.svelte:310` ("Installed runtime skills") behind the gear menu, not in the composer | Never-wired | M |
| Slash commands in composer | (no sourced reference found — not in Odysseus vendor JS, not in Open Design manifest, not in any doc) | — | Grep across `packages/chat-surface/src/components/` for slash-command/dropzone patterns returns zero hits | Never-designed | M |
| File upload / drag-drop in composer | (no sourced reference found in vendor code or manifests) | — | Same grep, zero hits | Never-designed | M |
| Single, unambiguous chat title | — | — | `apps/standalone-sveltekit/src/routes/+page.svelte:3403` renders `<WorkspaceRoot title="Sonik Chat" ...>` (host chrome) AND `+page.svelte:3425` / `AgentConversation.svelte:92` (`title = "Sonik Chat"` default prop) render it again as the inner conversation header — two independent components both hard-coding the same literal string. Confirmed as a named regression in PR #11's own bug report: "duplicated 'Sonik Chat' title." | Lost (introduced regression) | S |
| Surface naming identity | — | — | Four distinct literal labels for what should be 1-2 concepts: `"Artifact Canvas"` (`CanvasToolbar.svelte:59`), `"Artifact workspace"` (`ArtifactFrame.svelte:19` fallback title), `"Workspace Document"` (`+page.svelte:327-328`, `documentFrameTitle`), plus `docs/architecture/phase8-canvas-viewport-shell.md:29` itself lists `Artifact Canvas`, `Artifact workspace`, and `Canvas viewport ready` as three separate strings a tester should expect to see on one screen | Naming | S |
| Workflow-suggestion readiness badges | — | — | `apps/standalone-sveltekit/src/lib/agent-workflows/templates.ts:252` sets `readinessLabel: "Needs page"`; `AgentConversation.svelte:237` renders it through `uppercase tracking-[0.12em] text-[10px]` CSS, so on screen it reads as `NEEDS PAGE` — looks like a leaked debug/status flag even though the underlying string is sentence-case and intentional | Polish | S |
| Settings gear affordance | — | — | `AgentSettingsPanel.svelte:202-208` — the "gear" is a literal Unicode glyph `⚙` in a `<span aria-hidden="true">`, sized only by the parent button's `text-sm` class; no dedicated icon component or explicit icon-size token | Polish | S |
| Session/chat switcher in embedded widget | — | — | FIXED 2026-07-08: embedded bootstrap resumes the most recent session and the chat header renders a native session switcher (`AgentConversation.svelte` `sessionOptions`/`onSessionSwitch`, wired in `+page.svelte` behind `isEmbeddedHostContextExpected()`). **Deployed live as worker version `134735f9`**; PR #11 is the same change awaiting merge to protected main. The switcher also replaces the inner "Sonik Chat" `<h1>` in embedded mode, removing half of the double-title. | Fixed (deployed, PR open) | done |
| `json-ui-runtime` unused capability | `packages/json-ui-runtime/src/index.ts:2` exports `JsonInlineRenderer` | — | Only `JsonArtifactRenderer` is imported anywhere in the app (`apps/standalone-sveltekit/src/routes/+page.svelte:11`); `JsonInlineRenderer` has zero importers repo-wide | Never-wired (dead export) | S (delete or wire) |
| Twenty AI settings reference | `manifests/copy-retrofit/twenty-ai-settings.json` — upstream `twentyhq/twenty`, vendors `SettingsAI.tsx`, `SettingsAiModelsTab.tsx` | Model picker + AI settings UX pattern | Vendored only as **reference proof** under `docs/upstream-proofs/twenty-ai-settings/` — `"destination"` paths in the manifest are all under `docs/upstream-proofs/...`, not live app code | Never-wired (reference only, by design) | M |
| Open Design question-form artifact | `manifests/copy-retrofit/open-design-intake.json` — upstream `nexu-io/open-design` | `question-form.ts` artifact + `partial-json.ts` streaming-JSON runtime, vendored into `vendor/open-design/question-form/` | Live and used per `check:copy-retrofit:open-design-intake` gate (test suite `test:open-design-intake` runs against it) | Shipped (parity confirmed) | — |

Two items from the initial brief could **not** be verified in the current tree and are flagged rather than asserted:
- **"Documents" as a literal naming-soup label** — confirmed: `apps/standalone-sveltekit/src/routes/+page.svelte:3486` renders a header button labeled `Documents` (`aria-label="Open workspace documents"`), and `packages/tool-contracts/src/index.ts:1047` registers `{ id: "document", title: "Documents" }`. Sitting next to `"Workspace Document"` and the Canvas labels, this is the fifth synonym in the soup.
- **`wides.json` vs `wides.html` artifact identity** — zero grep hits for either string anywhere in the repo. Could not source this claim; do not treat it as confirmed.
- **"Canvas unreachable behind the left-hand nav in the booking host"** — not documented in `docs/reviews/persona-bug-triage-2026-07-07.md`, `docs/testing/amplify-workflow-demo-readiness.md`, or the UI target registry handoff. `WorkspaceRoot.svelte` does define a fixed-width rail column (`grid-template-columns: var(--workspace-rail-width, ...) minmax(0, 1fr)` at line 71) that could plausibly clip the canvas column under certain embed rail modes, but I did not find a sourced bug report confirming this specific failure — flagging as plausible-but-unconfirmed, worth a live repro before scoping a fix.

## Restore-first (top 10, ranked by demo impact)

1. **Fix the duplicate "Sonik Chat" title** — one-line-scope, single most visible glitch on every screen, already in-flight on PR #11.
2. **Land PR #11 (session switcher)** — it's written and open, just needs to merge; biggest functional gap (no chat history/switching) with a fix already sitting there.
3. **Collapse the four surface-name synonyms to one naming scheme** — see proposal below; touches only string literals, no logic change.
4. **Re-word/re-style workflow-card readiness badges** — either change `"Needs page"`/`"Draft"` copy or drop the aggressive uppercase-tracking treatment; looks like debug output on the most-viewed empty state.
5. **Give the gear button a real icon** — swap the `⚙` glyph for an icon component at an explicit size; smallest fix with outsized "polish" perception impact.
6. **Investigate/confirm the canvas-behind-left-nav claim in the booking host embed** — needs a live repro since no doc confirms it; if real, likely a z-index/rail-width fix in `WorkspaceRoot.svelte`.
7. **Wire a minimal canvas drag/resize** — doesn't need full Odysseus parity; even basic reposition using the already-vendored `windowDrag.js`/`windowResize.js` as reference would kill the "completely static" complaint.
8. **Add @-mention skill composition to the composer** — Open Design's Gap-4 pattern (ephemeral `skillIds`, not persisted) is a scoped, already-documented reference to build against.
9. **Design (from scratch — no reference exists) slash commands for the composer** — no upstream to copy, needs its own spec before implementation.
10. **Design (from scratch) upload/drag-drop in composer** — same as above, no reference found; needs product spec first.

## Naming identity proposal

One name per surface, replacing every synonym found in the codebase:

| Proposed name | Surface | Replaces (current synonyms, with citation) |
|---|---|---|
| **Chat** | The conversation/message thread | `"Sonik Chat"` used redundantly in both `WorkspaceRoot` (`+page.svelte:3403`) and `AgentConversation` (`AgentConversation.svelte:92`, `+page.svelte:3425`) — keep exactly one owner (the host `WorkspaceRoot`) rendering the title; `AgentConversation` should accept no default title string of its own. |
| **Canvas** | The single right-pane surface that shows a promoted artifact | `"Artifact Canvas"` (`CanvasToolbar.svelte:59`), `"Artifact workspace"` (`ArtifactFrame.svelte:19`), and the loose `"Canvas viewport ready"` state string (`phase8-canvas-viewport-shell.md:29`) — pick "Canvas" as the one on-screen word; "Artifact" becomes a data-model term only (see below), never a surface label. |
| **Document** | The editable Markdown/HTML/JSON/CSV text-editor island (distinct from Canvas — it's an editor, not an artifact viewer) | `"Workspace Document"` (`+page.svelte:327-328`, `documentFrameTitle`) and the `WorkspaceDocumentFrame.svelte` component name — keep "Document," drop "Workspace" prefix since "Workspace" isn't used consistently elsewhere. |
| **Artifact** | The underlying JSON-render data object/spec that Canvas renders — a data-model term, not a surface name | Currently double-used as both the data model AND a UI label ("Artifact Canvas," "Artifact workspace"). Stop using "Artifact" in any on-screen surface title; reserve it for internal/dev-facing state names (`artifactOpen`, `ArtifactInspector`, etc.), which is already how the codebase treats it in non-title contexts. |

This is a labels-only change (component titles, toolbar eyebrow text, default props) — no component restructuring required to implement rows 1-3.

## Sourcing notes

- Copy-retrofit gates confirmed in `package.json:14,29,33,35`: `check:copy-retrofit:booking`, `check:copy-retrofit:open-design-intake`, `check:copy-retrofit:twenty-ai-settings`, each backed by a manifest under `manifests/copy-retrofit/`.
- The recon corpus lives at `/Users/danielletterio/Documents/Sonik_Amplify/recon-mission-2026-05-06/` (outside the repo): 11 per-repo studies (incl. `01-open-design.md`, `07-mastra-ui-dojo.md`), cross-cutting syntheses (`C1-live-edit-rendered-thing.md` — click-to-edit-via-agent pattern, element-identity namespace flagged as an open decision), and vision PRDs. The Odysseus upstream sibling repo is at `/Users/danielletterio/Documents/GitHub/odysseus` per `manifests/copy-retrofit/odysseus-document-editor.json`.
- The in-repo Odysseus material is the static vendor snapshot at `apps/standalone-sveltekit/static/vendor/odysseus/`, which `docs/architecture/phase8-canvas-viewport-shell.md` (lines 5, 25, 39, 55) explicitly documents as vendored-but-not-wired, kept "so a future Odysseus copy-retrofit pass has an obvious destination surface."

## Append-only governance entries

- **MT-056-UX-001 — 2026-07-15:** Added `docs/testing/agent-ui-pr56-manual-test-2026-07-15.html` as a self-contained manual-test document composition. This is not a production visual-parity departure: shipped Agent UI behavior, signed host authority, stable org/user ownership, typed telemetry privacy, and fixture-only Channels remain the product truth. No deploys, production mutations, or booking writes occur during this manual test plan; those are execution boundaries for the test, not claims about global product invariants.

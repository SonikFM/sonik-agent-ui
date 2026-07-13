# UI/UX Defect Backlog — 2026-07-13 live-embed testing

Read-only ultratest gathering pass. Sources: Dan's live booking-embed session
(screenshots + transcripts), Claude's driven browser passes on the deployed
worker (`2fc0889c`), and a 3-viewport Playwright sweep of the dev rig
(`.omx/logs/ui-sweep/`, zero console errors at all widths; assertions green).
Open items only — the twelve defects fixed and deployed today are listed in the
appendix for traceability.

Severity: P1 blocks a core flow · P2 degrades a core flow · P3 polish with
user-visible friction · P4 nice-to-have.

| ID | Sev | Defect | Evidence | Pointer / sized fix |
|---|---|---|---|---|
| UX-001 | P1 | Workflow **Approve control unreachable in embedded chat** — approval state exists (`approvalGranted:false`, `canCommit:false`) but no card renders; the run-panel walk lives only in the standalone builder | Smoke transcript: "Approval requested — card created" with nothing to click | `+page.svelte` affordance slot covers reservation/intake only; extend `createApprovalAffordanceFromWorkflowRun` to marketplace workflow approvals (~1 day — the "reopen workflows" opener) |
| UX-002 | P2 | Marketplace workflow cards wrap **word-per-line** in narrow columns | Dan screenshot 13:03 (Set up a venue / Create reservation cards) | Workflow suggestion/launcher card CSS — min-width or horizontal variant under ~280px (~hours) |
| UX-003 | P2 | Approval card **buttons overlap the title** in the narrow canvas chat pane (~460px) | Claude canvas screenshots ("Book th'Review reservation" collision) | chat-surface approval card header — wrap/stack actions below title at narrow width (~hours) |
| UX-004 | P2 | **Raw tool-call args leak into the transcript** during a failed tool retry (`parameter name="spec" string=...` dumped as prose), followed by bare "Canvas creation failed" with no retry affordance | Dan's intake transcript | Streaming part renderer: never render tool-input deltas as text for failed/unmounted tools; show the tool chip + typed error (~0.5 day) |
| UX-005 | P2 | Booking committed via human Approve shows **"No guest identity"** in the reservations detail — guest linkage may be dropped on the commit chain | Reservations detail, Jul 13 5:30 PM booking | Investigate `reservation-commit.ts` guest-id threading ↔ booking-service linkage (investigation first) |
| UX-006 | P2 | **Model picker defaults to DeepSeek ("Recommended")** in the production embed | Dan settings screenshot | Product/policy call: `AI_GATEWAY_MODEL` secret + `agent-models` recommendation flags — likely Anthropic default for trust posture (decision + small) |
| UX-007 | P3 | SupportDiagnosticsMenu popover **clips 62px off the left viewport edge** at ≤480px | Playwright sweep (`sidecar` viewport, overflow detector) | `support-menu__panel` positioning — clamp to viewport (~1h) |
| UX-008 | P3 | Approval card shows **raw ISO timestamp** (`2026-07-15T19:00:00-04:00`) | Dan + Claude screenshots | `reservationPreviewSummary` — humanize date/time (~1h) |
| UX-009 | P3 | Agent output uses **emoji in receipts/tables** (🔮 ✅ ❌ 🍽️), violating the product-surface design bans | Smoke + intake transcripts | `agent-prompt.ts` style module: ban emoji in receipts/tables/structured output (prompt-only, small) |
| UX-010 | P3 | Session auto-titles read as **CTAs in the history switcher** ("Create a Booking Workflow") even with the caption | Dan report + screenshots | Title generation prompt or switcher rendering (timestamp suffix / summary-style titles) (decision + small) |
| UX-011 | P3 | Composer **context chips crowd the placeholder** and wrap awkwardly at narrow widths | Screenshots at 460–480px | chat-surface composer chip row — max-rows + overflow count chip (~hours) |
| UX-012 | P3 | chat-surface **G2.5 disabled-reason baseline** — 3 pre-existing gate findings (controls without disabled-reason contract) | enterprise-ux gate output (identical pre/post today's edits) | `AgentConversation.svelte` / `ToolCallBlock.svelte` (~hours) |
| UX-013 | P3 | Doc editor **toolbar crowds the tab bar** at narrow widths | Canvas screenshots | Vendored island toolbar CSS — retrofit spacing (~1h) |
| UX-014 | P4 | Chat pane **scrollbar sits flush against the divider** hit area — mis-grab risk | Zoomed boundary screenshot | Inset the pane scrollbar or add divider hover affordance (~1h) |
| UX-015 | P4 | Canvas header controls (`Preview / Document / Fullscreen / Clear`) — **active/disabled states read ambiguously** | Canvas screenshots | Canvas header button states + disabled reasons (~hours) |
| UX-016 | P4 | QuestionCard **stale error text** may persist after the underlying cause is fixed until next submit | Dan's intake transcript (pre-fix) | Verify post-`allowSkip`-fix; add error clear on revalidate if it reproduces (verify first) |

## Non-UI decisions adjacent to this list

- Workflow Builder is standalone-only (`{#if !isEmbeddedHostContextExpected()}`) — expose to organizers or keep internal (Dan's call).
- Old ping/demo test sessions still populate prod history — data wipe is Dan's call.
- Commit-idempotency ledger rides the artifact store — promote to a dedicated table next migration window.

## Appendix — fixed & deployed today (traceability)

Theme name collision (mauve embed) · forced-canvas trap on restored sessions ·
dock-chat bounce · v7 `AI_InvalidPromptError` (two prompt-shape regressions;
every ZDR turn 503'd) · mid-token Call-id wrap · history switcher caption +
header overlap · document Version History failing to load (island headers) ·
document v1 revert loop (stale-echo guards) · approval card resurrect +
double-commit hazard (in-flight flag, durable receipts, server idempotency
ledger) · canvas hides chat (side-by-side + real pane) · unanswerable intake
questions (`allowSkip` contract default) · canvas hiding the conversation
header · snap transition destabilizing mid-stream scroll. Booking-side (PR
#179, pending merge): chat↔canvas iframe hard-reload ×2 + outer canvas wall.

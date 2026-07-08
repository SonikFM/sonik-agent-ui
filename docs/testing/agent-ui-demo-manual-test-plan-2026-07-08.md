# Agent UI — Manual Demo-Readiness Test Plan (2026-07-08)

**Purpose:** human walk-through before sharing the demo. Ordered the way a demo actually runs; each pass has steps, expected result, and what it means if it fails.
**Stack under test:** agent-ui worker `dd18a0e8` (main `5859fa7`, PRs #11–#30) embedded in `https://sonik-booking-app-pipe-b.liam-trampota.workers.dev`
**Login:** test69@gmail.com / test6969 · **Workspace:** 105 seeded booking contexts, 11 installed
**Time budget:** ~35 min full pass · ~12 min for the ★ critical-path subset

**Known issues going in (don't burn time rediscovering):**
- K1 — Conversational intake: after ~2 productive answer turns the model may say "Recorded ✅" **without** actually saving (narration drift; `toolChoice` decision pending). Typed answers ARE saved when a receipt chip/tool call shows.
- K2 — Session dropdown has 300+ entries on this seeded workspace; functional but unwieldy.
- K3 — Anything gated on the booking host app itself (nav, page chrome) is out of this repo's control; note but don't debug.

---

## Pass 0 — Pre-flight (2 min)

| # | Step | Expected |
|---|------|----------|
| 0.1 | Open the booking app, log in | Lands on dashboard/My Spaces, no console errors |
| 0.2 | Confirm worker version: visit `https://sonik-agent-ui.liam-trampota.workers.dev` directly | Standalone app loads (don't demo from here — just confirms the worker is up) |

## Pass 1 ★ — Widget open/close & session continuity (3 min)

*The regression that hurt most yesterday. Pinned by the eval gate, but verify by hand.*

| # | Step | Expected |
|---|------|----------|
| 1.1 | Click the ✦ launcher (bottom-right) | Sidecar opens; **your most recent chat resumes** — not a blank fresh chat |
| 1.2 | Look at the chat header | **Session dropdown** (not a static "Sonik Chat" title inside the frame) — only ONE "Sonik Chat" visible (host toolbar) |
| 1.3 | Pick a different session in the dropdown | That conversation's messages load |
| 1.4 | Close chat, reload the page, reopen | Same session as 1.3 resumes |
| FAIL⇒ | Fresh empty chat on every open = the yesterday regression is back — stop and check the deployed version first |

## Pass 2 ★ — Live booking reads (the "it's real" moment) (4 min)

| # | Step | Expected |
|---|------|----------|
| 2.1 | Navigate to Reservations (Main Course Tee Sheet) with chat open | — |
| 2.2 | Ask: *"What's today's availability on the Main Course Tee Sheet?"* | Tool activity shows command learn + execute; a **real availability answer** comes back. **NO `runtime_unavailable`** |
| 2.3 | Ask: *"List my bookable contexts"* | Real list (golf/dining/lessons contexts from the seeded org) |
| FAIL⇒ | `runtime_unavailable` on reads = signed-envelope or approval regression — check Pipe-B for `host_context_header_rejected` before anything else |

## Pass 3 ★ — Reservation flow with approval (5 min)

| # | Step | Expected |
|---|------|----------|
| 3.1 | Ask: *"Book a tee time for 2 tomorrow morning"* | Availability read executes; a **write** (create hold/booking) stops at an approval affordance — it must NOT execute silently |
| 3.2 | Approve via the affordance | Command commits; receipt visible; confirmation message |
| 3.3 | Check the reservations page | The booking actually exists host-side |
| FAIL⇒ | Writes executing without approval is a **stop-the-demo** safety issue; writes denying after approval = check approvedCommandIds in the envelope |

## Pass 4 ★ — Venue intake on the Canvas (6 min)

| # | Step | Expected |
|---|------|----------|
| 4.1 | New chat → *"I need to set up a venue - it's a golf course with a tee sheet"* | Intake canvas appears with ~9 QuestionCards; **watch it build progressively while streaming** (new tonight) |
| 4.2 | **Click** an answer on a QuestionCard + Submit | Checkmark; open-question count drops; no error |
| 4.3 | **Type** one answer conversationally: *"We're open Tuesday through Sunday, 7 to 7"* | A `submitIntakeAnswer` tool call is visible and the relevant card updates. ⚠ K1: if it says "recorded" with NO tool activity, the answer is NOT saved — this is the known drift; click-path is the demo-safe fallback |
| 4.4 | Type another answer | **Artifact must NOT be recreated** (canvas doesn't blank/reset — the recreation guard refuses). Same canvas, same progress |
| 4.5 | Try *"start over with a fresh intake"* | New canvas IS allowed (explicit replaceActive escape) |
| FAIL⇒ | 4.4 canvas reset = recreation-guard regression, demo-blocking for Scenario A |

## Pass 5 — Canvas window behavior (3 min, standalone app)

*Drag/resize is standalone-only by design; embedded canvas is intentionally static.*

| # | Step | Expected |
|---|------|----------|
| 5.1 | In the standalone app, open an artifact on the Canvas | Toolbar reads **"Canvas"** (not "Artifact Canvas"/"Artifact workspace") |
| 5.2 | Drag from the toolbar; resize from an edge/corner | Window moves/resizes; min-size clamps; **"Reset layout"** button restores dock |
| 5.3 | Reload | Position/size persisted |
| 5.4 | In the **embedded** booking app, open the canvas | Full-viewport modal above the left nav; close/dock buttons clickable with nav expanded (K3 if not) |

## Pass 6 — Naming & polish sweep (3 min, eyes only)

| # | Check | Expected |
|---|------|----------|
| 6.1 | Every surface label | Only **Chat / Canvas / Document(s)** — no "Workspace Document", "Artifact workspace", "Artifact Canvas" anywhere |
| 6.2 | Empty-state workflow cards | Badges read quietly as "Draft" / "Needs page" (sentence case) — not shouty `NEEDS PAGE` debug-style caps |
| 6.3 | Chat header row | Real gear **icon** (not ⚙ text glyph); buttons share one pill shape/size; nothing misaligned |
| 6.4 | General | No gradients, no emoji in chrome |

## Pass 7 — Failure honesty (3 min)

| # | Step | Expected |
|---|------|----------|
| 7.1 | Ask for something impossible: *"Cancel the reservation for Elvis"* | Graceful, honest failure message — no stack traces, no infinite spinner |
| 7.2 | Stop a response mid-stream | Stream stops; Continue affordance appears; next prompt works |
| 7.3 | (Dev build only) press Cmd+Shift+J with an artifact open | json-render devtools panel (Spec/State/Actions/Stream) docks right — **must NOT appear in production** |

## Pass 8 — Telemetry spot-check (2 min, optional)

Export worker logs after Pass 4 and confirm these exist: `artifact.question.submit_attempt` + `artifact.question.persist_outcome` (per click), `api.generate.spec_stream_summary` (per generation), and **zero** `api.generate.host_context_header_rejected`.

---

## Verdict rubric

- **Demo-ready:** Passes 1–4 fully green (K1 typed-answer caveat acceptable if the click path is your demo script)
- **Demo with guardrails:** K1 bites in 4.3 → script the intake demo around clicking, not typing
- **Not ready:** any FAIL⇒ row in Passes 1–4

## Script recommendation for the live demo

Lead with Pass 2→3 (live reads + approved write — the strongest "it's real" beat), then Pass 4 driven by **clicking** QuestionCards (immune to K1), typing exactly one conversational answer early (turn 1–2, where drift hasn't set in) to show the capability.

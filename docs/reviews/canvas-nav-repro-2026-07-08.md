# Canvas-vs-nav overlap repro — 2026-07-08

Phase 3.3 repro of Dan's report (screenshots on file, dated 2026-07-08): with the
booking app's left nav open/expanded, the Sonik canvas modal was covered/unreachable.
Repro-first per instructions — no code was written until repro was attempted and
its result determined the next step.

**Verdict: NOT-REPRODUCED** on the current live `pipe_b` deployment
(`https://sonik-booking-app-pipe-b.liam-trampota.workers.dev`), at both requested
viewports (1600x1000, 1200x800). No code changes were made in this repo or in
`sonik-booking-service`.

## Why this is very likely a timing gap, not a live bug

`sonik-booking-service` already contains a merged root-cause fix for exactly this
symptom:

- Commit `f20b7c7` — *"fix(booking): UX-D23 agent-embed z-index root cause + GSAP
  embed motion + collapsible nav (#101)"*, merged 2026-07-07 23:43:25 -0400
  (2026-07-08T03:43:25Z).
- `apps/booking/src/lib/booking-platform/BookingAgentUiEmbed.svelte:331-344` carries
  an explicit "Root-cause stacking fix (UX-D23)" comment: the canvas/sidecar overlay
  and the app drawer sidebar (`aside.drawer-side`, `z-[60]` in
  `BookingPlatformApp.svelte:4747`) are both root-stacking-context siblings, so a
  plain z-index compare decides the winner. The overlay's z-index was raised from
  **45 → 80** so it always wins over the nav's `z-[60]`.
- `worker_deployment_status` (read-only) shows the `pipe_b` **app** worker's latest
  deployment at **2026-07-08T05:48:47Z** — after the fix commit's merge time. The
  live site is very likely running build(s) that include this fix already.

Dan's screenshots are dated 2026-07-08 with no timestamp finer than the day, so it
is entirely plausible he hit this before the 05:48Z deploy (or before f20b7c7
merged) and the bug is already resolved by the time of this repro. This is a
timing/report-vs-fix race, not evidence the fix is broken.

## Repro method

Playwright script (chromium, headless), following the login/embed-open pattern
already used by `scripts/agent-ui-booking-reservation-pipeb-smoke.mjs`:

1. `POST /api/auth/sign-in/email` with `test69@gmail.com` / `test6969` against
   `https://sonik-booking-app-pipe-b.liam-trampota.workers.dev`.
2. Navigate to `/dashboard`, wait for `networkidle`.
3. Open the Sonik canvas via `window.__sonikAgentHost.openCanvas()` (with a DOM
   fallback click on `#booking-agent-ui-open-canvas`), wait for the agent-ui iframe
   to mount.
4. Locate the host nav's collapse/expand toggle (`[data-nav-collapse]`,
   `AppSidebar.svelte`) and click it, then separately hover the sidebar
   (`.bk-sidebar`) to check for any hover-reveal affordance.
5. Capture `getBoundingClientRect()` + `getComputedStyle()` for the canvas
   (`#booking-agent-ui-canvas`), the drawer (`.drawer-side`), and the sidebar nav;
   `document.elementFromPoint()` hit-tests at the center of `#booking-agent-ui-close-canvas`
   and `#booking-agent-ui-dock-chat`.
6. Screenshot at each stage.

Run twice, once per viewport (1600x1000, 1200x800).

**Note on the nav's own interaction model**: `AppSidebar.svelte` has no hover-expand
affordance — it is a persistent inline sidebar (`.drawer min-[901px]:drawer-open`,
so at both tested viewports — both ≥901px — the nav renders inline/static, not as
a toggleable overlay) with a single explicit click toggle
(`.collapse-toggle` / `[data-nav-collapse]`) that narrows/widens the rail via GSAP.
There is no `:hover` CSS or JS hover-listener on the rail. This is a description
mismatch worth flagging back to Dan: whatever he saw expand on hover was not this
component in its current form (or he was on a route/viewport that renders the
mobile drawer-overlay variant, `<901px`, which is outside this repro's scope).

## Evidence

Raw JSON + screenshots (local artifacts, `.omx/` is gitignored, not committed —
paths below are on this worktree):

- `.omx/logs/canvas-nav-repro-2026-07-08T06-22-13-848Z.json` — full computed-style/
  hit-test evidence for both viewports.
- `.omx/logs/canvas-nav-repro-1600x1000-canvas-open-*.png`
- `.omx/logs/canvas-nav-repro-1600x1000-nav-toggled-*.png`
- `.omx/logs/canvas-nav-repro-1600x1000-nav-hover-*.png`
- `.omx/logs/canvas-nav-repro-1200x800-canvas-open-*.png`
- `.omx/logs/canvas-nav-repro-1200x800-nav-toggled-*.png`
- `.omx/logs/canvas-nav-repro-1200x800-nav-hover-*.png`

### Computed evidence (both viewports, identical pattern)

| Element | Selector | `position` | `z-index` | Notes |
|---|---|---|---|---|
| Canvas modal | `#booking-agent-ui-canvas` | `fixed` | `80` | `inset: 1rem` — rect covers the full viewport minus a 16px margin on every side, i.e. it geometrically overlaps the nav's screen region entirely. |
| App drawer | `.drawer-side` | `sticky` (not `fixed` as the source comment describes — `min-[901px]:drawer-open` changes DaisyUI's positioning scheme at these widths) | `60` | Rect `x:0, width:250`. |
| Sidebar nav | `.bk-sidebar` | `static` | `auto` | Inherits the drawer's stacking; no independent z-index. |

At 1600x1000: canvas rect `{x:16, y:16, w:1568, h:968}`, z-index `80`; drawer rect
`{x:0, y:0, w:250, h:1000}`, z-index `60`.
At 1200x800: canvas rect `{x:16, y:16, w:1168, h:768}`, z-index `80`; drawer rect
`{x:0, y:0, w:250, h:800}`, z-index `60`.

**Hit tests** (`elementFromPoint` at the center of each canvas control), both
viewports:

- `#booking-agent-ui-close-canvas` → top element is the button itself
  (`isButtonOrDescendant: true`).
- `#booking-agent-ui-dock-chat` → top element is the button itself
  (`isButtonOrDescendant: true`).

No nav element was ever the top hit at either control's coordinates. Clicking the
nav's collapse toggle while the canvas was open did not visibly move or resize the
canvas panel, and did not change what `elementFromPoint` returned for the canvas
controls (screenshots `*-nav-toggled-*.png` are visually identical to
`*-canvas-open-*.png` in the canvas region). No console errors were logged during
either run.

**Visual note**: the multi-item vertical rail visible at the far left inside the
black canvas panel in the screenshots (labelled entries like "Smok Priv ART/CHAT/…")
is the Sonik agent workspace's *own* internal chat-session list, rendered inside the
agent-ui iframe — not the booking host's `AppSidebar` nav. The host nav is fully
hidden behind the canvas modal at both viewports (consistent with the z-80 vs z-60
stacking order above); it does not bleed through or intercept clicks anywhere.

## Fix / verification

Not applicable — nothing to fix. No changes were made to
`packages/agent-embed/src/index.ts` (confirmed by reading it: it never sets or owns
any z-index/CSS for the host's canvas/sidecar/chat slot elements — all stacking is
entirely host-owned CSS in `BookingAgentUiEmbed.svelte`, so this class of bug can
only ever be fixed host-side, never from the agent-ui/agent-embed side) and nothing
in `sonik-booking-service` was touched (read-only per instructions).

## Host-side recommendation (for reference only — not applied)

None needed today: the one-line host fix Dan would have wanted
(`.booking-agent-sidecar, .booking-agent-canvas { z-index: 80; }` beating
`.drawer-side { z-index: 60; }`) is already the state of `main` via commit
`f20b7c7`, and the `pipe_b` app deploy that should carry it postdates that merge.
If Dan (or anyone) reproduces this again on the live site going forward:

1. First confirm which deployed version is actually live
   (`wrangler deployments list` for `apps/booking`, or re-run
   `worker_deployment_status`) and diff it against `main` at
   `BookingAgentUiEmbed.svelte` — a stale `pipe_b` deploy (see the 2026-07-06
   stale-branch deploy incident) is the most likely cause of any recurrence, not a
   regression in the fix itself.
2. If a genuinely new stacking regression appears (e.g. a future ancestor of
   `.booking-agent-canvas` gains a `transform`/`filter`/`perspective`/`opacity<1`,
   which would trap the fixed-position canvas in that ancestor's stacking context
   and silently defeat `z-index: 80` regardless of its value), the fix is still
   host-side only — `agent-embed` does not and cannot own this styling.

## Scope discipline

Read-only investigation in `sonik-booking-service` (`BookingAgentUiEmbed.svelte`,
`BookingPlatformApp.svelte`, `AppSidebar.svelte`, git log/blame only — no edits, no
deploy). No changes to `packages/agent-embed` in this repo. No PR opened.

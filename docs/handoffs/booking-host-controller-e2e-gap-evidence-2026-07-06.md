# Booking Host Controller Gap — Evidence Handoff for the booking-service lane

Date: 2026-07-06 (~14:45 UTC)
From: Fable/Claude Code agent-ui lane
To: booking-service lane (owner of `BookingAgentUiEmbed.svelte` / `packages/sonik-sdk/src/agent-ui.ts`)
Related: `docs/handoffs/booking-service-agent-ui-host-context-fix-handoff.md` (signed host-context fix — this is the *sibling* symptom on the same wiring)

## One-line summary

`window.__sonikAgentHost` never initializes on the deployed booking app dashboard, so the deterministic host controller is unavailable — the booking-context E2E smoke refuses to run, leaving the trusted approve→commit path **unverified (INCONCLUSIVE)** on the current deploys. Signed host context itself is FINE (sessions authenticate, `hostAuthenticated: true`); it is only the host *controller* object that is missing.

## Why this is not today's deploy

Timeline (all 2026-07-06 UTC):

| Time | Event | Evidence |
|---|---|---|
| 06:58 / 07:52 | booking-app pipe_b deployed by overnight run | `wrangler deployments list --env pipe_b` |
| 08:22 | reservation smoke PASS — but via **DOM fallback**, not host controller (agent-ui commit `c6a2f55` loosened that script to accept `fallback-dom-controls`) | `.omx/logs/booking-reservation-pipeb-smoke-2026-07-06T08-22-16-531Z.json` |
| 13:43 | **Pre-deploy** headless walkthrough: labeled open-chat control unresponsive; only coordinate click opened sidecar — controller already missing on the 07:52 build | scratchpad `demo-walkthrough-evidence.json` (agent-ui session) |
| 14:24 | booking-app redeployed (`d4da1a44`, adds only commit `e3bd612` — one deleted subtitle line, cannot affect controller mounting) | deploy log |
| 14:25 / 14:37 | `scripts/agent-ui-booking-context-pipeb-smoke.mjs` FAIL twice: "Booking embed did not open through window.__sonikAgentHost" | `.omx/logs/booking-context-pipeb-smoke-2026-07-06T14-37-17-010Z.json` |

So the regression window is **at or before the 07:52 build**, not the 14:24 one.

## What works / what doesn't (current deploys)

- WORKS: human click on chat bubble opens sidecar; signed host context arrives (`authenticated: true`, org id, `booking:write`, 72 approvedCommandIds); sessions + telemetry return 200; Pipe-B tail is alive (82 events captured 14:37–14:41).
- BROKEN: `window.__sonikAgentHost` absent on `/dashboard` → context smoke (hard-requires it per release gate in `tests/unit/agent-embed.test.mjs`) cannot run → **zero fresh `booking.context.create` commit evidence post-deploy**.

## Ask

1. Land/deploy the host-controller mounting fix on the booking app pipe_b (your handoff references commits `4fb3a0b`, `f68e20b`, `4324559` as in-flux; branch HEAD is now `e3bd612`).
2. Ping the agent-ui lane (or Dan) after deploy; we rerun `TEST_EMAIL=… TEST_PASSWORD=… node scripts/agent-ui-booking-context-pipeb-smoke.mjs` with a Pipe-B tail — one green run flips the demo state-of-the-union to PASS.

## Repro (30 seconds)

```bash
# from sonik-agent-ui
TEST_EMAIL=test69@gmail.com TEST_PASSWORD=test6969 \
  node scripts/agent-ui-booking-context-pipeb-smoke.mjs
# fails at openAttempts: window.__sonikAgentHost undefined, target falls to fallback-dom-controls
```

Or in a browser console on the logged-in dashboard: `window.__sonikAgentHost` → `undefined`.

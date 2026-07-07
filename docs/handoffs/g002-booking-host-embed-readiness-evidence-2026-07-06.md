# G002 Evidence — Booking Host Embed Readiness

Date: 2026-07-06

## Root cause

The booking host rendered the Agent UI shell, but the primary FAB only controlled DaisyUI speed-dial visibility. The SDK `openChat` listener was attached to a hidden secondary button only. In headless/user smoke, the iframe remained parked with empty `src` and `0x0` rect unless a DOM event was manually dispatched to the hidden control.

## Fix

Repo: `/Users/danielletterio/Documents/GitHub/sonik-booking-service`
Branch: `codex/booking-agent-ui-runtime-bridge`
Commit: `4fb3a0b fix(agent-ui): make booking launcher open embed`

Files changed:

- `packages/sonik-sdk/src/agent-ui.ts`
  - selector refs now attach click handlers to all matching elements, allowing comma selector lists.
- `apps/booking/src/lib/booking-platform/BookingAgentUiEmbed.svelte`
  - primary launcher gets `id="booking-agent-ui-launcher"` and participates in `openChat: "#booking-agent-ui-launcher, #booking-agent-ui-open-chat"`.
- `packages/sonik-sdk/src/agent-ui.test.ts`
  - adds regression that both primary launcher and secondary chat control open chat and set iframe src.

## Verification

Focused checks:

```bash
cd /Users/danielletterio/Documents/GitHub/sonik-booking-service/packages/sonik-sdk
bun run test
bun run typecheck
bun run build
bun run check-agent-ui-host-context
cd ../../apps/booking
bun run check:agent-ui-host-context-runtime
bun run build
bunx biome check packages/sonik-sdk/src/agent-ui.ts packages/sonik-sdk/src/agent-ui.test.ts apps/booking/src/lib/booking-platform/BookingAgentUiEmbed.svelte
```

Deploys:

```bash
cd /Users/danielletterio/Documents/GitHub/sonik-booking-service/apps/booking
bunx wrangler deploy --env pipe_b
```

Pipe-B deploy:

- Worker: `sonik-booking-app-pipe-b`
- URL: `https://sonik-booking-app-pipe-b.liam-trampota.workers.dev`
- Version ID: `e1d72270-2542-409d-946d-17e94afcd117`
- Tail events configured to `sonik-dev-observability-pipe-b`

Browser smoke:

```bash
node .omx/tmp/booking-embed-open-chat-smoke.mjs
```

Artifacts:

- JSON: `.omx/logs/booking-open-chat-1783324351213.json`
- Screenshot: `.omx/logs/booking-open-chat-1783324351213.png`

Result summary:

```json
{
  "pass": true,
  "finalUrl": "https://sonik-booking-app-pipe-b.liam-trampota.workers.dev/",
  "iframeSrc": "https://sonik-agent-ui.liam-trampota.workers.dev/?agentUiHostOrigin=https%3A%2F%2Fsonik-booking-app-pipe-b.liam-trampota.workers.dev&theme=gunmetal-dark&embedMode=chat&rail=hidden",
  "iframeRect": { "x": 921, "y": 66.59375, "w": 519, "h": 1033.40625 },
  "sidecarRect": { "x": 920, "y": 0, "w": 520, "h": 1100 },
  "bodyDataset": { "bookingAgentUiOpen": "chat" },
  "agentTextHasMissingHost": false,
  "consoleErrorCount": 0,
  "pageErrorCount": 0
}
```

## Verdict

PASS for G002: authenticated pipe-b booking host can open the embedded Agent UI from the primary launcher; iframe has non-empty Agent UI src and non-zero rect; no persistent missing-host-context text and no console/page errors in this smoke.

Note: full Pipe-B backend command telemetry remains part of later G006. This story only covers host embed readiness.

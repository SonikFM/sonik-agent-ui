# Sonik Agent UI host embedding parity handoff

**Date:** 2026-07-21  
**Agent UI donor:** `SonikFM/sonik-agent-ui@0db59bab44fe79785f18e2616aedf5012d82e8ec`  
**Dev Workbench:** `https://dev-workbench-sooty.vercel.app/`

## Outcome

Booking and Amplify now have a reproducible path to the same embedded Sonik Dev Workbench contract:

- Booking's complete embed, third **Dev** launcher, signed host-context relay, visual-context bridge, host-action bridge, and navigation reconnect are already present on current Booking `main`.
- Amplify PR [#565](https://github.com/SonikFM/amplify/pull/565) adds the third **Dev** launcher, right-rail Workbench, exact-frame context relay, opaque signed authority donation, and navigation persistence on current Amplify `main`.
- No host or Agent UI deployment was performed in this recovery pass.
- Amplify visual-element selection and executable host actions remain explicit follow-ups; unsupported actions fail closed.

This handoff intentionally excludes MCP installation, durable memory, deployment automation, AgentOS, and unrelated platform work.

## Branches and immutable evidence

| Repository | Branch | Base | Commit / result |
| --- | --- | --- | --- |
| Booking | `fix/booking-agent-ui-embed-parity-20260721` | `main@9083d4f53de946b3da0a479d68fbbc3a0cf01444` | No new commit. The branch intentionally equals current `main`; re-cherry-picking the old recovery commit would duplicate already-merged code. Branch pushed for auditability. |
| Amplify | `feat/amplify-dev-workbench-parity-20260721` | `main@3afe5f17a616442985c73337aed2ea950499abe4` | `d80a8383` — `feat(agent-ui): add Amplify Dev Workbench parity`; PR [#565](https://github.com/SonikFM/amplify/pull/565). |
| Agent UI | `docs/host-embedding-parity-handoff-20260721` | `main@0db59bab44fe79785f18e2616aedf5012d82e8ec` | This non-runtime handoff only. |

### Why Booking did not receive another cherry-pick

The former recovery commit `6e3e0ef0` has the same stable patch ID as merged commit `04991d46` from Booking PR #225. Current Booking `main` also contains:

- `723f4bf7` / PR #219 — Dev Workbench embed and launcher
- `04991d46` / PR #225 — docked terminal integration
- `1efd8180` / PR #230 — visual-context bridge
- `41c811a9` / PR #237 — navigation reconnect

A new cherry-pick would therefore manufacture duplicate history rather than restore lost source. The missing production control was deployment drift, not a missing source patch.

## Contract and capability matrix

| Capability | Contract / behavior ID | Booking `main` | Amplify PR #565 |
| --- | --- | --- | --- |
| Third Dev launcher | `sonik-dev-workbench-launcher-v1` | Complete | Complete |
| Right-rail terminal | `surface=terminal` + exact `agentUiHostOrigin` | Complete | Complete |
| Page-context request/response | `sonik-embed-page-context-v1` | Complete | Complete |
| Opaque signed authority | `sonik-embed-opaque-authority-v1` | Complete | Complete |
| Open-state continuity | `sonik-embed-mode-continuity-v1` | Complete | Complete |
| Navigation reconnect | `sonik-dev-workbench-navigation-restore-v1` | Complete | Complete |
| Host relay source/origin gate | `sonik-dev-workbench-host-relay-v1` | Complete | Complete |
| Executable host actions | `sonik-embed-host-actions-v1` | Complete | Fail-closed until an Amplify handler is registered |
| Visual element selection | `sonik-embed-visual-context-v1` | Complete | Deferred; the copied static embed does not contain the package-only picker |

### Security invariants

- The host remains the identity and organization authority.
- Browser-provided organization hints are not authorization.
- Signed context comes from the authenticated same-origin host route.
- Better Auth cookies and raw sessions never cross the iframe boundary.
- Authority is forwarded as a bounded opaque envelope and is not merged into display page context.
- `postMessage` requests must match both the configured origin and the exact iframe `contentWindow`.
- Unknown or unsupported host actions fail closed.
- Navigation persistence stores only the open/closed UI intent, never authority.

## Source-copy record

Amplify's manifest-tracked copied island is:

`src/lib/agent-ui/vendor/sonik-agent-ui-agent-embed/`

`UPSTREAM.json` pins Agent UI revision `0db59bab44fe79785f18e2616aedf5012d82e8ec`, records production consumers and runtime risks, and verifies the copied browser artifact and reference host by SHA-256. Amplify-specific auth, organization, theme, CSP, layout, and message-relay code stays outside the copied island.

Drift check:

```bash
node .codex/skills/analyze-copy-retrofit/scripts/verify-source-drift.mjs \
  src/lib/agent-ui/vendor/sonik-agent-ui-agent-embed/UPSTREAM.json
```

## Deployment inputs

### Booking

```bash
PUBLIC_SONIK_AGENT_UI_URL=https://sonik-agent-ui.liam-trampota.workers.dev/
PUBLIC_SONIK_DEV_WORKBENCH_URL=https://dev-workbench-sooty.vercel.app/
```

Promote the current Booking `main` app and its authenticated host-context route together. No new Booking source branch needs to be merged.

### Amplify

```bash
VITE_SONIK_AGENT_UI_URL=https://sonik-agent-ui.liam-trampota.workers.dev/
VITE_SONIK_AGENT_UI_ALLOWED_ORIGINS=https://*.workers.dev,https://*.sonik.fm
VITE_SONIK_DEV_WORKBENCH_URL=https://dev-workbench-sooty.vercel.app/
```

The Amplify CSP must allow `https://dev-workbench-sooty.vercel.app` in `frame-src` and `child-src`. The Workbench deployment must allow the target Amplify origin through `PUBLIC_DEV_WORKBENCH_ALLOWED_HOST_ORIGINS`.

## Promotion order and manual acceptance

1. Confirm the Agent UI/Workbench donor revision is deployed.
2. Confirm the Workbench allowlist includes the target Booking or Amplify origin.
3. For Amplify, merge PR #565. Booking requires no source merge.
4. Deploy the host backend route that signs host context, then deploy the matching host app shell.
5. Sign in to the host and verify:
   - the speed dial contains **Chat**, **Canvas**, and **Dev**;
   - **Dev** replaces the right rail with the Workbench terminal;
   - the Workbench receives the current route, title, theme, organization, and authenticated host envelope;
   - client navigation restores the open Workbench instead of dropping the UI;
   - foreign-origin and foreign-window messages are ignored;
   - closing **Dev** returns to the host's normal Agent UI modes.
6. Booking only: verify visual selection and registered host actions. Amplify should currently report host actions unavailable and does not expose the visual picker.

## Verification evidence

### Booking current main

- 13/13 Agent UI host-action tests passed.
- Authenticated host-context runtime check passed.
- Dev launcher/navigation Playwright suite passed 4/4, including navigation reconnect.
- Canonical `bun run build` passed with existing non-blocking Svelte warnings.
- Branch is clean and exactly matches `origin/main@9083d4f53de946b3da0a479d68fbbc3a0cf01444`.

### Amplify PR #565

- Focused embed/auth suite: 4 files, 34 tests passed.
- Focused production TypeScript check passed.
- `guard:vendored-integrity` passed for all four copied islands.
- Agent UI source-drift verification passed.
- `guard:theme-consistency` passed.
- Pre-commit and pre-push frontend compliance gates passed.
- `git diff --check` passed.
- Independent read-only security review accepted the core embedding after the CSP correction.

### Known Amplify baseline failures

Repo-wide `pnpm run typecheck` remains red on 673 diagnostics outside this change. The production build reaches Vite and then fails because the existing vendored `@sonikfm/amplify-sdk` browser bundle imports Node `crypto.createHash`. The same build failure reproduces on untouched `origin/main@3afe5f17`; PR #565 does not modify that SDK or its import path.

## Deliberately deferred

- Amplify visual-context picker and screenshot/element-selection relay
- Amplify executable host-action adapter
- MCP installation and profile management
- AgentOS runtime adoption
- Durable memory or credential restoration after sandbox teardown
- Controlled Playwright capture-launch repair
- Automated commit, push, or deployment authority

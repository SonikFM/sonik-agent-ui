# Next chat kickoff: Sonik host embedding recovery

Continue the Sonik Agent UI host-embedding recovery from this exact state.

## Skills

Use:

- `$oh-my-codex:ultrawork`
- `$analyze-copy-retrofit`
- `$amplify-auth`
- `$amplify-org-context`
- `$amplify-theming`

If installed and relevant, also load:

- `$sonik-agent-onboarding`
- `$sonik-agent-ui`
- `$sonik-accessibility`
- `$sonik-component-design`

## Operating rules

- Read `AGENTS.md` and the primary handoff first.
- Re-fetch every repository and treat current remote state and CI as authoritative.
- Do not duplicate already-merged Booking commits.
- Fix only introduced failures or review findings; distinguish existing `main` failures.
- Do not deploy or merge without an explicit request.
- Preserve exact-origin and exact-window message validation and fail-closed authorization.
- Keep changes minimal and test the affected contract.

## Primary handoff

`/Users/danielletterio/emdash/worktrees/sonik-agent-ui/emdash/yellow-zebras-smell-txxjz/docs/handoffs/host-embedding-parity-handoff-2026-07-21.md`

## Agent UI

**Repository:**

`/Users/danielletterio/emdash/worktrees/sonik-agent-ui/emdash/yellow-zebras-smell-txxjz`

**Branch:** `docs/host-embedding-parity-handoff-20260721`
**Prior handoff commit:** `70e58923c3a9b64bf30c933841dcb98fdf4766a6`
**PR:** <https://github.com/SonikFM/sonik-agent-ui/pull/62>

This PR is documentation-only and contains the authoritative promotion, capability, security, and verification handoff.

## Amplify

**Worktree:**

`/private/tmp/amplify-agent-ui-embed-parity-20260721`

**Branch:** `feat/amplify-dev-workbench-parity-20260721`
**Base:** `main@3afe5f17a616442985c73337aed2ea950499abe4`
**Commit:** `d80a838340b044a1df68bad122b6d418468d6cac`
**PR:** <https://github.com/SonikFM/amplify/pull/565>

### Implemented

- Third Dev speed-dial control
- Right-rail Vercel Dev Workbench terminal
- Exact `agentUiHostOrigin` forwarding
- Auth-gated same-origin host-context retrieval
- Bounded opaque signed-authority donation
- Exact iframe `contentWindow` and origin validation
- Dev-open `sessionStorage` persistence across host navigation and remount
- Escape/close behavior and host-layout padding
- Fail-closed unsupported host actions
- Workbench environment and CSP documentation
- Manifest-tracked refresh of the Agent UI browser embed

### Environment

```bash
VITE_SONIK_AGENT_UI_URL=https://sonik-agent-ui.liam-trampota.workers.dev/
VITE_SONIK_AGENT_UI_ALLOWED_ORIGINS=https://*.workers.dev,https://*.sonik.fm
VITE_SONIK_DEV_WORKBENCH_URL=https://dev-workbench-sooty.vercel.app/
```

The Amplify CSP must permit `https://dev-workbench-sooty.vercel.app` in `frame-src` and `child-src`.

### Verified locally

- Four focused files and 34 tests passed.
- Focused production TypeScript check passed.
- `guard:vendored-integrity` passed.
- Analyze-copy-retrofit source drift passed.
- `guard:theme-consistency` passed.
- Pre-commit and pre-push frontend compliance passed.
- `git diff --check` passed.
- Independent security review accepted the core embedding.

Focused tests:

```bash
pnpm exec vitest run \
  src/lib/agent-ui/AgentUiEmbedPreview.test.tsx \
  src/lib/agent-ui/embed.test.ts \
  src/lib/agent-ui/host-context-signer.test.ts \
  src/routes/api/agent-ui/host-context.test.ts
```

Drift check:

```bash
node .codex/skills/analyze-copy-retrofit/scripts/verify-source-drift.mjs \
  src/lib/agent-ui/vendor/sonik-agent-ui-agent-embed/UPSTREAM.json
```

### Known baseline failures

- Repo-wide typecheck has 673 existing diagnostics outside this change.
- Production build fails because the existing vendored `@sonikfm/amplify-sdk` imports Node `crypto.createHash` into the browser bundle.
- The same build failure reproduces on untouched `origin/main`.
- Do not attribute that baseline failure to PR #565 without new evidence.

### Explicit follow-ups

- Visual element/context picker is not yet present.
- Executable Amplify-specific host actions are not registered.
- Unsupported actions intentionally return unavailable.
- Do not claim complete Booking feature parity until those adapters exist.

## Booking

**Worktree:**

`/private/tmp/booking-agent-ui-embed-parity-20260721`

**Branch:** `fix/booking-agent-ui-embed-parity-20260721`
**Current main:** `9083d4f53de946b3da0a479d68fbbc3a0cf01444`

The branch intentionally equals current Booking `main` and has no new commit.

Do not cherry-pick `6e3e0ef0`: its stable patch ID matches already-merged `04991d46` from PR #225.

Current Booking `main` already contains:

- `723f4bf7` / PR #219 — Dev Workbench launcher and embed
- `04991d46` / PR #225 — docked terminal
- `1efd8180` / PR #230 — visual-context integration
- `41c811a9` / PR #237 — navigation reconnect

Booking verification already passed:

- 13/13 host-action tests
- Authenticated host-context runtime check
- Launcher/navigation Playwright suite 4/4
- Canonical `bun run build`
- Clean worktree and pushed audit branch

The previously missing Booking Dev control was caused by deployment drift, not overwritten source.

## First actions

1. Read the primary handoff document.
2. Fetch all three repositories.
3. Inspect PR #565 and PR #62 checks and CodeRabbit comments.
4. Repair only actionable findings introduced by these PRs.
5. Re-run the focused tests and guards.
6. Report exact CI state, remaining blockers, and whether each PR is merge-ready.
7. Do not deploy until explicitly instructed.

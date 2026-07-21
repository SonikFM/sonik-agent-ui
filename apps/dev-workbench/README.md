# Sonik Dev Workbench

The Dev Workbench is a separate SvelteKit app for running a repository-aware Codex session inside a Vercel Sandbox. The browser is only the control surface: source code, `tmux`, Codex CLI, and the hot development server run inside the isolated sandbox.

## Runtime shape

- **Preview:** the sandbox exposes the configured Vite/SvelteKit port through `sandbox.domain(port)`.
- **Terminal:** `Sandbox.openInteractive()` returns a short-lived WebSocket URL and token. The browser connects directly with xterm.js using Vercel's PTY protocol; Sonik does not proxy terminal bytes through a function or Worker.
- **Repository:** the server clones the configured revision. Browser requests cannot choose an arbitrary Git URL.
- **Context:** the page exposes a sanitized, display-only `window.__sonikAgentUI` snapshot and semantic actions. It never grants browser authority.
- **Context mirror:** **Sync page context** writes the sanitized snapshot to `.sonik/page-context.json`. Visual capture writes the validated snapshot to `.sonik/visual-context.json` and promotes the latest PNG to `.sonik/screenshots/latest.png`.
- **Realtime seam:** session and status descriptors are serializable for the forthcoming realtime-egress beacon. Terminal data remains on the provider-native PTY transport.
- **Retention:** workspaces use a persistent named sandbox with one provider-managed snapshot and a 30-day partitioned session cookie so a host-page navigation can reconnect to the same repository and `tmux` session. **Stop** permanently deletes the named sandbox and its files; persistent does not mean durable after deletion.

## Local setup

1. Copy `.env.example` to `.env.local`, explicitly enable the workbench, and set strong Basic Auth credentials.
2. Run `vercel link && vercel env pull` to obtain a development OIDC token.
3. Ensure the sandbox image can authenticate Codex CLI before relying on agent execution. MCP wiring is intentionally deferred from this first slice.
4. Start with `pnpm dev:workbench`.

The app enforces HTTPS Basic Auth whenever `DEV_WORKBENCH_ENABLED=true`. Protect deployed instances with Vercel Authentication as a second upstream gate. `DEV_WORKBENCH_ENABLED` is false by default and is not a substitute for authentication.

## Visual-context adoption (any host)

The integration is host-neutral; an adopting app does not import Amplify code.

1. Allow the host origin with `PUBLIC_DEV_WORKBENCH_ALLOWED_HOST_ORIGINS`, then embed the Workbench with its existing `agentUiHostOrigin` query parameter.
2. Keep page context sanitized and give pickable elements stable `data-sonik-target` identities. The public contract accepts semantic identities, bounded labels, a route without query/hash data, and viewport bounds—not arbitrary selectors or DOM paths.
3. Use **Preview** capture for a fresh Playwright navigation (`controlled-preview` fidelity). Use **Host** plus the optional extension when exact active-tab state is required (`exact-active-tab` fidelity).
4. Treat source changes, navigation, and route revision changes as invalidation boundaries. Stale results are rejected and persisted visual artifacts are cleared rather than reused.

Requests and results are defined in `packages/tool-contracts/src/visual-context.ts`. The authenticated Workbench endpoint remains the persistence authority; hosts and the extension only provide transient selection/capture results.

## Verification

```sh
pnpm check:workbench
pnpm build:workbench
```

Live sandbox verification additionally requires valid Vercel credentials and a deployment/runtime with Codex authentication.

# Sonik Dev Workbench

The Dev Workbench is a separate SvelteKit app for running a repository-aware Codex session inside a Vercel Sandbox. The browser is only the control surface: source code, `tmux`, Codex CLI, and the hot development server run inside the isolated sandbox.

## Runtime shape

- **Preview:** the sandbox exposes the configured Vite/SvelteKit port through `sandbox.domain(port)`.
- **Terminal:** `Sandbox.openInteractive()` returns a short-lived WebSocket URL and token. The browser connects directly with xterm.js using Vercel's PTY protocol; Sonik does not proxy terminal bytes through a function or Worker.
- **Repository:** the server clones the configured revision. Browser requests cannot choose an arbitrary Git URL.
- **Context:** the page exposes a sanitized, display-only `window.__sonikAgentUI` snapshot and semantic actions. It never grants browser authority.
- **Context mirror:** **Sync page context** writes the sanitized snapshot to `.sonik/page-context.json` so Codex can inspect the visible route and state. Screenshot capture remains deferred.
- **Realtime seam:** session and status descriptors are serializable for the forthcoming realtime-egress beacon. Terminal data remains on the provider-native PTY transport.
- **Retention:** this first slice uses non-persistent sandboxes. Stop permanently deletes the named sandbox; snapshot retention waits for a durable tenant-scoped registry and cleanup job.

## Local setup

1. Copy `.env.example` to `.env.local`, explicitly enable the workbench, and set strong Basic Auth credentials.
2. Run `vercel link && vercel env pull` to obtain a development OIDC token.
3. Ensure the sandbox image can authenticate Codex CLI before relying on agent execution. MCP wiring is intentionally deferred from this first slice.
4. Start with `pnpm dev:workbench`.

The app enforces HTTPS Basic Auth whenever `DEV_WORKBENCH_ENABLED=true`. Protect deployed instances with Vercel Authentication as a second upstream gate. `DEV_WORKBENCH_ENABLED` is false by default and is not a substitute for authentication.

## Verification

```sh
pnpm check:workbench
pnpm build:workbench
```

Live sandbox verification additionally requires valid Vercel credentials and a deployment/runtime with Codex authentication.

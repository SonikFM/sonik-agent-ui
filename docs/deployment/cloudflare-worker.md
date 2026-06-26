# Cloudflare Worker deployment

The standalone Agent UI deploys as a SvelteKit app on Cloudflare Workers Static Assets via `@sveltejs/adapter-cloudflare`.

## Fast staging allowlist

For temporary Worker-hosted staging URLs, keep iframe/page-context friction low with wildcard host-origin patterns:

```jsonc
{
  "vars": {
    "PUBLIC_AGENT_UI_ALLOWED_HOST_ORIGINS": "https://*.workers.dev,https://*.sonik.fm"
  }
}
```

This allows browser page-context donation from hosts such as:

- `https://amplify-staging.liam-trampota.workers.dev`
- `https://sonik-booking-app.liam-trampota.workers.dev`
- future `https://*.sonik.fm` hosts

Use `*` only for short-lived throwaway demos. The iframe still posts page context to the exact Agent UI origin; the wildcard controls which host origins the Agent UI accepts page-context messages from.

## Required Worker config

`apps/standalone-sveltekit/wrangler.jsonc` contains the default staging-safe Worker config:

```jsonc
{
  "name": "sonik-agent-ui",
  "main": ".svelte-kit/cloudflare/_worker.js",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "binding": "ASSETS",
    "directory": ".svelte-kit/cloudflare"
  },
  "vars": {
    "PUBLIC_AGENT_UI_ALLOWED_HOST_ORIGINS": "https://*.workers.dev,https://*.sonik.fm",
    "AI_GATEWAY_MODEL": "deepseek/deepseek-v4-flash",
    "RATE_LIMIT_PER_MINUTE": "10",
    "RATE_LIMIT_PER_DAY": "100"
  }
}
```

## Required Agent UI secrets

Set the AI SDK Gateway token as a Cloudflare Worker secret, not as a plain var:

```bash
cd apps/standalone-sveltekit
pnpm exec wrangler secret put AI_GATEWAY_API_KEY
```

Paste the Vercel AI Gateway token value when prompted. The app reads this value from `AI_GATEWAY_API_KEY` and reads the model from `AI_GATEWAY_MODEL`.

Optional rate limit storage secrets, only if you want persistent Upstash-backed rate limiting instead of the current no-op fallback:

```bash
pnpm exec wrangler secret put KV_REST_API_URL
pnpm exec wrangler secret put KV_REST_API_TOKEN
```

If these are absent, the app still runs; rate limiting becomes a no-op fallback.

## Host env

Amplify/Booking should point at the deployed Agent UI URL and allow the Agent UI origin. For a temporary Worker URL:

```bash
VITE_SONIK_AGENT_UI_URL=https://sonik-agent-ui.<account>.workers.dev/
VITE_SONIK_AGENT_UI_ALLOWED_ORIGINS=https://*.workers.dev,https://*.sonik.fm
```

For the stable hosted domain:

```bash
VITE_SONIK_AGENT_UI_URL=https://agent-ui.sonik.fm/
VITE_SONIK_AGENT_UI_ALLOWED_ORIGINS=https://*.workers.dev,https://*.sonik.fm
```

## Deploy

```bash
pnpm --filter svelte-chat build
cd apps/standalone-sveltekit
pnpm exec wrangler deploy
```

## Quick go-live checklist

1. Agent UI Worker vars:
   - `PUBLIC_AGENT_UI_ALLOWED_HOST_ORIGINS=https://*.workers.dev,https://*.sonik.fm`
   - `AI_GATEWAY_MODEL=deepseek/deepseek-v4-flash`
   - `RATE_LIMIT_PER_MINUTE=10`
   - `RATE_LIMIT_PER_DAY=100`
2. Agent UI Worker secrets:
   - `AI_GATEWAY_API_KEY=<Vercel AI Gateway token>`
   - optional `KV_REST_API_URL` / `KV_REST_API_TOKEN`
3. Amplify vars:
   - `VITE_SONIK_AGENT_UI_URL=<deployed Agent UI URL>`
   - `VITE_SONIK_AGENT_UI_ALLOWED_ORIGINS=https://*.workers.dev,https://*.sonik.fm`
4. Booking vars, if testing Booking embed now:
   - `VITE_SONIK_AGENT_UI_URL=<deployed Agent UI URL>` or the equivalent SDK config value used by the Booking host
   - `VITE_SONIK_AGENT_UI_ALLOWED_ORIGINS=https://*.workers.dev,https://*.sonik.fm` if the Booking host uses the same env-gated allowlist pattern
5. Redeploy Agent UI after vars/secrets are present.
6. Redeploy Amplify PR 485 after its vars are present.
7. Open Amplify/Booking staging and verify the Agent UI iframe loads, page context is donated, and a one-sentence live model response works.

## Security boundary

The wildcard allowlist is only for browser page context (`route`, `surface`, `title`, visible commands). It is not an auth channel. Production privileged tools should use a host-side proxy or short-lived host-minted token.

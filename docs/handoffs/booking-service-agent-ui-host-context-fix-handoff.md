# Booking Service Agent UI Host-Context Fix Handoff

## Goal

Fix the recurring deployed Agent UI error:

```txt
Workspace cloud runtime is not available. (missing-host-context)
```

This is **not primarily a DB migration issue**. The deployed booking app is failing to donate a valid signed host context into the embedded Agent UI iframe, so Agent UI cannot enable cloud workspace persistence.

We need the current booking-service / booking-app PR branch you are working on to pick up the signed host-context runtime fixes so they persist across future deployments and merge cleanly.

---

## Repo

```txt
/Users/danielletterio/Documents/GitHub/sonik-booking-service
```

Current local branch with relevant work:

```txt
codex/booking-agent-ui-runtime-bridge
```

But do **not** blindly deploy this branch as-is. It is behind `origin/main` and has extra unmerged commits.

---

## Failure being fixed

Agent UI requires a signed host context containing:

```txt
hostSession
authenticated=true
organizationId
userId/principalId
signatureVersion
issuedAt
expiresAt
signature
```

Agent UI validates this in:

```txt
/Users/danielletterio/Documents/GitHub/sonik-agent-ui/apps/standalone-sveltekit/src/lib/server/workspace-services.ts
```

If the signed context is missing or invalid, Agent UI throws:

```txt
missing-host-context
```

---

## Booking-service commits to pick up

These commits exist locally on:

```txt
codex/booking-agent-ui-runtime-bridge
```

but are not fully in `origin/main`:

```txt
f68e20b fix(agent-ui): refresh signed host context at runtime
4324559 Promote Agent UI booking contract grants
```

These are the important commits to cherry-pick or manually port into your current open booking-service PR branch.

### Why `f68e20b` matters

It changes the booking app embed to prefer the live same-origin endpoint:

```txt
/api/v1/booking/agent-ui/host-context
```

instead of trusting SSR-donated context too early. This matters because signed HMAC context can break if serialization changes between SSR and client.

Relevant files:

```txt
apps/booking/src/lib/booking-platform/BookingAgentUiEmbed.svelte
apps/booking/src/design-system/templates/BookingPlatformApp.svelte
apps/booking/scripts/check-agent-ui-host-context-runtime.mjs
packages/sonik-sdk/package.json
packages/sonik-sdk/scripts/check-agent-ui-host-context-preservation.mjs
```

### Why `4324559` matters

It promotes the generated booking command grants into the signed Agent UI context so the embedded Agent UI can execute approved booking commands.

Relevant files:

```txt
packages/service/src/agent-ui-command-grants.ts
packages/service/src/agent-ui-host-context.ts
packages/service/src/auth/session.ts
packages/service/src/http/booking-rest.ts
packages/service/src/worker.ts
packages/sonik-sdk/src/agent-ui.ts
packages/sonik-sdk/src/agent-ui.test.ts
packages/sonik-sdk/docs/agent-ui-embed.md
```

---

## Also pick up this current uncommitted SDK fix

There is an uncommitted local fix in:

```txt
packages/sonik-sdk/src/agent-ui.ts
packages/sonik-sdk/src/agent-ui.test.ts
```

It gates host-context posting until the iframe is actually ready.

Core behavior:

```ts
let iframeReadyForContext = false;

const postContext = async () => {
  if (!iframeReadyForContext) return;
  // then post signed context
};

const onLoad = () => {
  iframeReadyForContext = Boolean(resolveMountedAgentTargetOrigin(...));
  scheduleContextPosts();
};

const onRequestPageContext = (event) => {
  if (event.origin !== resolveAgentTargetOrigin(options.agentUrl, ownerWindow)) return;
  iframeReadyForContext = true;
  void postContext();
};
```

The test adds:

```ts
await controller.postContext();
expect(posted).toHaveLength(0);

iframe.dispatch("load");
await controller.postContext();
expect(posted.length).toBeGreaterThan(0);
```

This prevents posting context too early or into an iframe without a validated Agent UI origin.

---

## Recommended branch strategy

Use the branch you are already deploying / opening as the current booking-service PR branch.

If you need a clean one:

```bash
cd /Users/danielletterio/Documents/GitHub/sonik-booking-service
git fetch origin
git checkout -b codex/fix-agent-ui-host-context-runtime origin/main
```

Then cherry-pick:

```bash
git cherry-pick f68e20b
git cherry-pick 4324559
```

Then manually apply the uncommitted SDK iframe-readiness diff from:

```txt
packages/sonik-sdk/src/agent-ui.ts
packages/sonik-sdk/src/agent-ui.test.ts
```

Do **not** commit `.env`.

---

## Required checks before pushing

Run:

```bash
cd /Users/danielletterio/Documents/GitHub/sonik-booking-service

cd packages/sonik-sdk
bunx vitest run src/agent-ui.test.ts
bun run check-agent-ui-host-context

cd ../../apps/booking
bun run check:agent-ui-host-context-runtime
bun run check:agent-ui
```

If build deps are needed:

```bash
cd apps/booking
bun run build:deps
```

---

## Expected runtime behavior after deploy

On:

```txt
https://sonik-booking-app-pipe-b.liam-trampota.workers.dev
```

Open the Agent UI canvas/chat.

The left rail should **not** show:

```txt
Workspace cloud runtime is not available. (missing-host-context)
```

Agent UI should receive signed context and cloud persistence should work.

Prompt to verify:

```txt
Using the current page context only, tell me what booking surface I am on and what active entity is attached. Do not create an artifact.
```

Expected:

- It identifies the booking surface/page.
- It references the active booking context/entity.
- It does not say it has no page context.
- It does not create an artifact.

---

## Deployment order

After merge:

1. Deploy booking service pipe-b.
2. Deploy booking app pipe-b.
3. Agent UI only needs redeploy if its own code changed.

The signer must be current before the booking app can donate valid host context.

---

## Secret sanity check

Both must exist and match in value:

```txt
SONIK_AGENT_UI_HOST_CONTEXT_SECRET
```

Required on:

```txt
sonik-agent-ui
sonik-booking-service-pipe-b
```

`wrangler secret list` only proves presence, not equality. If the error persists after code is deployed, assume secret mismatch is the next thing to verify.

---

## Not the likely fix

Do not start with migrations for this specific error.

This visible error is:

```txt
missing-host-context
```

not:

```txt
missing-cloud-database
relation does not exist
RLS violation
POST /api/document failed with 500
```

Migrations may matter later, but this screenshot is failing before workspace DB writes are authorized.

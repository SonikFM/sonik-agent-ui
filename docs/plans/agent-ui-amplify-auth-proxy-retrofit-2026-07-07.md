# Agent UI Amplify Auth Proxy — Retrofit Analysis

Goal: give the standalone `sonik-agent-ui` surface
(`https://sonik-agent-ui.liam-trampota.workers.dev`, this repo) a first-party
Amplify auth proxy so it can run with real auth + org context without being
embedded in a host app — "like there is in booking service."

Method: `$analyze-copy-retrofit`. Donor is `sonik-booking-service`'s
Amplify auth proxy + signed host-context envelope. Canonical auth authority is
`sonik-dev/amplify/amplify` per `$amplify-auth`. Target seams are read-only in
this pass; nothing in this repo was modified.

## 0. Headline finding

The target repo **already contains a byte-for-byte independent
reimplementation of the donor's HMAC envelope signer** — same signature
version string, same header name, same TTL/skew constants, same
`stableJsonStringify`/`timingSafeEqual` scheme — in
`apps/standalone-sveltekit/src/lib/server/workspace-services.ts`. This is not
something to copy; it already exists and matches the donor's crypto exactly.
What's missing is everything **upstream** of the signer: there is no code path
in this repo that ever calls it with a real, Amplify-authenticated session.
The only caller today is a fixture-only dev route that 404s off `localhost`.
The retrofit is therefore a **login + session-proxy** problem, not an
envelope problem.

## 1. Donor inventory (sonik-booking-service)

All paths relative to `/Users/danielletterio/Documents/GitHub/sonik-booking-service`.

| Piece | Location | What it does |
|---|---|---|
| Session type + mode dispatch | `packages/service/src/auth/session.ts:21,164-218` | `validateSession()` tries, in order: production Amplify resolution → signed Agent UI host-context header → dev headers → demo harness. Returns a `Session` with `mode` tag. |
| Amplify session adapter (the actual "auth proxy") | `packages/service/src/auth/amplify-session.ts:55-146` | `resolveAmplifyProductionSession(request, env)` forwards the incoming request's `cookie`, `authorization`, and `x-organization-id` headers (`buildAmplifySessionHeaders`, line 185-194) to `GET {AMPLIFY_AUTH_BASE_URL}/api/auth/get-session`, then to `GET {AMPLIFY_AUTH_BASE_URL}/api/organizations` (`resolveOrganizationBackedSession`, line 148-183) to pick an org membership. Never touches Better Auth internals or DB tables — pure HTTP proxy to Amplify. |
| Envelope schema + HMAC signer | `packages/service/src/agent-ui-host-context.ts:1-11,36-100,138-164` | `SONIK_AGENT_UI_HOST_CONTEXT_HEADER = "x-sonik-agent-ui-host-context"`, `SIGNATURE_VERSION = "sonik.agent_ui.host_context.hmac.v1"`, `TTL_MS = 10 * 60 * 1000`, clock skew `60 * 1000`. `createSignedAgentUiTrustedHostContext({session, secret, scopes, approvedCommandIds})` builds `{authenticated, organizationId, scopes, hostSession, signatureVersion, issuedAt, expiresAt, signature}`; `signAgentUiTrustedHostContext` = `HMAC-SHA256(secret, stableJsonStringify(unsigned)).base64url()`. `isSignedAgentUiTrustedHostContextValid` checks signature, TTL, clock skew, `timingSafeEqual`. |
| Envelope-minting HTTP route | `packages/service/src/http/booking-rest.ts:158-159,576-606` | `GET /api/v1/booking/agent-ui/host-context` → `createAgentUiHostContextResponse(context)`. Requires `context.session` (any authenticated mode) to already be resolved (i.e. the *browser* must already be Amplify-authenticated when it hits this route); 503s if `SONIK_AGENT_UI_HOST_CONTEXT_SECRET` is unset. Mints an envelope scoped to `[workspace-persistence, booking:read, booking:write]` plus `AGENT_UI_BOOKING_CONTRACT_APPROVED_COMMAND_IDS`. |
| Route-level command gate | `packages/service/src/http/booking-rest.ts:538-561` | `guardAgentUiHostContextRequest` — once a request arrives carrying a *signed* Agent UI context (`session.mode === "agent-ui-host-context"`), every booking REST call is checked against `agentUiScopes` and `agentUiApprovedCommandIds` before it's allowed to mutate. This is the enforcement side of the envelope, separate from minting it. |
| Env wiring | `packages/service/src/worker.ts:64,278,320` | `SONIK_AGENT_UI_HOST_CONTEXT_SECRET` passed into both `validateSession()` and the REST context. |
| Client-side donor consumption (for parity reference only, not a copy target) | `packages/sonik-sdk/src/agent-ui.ts:172-220,600-753`, `apps/booking/src/lib/booking-platform/agent-ui.ts:960-983` | Sanitizes/merges the signed envelope into booking's own page-context object before postMessage-ing it down into the embedded Agent UI iframe. |

**Cookie/domain assumption baked into the donor (load-bearing, not incidental):**
`buildAmplifySessionHeaders` (`amplify-session.ts:185-194`) works only because
the *browser's own request to booking's origin* already carries Amplify's
Better Auth session cookie. Amplify's Better Auth config
(`sonik-dev/amplify/amplify/src/lib/auth.js:1-60,349-483`) does **not** set an
explicit cross-subdomain cookie `domain`/`crossSubDomainCookies` option —
`trustedOrigins`/`baseURL` are configured, but the session cookie is left
host-only by default. That only works today because booking's browser-facing
origin and Amplify's origin share a cookie-visible relationship in the current
deployment topology (same eTLD+1 under `liam-trampota.workers.dev`, or booking
is reverse-proxied under Amplify's own origin) — **not** because the donor
does anything to bridge two independent origins. See §3 risk callout.

## 2. Canonical Amplify auth (sonik-dev/amplify/amplify, read-only)

Per `$amplify-auth` (confirmed current, 2026-05-11 doctrine):

| Piece | Location | Role |
|---|---|---|
| Better Auth server config | `src/lib/auth.js:1-60` | `betterAuth()` instance, per-isolate cache (`AUTH_CACHE_TTL_MS=5min`, `AUTH_NEGATIVE_CACHE_TTL_MS=5s`), `DEDICATED_AUTH_TRANSPORT_ROUTES = {GET /api/auth/get-session, POST /api/auth/sign-in/email, POST /api/auth/sign-up/email}`. `CANONICAL_STAGING_ORIGIN = "https://amplify-staging.liam-trampota.workers.dev"`. |
| Direct session resolver | `src/lib/auth-session-resolver.ts` | `resolveDirectSessionContextFromHeaders(headers, orgHint, env)` — DB-direct session→org lookup joining `organization_memberships` (not Better Auth `member`). |
| Session→org authorization | `src/lib/auth-request-context.ts:360-460` | `resolveAuthorizedSessionContext(input, env)` — throws `AuthRequestContextError("AUTH_REQUIRED")` if no session user; dev-header fallback is explicit and gated. |
| oRPC envelope | `src/lib/core-services/organization-context-service.ts:592` | `buildAuthorizedRpcContext(context)` — the repo-mandated wrapper for any oRPC procedure; do not use `resolveAuthorizedSessionContext` directly per the skill's anti-pattern list. |
| Org bootstrap on first login | `src/routes/api/organizations/bootstrap.ts:19-76` | `POST /api/organizations/bootstrap` — resolves session via `resolveDirectSessionContextFromHeaders`, then `ensureOrganizationForAuthUser(db, {authUserId, userName, userEmail, activeOrganizationId})`. |
| Login page | `src/pages/login/index.tsx` | Standard Better Auth email/password + magic-link form, ~200-614 lines. |

## 3. DIRECT-COPY MANIFEST

Because the HMAC envelope layer already exists independently in this repo and
matches the donor byte-for-byte, **the copy manifest is small**. The donor's
value here is architectural (the auth-proxy *pattern*), not code that can be
vendored wholesale — the target's SvelteKit/Cloudflare-Worker runtime and the
donor's Bun/Hono-style Worker runtime are different enough that a literal file
copy would need a full rewrite of the HTTP layer anyway, which the
copy-retrofit skill treats as a retrofit, not a copy.

| # | Donor source | Target destination | Copy mode | Integrity note |
|---|---|---|---|---|
| 1 | `sonik-booking-service/packages/service/src/auth/amplify-session.ts` (whole file, ~433 lines) | `sonik-agent-ui/apps/standalone-sveltekit/src/lib/server/amplify-session-proxy.ts` (new) | **Direct copy, then adapt** — copy the file verbatim first (manifest entry + `verify-source-drift.mjs`), then retrofit in a second commit per the skill's "retrofit outside the copied island" rule. The header-forwarding logic (`buildAmplifySessionHeaders`), the `/api/auth/get-session` → `/api/organizations` two-step, and the UUID/membership-picking logic (`pickOrganizationMembership`, `organizationMembershipCandidates`) are directly reusable — this is exactly the "Amplify session → org membership" reduction agent-ui also needs, and it already treats headers as hints/proxies, never reimplementing Better Auth. |
| 2 | `sonik-booking-service/packages/service/src/agent-ui-host-context.ts` | *(no copy — already present as `workspace-services.ts` `createSignedTrustedHostContext`/`signTrustedHostContext`/`isSignedTrustedHostContextValid`)* | **N/A** | Confirmed identical signature version, header name, TTL, clock-skew constants. Record as a **behavioral parity anchor**, not a copy target — see §5. |
| 3 | `sonik-booking-service/packages/service/src/http/booking-rest.ts:576-606` (`createAgentUiHostContextResponse`) | New SvelteKit endpoint `apps/standalone-sveltekit/src/routes/api/auth/host-context/+server.ts` | **Pattern copy, not literal copy** — SvelteKit `RequestHandler` shape differs from the donor's Hono-style handler; port the *logic* (require resolved session → mint via existing signer → 503 if secret missing) using `copy-from-manifest.mjs` against a hand-written adapter stub is not applicable since the destination file has no donor byte-equivalent; document as `allowedLocalModifications` in the manifest per skill guidance. |

`allowedLocalModifications` for manifest entry 1 (required by the skill when
a copied file must change): swap `Fetcher`/Cloudflare service-binding types
for SvelteKit's `platform.env` shape; the `hasAuthSignal()` gate and
`ProductionSessionResolutionError` taxonomy stay verbatim.

## 4. RETROFIT DELTAS

### 4.1 The load-bearing gap: cookie/session domain strategy (biggest risk)

The donor's cookie-forwarding trick (`copyHeader(request, headers, "cookie")`)
only works because the *browser* already attaches Amplify's Better Auth
session cookie to requests hitting booking's origin. Amplify's Better Auth
config sets no cross-subdomain cookie domain
(`sonik-dev/amplify/amplify/src/lib/auth.js` has no `crossSubDomainCookies`/
`domain` option wired into the `betterAuth()` call — only `baseURL` and
`trustedOrigins`). A Better Auth session cookie is therefore host-only,
scoped to whatever origin issued it.

`sonik-agent-ui` standalone is deployed at its own distinct origin
(`sonik-agent-ui.liam-trampota.workers.dev`). Unless Amplify's cookie is
explicitly re-scoped to the shared `liam-trampota.workers.dev` eTLD+1 (a
change owned by Amplify, and one that would also affect booking), the browser
will **never** attach Amplify's session cookie to a request made directly to
agent-ui's own origin. Porting `amplify-session.ts` as-is and expecting
`buildAmplifySessionHeaders`'s cookie-forward to work will silently fail
(`hasAuthSignal()` returns false, `resolveAmplifyProductionSession` returns
`null`) with no error surfaced to the user beyond staying logged out.

Two viable strategies, both compatible with "Auth stays owned by Amplify —
agent-ui proxies/validates, never reimplements":

- **A. Login-form proxy (recommended for P1).** Agent-ui hosts its own
  minimal login form. The SvelteKit server handler POSTs credentials
  server-to-server to `{AMPLIFY_AUTH_BASE_URL}/api/auth/sign-in/email`
  (mirroring `DEDICATED_AUTH_TRANSPORT_ROUTES` in `auth.js`), captures
  Amplify's session token from the response, and immediately calls
  `GET /api/auth/get-session` + `GET /api/organizations` server-to-server
  (this is exactly the ported `amplify-session.ts` logic, just driven by a
  token agent-ui captured itself instead of a browser-forwarded cookie).
  Agent-ui then mints its own signed envelope via the existing
  `createSignedTrustedHostContext` and stores a short-lived, agent-ui-owned
  session reference (its own `HttpOnly` cookie, scoped to agent-ui's own
  origin) that maps to the captured Amplify token for silent refresh before
  the 10-minute TTL expires.
- **B. Shared-domain cutover.** Move agent-ui standalone off `workers.dev`
  onto a subdomain under Amplify's real apex (e.g. `agent-ui.sonik.fm`) and
  have Amplify opt into cross-subdomain cookies. This removes the need for a
  login-form proxy entirely (agent-ui could resolve sessions the same way
  booking does) but is an infra/DNS change outside this repo's control and
  changes Amplify's cookie posture for *all* consumers, not just agent-ui —
  out of scope for a repo-local retrofit; flag to Amplify owners as a
  follow-up, don't build against it.

Recommend **A** for P1: it's entirely within this repo's control, doesn't
touch Amplify's cookie config, and produces the same envelope shape either
way.

### 4.2 Retire the dev smoke signer

`apps/standalone-sveltekit/src/routes/api/dev/smoke-host-context/+server.ts`
is gated by `isLocalSmokeRequest()` (hostname must be `localhost`/`127.0.0.1`/
`0.0.0.0`) and `SONIK_AGENT_UI_ENABLE_SMOKE_HOST_CONTEXT_SIGNER=true` — safe
today because it always 404s on the deployed `workers.dev` host (confirmed:
`wrangler.jsonc` sets that env var to `"true"` unconditionally, but the
hostname gate is what actually protects production). Once §4.1 ships, this
route should be deleted, not just left dormant — its fixture org/user IDs
(`FIXTURE_ORGANIZATION_ID`, `FIXTURE_USER_ID`) and its direct call to
`createSignedTrustedHostContext` are the only other caller of the signer
today, and leaving it in place after a real login path exists is an
unnecessary unauthenticated-envelope-minting surface even with the hostname
gate.

### 4.3 Org-keyed persistence — smaller gap than it first looks

The Neon/cloud persistence adapter
(`packages/workspace-session/src/index.ts`, `class ... implements
AsyncWorkspacePersistenceAdapter`, e.g. lines 708-1494) already filters every
SQL query on `this.#authorized.organizationId` — it is already org-scoped.
`AuthorizedWorkspaceRuntime.organizationId` (line 474) is a required field.
**The actual flagged risk is narrower**: the *default* runtime for standalone
is the **in-memory** adapter (`createInMemoryWorkspacePersistence`,
`workspace-session/src/index.ts:1660+`, backed by plain `Map<string, ...>`),
selected whenever `resolveWorkspaceRuntime` can't resolve a signed host
context (`localAuthAdapter` always returns `organizationId: null`,
`userId: "local-user"`, `workspace-services.ts:70` /
`workspace-session/src/index.ts:369-386`). That adapter has **no org
boundary at all** — it's safe only because each local/dev process is
effectively single-tenant. Once §4.1 makes cloud mode reachable for real
users, this stops being a live risk for authenticated traffic (cloud mode is
already org-scoped); the residual risk is scoping what happens for
unauthenticated/anonymous visits to the standalone app — those should
either be blocked entirely or explicitly routed to a per-session-only memory
runtime that never claims to be org-scoped in its telemetry/diagnostics
(`resolveWorkspaceRuntimeDiagnostics`, `workspace-services.ts:154-193`,
already reports `mode` and `memoryReason` — reuse, don't rebuild).

### 4.4 Env vars / secrets needed (new for standalone)

| Var | Purpose | Precedent |
|---|---|---|
| `AMPLIFY_AUTH_BASE_URL` | Base URL for Amplify's `/api/auth/*` and `/api/organizations` | Direct analog of donor's `AmplifySessionAuthEnv.AMPLIFY_AUTH_BASE_URL` (`amplify-session.ts:9`) |
| `AMPLIFY_AUTH_INTERNAL_TOKEN` (optional) | Server-to-server auth marker if Amplify requires one for non-cookie-bearing calls | Donor: `amplify-session.ts:14,190-191` |
| `SONIK_AGENT_UI_HOST_CONTEXT_SECRET` | Already defined/read (`workspace-services.ts:382`, `smoke-host-context/+server.ts:172`) — must be the **same secret value** Amplify/booking use, not a new one, or envelopes minted by agent-ui won't validate anywhere that shares the secret | Existing var, new requirement: must match donor's `SONIK_AGENT_UI_HOST_CONTEXT_SECRET` (`worker.ts:64`) |
| `SONIK_AGENT_UI_LOGIN_SESSION_SECRET` (new) | Encrypts/signs agent-ui's own short-lived login-proxy cookie (strategy A, §4.1) — must be distinct from the host-context HMAC secret | New |
| `SONIK_AGENT_UI_ENABLE_SMOKE_HOST_CONTEXT_SIGNER` | Retire once §4.2 lands; currently `"true"` in `wrangler.jsonc:44` | Existing, to be removed |

## 5. BEHAVIORAL PARITY PROOF plan

Parity claim to prove: **an envelope minted by agent-ui's own login proxy is
indistinguishable, at every downstream validator, from one donated by the
booking-app embed handshake.** Both must pass through the exact same
`isSignedTrustedHostContextValid` / `isSignedAgentUiTrustedHostContextValid`
code paths with no forked validation branch.

| Donor behavior | Evidence (donor) | Host test (target) |
|---|---|---|
| Signature scheme (HMAC-SHA256, base64url, stable-sorted JSON) | `agent-ui-host-context.ts:93-100`, `agent-ui-host-context.test.ts` | Existing `workspace-services.ts` unit coverage already asserts identical scheme — add a **cross-signing test**: sign with donor's `createSignedAgentUiTrustedHostContext`, validate with target's `isSignedTrustedHostContextValid` (and vice versa) against the same secret, in a new `apps/standalone-sveltekit/src/lib/server/workspace-services.envelope-parity.test.ts`. This is the strongest possible parity proof — literal cross-implementation validation, not just "looks similar." |
| TTL (10 min) + clock skew (60s) rejection | `agent-ui-host-context.ts:6-7,152-162` | Mirror as parity cases: expired-by-1s, expired-within-skew, issued-in-future-within-skew, issued-in-future-beyond-skew. |
| `approvedCommandIds` semantics (max 128, dedup, scope-gated) | `agent-ui-host-context.ts:11,71-79`, `booking-rest.ts:538-561` | Agent-ui doesn't currently enforce approved-command gating on its own command runtime the way booking does on REST routes — audit `apps/standalone-sveltekit/src/lib/server/host-command-runtime.ts` against the same `approvedCommandIds` metadata key and add an enforcement test if missing (deferred gap if out of scope for P1). |
| `hostSession.metadata.authAuthority` provenance tagging | `agent-ui-host-context.ts:69` (`"amplify-org-context"`) vs target's `"signed-embedded-host"`/`"unsigned-dev-fixture-host-context"` (`workspace-services.ts:329,332`) | Add `"amplify-login-proxy"` as a new authority tag for §4.1's minted envelopes so `resolveWorkspaceRuntimeDiagnostics` telemetry can distinguish proxy-minted from embed-donated sessions without weakening validation. |
| Deployed host receives real org/session and cloud persistence activates | N/A (new for standalone) | Extend `pnpm gate:agent-ui`'s existing `booking-pipeb-document`/`booking-pipeb-reservation` live checks (`docs/release-gate.md`) with a **new `standalone-login-proxy` check**: log in via agent-ui's own login form with `TEST_EMAIL`/`TEST_PASSWORD`, confirm `SONIK_AGENT_UI_PERSISTENCE_MODE=cloud` runtime resolves (not `memory`/`cloud-unavailable`), confirm a created session is org-scoped by reading it back with a second test org's credentials and asserting 404/empty, not cross-tenant leakage. |
| No forked dev format ever reaches production | `smoke-host-context/+server.ts` hostname gate | Add a `host-context-secret`-style gate check (already exists per `docs/release-gate.md`) confirming the smoke route is **deleted**, not just disabled, once §4.2 ships — a grep-based CI assertion is sufficient and cheap. |

## 6. Phasing

**P1 — Dev-and-staging login proxy (agent-ui mints its own envelope).**
Ship strategy A (§4.1): copy-and-adapt `amplify-session.ts` (manifest §3.1),
new login route + form, new `GET /api/auth/host-context` SvelteKit endpoint
(manifest §3.3) that requires the agent-ui-owned session cookie and mints via
the *existing* signer, retire the smoke route (§4.2), add the cross-signing
parity test (§5). Does not touch Amplify or booking. Effort: **3-4 days**
(1 day port+adapt `amplify-session.ts`, 1 day login form + agent-ui session
cookie, 1 day host-context mint route + parity tests, 0.5-1 day gate wiring).

**P2 — Org-keyed persistence hardening.** Confirm §4.3's narrower framing
holds under load (cloud adapter already org-scoped); add explicit
unauthenticated-visitor handling so the in-memory fallback never silently
comingles sessions across users if `SONIK_AGENT_UI_PERSISTENCE_MODE=auto` is
ever used with agent-ui's login proxy active. Effort: **1-2 days**, mostly
tests and a diagnostics check, not new persistence code (the org-scoping
logic to reuse already exists — see §4.3).

**P3 — Decide shippable-product-mode.** Once P1/P2 are proven in staging,
decide whether agent-ui standalone becomes a real login surface for external
users (requiring rate limiting, password-reset flows, session-list/revoke UI
— none of which exist in the P1 minimal proxy) or stays an
internal/demo-and-testing surface with the login proxy gated behind an
allowlist. This is a product decision, not an engineering one; flag to Dan
before P1 ships rather than after, since it changes whether P1's login form
needs to be production-grade UX or can stay minimal. Effort: **decision only,
0 engineering days** until the direction is picked; downstream effort
(password reset, rate limiting, etc.) is a separate estimate once the
direction is set.

## 7. Open risks not covered above

- Amplify's `AUTH_CACHE_DISABLED`/Hyperdrive-socket bug class
  (`$amplify-auth` §"Known bug class") applies to agent-ui's server-to-server
  calls in §4.1 exactly as it does to booking's — agent-ui's login proxy
  should surface the same `AUTH_TIMEOUT_MS`/504 failure mode distinctly from
  "wrong credentials," or support will misdiagnose it.
- `SONIK_AGENT_UI_HOST_CONTEXT_SECRET` is currently only known to be shared
  between booking-service and agent-ui's dev smoke route; confirming it's
  the *same* secret value provisioned to Amplify (if Amplify ever needs to
  validate agent-ui-minted envelopes directly) was not verified in this pass
  — Amplify's repo was read-only and no secret material was inspected.

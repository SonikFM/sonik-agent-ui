# Production Readiness — Agent Creation Tool (gap ledger, 2026-07-13)

Status of record: PR #53 is merge-ready (build exit 0, suite green, two reviews,
no P0 code defects). This ledger is what separates MERGED from PRODUCTION.
Feeds the next ralplan ("production slice").

## Deploy tiers (corrected 2026-07-13 after Dan's challenge)

- **LIVE INTERNAL TEST: READY NOW.** Conditions: internal-access only (the
  agent-definitions routes are unauthenticated mutable state — bound the
  audience, not the code), and definitions/knowledge are EPHEMERAL on Workers
  (isolate recycle wipes them; fine for testing, don't keep real work).
  Sessions/chats already persist (workspace store is Neon-backed). On a node
  test box even the ephemerality caveat mostly disappears. Subject to Dan
  confirming the standing A2 deploy gate (the Approve-card UI now exists and
  is test-green, so the gate is likely satisfied — his call).
- **ORGANIZER-FACING / MULTI-TENANT PRODUCTION:** the P0 table below. Note
  P0-#2 (auth/tenant scoping) is a GRADUATION requirement per the spec's
  audience model (internal-first, organizer tier deferred) — the reviewer's
  verdict was "must be scoped before any MULTI-TENANT deploy," not before any
  deploy. It was previously overstated here as blocking all shared deploys.

## P0 — blocks any shared deploy

| # | Gap | Fix | Owner/lane | Shape |
|---|-----|-----|------------|-------|
| 1 | **Durable persistence.** Agent-definition store is in-memory single-process; knowledge store is local-file. On Cloudflare Workers: isolate-recycled memory + no durable disk → drafts, published versions, and knowledge unreliable-to-broken. Both were built demo-tier ON PURPOSE with seamed interfaces + upgrade-path comments. | Swap both stores behind their existing interfaces (keep `resolveKnowledgeContext` untouched; published versions append-only keyed by immutable packageVersionId per D002). **OPEN DECISION for the plan — backing store:** (a) **Neon Postgres** (repo's `workspace-store.ts` pattern; agent defs live NEXT TO sessions + Better Auth org tables → tenant scoping (#2) is a join, one security surface) vs (b) **Cloudflare D1 / Durable-Object SQLite** ("SQLite for agents" done Workers-native; less DB ceremony, but a second store whose org-scoping must be re-implemented). Classic SQLite-file is unavailable on the Workers target. Default lean: Neon for definitions/knowledge metadata (auth-adjacency wins the P0-#2 argument), R2 for large knowledge blobs; D1 stays the fallback if Neon latency from Workers disappoints. Migrations + `SONIK_AGENT_UI_DATABASE_URL` in deploy env. | this lane (ralplan settles a-vs-b) | the core of the production slice |
| 2 | **Auth/tenant scoping (review P1).** `api/agent-definitions` fronts a shared mutable store unauthenticated: cross-tenant clobber + stored-prompt-injection in any shared deploy. Interim hardening done (no draft enumeration, server-assigned publisher) but NOT sufficient. Also: `draftAgentId`/`publishedAgentId` resolution on the generate route has no ownership check. | Gate route + resolution behind Better Auth org context per platform doctrine (`amplify-auth` / `amplify-org-context` skills); drafts + published versions org-scoped; publisher derived from auth identity. | credentials/auth lane (blocking dependency) | medium; mostly plumbing once org context is resolvable here |
| 3 | **Knowledge = injected system prompt.** Attached knowledge is folded into system context verbatim — a poisoned file is stored prompt injection with a persistence layer. | Provenance-framed injection (wrap sections in explicit "untrusted attached content" framing), size/count quotas per store, content-type allowlist; org-scoping from #2 bounds who can write. | this lane | small, do with #1 |
| 4 | **A2 deploy-gate confirmation.** Standing ledger: deploys held until reservation-commit backend (merged #45) AND Approve-card UI both confirmed. | Dan confirms gate status before any deploy of anything. | Dan | decision |

## P1 — production hardening (ship within the slice)

| # | Gap | Fix | Shape |
|---|-----|-----|-------|
| 5 | **AC-11 production path.** Controller + run-state reducer still have zero production callers; the builder can draft workflows but not RUN them in-product. | `api/workflow-runs` endpoint (start/preview/approve[host-signed]/commit, run rows persisted per #1) + Run affordance in the builder; cards via the shared affordance builder; this is also where the D011 review surface gets its first non-reservation instance. | the feature half of the slice (Dan-ratified next-slice opener) |
| 6 | **Abuse guards on new mutable routes.** save_draft/publish/knowledge writes have no rate limits or size caps. | Per-org rate limits + payload caps on `api/agent-definitions` and knowledge writes; publish requires existing draft (already enforced) + semver monotonicity check. | small |
| 7 | **E2E/visual verification (AC-4 caveat).** Builder mode is source-assertion tested only; plan specified a Playwright lane + screenshot signoff; browser smoke was manual (this session). | Playwright specs: mode toggle, draft save round-trip, Debug&Preview send, locked-fixture render; wire into CI; visual-regression baseline screenshots. | medium |
| 8 | **Design gates + UX elevation on the builder.** Manual ban-audit passed, but the real gates (elevation-skill scripts) never ran; the canvas is a v0 structured form editor, not the visual graph; model picker is a static "Host-derived default". | Copy design-gate scripts into `scripts/design-gates/` per skill bootstrap and run on `workflow-builder/**`; impeccable critique pass; dynamic model list (Dify bar: searchable, context badges, incompatible flags); canvas upgrade = Dan's call (form editor arguably fits workflows-invisible doctrine). | medium; UX polish sized by Dan's bar |
| 9 | **Observability productionization.** workflowRunId join-key ships, but nothing consumes it: no run dashboard, no error alerting on new routes. | A3 runs screen (consumes the join-key for free) or PostHog dashboards + error tracking on agent-definitions/workflow-runs routes; alert on default-deny spikes (wrong-tool canary). | medium; A3 was already sequenced post-absorb per D020 |
| 10 | **Embed origin policy.** publishedAgentId selector is provably grant-free, but production embeds on organizer sites need an allowed-origins policy for the iframe/postMessage channel. | Per-published-agent allowed-origins list (lives on the package version), enforced at mount/message level in agent-embed. | small-medium |
| 11 | **CI parity.** Local gates are green; confirm the repo's CI runs the same chain (pnpm test + check-types + build) on PRs, including the new test files. | Verify/extend CI workflow. | small |

## P2 — quality follow-ons (schedule, don't block)

- Publish UX: semver picker + version-history list in the builder (store already append-only).
- Debug & Preview: streaming status/receipt display parity with main chat.
- Composer lane merge (Dan's parallel session; fenced files — trivial integration).
- 3a-2 reservation live cutover — Dan-gated; NOT production-blocking (reservation ships on its existing proven path).
- Multi-region/session stickiness review for run state once workflow-runs persist.
- Knowledge deep-dive session (Dan's reserved unpack: GC datasets, pages-as-knowledge).

## Sequencing recommendation

One consensus slice, two tracks in parallel after a shared Phase A:
- **Phase A (foundation):** #1 persistence + #3 knowledge hardening + #6 guards (one lane), while credentials lane lands #2 org context.
- **Phase B (feature):** #5 workflow-runs + Run affordance + #9 A3/dashboards (consumes A).
- **Phase C (verification):** #7 Playwright/visual + #8 gates/UX pass + #11 CI, then deploy behind #4's gate confirmation.

Estimate shape: comparable to the slice just completed (contracts are done; this
is stores + routes + one feature + verification). Everything above is additive
to PR #53 — nothing requires rework of what shipped.

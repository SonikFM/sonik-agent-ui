# Copy-Retrofit Pre-Runner: activepieces

Date: 2026-07-12 · Method: read-only local-repo analysis, no files copied.
Donor: `/Users/danielletterio/Documents/GitHub/activepieces`, commit
`63150713e7d93d56c6f561191c2694e362cf3a52` (2026-07-12), remote
`https://github.com/activepieces/activepieces.git`.
Targets four confirmed steal items from
`docs/research/workflow-competitors-analysis-2026-07.md` (activepieces
section): waitpoint primitive, confirm-page-then-POST resume, `audience` +
`aiMetadata.idempotent` fields, `min/maxSupportedRelease` host-compat gating.

## License bottom line (read once, applies to every item below)

Root `LICENSE`: everything is **MIT Expat** except two carve-outs —
`packages/ee/` and `packages/server/api/src/app/ee/`, which fall under a
separate commercial license (`packages/ee/LICENSE`). All four target items
live entirely outside both carve-outs (verified by path below) — **clean MIT,
no EE contamination, no per-package override found in the touched
`package.json` files.**

---

## Item 1 — Waitpoint primitive

**What it is:** the one durable pause/resume primitive under every
delay/webhook/approval feature. A flow step calls a `createWaitpoint` engine
hook, which inserts a `waitpoint` row (`PENDING`, unique on
`(flowRunId, stepName)`) and returns a `resumeUrl`; the step then throws
`PausedFlowTimeoutError` up through `waitForWaitpoint`, and the executor sets
the step status to `PAUSED`. Resume is a separate HTTP call that reads the row
and calls back into the paused run.

**File set:**
- `packages/core/execution/src/lib/flow-run/waitpoint/index.ts` (24 LOC) — Zod
  request/response contracts (`CreateWaitpointRequest`,
  `CreateWaitpointResponse`, `WaitpointVersion` enum `V0|V1`). Pure schema,
  zero framework coupling.
- `packages/server/api/src/app/flows/flow-run/waitpoint/` (936 LOC across 7
  files): `waitpoint-entity.ts` (TypeORM entity), `waitpoint-service.ts` (163
  LOC — create/complete/find, TypeORM `repoFactory`/`transaction`, dayjs, a
  `systemJobsSchedule` job for `DELAY` waitpoints), `waitpoint-controller.ts`
  (42 LOC — POST-create endpoint, engine-only auth), `resume-service.ts` (197
  LOC), `resume-controller.ts` (350 LOC — HTTP surface, mostly HTML-template
  string constants, see Item 2), `resume-page-hooks.ts` (14 LOC — CE/EE theme
  hook seam), `waitpoint-types.ts` (83 LOC).
- Engine-side hook wiring: `packages/server/engine/src/lib/handler/piece-executor.ts`
  (320 LOC total; the relevant hook plumbing is ~50 lines —
  `createWaitpointHook`/`createWaitForWaitpointHook` at lines 273–318, wired
  into the action-execution context at lines 139–140). Imports
  `waitpointClient` from `../piece-context/waitpoint-client` (not yet read;
  thin HTTP client, follow-up if porting).

**Dependency fan-in:** TypeORM (`repoFactory`, `transaction`, query builder
`.orIgnore()` upsert), Fastify (`FastifyBaseLogger`, plugin/route registration
via `securityAccess.engine()`/`.unscoped()`), a bespoke `systemJobsSchedule`
scheduler for `DELAY` waitpoints, `dayjs`, `apId` util. The pure-schema layer
(`core/execution/.../waitpoint/index.ts`) has none of this.

**License:** MIT. All 8 files are under `packages/core/execution` and
`packages/server/api/src/app/flows/...` and `packages/server/engine/...` —
none under `packages/ee` or `.../app/ee`.

**Verdict: port the shape, don't vendor.** The 24-line Zod contract
(`CreateWaitpointRequest`/`Response`, `type: 'DELAY'|'WEBHOOK'`) is worth
copying close to verbatim — it's dependency-free and is the actual "steal"
(one pause primitive under every HITL/delay feature, not a bespoke one per
piece). The 936-line service/controller layer is TypeORM+Fastify+their job
scheduler specific; reimplement against our own DB/queue/router rather than
vendor, but keep the state machine identical: `PENDING → COMPLETED`,
unique-on-`(flowRunId, stepName)` idempotent insert (`.orIgnore()` — this is
the "duplicate resume signal is a no-op" guarantee, don't drop it), and the
explicit "pre-completed" check in `createForPause` (a waitpoint completed
before the pause call landed — a race the naive version misses). The
piece-executor hook shape (`createWaitpoint` + `waitForWaitpoint` throwing a
typed timeout error) is a clean seam to reproduce in our interpreter's action
hook contract.

**Adaptation notes for our stack:** our workflow interpreter
(`packages/tool-contracts/src/workflow-controller.ts`,
`workflow-run-state.ts`) doesn't yet have a pause primitive — this is new
surface, not a replacement. Map `waitpoint.type: 'DELAY'|'WEBHOOK'` to
whatever our resume-trigger taxonomy becomes; keep `V0/V1` version tagging out
(that's activepieces' own migration history, not something we inherit) but do
keep *a* version field on the waitpoint row from day one — cheap now,
expensive to retrofit later per their own `V0` legacy-route deprecation
comments (see Item 2).

**Drift-watch files:** `packages/core/execution/src/lib/flow-run/waitpoint/index.ts`
(schema changes = breaking contract change upstream), `piece-executor.ts`
lines 273–318 (hook signature), `waitpoint-service.ts` `createForPause`
pre-completed-check logic (silent correctness fix, easy to lose on a manual
reimplementation — write a test for it).

---

## Item 2 — Confirm-page-then-POST resume pattern

**What it is:** ADR 0005
(`docs/adr/0005-resume-links-require-post-confirmation.md`) plus its route in
`resume-controller.ts`. Root cause: a bare `GET` on the legacy resume route
consumes the single-use waitpoint, and email security scanners (Microsoft
Safe Links, Mimecast, Proofpoint) **prefetch** links with `GET` before
delivery — indistinguishable from a human click, so the scanner silently
consumes the approval and the human sees "expired" on their real click
(Pylon #5253 regression, cited in the ADR).

**Fix shape (verified in `resume-controller.ts:39-105`):**
- New route `/:id/waitpoints/:waitpointId/confirm`. `GET`/`HEAD` **never**
  consumes the waitpoint — it renders an HTML confirmation page (`Mustache`
  templates, inline CSS, no external assets) with Approve/Disapprove buttons
  as an HTML `<form method="POST">` with per-button `formaction`. Only the
  resulting `POST` calls `resumeService.resumeFromWaitpoint(...)`.
- Content negotiation: `Accept: text/html` → branded HTML result page,
  otherwise → the pre-existing `{ message }` JSON, so API/webhook callers are
  unaffected by the UI addition (`acceptsHtml()` helper, line 189).
- Legacy bare-`GET` routes (`/:id/waitpoints/:waitpointId`,
  `/:id/requests/:requestId`) are kept **unchanged and marked `@deprecated`**
  — already-delivered emails must keep resolving. New approval messages send
  only the `/confirm` link.
- Reopening a resolved confirm page shows a generic "already responded" state
  (line 88, 118–120) — it does **not** reveal which decision was made, because
  the waitpoint row is deleted on resume and the decision isn't persisted
  separately (explicit scope-out in the ADR's Consequences section).
- Theme/branding resolved through a CE-safe `hooksFactory` seam
  (`resume-page-hooks.ts`, 14 LOC): CE returns a `defaultTheme`; EE/Cloud
  `.set()`s a platform-appearance hook. The controller only ever calls the CE
  interface — never imports EE code directly. This is the actual pattern
  worth copying if we ever have an OSS/paid split; for us right now it's
  irrelevant (no CE/EE split), so the port can inline our own theme lookup.
- Explicit design note: Slack is excluded from this pattern because Slack
  buttons resume via a server-side `POST` webhook already (not
  browser-GET-prefetchable) — worth carrying as a decision rule ("does this
  channel's button trigger a GET or a POST callback") rather than a
  channel-by-channel special case list.

**File set:** `resume-controller.ts` (350 LOC, but only ~120 of those are
logic — the rest is inline HTML/CSS template strings for the confirm and
status pages) + the referenced ADR (already a complete spec) +
`resume-page-hooks.ts` (14 LOC, skip — no CE/EE split to preserve).

**License:** MIT (`packages/server/api/src/app/flows/flow-run/waitpoint/`,
outside `.../app/ee`).

**Verdict: port the pattern, reimplement the route.** This is the highest-
value, lowest-effort steal of the four — it's a security fix to a pattern
(bearer-link resume) we don't have built yet, so there's no legacy-route
backward-compat burden to carry like activepieces has. Don't vendor their
Mustache/inline-CSS templates (donor-branded, framework-specific); do port:
(a) the GET-never-consumes / POST-only-consumes split as a hard rule for any
resume-by-link endpoint we build, (b) content-negotiation on the response so
JSON callers are untouched, (c) the "already responded, decision not
revealed" reopen behavior — cheap to build in from day one, and it sidesteps
needing a persisted-decision schema. If we ever add a bearer-link approval
surface, treat scanner-prefetch-safety as a **launch requirement**, not a
follow-up fix — activepieces shipped the vulnerable version first and this
ADR is the incident writeup.

**Adaptation notes for our stack:** we already have host-signed approval
(per `[[a2-reservation-commit-deploy-gate]]`, PR #45,
`apps/standalone-sveltekit/src/lib/server/booking-workflows/reservation-commit.ts`)
which is a stronger trust model than activepieces' unguessable-ID-possession
bearer link — our moat per the competitor doc is exactly that we don't need
this pattern for *primary* approval. Where it's still relevant: any
lower-trust, external-channel resume surface (e.g. email/Slack-triggered
resume before a human reaches an authenticated host UI) should use this
GET-safe/POST-consumes split rather than inventing something weaker.

**Drift-watch files:** `docs/adr/0005-resume-links-require-post-confirmation.md`
(spec, watch for revisions), `resume-controller.ts` lines 39–105 (route
logic only, not the template strings).

---

## Item 3 — `audience: 'human'|'ai'|'both'` + `aiMetadata.idempotent`

**What it is:** per-action/trigger fields on the piece metadata schema
declaring who may invoke a capability and whether a retry is safe.

**Exact location:** `packages/pieces/framework/src/lib/piece-metadata.ts`,
lines 50–68:

```ts
export const Audience = z.enum(['human', 'ai', 'both'])
export type Audience = z.infer<typeof Audience>

export const AiMetadata = z.object({
  description: z.optional(z.string()),
  idempotent: z.optional(z.boolean()),
})
export type AiMetadata = z.infer<typeof AiMetadata>

export const ActionBase = z.object({
  // ...
  audience: z.optional(Audience),
  aiMetadata: z.optional(AiMetadata),
})
```

`audience` is on `ActionBase` only (not `TriggerBase` — triggers are always
event-driven, never directly invoked, so "who may invoke" doesn't apply;
`TriggerBase = Omit<ActionBase, 'audience'> & {...}`, line 97). `aiMetadata`
is on both `ActionBase` and `TriggerBase`. Both fields are optional — no
migration/backfill burden on existing pieces.

**File set:** one file, ~19 lines of net-new schema (fields plus the two
supporting types). No other file in the donor repo enforces or reads these
fields in the grepped surface (server/engine/cli) — this looks like a
declared-but-not-yet-enforced field pair in the donor itself, i.e. we'd be
porting the *design*, not a working enforcement pipeline.

**Dependency fan-in:** none beyond `zod`.

**License:** MIT (`packages/pieces/framework`, outside EE carve-outs).

**Verdict: port the field design directly — this is the smallest, cleanest
steal of the four**, as flagged in the task brief. Reimplement (not vendor)
since it's a ~19-line addition to our own schema, not a file worth copying
wholesale.

**Adaptation notes for our stack:** the natural landing spot is
`packages/tool-contracts/src/capability-registry.ts`
`capabilityDescriptorSchema` (currently: `capabilityId`, `version`, `title`,
`effect`, `status`, `implies`, `description` — no audience or idempotency
field exists there today, confirmed by reading the file). Add:

```ts
export const capabilityAudienceSchema = z.enum(["human", "ai", "both"]);
// on capabilityDescriptorSchema:
audience: capabilityAudienceSchema.optional(),
aiIdempotent: z.boolean().optional(),
```

Two adaptation calls to make deliberately, not silently: (1) our
`effect`/`implies` privilege-escalation guard (`CAPABILITY_EFFECT_RANK`) is
already a stronger per-call gate than activepieces has anywhere — `audience`
should be treated as an *additional* filter dimension on top of that, not a
replacement; (2) unlike activepieces' `idempotent`, which appears
unenforced in the donor (no reader found in this pass), if we add
`aiIdempotent` here it should be wired into actual retry logic wherever the
controller retries agent-initiated calls — otherwise we're copying a field
that looks like a safety feature but isn't one, which is worse than not
having it. Since `audience` was `ActionBase`-only upstream (not on
triggers), and our registry doesn't currently distinguish
action-vs-trigger-shaped capabilities, just scope it to whichever
capability kinds are directly agent/human-invocable in our model.

**Drift-watch files:** `packages/pieces/framework/src/lib/piece-metadata.ts`
lines 50–68 (watch for `aiMetadata` growing more fields, or `audience`
gaining enforcement call sites upstream — would be a signal our port should
follow).

---

## Item 4 — `min/maxSupportedRelease` host-compat gating

**What it is:** per-piece declared compatibility range against the host
platform's release version, enforced as a filter at piece-listing time (not
at install time — incompatible pieces simply don't appear/aren't offered).

**Schema:** `packages/pieces/framework/src/lib/piece-metadata.ts` lines 25–26,
on `PieceBase`: `minimumSupportedRelease?: string`,
`maximumSupportedRelease?: string` — plain optional strings, semver-shaped by
convention, not a branded/refined type.

**Enforcement (the actual gate — this is the part worth stealing, not just
the two optional strings):**
`packages/server/api/src/app/pieces/metadata/utils/piece-cache-utils.ts`
lines 88–99:

```ts
export function isSupportedRelease(release: string | undefined, piece: { minimumSupportedRelease?: string, maximumSupportedRelease?: string }): boolean {
    if (isNil(release) || !semVer.valid(release)) {
        return true
    }
    if (!isNil(piece.maximumSupportedRelease) && semVer.valid(piece.maximumSupportedRelease) && semVer.compare(release, piece.maximumSupportedRelease) === 1) {
        return false
    }
    if (!isNil(piece.minimumSupportedRelease) && semVer.valid(piece.minimumSupportedRelease) && semVer.compare(release, piece.minimumSupportedRelease) === -1) {
        return false
    }
    return true
}
```

Called from three sites in `packages/server/api/src/app/pieces/metadata/piece-metadata-service.ts`
(lines 433, 460, 513) — all are `.filter()` calls over the piece list at
read time, gated by `isNil(params.release)` short-circuiting to "show
everything" when the caller didn't pass a host release (line 513). Fail-open
by design: invalid/missing release strings on either side pass the gate
rather than blocking (`!semVer.valid → return true`).

**File set:** ~19 LOC total (2 schema fields + 12-line pure function) plus 3
one-line call sites. This is a trivially small, dependency-light steal — the
only dependency is the `semver` npm package (already a common transitive
dependency, likely already in our tree via other tooling — verify before
adding).

**License:** MIT (`packages/pieces/framework`, `packages/server/api/src/app/pieces/metadata/`,
outside EE carve-outs).

**Verdict: port directly, near-verbatim.** This is the second-cleanest steal
after Item 3 — small, pure, framework-agnostic function plus two schema
fields. Reimplement rather than vendor (it's 12 lines, not worth a vendor
boundary), but keep the exact semantics: fail-open on missing/invalid
version strings (don't accidentally make this fail-closed — that would hide
every capability the moment version parsing has a bug, which is a worse
failure mode than occasionally over-showing something), and gate at
discovery/listing time, not at install/execution time — cheaper and it
means an incompatible capability is invisible rather than erroring later.

**Adaptation notes for our stack:** we don't have a host-release-version
concept anywhere in `packages/tool-contracts` today (confirmed — no
`min`/`max`/`release`/`Compat` hits in `marketplace.ts`). This is genuinely
new surface, matching the research doc's framing ("host-compat gating").
Two things to decide before porting, not silently inherit: (1) what "host
release" means for us — a Sonik Agent UI build version? An amp.pkg host
primitive version? Pick one anchor, don't gate against two things at once;
(2) where the filter runs — activepieces does it at their `piece-metadata-service`
listing layer, which is the equivalent of wherever we resolve the capability
registry for a given host/session; add the two fields to
`capabilityDescriptorSchema` alongside the Item 3 fields and add one
`isSupportedRelease`-equivalent filter function at that resolution point.

**Drift-watch files:** `piece-cache-utils.ts` lines 88–99 (the function
itself — small enough that upstream changes are easy to diff),
`piece-metadata-service.ts` lines 433/460/513 (call-site placement, in case
upstream adds a fourth enforcement point we'd want to mirror).

---

## Summary table

| # | Item | LOC (core logic) | Dependency fan-in | License | Verdict |
| - | - | - | - | - | - |
| 1 | Waitpoint primitive | 24 (schema) + 936 (service/controller) + ~50 (executor hooks) | TypeORM, Fastify, dayjs, bespoke job scheduler | MIT | Port the schema near-verbatim; reimplement service/controller against our stack |
| 2 | Confirm-page-then-POST | ~120 (route logic; rest is template strings) | Fastify, Mustache (skip) | MIT | Port the GET-never-consumes/POST-only-consumes pattern; reimplement route |
| 3 | `audience` + `aiMetadata.idempotent` | ~19 | zod only | MIT | Port field design directly into `capabilityDescriptorSchema` |
| 4 | `min/maxSupportedRelease` gating | ~19 (2 fields + 12-line function) + 3 call sites | `semver` | MIT | Port near-verbatim into capability registry + resolution layer |

No EE-licensed code touched by any of the four items — everything sampled
lives outside `packages/ee/` and `packages/server/api/src/app/ee/`.

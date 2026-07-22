# E7 Tautology Inventory — pr61-contract-hardening.test.mjs + agent-embed.test.mjs static-mirror block

**Date:** 2026-07-22 · **Scope:** the 8 tests in `tests/unit/pr61-contract-hardening.test.mjs`, plus the
static-mirror substring-sync assertions in `tests/unit/agent-embed.test.mjs:623-653`.
**Method:** for every tautological (doc-prose / source-text-regex) test, find the real runtime behavior it
pretended to verify, then search the repo for a test that actually exercises that behavior instead of
reading about it. Constraint honored: zero edits to any existing test file or `package.json` (verified below).

## Headline finding (honest surprise)

6 of 8 `pr61-contract-hardening.test.mjs` tests are tautological, matching the prior audit. But for
**5 of those 6**, and for the `agent-embed.test.mjs` static-mirror block, real behavioral coverage of the
claimed behavior **already exists elsewhere in the repo** — written by other work, not credited by these
tests. The tautological tests were pure decoration stacked on top of already-solid engineering: they checked
that documentation *described* correct behavior, not that the behavior *was* correct. Only one claim
(the skills-CLI version pin) had zero coverage anywhere and a concrete seam to test against; that became the
one new red test.

## Disposition counts

| Disposition | Count | Items |
|---|---|---|
| DELETE (real coverage exists elsewhere) | 5 | tests 1, 5, 6, 7, 8 |
| DELETE (not product behavior, no code seam) | 1 | test 4 |
| KEEP (already behavioral) | 2 | tests 2, 3 |
| REPLACE-WITH (sibling epic's red suite supersedes it) | 1 | agent-embed.test.mjs static-mirror block |
| New red test written | 1 | E7.1 in `tests/unit/pr61-behavioral-coverage.test.mjs` |

## Inventory table

| # | Test name | Classification | Behavior it claimed to verify | Real coverage that exists | Gap | Disposition |
|---|---|---|---|---|---|---|
| 1 | `host authority is relayed for server consumption without entering the guest sandbox` | TAUTOLOGICAL | Host-authority signed handle is relayed browser→server and consumed there (HMAC-verified), and never lands in the sandbox/guest filesystem or env. | `tests/unit/host-authority-recovery.test.mjs` (real HMAC sign/verify via `resolveTrustedHostSessionSnapshot`, replay-tamper rejection, legacy-payload recovery — genuine runtime auth behavior, not prose) + `tests/unit/dev-workbench-server.test.mjs:212-215,561` (real object-shape check `"hostAuthority" in DEV_WORKBENCH_MIRROR_PATHS` plus a mocked-sandbox-filesystem check that authority is never written) + `tests/unit/dev-workbench-runtime-security-contract.test.mjs:10-13`. | None. | DELETE |
| 2 | `visual artifact staleness does not make a healthy interactive preview stale` | BEHAVIORAL | `derivePreviewStatus(visualReady, interactiveReady)` returns the right status per combination. | Calls the real function directly in the test itself. | — | KEEP |
| 3 | `handoff event examples parse through the strict runtime wire contract` | BEHAVIORAL (one trailing prose line) | Realtime envelope payloads (status/preview/terminal/page-context/repository/error) actually parse through `devWorkbenchRealtimeEnvelopeSchema`, including negative cases (extra field, wrong key name). | Calls the real Zod schema `.safeParse` directly in the test; only the final `assert.match(architecture, ...)` line is prose and is incidental to the rest of the test's value. | None material. | KEEP (trailing prose line is low-value but not worth a separate red test — the schema behavior it decorates is already proven by the same test's real assertions) |
| 4 | `handoff provenance is portable` | TAUTOLOGICAL | Shipped handoff docs contain no absolute local filesystem paths (`/Users/<name>/...`) and the source index names a real session id. | N/A — this is not product runtime behavior, it's document-hygiene/PII-leak prevention on a specific transitional handoff bundle. Per the plan's own doctrine ("prose-matching tests are banned; every test asserts runtime behavior"), this test is a category error, not a behavior gap to backfill. | No code seam exists or should exist. | DELETE (no replacement — falls outside TDD acceptance scope by the plan's own rule; drop when the handoff docs are archived) |
| 5 | `handoff reports restored embedded controls as current behavior` | TAUTOLOGICAL | The embedded toolbar/controls are actually restored and functional (not just that a doc says so), including surviving a reload. This is the epic's own named example ("restored embedded controls" → Playwright proves controls function). | `apps/dev-workbench/e2e/embedded-workbench.spec.ts:113-132` — real Playwright: navigates `?surface=terminal`, asserts `.dev-workbench__toolbar` is visible, clicks a real "Bottom" dock button, asserts the DOM attribute changes, then `page.reload()` and re-asserts dock position + visual-context status survive the reload. Genuinely DOM-driven, not source-regex. | None. | DELETE |
| 6 | `runtime ownership pins installers and documents attested visual context` | TAUTOLOGICAL | (a) ownership doc documents a pinned skills-CLI install version; (b) ownership doc documents the visual-context JSON field names (`schemaVersion`, `sourceContextRevision`, `routeRevision`, `requestSequence`, `source`, `screenshot`); (c) documents the screenshot path template. | (b)+(c): `tests/unit/dev-workbench-visual-context.test.mjs` + `tests/unit/dev-workbench-visual-context-telemetry.test.mjs` exercise `isStaleVisualContextResult`/`isStaleVisualContextSequence`/`isStaleVisualContextInvalidation` with real `sourceContextRevision`/`routeRevision`/`requestSequence` values against real coordinator functions in `apps/dev-workbench/src/lib/server/visual-context-coordinator.ts`; `tests/unit/dev-workbench-server.test.mjs` asserts the real resolved screenshot path equals the exact template. (a): confirmed via `grep` that no package.json dependency, bootstrap script, or manifest anywhere references the skills-CLI version — it is genuinely undocumented-in-code. | (a) has no coverage anywhere. | DELETE for (b)/(c) (real coverage exists) — (a) becomes the new red test E7.1 |
| 7 | `canonical visual fixture carries explicit replay attestation` | TAUTOLOGICAL | The canonical fixture's `requestSequence`/`sourceContextRevision`/`routeRevision` values are a meaningful, validated replay attestation — not just three numbers sitting in a JSON file. | `tests/unit/target-registry-contracts.test.mjs:27-68` — imports the *same* fixture, parses it through the real Zod schemas, calls the real `assertVisualContextResultMatchesRequest(visualRequest, visualResult)` (`assert.doesNotThrow`), **and** proves it's a real check by mutating `routeRevision`/`provider` and asserting it throws with the right message. This is strictly stronger than test 7 — it proves the attestation is enforced, not just present. | None. | DELETE |
| 8 | `sandbox processes cannot receive control-plane credentials` | TAUTOLOGICAL | Sandbox processes never receive GitHub/Cloudflare/database/host-authority/visual-grounding credentials; credentials are brokered server-side instead of embedded in things the sandbox touches. | `tests/unit/dev-workbench-server.test.mjs`: line 264 `repositoryManifestSchema.parse({cloneUrl: "https://token@..."})` throws `/embedded credentials/` (real schema-level rejection of credential-bearing clone URLs before they can reach the generated `git clone` command); line 349 asserts the real generated tmux plan's command string excludes `HOST_AUTHORITY|CLOUDFLARE|GITHUB|DATABASE|VISUAL_GROUNDING`; line 416 asserts a real serialized realtime event never contains `"accessToken"`; line 561 asserts a mocked sandbox filesystem never receives an `host-authority`-named file after a real code path runs. `tests/unit/dev-workbench-runtime-security-contract.test.mjs:8-13` similarly checks the real `vercel-sandbox.ts` has no generic env passthrough. | The doc's *positive* claim ("server-side brokers ... short-lived, least-privilege tokens") has no implementation or test anywhere — but this maps to unbuilt R4 sandbox-provisioning work (multi-repo grants, D3) with no pinned API in the plan yet. Not fabricated here; flagged for a future epic once R4 is designed. | DELETE (negative claim fully covered); broker-token positive claim explicitly out of scope, not faked |
| — | `agent-embed.test.mjs:623-653` static-mirror substring-sync block | TAUTOLOGICAL | The hand-maintained static vendor mirror (`apps/standalone-sveltekit/static/vendor/sonik-agent-ui/agent-embed.js`) stays in sync with the real `packages/agent-embed` source, proven by substring `includes()` checks. Per `tests/unit/agent-embed-bundle-parity.test.mjs`'s own header comment, this exact mechanism "silently dropped `mountVisualContextPicker`" while the substring assertions kept passing — direct proof the tautology failed at its one job. | `tests/unit/agent-embed-bundle-parity.test.mjs` (E5 red-writer's file) — **UPDATE 2026-07-22: no longer red.** `scripts/build-agent-embed-bundle.mjs` now exists and runs; it produces `apps/standalone-sveltekit/static/vendor/sonik-agent-ui/agent-embed.bundle.js` + `agent-embed.bundle.json` (with a `sha256` + `exports` manifest, including `mountVisualContextPicker`). Re-ran the suite just now: **5/5 passing** (E5.1 build runs, E5.2 export-superset parity, E5.3 bundle self-containment, E5.4 sha256 drift guard, E5.5 falsification check — legacy mirror still lacks `visualContext`, new bundle carries it). The real, generated, hash-verified artifact now exists alongside the old hand-maintained `agent-embed.js` mirror. | None — real behavioral proof is landed and green. | REPLACE-WITH `tests/unit/agent-embed-bundle-parity.test.mjs` (already landed, already green — not a future promise). At green phase: cut hosts over to `agent-embed.bundle.js`, delete the hand-maintained `agent-embed.js` mirror, delete the `agent-embed.test.mjs:623-653` substring block along with it. |

## New red test written

`tests/unit/pr61-behavioral-coverage.test.mjs` — one test, **E7.1**:

> `skills-manifest module pins the same skills-CLI version the ownership doc documents`

Reads the real pinned version out of `docs/architecture/dev-workbench-runtime-ownership-2026-07-20.md`
(`npx skills@1.5.19 add`), then imports the R2-plan-named-but-not-yet-built
`apps/dev-workbench/src/lib/server/skills-manifest.ts` expecting a `buildSkillsManifest()` export whose
`skillsCliVersion` matches the documented version. This turns test 6's one truly uncovered claim into a
real drift check instead of a prose check, using the exact artifact R2 of the TDD plan already names
(`skills-manifest.json (new)`) rather than inventing a new API surface.

**Run output (verified failing cleanly, not crashing):**

```
✖ E7.1: skills-manifest module pins the same skills-CLI version the ownership doc documents (1.7ms)
  AssertionError [ERR_ASSERTION]: not implemented: R2 skills-manifest.json generator
  (apps/dev-workbench/src/lib/server/skills-manifest.ts exporting buildSkillsManifest)
  (import of ../../apps/dev-workbench/src/lib/server/skills-manifest.ts failed:
  Cannot find module '.../apps/dev-workbench/src/lib/server/skills-manifest.ts')
ℹ tests 1 · pass 0 · fail 1
```

Command: `node --experimental-strip-types --loader ./tests/unit/ts-extension-loader.mjs --test tests/unit/pr61-behavioral-coverage.test.mjs`

## Why no more red tests were written

Every other tautological claim traced back to real, already-passing, already-rigorous behavioral coverage
(see table). Writing duplicate assertions against the same real functions in a third location would be
redundant filler — the exact failure mode E7 exists to remove, not fix. Two claims (test 4's doc-path
hygiene, test 8's "server-side broker" positive claim, and test 6's installer-pin claim) had no code seam
to test against; test 6's installer-pin claim is the one that had a concrete, plan-pinned target
(`skills-manifest.json`) and became E7.1. The other two are recorded above as legitimately out of scope
rather than papered over with a fake test.

## Zero edits to existing files (verified)

```
$ git status --short tests/unit/pr61-contract-hardening.test.mjs tests/unit/agent-embed.test.mjs package.json
```
produced no output — none of the three are modified, staged, or touched. Only new files were added:
`tests/unit/pr61-behavioral-coverage.test.mjs` and this inventory document.

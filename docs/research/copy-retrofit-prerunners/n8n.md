# Copy-Retrofit Pre-Runner: n8n

Donor repo: `/Users/danielletterio/Documents/GitHub/n8n` (read-only local clone).
Context: `docs/research/workflow-competitors-analysis-2026-07.md`, n8n section — steal
list items "EngineRequest/EngineResponse chokepoint", "Type-derived Zod
(`z.ZodType<T>`)", "Per-node typeVersion + VersionedNodeType resolution".
Method: read the actual source and the actual `package.json` license fields, not
the repo README's marketing description of its licensing.

## License bottom line (read first — it decides all three verdicts)

Every file touched below lives in `packages/workflow` or `packages/core`. Both
declare `"license": "LicenseRef-n8n-sustainable-use"` in their `package.json` —
confirmed by grep, not inferred. That resolves to n8n's **Sustainable Use
License v1.0** (`LICENSE.md`, root of repo), which is fair-code, not
permissive. Its operative limitation:

> You may use or modify the software only for your own internal business
> purposes or for non-commercial or personal use. You may distribute the
> software or provide it to others only if you do so free of charge for
> non-commercial purposes.

The repo does contain a handful of Apache-2.0/MIT packages (`@n8n/tournament`
— Apache-2.0; `@n8n/typeorm`, `@n8n/codemirror-lang*`, `@n8n/code-health`,
`@n8n/rules-engine`, testing-only tooling — MIT), but none of them are in the
dependency closure of any of the three target items. All three targets are
Sustainable-Use-licensed, no exceptions.

Sonik/Amplify is a commercial product we sell and host. Vendoring
Sustainable-Use-licensed source into it — even adapted — is not "internal
business purposes"; it's redistribution inside a paid product, which the
license does not permit free of charge or otherwise. **Verdict for all three
items: no verbatim copying, no vendored file, no drift-watch pointer at
upstream file contents.** Treat n8n source as a read-only spec to learn from
and reimplement in our own words/types, the same way you'd treat a paper.

## Item 1 — EngineRequest/EngineResponse protocol

**Files:**
- `packages/workflow/src/interfaces.ts:2298-2354` — the actual types
  (`EngineRequest<T>`, `EngineAction<T>`, `ExecuteNodeAction<T>`,
  `ExecuteNodeResult<T>`, `EngineResult<T>`, `EngineResponse<T>`) plus the
  `Node.execute()` signature at `:2372-2375` that returns
  `Promise<INodeExecutionData[][] | EngineRequest>`.
- `packages/core/src/execution-engine/requests-response.ts` (293 lines,
  self-contained) — `handleRequest()`, `prepareRequestedNodesForExecution()`,
  `prepareRequestingNodeForResuming()`, `isEngineRequest()`,
  `makeEngineResponse()`.
- Dispatch point: `packages/core/src/execution-engine/workflow-execute.ts` —
  not one call site but ~10, woven through `runNode()`
  (`isEngineRequest(data)` at `:1118`), `handleEngineRequest()`
  (`:1530-1584`), and the resume loop (`:1790-1791`, `:1885-1886`).

**Dependency fan-in:** `requests-response.ts` itself is shallow — it imports
only types from `n8n-workflow` plus `Container`/`ErrorReporter` from
`@n8n/di` and a local error-reporter module. But it is *meaningless* on its
own: it operates on `IExecuteData`, `IRunData`, `runIndex`, `parentOutputData`
— n8n's execution bookkeeping types — and its only caller is
`workflow-execute.ts`, a 2,899-line file that also imports
`node-execution-context/` (14 files, ~7,200 lines combined across
`execution-engine/`), `partial-execution-utils`, `routing-node`,
`triggers-and-pollers`, and `node-execute-functions`. The 293-line handler is
extractable as *reading material*; the chokepoint behavior is not
extractable as code because it's load-bearing on n8n's entire run-data model,
which we don't have and don't want (we're not building `IExecuteData`/
`pairedItem` bookkeeping).

**Approx LOC of the core:** types ~60 lines; handler 293 lines; dispatch glue
touches ~10 sites inside a 2,899-line interpreter file. Call it ~350 lines of
directly relevant code sitting inside a ~10,000-line closure once you count
what it's welded to.

**Recommendation: reimplement-from-spec.** Read `requests-response.ts` and the
five dispatch call sites in `workflow-execute.ts` as a design spec for "one
chokepoint where an agent node's tool calls get resolved to real
credential-backed execution and land in the audit trail," then write our own
version against our own interpreter and run-state model. Nothing here is
worth vendoring even license-aside — the 293-line handler's value is entirely
in the *shape* of the idea (request → engine executes with real credentials →
response → resume), not in n8n's specific `runData`/`parentOutputData`/
`pairedItem` plumbing, which is n8n-only bookkeeping we don't have.

**Adaptation notes for our stack:** Map `EngineRequest.actions[]` to our
capability-call queue and `EngineResponse.actionResponses[]` to the receipt
set gating resume — that's the whole steal. Our chokepoint is wherever the
controller (Phase 3a-2 cutover) hands agent-requested calls to the capability
registry; per-call gating and kill-switch attach there, same as n8n's
`handleEngineRequest`. Skip: `ITaskMetadata`, `pairedItem`, `sourceOverwrite`
— those exist to make n8n's canvas UI draw correct lineage lines and have no
Sonik analog.

**Drift-watch if vendored:** N/A — not vendoring, so nothing to watch for
upstream drift. If this changes, the files to pin would be
`packages/workflow/src/interfaces.ts` (EngineRequest/EngineResponse region)
and `packages/core/src/execution-engine/requests-response.ts`.

## Item 2 — Type-derived Zod pattern (`z.ZodType<T>`)

**Files:**
- `packages/workflow/src/schemas.ts` — 500 lines total, 40 exported schemas,
  all shaped `export const XSchema: z.ZodType<X> = z.object({...})`. Example:
  `INodeSchema: z.ZodType<INode> = z.object({...})` at `:471-486`.
- `packages/workflow/src/interfaces.ts` — supplies the `INode` etc. types via
  `import type { ... } from './interfaces'` at the top of `schemas.ts`
  (type-only import; interfaces.ts itself is 4,078 lines but nothing from it
  is pulled in at runtime).

**Dependency fan-in:** as shallow as it gets — `schemas.ts` imports `zod`
(external, already in our stack) and one `import type` block from a sibling
file. No other runtime dependency, no other file touches it.

**Approx LOC of the core:** the "core" isn't code, it's a naming convention:
annotate every Zod schema for a shared type with `z.ZodType<T>` so a
TypeScript-level mismatch between the interface and the schema is a compile
error, not a runtime surprise discovered later. Zero lines to copy — one
convention to adopt.

**Recommendation: reimplement-from-spec**, trivially — this is a pattern, not
a redistributable artifact, and there is no vendor-worth unit here even
before the license question. Apply `z.ZodType<OurInterface>` directly to our
own tool-contract and workflow-document schemas.

**Adaptation notes for our stack:** We're already Zod-first, so this is a
five-minute lint-level change: wherever a schema is meant to validate a named
TS interface, type-annotate the `const` as `z.ZodType<ThatInterface>`. No new
dependency, no new file, no structural change — just enforce the annotation
in `tool-contracts` and wherever workflow-document schemas live.

**Drift-watch if vendored:** N/A — not vendoring.

## Item 3 — VersionedNodeType registry

**Files:**
- `packages/workflow/src/versioned-node-type.ts` — 30 lines, the entire
  implementation: `class VersionedNodeType implements IVersionedNodeType`
  wrapping a `{ [version: number]: INodeType }` map plus `currentVersion`
  resolution and `getNodeType(version?)`.
- `packages/workflow/src/interfaces.ts:2389-2396` — the `IVersionedNodeType`
  interface it implements (8 lines).

**Dependency fan-in:** imports exactly three types from `./interfaces` and
nothing else. Zero transitive closure beyond that one file. (Real-world usage
fans out wide — 156 hits for `VersionedNodeType` across
`packages/nodes-base/nodes/*/*.node.ts` — but that's call sites registering
node versions, not a dependency of the registry class itself.)

**Approx LOC of the core:** ~40 lines combined (interface + class). This is a
lookup table with a default-version fallback.

**Recommendation: reimplement-from-spec.** At 40 lines, transcribing the idea
from the one-paragraph description is faster and cleaner than any
vendor-and-track workflow would be, license question aside.

**Adaptation notes for our stack:** This is exactly our capability-registry
version axis (steal list already names the destination). Shape:
`{ [version: number]: CapabilityImpl }` + `currentVersion`/`defaultVersion`
resolution, same as D015 proof-tier rows expect. Pairs naturally with Item 2
— each version's implementation gets its own `z.ZodType<T>`-annotated
contract schema, so a breaking node/capability change is a new registry entry
with its own validated shape, not a mutation of an existing one.

**Drift-watch if vendored:** N/A — not vendoring.

## Per-item verdicts

1. **EngineRequest/EngineResponse chokepoint** — reimplement-from-spec. Steal
   the idea (one chokepoint, real credential resolution, audit trail before
   resume), not the code; the 293-line handler is inseparable from n8n's
   `IExecuteData`/`runData` bookkeeping we don't have, and SUL forbids
   vendoring into a sold product regardless.
2. **Type-derived Zod (`z.ZodType<T>`)** — reimplement-from-spec, trivially;
   it's a one-line-per-schema naming convention on a stack we already run,
   nothing to vendor even without the license constraint.
3. **VersionedNodeType registry** — reimplement-from-spec; 40 lines, faster
   to write from the spec than to vendor-and-track, and it's the direct
   ancestor of our own capability-registry version axis.

**License bottom line:** every targeted file sits in `packages/workflow` or
`packages/core`, both declared `LicenseRef-n8n-sustainable-use` (Sustainable
Use License v1.0) in their `package.json` — confirmed by direct grep, not
assumed from the repo's "fair-code" framing. No Apache/MIT exception applies
to any of the three items. Sonik is a commercial, sold product, so SUL's
internal-use / free-non-commercial-distribution-only limitation rules out
vendoring any of this source outright — all three items are port-the-pattern
or reimplement-from-spec, never vendor, independent of how small the file is.

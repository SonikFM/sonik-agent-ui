# Copy-retrofit prerunner: Flowise (join-barrier scheduler) + Composio (meta-tool API shape)

Date: 2026-07-12 · Method: read-only local-repo analysis, no code copied. Companion to
`docs/research/workflow-competitors-analysis-2026-07.md` ("Second wave" Flowise entry;
Composio priority-lane entry). This doc is the per-item due-diligence pass the copy-retrofit
skill requires before any manifest/copy step: exact files, LOC, license, dependency fan-in,
and a vendor/port/reimplement call per item.

Scope note up front: all four items below are **reimplement, not lift-and-adapt**. Flowise's
scheduler is a lift-shaped candidate (same language, same problem, permissive license) but is
entangled with Flowise's `IReactFlowNode`/`ChatFlow` runtime and would need a full rewrite
against Sonik's node/edge model regardless of license. Composio's three items are architecture
patterns and a client-side type contract, not portable server code — Composio's actual
meta-tool discovery logic (`COMPOSIO_SEARCH_TOOLS` etc.) executes server-side in their cloud
and is not present in any local repo to copy from.

---

## Donor A: Flowise — IWaitingNode join-barrier scheduler

**Repo:** `/Users/danielletterio/Documents/GitHub/flowise`, commit `f05af6cb` (2026-05-12),
file `packages/server/src/utils/buildAgentflow.ts` (2,471 lines total; scheduler is a ~320-line
slice).

**License:** Apache 2.0 (root `LICENSE.md`), **except** the `packages/server/src/enterprise/`
directory and files with an explicit commercial-license header (e.g. `IdentityManager.ts`),
which carry a separate Commercial License. `buildAgentflow.ts` is outside `enterprise/` and
carries no commercial header — it is Apache 2.0. Apache 2.0 permits copy/modify/relicense with
attribution + a copy of the license; no copyleft obligation on the consuming codebase (unlike
GPL/AGPL). Safe to vendor.

### Minimal file set

One file is genuinely self-contained for the scheduler concept, but it is not standalone code —
it's interleaved with ~2,150 lines of Flowise-specific node execution, streaming, and DB
persistence in the same file. The join-barrier logic proper:

| Symbol | Lines | Role |
| --- | --- | --- |
| `IWaitingNode` interface | `buildAgentflow.ts:67-73` | Per-node join-barrier state: received inputs (Map), expected inputs (Set), conditional flag, conditional groups (Map) |
| `INodeQueue` interface | `buildAgentflow.ts:75-79` | Ready-to-run queue entry (nodeId + combined data + raw inputs) |
| `getNodeInputConnections` | `buildAgentflow.ts:~650-667` | Sorts incoming edges by `sourceHandle` index for deterministic multi-input ordering |
| `setupNodeDependencies` | `buildAgentflow.ts:672-714` | First-sight lazy init: walks incoming edges, splits each source into "required" (`expectedInputs`) vs. "conditional" (`conditionalGroups`, keyed by the upstream condition/humanInput node id) |
| `findConditionParent` | `buildAgentflow.ts:719-765` | Walks the graph upward from a source node to find the nearest ancestor that is a `conditionAgentflow` / `conditionAgentAgentflow` / `humanInputAgentflow` node — this is how a fan-in barrier knows an input is "one-of-N branches" rather than "all-required" |
| `hasReceivedRequiredInputs` | `buildAgentflow.ts:770-789` | Barrier test: every `expectedInputs` entry present AND at least one input per `conditionalGroups` entry |
| `processNodeOutputs` (join-relevant slice) | `buildAgentflow.ts:847-916` | Per-child-node: lazily creates the `IWaitingNode` on first sight, records the arriving edge's result into `receivedInputs`, tests the barrier, and only then dequeues the node into `nodeExecutionQueue` with combined inputs |
| `combineNodeInputs` | `buildAgentflow.ts:971-1020ish` | Merges multiple `receivedInputs` entries into one input object (single input passes through as-is; multiple inputs are merged by sorted source-node-id into `{json, text, binary}`) |

**Dependency fan-in:** heavy. The join-barrier functions themselves are dependency-light (pure
functions over plain objects/Maps/Sets), but they're called from inside `processNodeOutputs`,
which is called from the main `buildAgentflow` execution loop that also touches: `DataSource`
(TypeORM), `ChatFlow`/`Execution`/`ChatMessage` entities, `CachePool`, `Telemetry`,
`UsageCacheManager`, `AnalyticHandler`, SSE streaming (`IServerSideEventStreamer`), and
Flowise's own `IReactFlowNode`/`IReactFlowEdge`/`INodeDirectedGraph` types. None of that is
needed for the scheduling *algorithm* — it's needed for Flowise's specific execution loop that
wraps it.

**LOC to actually port:** ~200 lines if you take just the seven symbols above and strip
Flowise-specific logging (`logger.debug` calls with emoji prefixes, ~40 lines) and the
loop-node special case at the end of `processNodeOutputs` (lines 918-946, which is Flowise's
`loopAgentflow` node type, not part of the join-barrier itself).

### Recommendation: **reimplement (algorithm port, not code copy)**

The algorithm is worth stealing — it's a clean, minimal join-barrier: lazy per-node waiting-set
construction on first edge arrival, a required/conditional split determined by walking up to
the nearest branch-point ancestor, and a barrier test that's O(edges into that node). But the
data types (`IReactFlowNode`, `IReactFlowEdge`, `graph: Record<string, string[]>`) are
Flowise's own adjacency representation, not Sonik's. A direct copy would need adapters at every
touch point anyway, and Apache 2.0 permits copying, but the actual ROI is in the *shape* of the
four functions, not the bytes.

**Sonik equivalent:** the workflow interpreter (per the competitor doc, "one generic
interpreter" is already our committed shape). Fan-in convergence for parallel branches is a gap
worth closing — this is the concrete algorithm to adapt when that lands. Suggested landing
spot: wherever the interpreter resolves `(node) -> ready to execute`, i.e. the executor-queue
step analogous to Flowise's `nodeExecutionQueue`.

**Adaptation notes:**
- Replace `IReactFlowNode`/`IReactFlowEdge` walks with whatever Sonik's Zod-validated workflow
  document uses for adjacency (per the competitor doc, n8n's `IConnections` and our own
  document shape are the closer reference points than Flowise's React-Flow-derived nodes/edges).
- The conditional-group logic (`findConditionParent` walking up to the nearest branch node) is
  Flowise's way of saying "this input is optional-one-of" vs. n8n/our own explicit branch
  metadata — if Sonik's document format already tags edges with their originating branch, this
  whole upward-walk can be replaced with a direct lookup, which is strictly better (Flowise pays
  an O(depth) walk per new node; a branch-tagged edge is O(1)).
- Drop the emoji-prefixed `logger.debug` calls; replace with structured tracing consistent with
  Sonik's existing interpreter instrumentation.
- `combineNodeInputs`'s merge-by-sorted-source-id behavior is a reasonable default for
  determinism but should be revisited against whatever Sonik's node input contract already
  promises multi-input consumers (may already be handled by Zod schema shape on the consuming
  node).

**Drift-watch:** none needed if this becomes a from-scratch reimplementation (no upstream bytes
retained). If any literal code is retained (e.g. the `hasReceivedRequiredInputs` barrier test
verbatim, since it's genuinely donor-agnostic boolean logic), tag it in a manifest per the
copy-retrofit skill's `allowedLocalModifications` field and note the upstream commit
(`f05af6cb`) so a future Flowise fix to fan-in edge cases can be diffed against.

---

## Donor B: Composio — three items, all API-shape reimplements

**Repo:** local checkout lives at `/Users/danielletterio/Documents/GitHub/credentials/composio`
(not `.../GitHub/composio` — path correction for whoever runs this next), commit `820abb90`
(2026-07-06).

**License:** root `LICENSE` is **MIT** (Copyright 2025 Sampark Inc. — Composio's legal entity).
Permissive, no restriction on reimplementing API shapes or porting patterns. Note:
`ts/packages/core/package.json` declares `"license": "ISC"` in its own package metadata field —
this is very likely a stale/default value from `npm init` and not authoritative; the repo-root
MIT `LICENSE` file governs. Either way both MIT and ISC are permissive with no copyleft
concern. No blocker either reading.

Critical scope note: none of the three items below has server-side logic to copy. The actual
`COMPOSIO_SEARCH_TOOLS` / `COMPOSIO_GET_TOOL_SCHEMAS` / `COMPOSIO_MULTI_EXECUTE_TOOL` discovery
and ranking logic runs in Composio's hosted backend (`backend.composio.dev`) and is not in this
repo — confirmed by grep across `ts/packages/core/src`: the only local references are Zod
*response schemas* (what the wire payload looks like) and thin client-side dispatch/typing.
There is no algorithm to port for item (1); it's a wire-contract shape to mirror in a new Sonik
endpoint.

### Item 1: Meta-tool discovery API shape (search / schemas / multi-execute)

**Files (all type/schema, no business logic):**
- `ts/packages/core/src/types/toolRouter.types.ts` — response schemas, notably
  `ToolRouterSessionSearchResponseSchema` (`toolRouter.types.ts:524-533`) and its constituents:
  `ToolRouterSessionSearchResultSchema` (~line 465-485, includes `useCase`,
  `primaryToolSlugs`/`relatedToolSlugs`, `executionGuidance`, `knownPitfalls`,
  `recommendedPlanSteps` — this is the "execution plan" the competitor doc references),
  `ToolRouterSessionSearchToolSchemaSchema` (`:505-513`, per-tool input/output schema plus a
  lazy `schemaRef` pointer back to `COMPOSIO_GET_TOOL_SCHEMAS` for tools not fully expanded
  inline), `ToolRouterSessionSearchToolkitConnectionStatusSchema` (`:515-522`, whether the
  caller already has a usable credential per toolkit — folded into the *same* search response
  rather than a separate round trip).
- `ts/packages/core/src/models/ToolRouterSession.ts` (not fully read this pass, but grep
  confirms lines ~77, 185-207, 686-762 own the client-side `COMPOSIO_MULTI_EXECUTE_TOOL`
  dispatch — splitting local/custom tools from remote-executed ones before batching).
- `ts/packages/core/src/models/ToolRouter.ts` (406 lines, read in full) — session
  creation/attach/delete only; not discovery logic. Relevant here because
  `ToolRouterCreateSessionConfig` (`ToolRouter.ts:250-253`) shows a `DIRECT_TOOLS` session
  preset that disables search/multi-execute server-side (`search: { enable: false }`), i.e.
  discovery is an opt-out feature per session, not hardwired.
- Docs (prose, not code, but useful for the UX contract):
  `docs/content/toolkits/meta-tools/index.mdx` (table of all 6 meta-tools + the stated ordering
  contract: search → manage_connections → multi_execute, workbench/bash only for
  large-response overflow) and `docs/content/toolkits/meta-tools/search_tools.mdx` (thin
  wrapper around an auto-generated component; the real per-tool docs come from
  `docs/public/data/meta-tools.json`, not inspected this pass).

**LOC:** the discoverable *shape* is ~90 lines of Zod schema (`toolRouter.types.ts:460-545`
region) plus the docs table. There is no server algorithm file to count — confirmed absent from
this repo.

**Recommendation: reimplement as a new Sonik endpoint, not a port.**

**Sonik equivalent:** per the competitor doc's steal-list mapping, this lands in "Marketplace
R3 discovery + agent-facing capability search" and "Controller runtime, Phase 6" for the batch
form. Concretely, two new capabilities against the 113-command booking-service SDK registry
(per Dan's 2026-07-12 correction in the competitor doc — capability registration should be
*generated* from `bookingOperationManifest.contract.ts`, not hand-written, so this discovery
layer should query that generated registry, not a hand-maintained catalog):
- A `search_capabilities` (or similarly named) meta-command returning: matched capability
  slugs, a short per-match execution-guidance string, and — this is the part worth stealing
  precisely — connection/credential-readiness status folded into the *same* response so the
  agent doesn't need a second round trip before it knows whether a write will need approval
  setup first.
- A `multi_execute` batch command, capped (Composio caps at 50 parallel) so a single agent turn
  can fire several read-only capability calls without N round trips. Given Sonik's host-signed
  approval doctrine, this cap must apply per-item *read* gating identically to single-call
  gating — Composio's multi-execute has no such distinction to steal from (their trust boundary
  is absent per the competitor doc headline), so the gating logic here is net-new Sonik design,
  not adapted.

**Adaptation notes:**
- Do not adopt Composio's flat `TOOLKIT_ACTION` slug namespace; Sonik already has the
  113-command/15-family registry as the denominator.
- Do adopt the "fold connection-readiness into the search response" ergonomic — it measurably
  reduces round trips and is orthogonal to Composio's missing-trust-boundary problem.
- The `schemaRef` lazy-expansion pattern (`ToolRouterSessionSearchToolSchemasSchemaRefSchema`,
  `toolRouter.types.ts:499-503`) — returning a pointer to `GET_TOOL_SCHEMAS` instead of the full
  schema inline when the search result set is large — is a reasonable context-budget technique
  worth mirroring once the registry search result count grows past what's comfortable inline.
- Composio explicitly disclaims schema stability ("We do not guarantee backward compatibility
  for parameter names or response shapes" — `meta-tools/index.mdx:26-28`). Sonik's version is a
  proper contract-generated surface and should NOT carry that disclaimer; this is a place where
  we should be strictly better, not just parity.

**Drift-watch:** N/A — no upstream bytes retained, this is a from-spec reimplementation. Watch
Composio's public docs (`docs/content/toolkits/meta-tools/`) for meta-tool count/shape changes
if this becomes a recurring "match their catalog UX" commitment; otherwise no ongoing coupling.

### Item 2: Date-stamp version + `'latest'` resolution ergonomics

**File:** `ts/packages/core/src/utils/toolkitVersion.ts` — 45 lines, read in full, the entire
file.

**LOC:** 45 lines total; the two exported functions are ~20 lines combined:
- `normalizeToolkitSlug` (`:18`) — one-line lowercase canonicalization, called on both the
  write side (env var / user config ingestion) and read side (lookup) so a version-map key can
  never silently miss a pin due to casing drift. Comment at `:6-11` explicitly flags this as the
  single source of truth for that invariant, and notes it's kept in lockstep with the Python
  SDK's `normalize_toolkit_slug` (cross-language parity discipline worth noting even though
  Sonik has no Python SDK equivalent surface here).
- `getToolkitVersion` (`:27-45`) — three-way resolution: string `toolkitVersions` param means
  "one version for everything," object param means per-toolkit lookup via the normalized slug
  with `?? 'latest'` fallback on miss, and no param at all also falls through to `'latest'`.

**Recommendation: reimplement (trivial, ~20-30 line utility; not worth a vendor/port
distinction).**

**Sonik equivalent:** capability-registry version resolution. The competitor doc already flags
n8n's `typeVersion` + `VersionedNodeType` registry as the primary steal for the version *axis*
architecture; this Composio utility is a smaller, complementary piece — specifically the
override-precedence and case-normalization ergonomics for *resolving which version an agent
gets when it doesn't pin one explicitly*. Lands wherever Sonik resolves
`(capability, requestedVersion?) -> concrete implementation` against the generated command
registry.

**Adaptation notes:**
- The normalize-on-both-sides discipline (`normalizeToolkitSlug` used identically at write and
  read time) is the one piece of real engineering judgment in this file and is worth copying
  as a *pattern*, not code — i.e. write Sonik's own single-source-of-truth normalizer and
  route every registry key write/read through it, exactly as this file's own doc comment
  argues for.
- Composio's `'latest'` float-forever default is explicitly what the competitor doc calls out
  as weaker than immutable versioning ("date-stamp versions... with `'latest'` floats" — no
  pinning safety net). Sonik's registry should default to pinned/immutable per D015-style
  proof-tier doctrine, not float-by-default; if a `'latest'`-style convenience alias is offered
  at all, it should be an explicit opt-in, inverted from Composio's default.

**Drift-watch:** none — reimplementation, not a copy.

### Item 3: SessionContext re-entrancy pattern (`ctx.execute` / `ctx.proxyExecute`)

**File:** `ts/packages/core/src/types/customTool.types.ts` — 261 lines, read in full.

**LOC:** the pattern itself is the `SessionContext` interface, `customTool.types.ts:28-46` (19
lines) plus its consumption point, `CustomToolExecuteFn`, `:56-59` (4 lines). Everything else
in the file (~200 lines) is custom-tool/toolkit registration, slug-prefix validation
(`CustomToolSlugSchema`, `:66-79`, rejecting `LOCAL_`/`COMPOSIO_`-prefixed slugs since those are
reserved namespaces), and the routing-map types (`CustomToolsMap`, `:214-227`) used to resolve
a custom tool's final backend-assigned slug back to its local handler — not part of the
re-entrancy pattern proper.

**Recommendation: reimplement (small interface + one composition rule to reproduce; no code
worth lifting).**

**Sonik equivalent:** this is the shape a Sonik-side "custom tool" or agent-authored capability
execute function would receive if/when Sonik supports agent-defined tools that need to call
*other* registered capabilities from inside their own execution — i.e. the re-entrancy
chokepoint. Directly comparable to n8n's `EngineRequest`/`EngineResponse` chokepoint already on
the steal list (competitor doc line ~124) for the *general* agent-tool-call gating point;
Composio's version is narrower (custom-tool-authoring re-entrancy specifically) but the shape
is the same idea: **the tool doesn't get a raw HTTP client, it gets a bound `ctx.execute`/
`ctx.proxyExecute` that routes back through the same session's auth/gating**, so a custom tool
cannot bypass the platform's own execution/audit path even though it's user-authored code.

Concretely for Sonik: `SessionContext.execute(toolSlug, args)` returning the same shape as a
top-level session execute call (`customTool.types.ts:31-35`, explicit doc comment: "Returns the
same shape as session.execute()") is the piece worth mirroring exactly — same response
contract for direct and re-entrant calls means no special-casing downstream consumers of
either path. `proxyExecute` (`:36-37`) — proxying a raw API call through the session's resolved
credential without ever handing the credential itself to the custom tool — is the sharper of
the two and maps directly onto Sonik's credential-boundary doctrine (agent code gets a capability,
never a secret).

**Adaptation notes:**
- The cooperative-cancellation detail (`signal?: AbortSignal` at `:38-45`, forwarded from the
  outer `session.execute(..., { signal })` call so long-running custom-tool code can abort
  mid-flight) is a small but real detail worth carrying into Sonik's version — without it, a
  custom-tool re-entrant call becomes an un-cancelable sub-execution once started.
- The reserved-slug-prefix validation (`CustomToolSlugSchema`, rejecting `LOCAL_`/`COMPOSIO_`
  prefixes so user-authored tool slugs can never collide with the platform's own namespace) is
  a one-line pattern worth replicating with Sonik's own reserved prefix(es), if/when third-party
  or agent-authored capabilities get slugs in the same namespace as first-party ones.
- Unlike Composio (per the competitor doc headline: no execution trust, no read/write
  distinction anywhere in their stack), any Sonik `ctx.execute`/`ctx.proxyExecute` reentrant
  path MUST route through the same host-signed-approval gate as a top-level call — this is
  precisely the seam the competitor doc identifies as Composio's structural gap ("their
  unguarded seam is exactly where our approval boundary sits"). Do not adopt Composio's
  approval-free default for the re-entrant path; that would reproduce their gap inside our own
  moat feature.

**Drift-watch:** none — reimplementation, not a copy.

---

## Verdicts summary

| Item | Donor | License | LOC (relevant slice) | Verdict | Sonik landing |
| --- | --- | --- | --- | --- | --- |
| Join-barrier scheduler | Flowise `buildAgentflow.ts` | Apache 2.0 (clean, outside `enterprise/`) | ~200 (of 2,471-line file) | Reimplement — algorithm port, adapt to Sonik's document/edge model | Interpreter fan-in/executor-queue step |
| Meta-tool discovery API shape | Composio `toolRouter.types.ts` + `ToolRouterSession.ts` + docs | MIT | ~90 (schema only; no server code exists locally) | Reimplement — new endpoint against generated 113-command registry | Marketplace R3 discovery, Controller runtime Phase 6 |
| Date-stamp version / `'latest'` resolution | Composio `toolkitVersion.ts` | MIT | 45 (whole file) | Reimplement — trivial utility, adopt normalize-both-sides pattern, invert default to pinned | Capability-registry version resolution |
| SessionContext re-entrancy | Composio `customTool.types.ts` | MIT | ~25 (interface + fn type) | Reimplement — small interface, must add approval gating Composio lacks | Agent-authored/custom-tool execution chokepoint (pairs with n8n EngineRequest/EngineResponse steal) |

**License bottom line:** both donors are clear. Flowise is Apache 2.0 outside its
`enterprise/` directory (the scheduler file is unaffected). Composio is MIT at the repo root;
one `package.json`'s stray `"license": "ISC"` field is almost certainly an unedited npm-init
default and doesn't override the root license, and is permissive either way. No legal blocker
to reading, learning from, or reimplementing any of the four items. None of the four items is a
same-language direct-lift candidate that would justify running the copy-retrofit skill's
manifest/copy/drift-check pipeline — Flowise's file is real code but entangled with a foreign
runtime; all three Composio items are contracts/patterns with no local server implementation to
copy in the first place. Treat all four as design references for net-new Sonik code, cite the
donor commit SHAs above in any PR that implements them, and do not paste donor identifiers
(Composio's `TOOLKIT_ACTION`/`COMPOSIO_*` slugs, Flowise's `IReactFlowNode`) into Sonik's core
contracts — use neutral names per the copy-retrofit skill's vocabulary-quarantine rule.

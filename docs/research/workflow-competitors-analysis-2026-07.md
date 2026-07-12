# Workflow Competitor Analysis — Composio, activepieces, Dify, n8n (July 2026)

Date: 2026-07-12 · Method: read-only local-repo analysis, four parallel lanes, every
load-bearing claim carries a repo-relative file path (full evidence in lane reports).
Lens: Sonik agent marketplace — workflows as Zod-validated JSON documents, one generic
interpreter, versioned capability registry with per-call gating and kill-switch,
host-signed approval for writes, semantic receipts, immutable packageVersionId.
Scope: workflows + integration factory. Credentials/auth vault: separate lane, excluded.

## Headline

All four converge on our core thesis — workflow/graph as data, one generic
interpreter, versioned node/tool registries. **None of the four has a real trust
boundary.** The strongest approval primitive in the set is a bearer-style resume
URL or a client-side advisory callback; host-signed approval, unrepresentable
model-supplied approval, and semantic receipts exist nowhere. That is the moat.

## Composio — the direct competitor (priority lane)

Shape: hosted catalog of ~855 pre-authenticated toolkits; SDK is a client to their
cloud (`backend.composio.dev`); tools described in raw JSON Schema server-side;
flat `TOOLKIT_ACTION` slugs; per-toolkit date-stamp versions (`20250909_00`) with
`'latest'` floats.

- **No workflow layer at all.** Multi-step = triggers (event-in, your-code-out) or
  an agent writing imperative code in their Remote Workbench sandbox. No flow
  document, no state machine, no resume.
- **No execution trust.** Everything executes in their cloud against their stored
  credential. The only approval primitive is the experimental Eve provider's
  client-side, opt-in `needsApproval` callback; the mainstream OpenAI provider
  hardcodes `require_approval: 'never'`. A model-supplied approval is fully
  representable and trusted. No receipts, no read/write distinction, no kill-switch.
- **Closed catalog.** First-party curated; "Request Tools" button; no third-party
  publishing, no immutability guarantees, no install modes.
- **Their moat:** the catalog cold-start + the **meta-tool discovery pattern** —
  agents get ~6 meta-tools (`COMPOSIO_SEARCH_TOOLS` semantic discovery returning an
  execution plan, `GET_TOOL_SCHEMAS`, `MULTI_EXECUTE_TOOL` ≤50-parallel) instead of
  hundreds of tool definitions. Context stays small at 855-toolkit scale.
- **Competitive posture:** head-on on integration factory / agent tool-availability;
  our defensible wedge is governed workflows + host-signed approval + receipts —
  categories they structurally lack. A Sonik host could even consume Composio as
  one capability source under our governance layer; their unguarded seam is
  exactly where our approval boundary sits (between agent execute and
  credential-backed API call).

## n8n — the mature workflow-as-JSON reference

- `IWorkflowBase`/`INode`/`IConnections` validated with **type-derived Zod**
  (`z.ZodType<INode>`) — TS interface as source of truth, Zod in lockstep. Steal.
- Two-axis versioning: whole-document workflow history + per-node `typeVersion`
  resolved via `VersionedNodeType` registry (`{version: implClass}`) — breaking
  node changes without migrating existing workflows. Directly applicable to our
  capability registry.
- One interpreter (`WorkflowExecute`, 2.9k lines) with persisted run-blob resume
  (not event-sourced); Wait node = `putExecutionToWait(waitTill)` — the entire
  pause mechanism is data.
- **`EngineRequest`/`EngineResponse`**: an agent node's opaque reasoning loop asks
  the ENGINE to run tools on its behalf — every call lands in run data with real
  credential resolution and audit. One chokepoint for per-call gating. Steal.
- HITL: signed resume URLs (HMAC bearer) + per-integration sendAndWait — no
  structured "who approved" payload, no receipts. Weaker than ours.
- Community nodes: npm install + opt-in checksum/vetted-registry — allowlist, not
  immutable content-addressing.

## activepieces — closest cousin on versioning doctrine

- Flows are recursive Zod trees (linked `nextAction` pointers, not flat
  nodes/edges) with `schemaVersion: '22'` + stepwise migrations; **DRAFT/LOCKED**
  versioning = our immutable-published/mutable-draft doctrine, shipped.
- One interpreter with a per-node-kind executor lookup table; process-per-job
  sandbox (ADR 0003: worker IS the sandbox; blast radius = one run); code piece
  in isolated-vm with no `require`.
- **Waitpoints**: one durable pause/resume primitive (`DELAY|WEBHOOK`, resumeUrl)
  under every delay/approval feature. ADR 0005: email scanners prefetched GET
  resume links and silently consumed approvals — fixed with confirm-page-then-POST.
  Cautionary tale for any link-borne approval; authorization is unguessable-ID
  possession, not signing.
- **Steal directly:** action-level `audience: 'human'|'ai'|'both'` +
  `aiMetadata.idempotent` — per-capability declaration of agent-invocability and
  retry safety. Also `minimum/maximumSupportedRelease` host-compat gating and
  platform-scoped lazy tarball distribution (ADR 0002).
- Publishing: monorepo PR review / bare npm — no conformance gate. Softer than
  our curated-review + proof-tier model (D015).

## Dify — the interpreter-extraction datapoint

- Extracted their entire graph engine into a separate versioned pip package
  (`graphon==0.6.0`) — strongest external validation of one-interpreter; visible
  version-skew tax (compat shims in `workflow_entry.py`) is the warning label.
- **Layer/middleware stack** on one engine instance (`ExecutionLimitsLayer`,
  `LLMQuotaLayer`, pause-persistence, observability, composed via `.layer()`) —
  architecturally our per-call gating + kill-switch as ordered middleware. Steal.
- Three-tier DSL version import gate (ok / warn / pending-block) — simpler than
  semver ranges; pairs well with immutable versions. Steal.
- Two-phase node validation (loose structural parse → resolve type → strict
  re-validate against the concrete node schema) — the right shape once node kinds
  are plugin-contributed. Steal.
- Plugins run in a separate daemon (Go binary, own DB, resource/permission
  manifest) — permission model is category-level on/off, coarser than per-call;
  sandbox internals unverifiable from this repo; immutability-on-republish not
  found (unverified). Marketplace keeps `latest_version` as a pointer distinct
  from version records, plus `deprecated_reason`/`alternative_plugin_id`.
- HITL: first-class human-input node with typed forms, timeouts, and
  **multi-surface recipient authorization** (which caller-identity class may
  unblock which paused form) — the best HITL in the set, still allowlist-based,
  no signing, no receipts.

## Convergent industry patterns (all four)

1. Workflow/graph as data + one generic interpreter — universal. Our thesis holds
   at 280–855-integration scale.
2. Versioned registries resolving `(type, version) → implementation` — universal.
3. Durable pause-as-data for HITL — universal; authorization is bearer/allowlist
   everywhere. **Nobody signs approvals; nobody issues receipts.**
4. Publishing trust is PR review, checksums, or first-party curation — nobody has
   immutable content-addressed third-party packages with install modes.

## Steal list mapped to our lanes

| Steal | From | Lands in |
| --- | --- | --- |
| Meta-tool discovery (search/plan/execute over catalog; never dump the namespace into context) | Composio | Marketplace R3 discovery + agent-facing capability search |
| MULTI_EXECUTE batching | Composio | Controller runtime, Phase 6 |
| EngineRequest/EngineResponse chokepoint for agent tool calls | n8n | Controller cutover (Phase 3a-2) / capability gate placement |
| Type-derived Zod (`z.ZodType<T>`) | n8n | tool-contracts hygiene |
| Per-node typeVersion + VersionedNodeType resolution | n8n | capability-registry version axis |
| `audience: human/ai/both` + `idempotent` on capabilities | activepieces | capability descriptor fields |
| One waitpoint primitive under all pauses; confirm-then-POST for link-borne approvals | activepieces | approval endpoint hardening |
| Layer/middleware gating stack | Dify | pinning + kill-switch enforcement shape |
| Three-tier DSL version import gate | Dify | manifest upgrade path (`upgradeMarketplaceManifest`) |
| Two-phase node validation | Dify | workflow schema once node kinds are package-contributed |
| Multi-surface resume authorization | Dify | Review surface / approval channels under our signing |
| `latest` as pointer + deprecation-with-alternative | Dify | package discovery fields |

## Ratified read

Compete with Composio on the integration factory (their catalog + discovery UX is
the bar); differentiate on governed workflows, host-signed approval, receipts, and
immutable third-party packaging — four categories in which all four competitors
are structurally absent, not merely behind.

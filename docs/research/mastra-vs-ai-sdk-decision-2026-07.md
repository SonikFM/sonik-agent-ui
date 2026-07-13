# Mastra vs. Vercel AI SDK — Agent Framework Decision

**Date:** 2026-07-12
**Author:** architect lane (yellow-zebras branch)
**Question (Dan, verbatim intent):** "What does Mastra give us as an agent framework that we might not have and might want? Should we switch to the Mastra way or keep doing what we're doing? Do we need a definition of what our agents are, and should that be a Mastra thing?"
**Scope:** read-only analysis of our stack (`apps/standalone-sveltekit`, `packages/tool-contracts`) vs. Mastra source at `/Users/danielletterio/Documents/GitHub/mastra` (core `1.44.0-alpha.1`), cross-checked against prior repo research (`docs/research/stateful-runtimes-landscape-2026-07.md`, `lane-L3-permission-trust-supplychain-2026-07.md`).

---

## TL;DR / Recommendation

**STAY** on Vercel AI SDK + our own trust contracts. Do **not** adopt Mastra as the agent framework. Instead, **steal three Mastra ideas as Sonik-native contracts**: a first-class agent-definition object (we already have the schema — `agentDefinitionSchema`, it just needs a runtime), a memory policy shape, and a thread/resource session model. Define "a Sonik agent" as a **Sonik-native contract**, not a Mastra type — but keep its field names deliberately Mastra-adjacent so a future adapter is cheap.

The single deciding fact: **Mastra has no approval-authority model.** Its `resume()` trusts any shape-valid payload — no identity, no signing, no audit primitive. Our host-signed approval gate + capability registry + semantic-success receipts is exactly the layer Mastra lacks, and it is the layer our product sells. Switching would mean rebuilding our moat on top of a framework that actively fights it (its run/session/HITL primitives were renamed four times in one month), for the sake of primitives — agent object, memory, threads — we can copy as ~200 lines of contract without taking the dependency.

---

## 1. Capability-by-capability

| Capability | Mastra provides | We have | Gap direction |
|---|---|---|---|
| **Agent definition / identity** | `Agent` class — imperative object constructed with `{ name, instructions, model, tools, memory, workflows }`, registered on a central `Mastra` instance. Live JS object, not a serializable record. | `agentDefinitionSchema` (marketplace.ts:320) — declarative, serializable: `agentId, title, modelPolicyRef, systemPromptRef, requiredSkills, requiredToolPacks, toolPolicy`. Contract exists; **runtime that instantiates from it does not** (Slice H heritage). | **We're ahead on shape** (ours is data, theirs is code), **they're ahead on runtime** (theirs runs, ours is a schema waiting for a loader). |
| **Conversation / session mgmt** | Threads keyed by `threadId` + `resourceId`, persisted via storage adapter. Mature, batteries-included. | Per-run `run-context.ts` selection (chips, provenance, authoritative dismissal, reload-safe reconcile) + persistence layer. Strong on *context provenance*, thinner on *durable multi-turn thread storage*. | **They're ahead** on durable thread/resource persistence; **we're ahead** on explicit, replayable context selection. |
| **Memory** | Dedicated memory package: working memory, semantic recall (vector), message history, pluggable storage. Declarative config. | No first-class memory abstraction. Context is per-turn composed (agent-prompt.ts) + document/artifact chips. | **They're ahead.** This is the biggest genuine capability gap and the best idea to steal. |
| **Tool registry + approval** | `createTool({ inputSchema, outputSchema, execute })`, zod-validated. **No approval/authorization/human-in-the-loop authority** — HITL is workflow `suspend()/resume()`, and `resume()` trusts any shape-valid payload. No permission or signed-grant concept anywhere. | Capability registry (registered, versioned, default-deny, per-call gating, write-implies-read implication edges, kill-switch) + capability pinning (three authority inputs intersected most-restrictive-wins, frozen at run start) + host-signed approval enforced structurally in the reducer. | **We're far ahead.** This is the moat (§2). |
| **Workflows** | `createWorkflow().then().branch().parallel().suspend().resume()` — **code-first only, no workflow-as-data**. Snapshot format explicitly internal/unversioned. Durable suspend/resume via storage. | `workflowDefinitionSchema` (workflow-as-**data**: nodes + edges + facadeToolIds) + pure reducer (`workflow-run-state.ts`) + controller (`workflow-controller.ts`). Trust doctrine enforced structurally in the reducer. Contracts + reducers shipped and tested; **generic runtime engine not yet wired** (live path is the bespoke A2 reservation-commit route). | **Tie, different axes.** They ship a working durable engine today; we ship an inspectable, versionable, approval-native definition format. Their snapshot is unversioned (bad interop target); ours is a contract. |
| **Streaming** | `stream()` / `generate()` with typed event stream. | Vercel AI SDK `ToolLoopAgent` / `streamText` loop (agent.ts:94) — the same underlying streaming primitives, since Mastra also builds on AI SDK model calls. | **Tie** (shared substrate). |
| **Observability** | OpenTelemetry tracing + evals framework, batteries-included. | Bespoke `agent-telemetry` + run-record provenance + receipts; Dify-style Runs/Observability console planned (addendum 4.5, A3). | **They're ahead** on turnkey OTel + evals; **we're ahead** on receipt/approval-audit semantics. |
| **Deploy fit (Cloudflare Workers)** | Real CF deployer: D1 / KV / Durable Object adapters. Docs steer DO for consistency; KV is an eventually-consistent footgun; D1 has a hard 10 GB cap. Core still assumes Node-ish APIs in places. | SvelteKit + `@sveltejs/adapter-cloudflare` — already deploying to Workers today. | **We're ahead** for *our* deploy: we already run on Workers with zero framework adapter risk. Mastra's CF story is real but adds its runtime assumptions on top of ours. |
| **Multi-tenancy** | None first-class. Single logical instance; org/tenant scoping is bring-your-own. | Org scope is a design invariant (host session authoritative, RLS, per-org capability grants; addendum 4.5 Tier 1/2). | **We're ahead** (it's a product boundary for us, an afterthought for them). |

---

## 2. The trust-boundary lens (the deciding factor)

Our product is not "an agent that calls tools." It is **an agent whose every mutating action is host-gated, capability-scoped, and receipt-audited.** That layer lives in three files with no Mastra equivalent:

- **`capability-registry.ts`** — capabilities are registered, versioned, default-deny. `evaluateCapabilityAccess` is per-call: no registration, no grant, a revoked descriptor, or a kill-switched id all evaluate to `off`. Write-implies-read implication edges can only *lower* privilege (rank-checked so implication can never escalate).
- **`capability-pinning.ts`** — intersects three live authority inputs (capability grants = default-deny; tool permission modes = default-allow; host-signed `approvedCommandIds` = commit allow-list) most-restrictive-wins, and **freezes** the result at run start so two enforcement paths can't disagree mid-run.
- **`workflow-run-state.ts` + `workflow-controller.ts`** — approval is *structurally* host-signed: the approval schema `superRefine` **refuses to represent** a model-granted approval (`model_supplied_approval_is_not_trusted`); the commit transition is rejected unless approval is `{ approved, hostSigned: true }`; the controller checks this *before* invoking the write callback, not only in the reducer; and the terminal `committed` phase requires a **semantic-success receipt**, never transport status.

**Mastra has none of this.** Prior repo research verified it at source: *"no approval authority model — `resume()` trusts any shape-valid payload; no identity, signing, or audit primitive"* (stateful-runtimes-landscape-2026-07.md:41). The 12-framework HITL survey in the same doc found **no** agent framework ships a pluggable approval channel, verifier hook, or approval dashboard — the gap our host-signed gate fills.

**What switching would cost us here:** everything above becomes a layer we bolt *on top of* Mastra rather than *own*. Mastra's suspend/resume would still be the transport for approval, so we'd have to intercept `resume()` and re-impose host-signing — fighting the framework's own "any payload resumes" contract at exactly the security boundary we cannot afford to get wrong. And Mastra's snapshot format is internal/unversioned, so our audit/replay story would depend on a format they change without semver.

**Could Mastra host our trust layer?** Only as an outer wrapper we fully own — i.e., our capability gate and approval reducer would run *around* Mastra calls, which is precisely the STAY architecture minus the benefit of also owning the loop. There is no seam inside Mastra where a signed-grant authority plugs in.

---

## 3. Three options, argued

### (a) SWITCH — Mastra as the framework, our trust contracts on top
- **For:** Get memory, threads, durable workflows, OTel, evals for free. Stop maintaining our own agent loop.
- **Against:** (1) Our moat (§2) becomes an add-on fighting `resume()`'s trust-any-payload contract at the security boundary. (2) **API instability is a real dependency risk for a trust product** — four breaking renames of run/session/HITL primitives in *one month* (tool-suspension unified v1.42; Harness v1.46 → AgentController v1.47 within two days; heartbeats→schedules v1.50), no semver guarantee on the stable channel. A product whose selling point is auditability cannot have its HITL primitive renamed under it quarterly. (3) The Mastra AI npm package was in the March–June 2026 supply-chain compromise wave (lane-L3 research) — taking it as a core dependency of a *trust* product is the wrong risk to add. (4) Rewrites our shipped, tested contract investment. **Verdict: rejected.**

### (b) STAY — Vercel AI SDK + our contracts, steal Mastra ideas as our own contracts
- **For:** Keep the moat we've already shipped and tested. Keep zero deploy-adapter risk on Workers. Adopt Mastra's *good ideas* (memory shape, agent-definition object, thread/resource model) as **Sonik-native contracts** we version and control. Their `stateSchema` is already structurally close to our reducer state, so cross-pollination is cheap and one-directional (read their design, don't import their package).
- **Against:** We keep building memory / durable threads / OTel ourselves instead of getting them free. Real cost, but bounded — memory is one new contract + storage seam, not a framework.
- **Verdict: recommended.**

### (c) HYBRID — Mastra for agent/memory primitives only, our controller for workflows
- **For:** Cherry-pick Mastra's strongest area (memory) without adopting its workflow engine (where we're already ahead on approval-native design).
- **Against:** Two agent-object models (`Agent` class + our `agentDefinitionSchema`) and two session models to keep in sync; we'd still import an unstable, supply-chain-flagged dependency for the one piece (memory) we can spec as a contract in a fraction of the surface. The dependency cost is nearly the full SWITCH cost for a fraction of the benefit. **Verdict: rejected now; the memory-shape idea survives inside STAY.**

---

## 4. What IS a Sonik agent — contract sketch

We already have most of it (`agentDefinitionSchema`, marketplace.ts:320). Proposed canonical shape, folding in the addendum-4.5 B1 fields (model, declared skills, pinned facade, permission grants, org scope) and a memory policy stolen from Mastra:

```ts
// Sonik-native. Field names kept Mastra-adjacent for cheap future interop,
// but the type is ours: serializable, versioned, org-scoped, approval-aware.
sonikAgentDefinition = {
  agentId: string,
  title: string,
  orgScope: { organizationId: string, visibility: "private" | "organization" | "managed_internal" },
  model: { modelPolicyRef: string },          // resolves through AI Gateway, not a hard model id
  systemPromptRef?: string,
  declaredSkills: SkillDefinitionRef[],        // requiredSkills, typed
  pinnedFacade: { facadeToolIds: string[] },   // <=5, the model-facing toolset (workflow-run-state doctrine)
  permissionGrants: CapabilityGrant[],         // capability-registry ids + off/ask/allow, NOT free strings
  toolPolicy: Record<CapabilityId, "off"|"ask"|"allow">,
  memoryPolicy: {                              // stolen from Mastra, shaped as our contract
    workingMemory: boolean,
    semanticRecall: boolean,
    scope: "thread" | "resource",              // Mastra's thread/resourceId model, as data
    retention: "zdr" | "session" | "durable",  // ties to our ZDR enforcement invariant
  },
}
```

**Sonik-native, not Mastra-shaped.** Reasons: (1) it must reference **registered capability ids**, not free strings — that constraint (D013) is the whole point and Mastra has no equivalent field; (2) it must be **serializable and versioned** for the admin console (B1) and marketplace publish, which Mastra's live-`Agent`-object model is not; (3) `orgScope` and `memoryPolicy.retention: "zdr"` are product invariants with no Mastra counterpart. Keep field *names* aligned with Mastra (`instructions`↔`systemPromptRef`, thread/resource memory scope) so that if interop is ever wanted, an adapter is a field map, not a redesign.

**Yes, we need this definition** — and it should be the entity the admin console's B1 "Agents" screen creates/edits (addendum 4.5 explicitly supersedes Slice H with this). The gap today is not the schema; it's a runtime that instantiates a live agent (the AI SDK `ToolLoopAgent` in agent.ts) *from* the definition. That loader is the STAY path's main new build.

---

## 5. Recommendation & reversibility

**Recommendation: STAY (option b).** Keep Vercel AI SDK + our trust contracts; build the agent-definition **runtime** (loader from `sonikAgentDefinition` → `createAgent` context) rather than a framework migration; add a memory contract + storage seam inspired by Mastra's memory package; formalize threads/resources as our own session contract. Track Mastra quarterly and re-evaluate only if it grows an approval-authority primitive (it has no roadmap signal for one).

**Reversibility notes:**
- STAY is the **low-lock-in** path: our contracts are dependency-light (no zod-less leaf modules already), the AI SDK is a thin, stable substrate Mastra itself sits on, and adopting Mastra *later* is still open because we'd own the agent-definition and memory contracts an adapter could map onto.
- SWITCH is **high-lock-in and hard to reverse**: Mastra's unversioned snapshot format + monthly primitive renames mean migrating *off* Mastra later would strand persisted run/thread state in a format they don't guarantee.
- The one thing to keep portable: hold `sonikAgentDefinition` field names Mastra-adjacent (cheap now, preserves the hybrid option) and keep our reducer state — already structurally close to Mastra's `stateSchema` — as the durable source of truth, so no future engine choice is foreclosed.

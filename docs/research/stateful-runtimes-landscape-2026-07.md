# Stateful Runtimes Landscape — July 2026

Date: 2026-07-11 (research run 2026-07-10/11, three parallel web-research lanes)
Status: research synthesis, ratified direction: keep hand-rolled reducer
Lens: TypeScript monorepo on Cloudflare Workers; Zod-validated pure-reducer workflow
state machine (workflow-run-state.ts); workflows as JSON documents executed by one
generic controller; host-signed approval gates; semantic receipts.

## Headline finding

Nothing in the July 2026 open-source ecosystem combines all three of:
(a) workflows as validated JSON documents, (b) one generic interpreter,
(c) a typed, host-verified approval boundary. Closest cousins each have one:
Netflix/Orkes Conductor (data-as-workflow, no trust model, Java), Pydantic AI
(typed approval payloads, Python, no durability), Restate (durable-promise
approval gates, external server). Our hand-rolled reducer is a correct
instance of the **Decider pattern** (decide(command, state) → events; rejection
as data; effects injected) as formalized by Emmett and fmodel-ts — a named,
recognized shape, not an ad-hoc wheel.

## Durable-execution engines (ranked for our lens)

| Project | License | Shape | Workers story | HITL | Verdict |
| --- | --- | --- | --- | --- | --- |
| DBOS Transact-TS | MIT | Library (no server; checkpoints inside your Postgres txns) | Portable; needs true txn semantics (verify vs Hyperdrive) | Build-your-own | Prototype candidate; steal the atomicity rule |
| Restate | BSL 1.1 (prod-safe) | Platform (Rust server) + per-key journal | Shipped CF Workers SDK + deploy docs | Durable `awakeable()` promises — near-identical to our gate | Bookmark for external durability |
| Cloudflare Workflows / DO + Project Think Fibers (Apr 2026) | n/a (platform) | Platform primitive; SQLite-backed DO per instance | Native; limits raised 10x May 2026; Dynamic Workflows load per-tenant code | Generic waits only — approval semantics left to you | Our persistence substrate; the layer we build is the layer it omits |
| Vercel Workflow DevKit | Apache 2.0 | Compiler-directive durability ("use workflow"), Worlds adapter | Community Cloudflare World in progress (unshipped) | Hooks | Watch; revisit Q4 2026 |
| Temporal | MIT | Full platform (server+DB+workers) | None | Signals + timers, mature | Ruled out: operational weight, no edge story |
| Inngest | SSPL→Apache | Platform, step memoization | None native | Wait-for-event steps | Ruled out for embedding |
| Hatchet | MIT | Platform, Postgres-backed | None | DAG-level | Ruled out |
| Trigger.dev | Apache 2.0 | Platform, checkpoint-resume, own workers | None | Wait points | Ruled out |
| Windmill | AGPL core | Internal-tools platform | None | n/a | Ruled out (license + shape) |
| Resonate | Apache 2.0 | Library OR sidecar; durable promises as protocol | Embeddable mode | First-class HITL doc | Idea source; too small (~600 stars) to depend on |

## Agent-framework layer (non-LangGraph)

- **Mastra** (TS, 1.0 Jan 2026, $22M Series A Apr 2026, ~300k weekly downloads) — the
  road not taken for this project. Deep-dive verdict: (1) **no workflow-as-data** —
  code-first `.then()/.branch()` only, vNext direction is stronger code-first typing,
  not documents; (2) **no approval authority model** — `resume()` trusts any
  shape-valid payload; no identity, signing, or audit primitive; (3) snapshot format
  explicitly internal/unversioned — unsafe interop target; (4) four breaking renames
  of run/session/HITL primitives in one month (tool-suspension unified v1.42 Jun 12;
  Harness v1.46 Jun 24 → AgentController v1.47 Jun 26; heartbeats→schedules v1.50
  Jul 6), no semver guarantee on the stable channel; (5) Cloudflare deployer real —
  D1/KV/DO adapters; docs steer DO for consistency, KV eventually-consistent footgun,
  D1 hard 10GB cap. Their `stateSchema` is structurally close to our reducer state.
- **Pydantic AI / pydantic-graph** (Python) — closest conceptual match: typed FSM
  decoupled from the agent loop; deferred tools with schema-validated approval
  request AND response. Read their design; don't adopt the language.
- **OpenAI Agents SDK** — state is the transcript (handoffs transfer history);
  serializable RunState + needs_approval but bring-your-own persistence.
- **Microsoft Agent Framework 1.0** (GA Apr 2026; AutoGen+SK merged, both now
  maintenance-only) — graph workflows-as-data; separate Process Framework targets
  compliance audit trails — the only framework building for the receipts problem.
- **LlamaIndex Workflows 1.0** (Jun 2026) — event-driven; replay-on-resume duplicate
  side-effect hazard documented.
- **Cloudflare Agents SDK** — agent IS a Durable Object; Fibers = mid-turn
  checkpointing (Apr 2026). Platform durability, no workflow shape/approval layer.
- **LangGraph status** (context only): incumbent and growing ($1.25B valuation,
  1.0 GA, DeltaChannel incremental checkpoints Q2 2026). People pick alternatives by
  stack fit, not exodus.
- Ecosystem gap (12-framework HITL comparison, dev.to): none ship a pluggable
  approval channel, verifier hook, or approval dashboard — the gap our host-signed
  gate fills.

## Statechart / library layer

- **XState v5** — production-grade; machines ARE data (JSON config → interpreter;
  how Stately Studio round-trips — prior art for our canvas builder). Earns its
  dependency only for hierarchy/parallel regions/history/delayed transitions.
  Alpha `statelyai/agent` validates "agent as validated JSON" — unstable API.
- **Emmett / fmodel-ts** — the Decider pattern formalized; our reducer's shape,
  with given/when/then spec harnesses.
- **@effect/workflow + Effect Cluster** — deterministic IDs, replay-on-retry
  activities, Schema-validated, saga compensation; explicitly alpha, weekly
  breaking; philosophically closest engine; re-evaluate at 1.0.
- Minimalist 2026 crop (yay-machine, robot3, typescript-fsm) — flat only; ecosystem
  consensus: reducer or 1kb lib below XState, nothing between wins adoption.
- **SCXML**: still the only statechart interchange standard; XML, legacy-oriented —
  do not chase. XState's JSON config is the pragmatic "statechart as data" reference.

## Patterns to steal (regardless of adoption)

1. **Atomic receipt writes** (DBOS): receipt row commits in the same DB transaction
   as the effect's own write — kills "committed but not marked done."
2. **Durable promise as approval gate** (Restate/Resonate): create-once, persist,
   resolve via signed callback — cleaner framing for our request_approval→approve.
3. **Event log as source of truth, state as projection** (all mature engines):
   receipts array is halfway there; formalize run state as projection of an
   append-only event list for free replay/audit.
4. **Journal-per-step** (Restate): name and journal every side effect individually
   rather than replaying whole functions.
5. **Backend adapter seam** (Vercel Worlds): a 20-line append/read interface
   decoupling durability from storage; cheap insurance (DO today, D1/PG later).

## Reducer hardening checklist (from statechart research; contract-layer, cheap)

1. Idempotent replay — retried `commit_result` currently double-applies; add
   dedupe via receipt identity or event id.
2. Approval expiry as data (`expiresAt` checked on next event), never a timer.
3. Parallel-dimension snapshot integrity — `approvalState` vs `nodeStates` are
   independent axes; test events on one never clobber the other.
4. Rejected events return state unchanged (already tested — keep asserting).
5. Snapshot round-trip: JSON serialize → rehydrate → next event ≡ live object.
6. Illegal-transition totality: every event type has explicit behavior in every
   phase (TS `never` exhaustiveness).
7. Re-entry semantics: self-transition entry/exit behavior decided explicitly.

## Ratified direction

Keep the Decider-pattern reducer as the core. Persist through Durable Objects when
durability lands. Steal patterns 1–3 in Phase 5/6. Track quarterly: Mastra,
Cloudflare Project Think, Vercel WDK Cloudflare World, @effect/workflow 1.0.
The typed host-signed approval boundary remains uncommoditized — it is the moat.

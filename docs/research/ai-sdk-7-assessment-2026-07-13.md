# AI SDK 7 — Adoption Assessment (2026-07-13)

We're on `ai@^7.0.22` with `@ai-sdk/otel@^1.0.22`. v7 is STABLE
(2026-06-25). Assessed against what this codebase hand-built. Sources:
vercel.com/blog/ai-sdk-7,
ai-sdk.dev/docs/migration-guides/migration-guide-7-0, /docs/agents/tool-approvals,
/v7/docs/agents/workflow-agent, /docs/ai-sdk-core/telemetry.

## Verdict per feature

| v7 feature | our hand-built equivalent (file:line) | verdict | risk |
|---|---|---|---|
| HMAC-signed tool approvals (`experimental_toolApprovalSecret`) | host-session-derived `hostSigned` (`workflow-runs.ts:159-166`), reducer refusal `model_supplied_approval_is_not_trusted` (`workflow-run-state.ts:237`), controller re-check (`workflow-controller.ts:110-112`), per-commandId targeting (`workflow-run-state.ts:266-276`) | **KEEP OURS** | HIGH if swapped — solves a *different* problem |
| WorkflowAgent + `@ai-sdk/workflow` (durable/resumable) | controller + reducer + Neon `workflow-run-store.ts` | **DEFER** | Vercel-Workflow infra commitment; our Neon store already does durability |
| Telemetry (`registerTelemetry`, `@ai-sdk/otel`) | `agent-telemetry.ts` JSONL+workspace mirror + Worker log marker and AsyncLocalStorage `workflowRunId` join-key | **ADOPTED 2026-07-14** — structural AI lifecycle spans use the existing marker path; keep join-key | Low, additive; production trace validation remains Dan-gated |
| Timeouts (total/per-step/per-tool) | `stepCountIs(12)` only — no wall-clock bound | **ADOPT** | None, additive — genuine gap |
| Typed tool context (`contextSchema`/`toolsContext`) | factory-closure threading (`agent.ts` createAgent) | **KEEP OURS** | closures already solve it; no win |
| Runtime context / `prepareStep` | unused | adopt only if a per-step need arises | none |
| Sandbox (`SandboxSession`), MCP Apps, `uploadSkill` | no surface in repo | **DEFER** (N/A today) | N/A |
| v7 version bump itself (renames) | `stepCountIs`→`isStepCount` is our only rename | **DO** — cheap, codemod-handled | trivial |

## The crown jewels are KEEP/DEFER — and that validates the architecture

**Signed approvals (KEEP OURS).** v7's HMAC signs an approval token at issuance,
hands it to the client, re-verifies on replay — built for STATELESS serverless
where turn N+1 hits a different instance. Ours never serializes a token: `hostSigned`
is derived fresh, server-side, from the live authenticated host session at the
approve action itself. Stronger for our case (nothing to forge/exfiltrate/replay),
but it requires a live session at approval time — which is exactly what durable
async approval breaks. **Blocking fact:** `experimental_toolApprovalSecret` is
"not yet supported on WorkflowAgent" — the two features you'd want *together* for
async human approval don't compose in v7 today. So "adopt WorkflowAgent + HMAC as
a unit" is ruled out regardless. Re-evaluate HMAC only if/when durable
approve-days-later (Slack/email) becomes a real requirement — as an *additional*
layer for the serialized-token case, never a replacement for live-session
`hostSigned` in the synchronous flow (which is 100% of what exists: reservation +
campaign).

**WorkflowAgent (DEFER).** It gives restart/deploy survival + pause/resume, but
has zero opinion on our domain: `tool_preview`/`tool_commit`/`ask_user` typing, the
`effect: write|destructive|external` gate, per-command approval targeting, the
capability-registry semantics. We'd keep 100% of the reducer + controller gating
regardless; the only thing on the table is whether our working, deployed Neon store
gets replaced by a Vercel-Workflow runtime (an infra commitment). Not now.

## REAL BUG FOUND (independent of any SDK decision) — P1 follow-up

`stableInputHash` is carried on the preview (`workflow-run-state.ts:63`, threaded to
UI via `workflow-projection.ts:58`) but **never re-checked at commit time** —
nothing in `applyWorkflowRunEvent`'s `commit_started`/`approve` compares the approved
hash against what's actually committed. We have per-command-ID targeting but NOT
per-exact-input tamper-evidence. If a command's input can change between preview and
commit (multi-step forms, concurrent edits), an operator could approve input X and
commit input Y. **Fix: enforce `stableInputHash` equality at `commit_started`, OR
document why it's presentation-only.** This is exactly the property v7's HMAC binds
(tool + call-id + exact input) and ours currently doesn't. Ticket regardless of v7.

## Telemetry adoption (2026-07-14)

**Exporter decision.** Reuse the existing `sonik_agent_ui_telemetry` Worker-log
marker consumed by the configured Pipe-B Tail Worker. `@ai-sdk/otel` receives a
small structural `Tracer`; span end events are projected through the same
sanitizer as existing app telemetry. We did **not** add
`@microlabs/otel-cf-workers`: the current path already reaches the Tail Worker,
while that package would add an OTel SDK/export stack and duplicate transport.

This is accurately described as an **OTel-API-compatible bespoke tracer/log
export bridge**, not an OTel SDK, OTLP exporter, `Resource`, `Sampler`, or
`SpanProcessor`. SvelteKit `instrumentation.server` registers it once; SvelteKit
framework tracing remains off.

**Privacy contract.** Every production call sets `recordInputs: false` and
`recordOutputs: false`. Usage detail, provider metadata, embeddings, reranking,
runtime-context export, headers, tool choice, and schemas are also off. The
export boundary ignores raw span names and every non-allowlisted attribute,
does not evaluate lazy GenAI content attributes, discards events/links/tool
arguments/results, and reduces exceptions/status messages to a boolean status.
Only lifecycle kind, allowlisted operation id, duration, and validated
request/trace/session/run/workflow correlation leave the boundary. The Gateway
ZDR provider option is unchanged.

**Covered calls.** The main `ToolLoopAgent`, nested Perplexity search, and nested
workflow drafting calls all carry the same turn correlation. Fresh-process
`MockLanguageModelV4` proofs cover global unregistered, registered, per-call
disabled, duplicate registration, failure scrubbing, real nested factories,
and the real `createAgent` path.

**Local evidence.** `.omx/evidence/g016-ai-sdk-otel-local-trace.jsonl` contains
nine redacted correlated main/nested-call events. The 25-warmup/200-iteration
mock benchmark reports enabled overhead of +0.162458 ms p50 and +0.247833 ms
p95 versus unregistered; the disabled-path delta was +0.001833 ms p50 and
+0.015166 ms p95 (`g016-ai-sdk-otel-benchmark.json`). Wrangler dry-run moved
from 5998.42/970.54 KiB raw/gzip to 6146.83/993.31 KiB, a conservative worktree
delta of +148.41/+22.77 KiB (`g016-wrangler-before.txt`,
`g016-wrangler-after.txt`).

**Validation ceiling.** No deployment was performed. A production query proving
app and SDK marker events together in Pipe-B remains Dan-gated. Cloudflare's
native custom spans cannot currently be manually ended or expose the trace id
needed by this projection, so this slice does not claim Cloudflare framework
parenting, remote W3C parent/child fidelity, OTLP delivery/backpressure, or an
arbitrary OTel backend schema.

Explicitly not changed: signed approvals, WorkflowAgent, or the tool-context
architecture. Those stay KEEP/DEFER per above.

Separately (not v7-gated): fix the `stableInputHash` commit-time check.

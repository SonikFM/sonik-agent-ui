# AI SDK 7 — Adoption Assessment (2026-07-13)

We're on `ai@^6.0.86` (6.0.168). v7 is STABLE (2026-06-25). Assessed against what
this codebase hand-built. Sources: vercel.com/blog/ai-sdk-7,
ai-sdk.dev/docs/migration-guides/migration-guide-7-0, /docs/agents/tool-approvals,
/v7/docs/agents/workflow-agent, /docs/ai-sdk-core/telemetry.

## Verdict per feature

| v7 feature | our hand-built equivalent (file:line) | verdict | risk |
|---|---|---|---|
| HMAC-signed tool approvals (`experimental_toolApprovalSecret`) | host-session-derived `hostSigned` (`workflow-runs.ts:159-166`), reducer refusal `model_supplied_approval_is_not_trusted` (`workflow-run-state.ts:237`), controller re-check (`workflow-controller.ts:110-112`), per-commandId targeting (`workflow-run-state.ts:266-276`) | **KEEP OURS** | HIGH if swapped — solves a *different* problem |
| WorkflowAgent + `@ai-sdk/workflow` (durable/resumable) | controller + reducer + Neon `workflow-run-store.ts` | **DEFER** | Vercel-Workflow infra commitment; our Neon store already does durability |
| Telemetry (`registerTelemetry`, OTel GenAI semconv) | `agent-telemetry.ts` JSONL+Neon + AsyncLocalStorage `workflowRunId` join-key | **ADOPT (LLM/tool spans), KEEP join-key on top** | Low-med, additive |
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

## Recommended v7 slice (when Dan greenlights) — small, low-risk, no trust-kernel touch

1. `npx @ai-sdk/codemod v7` — renames + version bump (2 package.json + agent.ts:112). Gate.
2. Adopt `registerTelemetry` + OTel GenAI semconv for LLM/tool spans; thread
   `activeWorkflowRunId()` in as a custom span attribute; keep the JSONL/Neon audit
   trail. (Feeds the observability item in the production ledger P1 #9.)
3. Add wall-clock timeouts (total/per-tool) to `createAgent`.
4. Explicitly NOT in this slice: signed-approval swap, WorkflowAgent, tool-context
   rewrite. Those stay KEEP/DEFER per above.

Separately (not v7-gated): fix the `stableInputHash` commit-time check.

# High-Volume Agent Harness Testing — Plan v2

Status: DRAFT for Dan's sign-off · 2026-07-07 · Supersedes the pyramid sketch in `agent-pressure-test-plan-2026-07-07.md` with a concrete volume engine.
Goal: hundreds of thousands of agent-workflow test datapoints, cheaply, on a cadence — to make agent behavior *measurable* (the audit's "unpredictability" becomes a graph) and to prove a cheap model (deepseek-v4-pro, already the default) stays safe.

## The core unlock (verified 2026-07-07)

The page-control semantic actions (`submitAnswer`, `approveAndRun`, …) are a **browser-window API** — that's why Playwright was the only driver, and why every run cost 5–12 min + a browser. **But the workflow's actual server surface is already complete:** `/api/generate` (model turn + tool loop), `/api/artifact` + `/api/artifact/[id]/state` (create/patch = the answer/save path), `/api/session*`, `/api/telemetry`. The browser-only part is orchestration glue in `+page.svelte`, not backend logic.

**So the volume engine is a headless workflow driver that assembles existing endpoints** — login (via the just-shipped auth-proxy) → create session → `/api/generate` turn → parse the rendered spec → POST answers to `/api/artifact/[id]/state` → commit → read telemetry. No browser. Runs in parallel to whatever Neon/Workers concurrency allows. This is ~1–2 days, not a rebuild, because the endpoints exist.

## Where the "hundreds of thousands" actually come from

Volume is **combinatorial generation**, not hand-written scenarios. Four dimensions, and dimension #2 is the audit's #1 unpredictability suspect — so testing it *is* the point:

| Dimension | Values | Why |
|---|---|---|
| Workflow | venue / event / reservation / campaign (4) | the real product surfaces |
| **Phrasing/persona** | ~25 per workflow | `resolveImplicitWorkflowSkillIds` keyword-matching means phrasing silently swaps tools — the #1 unpredictability suspect. Generate paraphrases, edge words ("run it", "approve", "commit"), multilingual, terse vs verbose |
| Answer strategy | valid / boundary / adversarial / skip-heavy / contradictory (5) | exercises validation, refusals, the "still needed" gating |
| Host context | org × page-surface variants (3) | context-aware skill selection |

4 × 25 × 5 × 3 = **1,500 distinct scenarios per pass**. Model-free (mock-stream) that's thousands/night at ~zero cost. The 100k+ *datapoints* accumulate: every scenario emits ~10–50 telemetry events, banked in the observability worker's R2 — the "test data in the door" is that growing corpus, plus every live run auto-banked as a future deterministic replay fixture.

## The layers (each catches what the one above shouldn't reach)

| Layer | Volume/cadence | Cost | Driver |
|---|---|---|---|
| L0 contract/unit | unbounded, every commit | free | existing gate + policy tests |
| L1 **mock-stream sims** | thousands/night | ~free | headless driver + canned SSE (`smokeMockStream` mode exists) |
| L2 **recorded replay** | hundreds/night | free | banked live transcripts vs stubbed backend |
| L3 **live-model sample** | ~1–5% of scenarios | real $ | headless driver + real `/api/generate` (deepseek) |
| L4 cross-env (Amplify) | weekly | real $ | same driver, Amplify host profile |

The unpredictability *lives* in L3 but the *fix* is L0/L1 (phase-scoped tools, declarative skill selection — ratified DR-4). L3's job is to *measure* it and alarm on drift.

## Behavior scoring (unpredictability → a number)

Every run auto-scored from its telemetry, no human:
- **recipe adherence** — did it call the skill's declared `commandSequence`? off-recipe calls named.
- **execute-vs-narrate** — receipts present for claimed actions (current baseline ~2/3 on reservation).
- **refusal correctness** — typed refusals honored, never argued.
- **turn economy** — tool calls + tokens per completed workflow.
- **phrasing sensitivity** — same scenario, N phrasings → variance in tool selection. *This is the direct unpredictability metric.*
Nightly time-series per metric; a regression is a red line, not a feeling.

## Phased build

- **P1 — Headless workflow driver** (~1–2d): assemble existing endpoints into a full authenticated workflow run, no browser; reuse auth-proxy login. Deliverable: `node scripts/harness/run-workflow.mjs --scenario <spec>` → structured result + telemetry correlation. *The engine.*
- **P2 — Scenario generator + mock-stream bulk** (~2d): combinatorial factory (`scenarios/*.json`), the canned-SSE library, parallel runner. *The volume.*
- **P3 — Scoring + aggregation** (~2d): the 5 metrics computed from R2 telemetry; a query/rollup layer (this is the **Dev MCP** — turns the corpus into dashboards + conversational queries). *The signal.*
- **P4 — Live sampling + drift alarms + replay banking** (~2d): N% live-model runs, auto-bank transcripts, alarm on metric regression, CI wiring (L0/L1 per commit, L3 nightly). *The loop.*

## Decisions (Dan, 2026-07-07)

1. **Volume model: HYBRID.** Bulk runs against a local ephemeral instance (throwaway DB + mock model) for cheap infinite parallelism; a sampled ~1–5% run against the real deployed worker for fidelity. Implication: P1's headless driver must target BOTH a local `pnpm dev` instance and the deployed worker behind one flag (`--target local|deployed`), and the local path needs a throwaway-DB bootstrap (ephemeral Neon branch or in-memory persistence mode — the latter already exists).
2. **Primary goal: BEHAVIOR EVAL.** Scoring-centric. The 5 metrics (esp. phrasing sensitivity) are the product; drift alarms gate model/prompt/skill changes. Data-gen is a free byproduct — retain transcripts, but don't build a labeling/export pipeline until asked.

### What this settles about the build
- **Scoring is P3-critical, not optional** — it's the whole point. Bring it forward: a minimal scorer ships with P1 so the first runs are already measured.
- **Retention is lightweight** — telemetry already lands in R2; no dataset schema/export work now.
- **The deployed-sample path reuses the auth-proxy** (login → envelope) exactly as verified; the local path skips auth via the in-memory persistence mode.
- **Drift alarms** compare tonight's metric distribution to a rolling baseline; a phrasing-sensitivity spike or execute-rate drop blocks the offending prompt/skill/model change.

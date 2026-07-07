# Agent Pressure-Test Plan — Simple, Seamless, Scalable

Status: DRAFT for Dan · 2026-07-07
Goal: make agent behavior predictable and provable at scale — from one-command smoke checks to hundreds of thousands of test datapoints — without every test costing a live LLM run.

## 1. Current tooling reality (verified this session)

- **No MCP is connected to this Claude Code session.** There is no dev-observability MCP; `sonik-mcp` (the repo) is the *product's* command/MCP projection, not a testing tool, and isn't wired in. Current access paths: `wrangler tail`/`deployments` (works), the observability worker's bun CLI + R2 raw objects (works, payload-level truth), and the repo's scripts.
- Evidence pipe verified alive post-deploy: observability worker consumes tail batches from all three producers (agent-ui ×33, service ×6, app ×3 in a 45s window). **Payload queries must go through the CLI/R2, not live-tail grepping** (tail shows consumption batches; payloads land in R2).
- Working test assets: deterministic contract gate (`scripts/agent-eval-gate.mjs`, ~30s, no LLM), UI-mechanics smokes, reservation smoke + flake-aware retry wrapper, intake E2E driver (`.omx/tmp/ut-intake-real-agent.mjs`, promotable to `tests/agent-eval/scenarios/`).

## 2. The testing pyramid (how you get to 100s of 1000s)

Live E2E runs cost 5–12 min + LLM tokens each — they can never be the volume layer. Scale comes from making each layer catch what the layer above shouldn't have to:

| Layer | Volume | Cost | What it proves |
|---|---|---|---|
| L0 Contract checks (eval gate, schema conformance, policy matrix unit tests) | **unbounded** — CI on every commit | free | the harness is intact: actions, refusals, schemas, policy decisions |
| L1 Mock-stream conversation sims | **thousands/night** | pennies | UI + controller behavior under synthetic agent turns — `smokeMockStream=1` + the mock-factory already exist; add a canned-SSE scenario corpus (happy paths, malformed tool calls, mid-stream aborts, wrong-shape answers) |
| L2 Recorded-replay fixtures | **hundreds/night** | free after capture | regression: real production/live-run transcripts (message → tool call → tool result) replayed against a stubbed backend; every live run we do should auto-bank its transcript as a future fixture |
| L3 Live-model runs | **dozens/day** | real $ | model behavior itself: recipe-following, narrate-vs-execute rate, prompt drift |
| L4 Cross-env (Amplify host) | weekly + pre-release | real $ | host-adapter parity: same contract, different host |

The "unpredictability" problem lives in L3 — but the FIX for it mostly lives in L0/L1: phase-scoped tool exposure (only offer actions valid for the current workflowPhase — already on the ratified hitlist), tighter recipes, and behavior scoring.

## 3. Behavior scoring (turning unpredictability into a number)

Every L3 run gets scored automatically from its evidence JSON + R2 receipts:
- **recipe adherence**: did the model call the expected tool sequence for the skill (searchSkillCatalog → learnSkill → … per the runtime skill's `commandSequence`)? Off-recipe calls (e.g. `booking.create.hold`) are named violations.
- **execute-vs-narrate**: receipts present for claimed actions (the reservation flake, measured — current baseline ~2/3 execute).
- **turn economy**: tool calls + tokens per completed workflow.
- **refusal correctness**: typed refusals honored, never argued with.
Nightly trend per metric → "the agent got less predictable" becomes a red graph instead of a feeling.

## 4. Prompt/skill inventory sweep (the predictability audit)

One read-only sweep producing `docs/product/agent-context-inventory.md`: every system-prompt fragment (agent-prompt composition, per-skill prompts, trusted-controller injected turns), every runtime skill + load policy, every tool exposed per phase/settings, every default (`agent-settings` families/modes), and which of these are UNVERSIONED or duplicated. This is the map the workspace-builder/context-loading work needs anyway — do it once, keep it gated by a drift test.

## 5. Amplify-auth harness (recommendation: yes, phase it)

Decoupling from the booking demo is right — but sequence it: (P1) run the existing eval gate against the Amplify staging host with its auth (ultratest already has the Amplify lanes + QA maps); (P2) add an `AMPLIFY_*` env profile to the L0/L1 layers; (P3) only then port L3 flows. The contract layer is host-agnostic by design — that's the payoff of the page-control contract. What this does NOT need: new harness code; it needs an auth profile + host page-context fixtures.

## 6. Dev MCP (recommendation: build a thin one, later)

The single best DX upgrade for interactive debugging: a small MCP server over the observability worker (query events by runId/traceId/window, fetch receipts, list recent runs) + the eval gate as a tool. ~a day of work, makes every future session's evidence loop conversational instead of grep-archaeology. Not a blocker for anything above.

## 7. Known broken (pressure-test targets, need repro detail)

- "Buttons still don't work" (Dan, 2026-07-07) — needs one specifics pass: WHICH buttons/surface. Candidates from the open bug list: renderer action crash → generic "Internal Error" (#14, never assigned), approval-card buttons, QuestionCard choice buttons. L1 mock-stream sims are the right net for whichever it is once reproduced.

## 8. Immediate next steps (in order, all cheap)

1. Repro + fix the broken buttons (needs Dan's one-line description or a 10-min click-through).
2. Promote the intake E2E driver into `tests/agent-eval/scenarios/` + add transcript auto-banking (feeds L2).
3. Build the L1 canned-SSE scenario corpus (10–20 scenarios) — the volume unlock.
4. Run the prompt/skill inventory sweep (§4).
5. Nightly loop: L0+L1 every night, L3 ×5 with scoring, weekly Amplify lane.
6. Dev MCP when the above is humming.

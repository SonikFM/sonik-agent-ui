# sonik-agent-ui — Enterprise Benchmark Review

**Date:** 2026-07-08
**Scope:** Phase 1, deep internal review of the agent build as-implemented on `origin/main` @ `aba57bf` (reviewed via worktree `/private/tmp/sonik-agent-ui-deploy-e947db2`). Phase 2, benchmark against onyx, open-webui, four local reference repos, and July-2026 external best practice.
**Method:** internal review split across three scoped sub-reviews (agent loop/trust, streaming/telemetry, testing/known-problem docs); external benchmark split across open-webui, a four-repo local-pattern skim, and 12 cited web sources. The onyx deep-research/multi-agent section was produced by a separate dedicated dive and is merged here as relayed content — it is marked as such and was not independently re-verified against onyx's source by this reviewer.

> **Reconciliation note (added at merge, 2026-07-08 evening):** This report was written against `origin/main @ aba57bf`. Two of its findings were resolved the same evening and should be read with that update:
> - **Top risk #1 (R5, approval bypass) — CLOSED** by PR #39 (Slice A, merged `8875ce9`). `commitCommand`/`commitActiveIntakeCommand` are removed from the model's tool set entirely; publishing an intake/venue draft now goes only through a human-invoked `POST /api/intake/commit`. An invariant test (`draft-only-commit-invariant.test.mjs`) asserts the forbidden tools can never mount. The report's caution ("do not repeat draft-only as a settled strength until confirmed") is now satisfied for the intake/create flow. **Caveat:** reservation writes (A2) have no commit path yet and Slice A is **merged but NOT deployed** — the live worker remains `50d95c26`; this report's runtime observations still describe that deploy.
> - **Priority #2 (rendered-E2E lane) — BUILT** by PR #38 (Slice G, merged), incl. the test-chain integrity guard that fixed 4 silently-skipped unit tests.
> Remaining top-10 items (#3–#10) are open backlog. The `f0890e4` question the report raises is superseded: R5 is closed structurally by #39, not by `f0890e4`.


---

## 1. Executive summary

1. **The one trust-model finding that matters most is unresolved as of this doc: verify whether `f0890e4` ("honor host-approved commands at execute") actually fixes R5.** `docs/plans/experience-seams-resolution-plan-2026-07-08.md` documents that the "ask" approval toggle historically only controlled visibility, not execution — a standing `approvedCommandIds` grant list overrode it. That is the single highest-trust-risk item found in this review, independent of whether any harmful content was ever sent. Confirm the fix closes it before repeating the "draft-only, execution-inert" claim as a settled strength.
2. **The agent loop and the live approval-commit path are the least-tested parts of the system.** Zero unit tests import `agent.ts` or `+server.ts` directly; the one eval lane that touches a real signed session (`page-control-contract.eval.mjs`) reports `INCONCLUSIVE`, not `FAIL`, in offline mode for exactly the assertions that would catch an approval bypass; the keyless persona harness stops at `preview_ready` and never exercises `commitActiveIntakeCommand`. This is why R5 shipped unnoticed — the test pyramid has a hole exactly where the trust boundary lives.
3. **Observability terminates in structured console logs with no external trace backend, no OTel GenAI conventions, and no cost rollup.** The `claim_without_receipt` drift detector is a genuinely clever piece of engineering, but it's detect-only — a hallucinated "saved" claim still reaches the user. Adopting OTel GenAI span conventions would make the existing telemetry ingestible by Langfuse/Braintrust/Datadog without inventing a bespoke schema.

The build is more mature than a first read of its size suggests: the signed-envelope + policy-evaluation + tenant-field-enforcement trust chain is coherently layered, the streaming pipeline degrades gracefully instead of crashing on partial/malformed model output, and the project has a real, unusually honest culture of writing down its own incidents (F1–F6, R1–R7) in code comments and docs rather than hiding them. The weaknesses below are specific and fixable, not systemic.

---

## 2. Phase 1 — Internal review

### 2.1 Strengths

- **Multi-layered, coherently-designed trust chain.** HMAC-SHA256 signed host-context envelope with `timingSafeEqual` comparison (`workspace-services.ts:408-422`), multi-factor validity checks (signature version pin, `issuedAt`/`expiresAt`, clock-skew tolerance, independent max-age ceiling — `workspace-services.ts:392-406`), routed through `evaluateCommandPolicy` (`packages/tool-contracts/src/index.ts:1310-1340`), with a second independent tenant-field tamper guard (`assertTrustedGeneratedBookingInput`, `host-command-runtime.ts:671-685`) that rejects model-supplied identity fields regardless of what the prompt says. Approval is correctly never model-provided (`command-catalog.ts:114,155`), with the code comment explaining *why* execute also needs approval, not just commit.
- **Structural, not just prompted, capability scoping.** `commandCatalogTools` are entirely absent from the tool schema (`= {}`) when a preview-only/booking-create skill is active (`agent.ts:110-112`) — tools are structurally unavailable to the model that turn, not merely discouraged by prompt text.
- **Progressive artifact mount degrades gracefully.** `artifacts/streaming-artifact.ts:44-118` dry-runs `resolveElementProps` on every element before allowing a render (`allElementPropsResolveCleanly`, lines 94-105); a partially-streamed directive that passes structural checks but would throw on resolution is caught and the tree falls back to "keep last good" instead of crashing.
- **Honest, incident-driven engineering culture.** The 16KB header cap fix documents the 4096-char truncation incident it replaced (`workspace-services.ts:601`); the F2 skill-intent bug fix is structural, not a prompt patch (`activeArtifactIsRegisteredIntake`, `+server.ts:474-482`); `docs/plans/experience-seams-resolution-plan-2026-07-08.md` opens with a self-correction of the project's own prior "safety: clean" claim. This is a real maturity signal, not boilerplate process theater.
- **`claim_without_receipt` drift detector.** `spec-stream-tap-telemetry.ts:50-96` tees the stream, tracks state-changing receipts, and flags text matching save/record language with zero receipts — a genuinely clever, honestly-scoped ("never blocks, rewrites, or annotates," line 48) detector tracing directly to a real observed bug (F1).
- **Real (if partial) test coverage of the policy layer.** 3,215 lines across 11 files test tool contracts, command policy, and stream safety — `tool-contracts.test.mjs` alone is 1,344 lines, the largest file in the suite.

### 2.2 Weaknesses

- **824-line monolithic route handler.** `apps/standalone-sveltekit/src/routes/api/generate/+server.ts` does rate-limiting, page-context parsing, skill resolution, prompt composition, persistence, 7+ telemetry call sites, streaming pipeline wiring, and title extraction inline, with no separation between parse/build-agent/stream concerns.
- **Single runaway guard.** `stepCountIs(12)` (`agent.ts:137`) is the only loop-termination control — no per-tool timeout, no token/cost budget ceiling.
- **Testing blind spot at exactly the trust boundary** (detailed in §2.3, risk #2).
- **Shared signing root for identity and authorization.** `approvedCommandIds` lives inside the same signed envelope as identity (`host-command-runtime.ts`), with one shared secret (`SONIK_AGENT_UI_HOST_CONTEXT_SECRET`) and no rotation/versioning beyond a single `signatureVersion` string constant.
- **Skill-id string literals duplicated with no compile-time link** (`"booking.context.create"` / `"booking-context-create"` across `agent.ts:113` and `artifact-state.ts:328`) — a future rename in one place silently reopens or closes a mutation gate.
- **O(elements²) cost risk in progressive rendering.** `streaming-artifact.ts` re-resolves props for every element in a growing partial spec on every streamed chunk, with no cap or debounce found.
- **No RAG layer, no external trace backend, no cost/$ rollup** — all confirmed absent, not merely unexamined (see §3 matrix).
- **Regex/keyword-only skill-intent matching** (`runtime-skill-intent.ts:5-26,75-76`) — fast and debuggable, but brittle to false positives on incidental phrase matches like "run it"/"create it".
- **Deferred AGPL-3.0 compliance obligation** — vendored-but-unwired Odysseus drag/resize JS, flagged in `docs/reviews/ux-parity-ledger-2026-07-08.md`, real not hypothetical, deferred to pre-release per Dan.

### 2.3 Top-5 architectural risks (independent judgment)

1. **Approval-toggle bypass (R5), status unverified as of this review.** `docs/plans/experience-seams-resolution-plan-2026-07-08.md` §0 documents a write committed despite the per-family toggle being set to "ask," root-caused to `commitCommand` approval resolving purely via `context.approvedCommandIds?.includes(commandId)` (`command-catalog.ts:155`) — the host's ~113-id standing grant list overrides the UI's "ask" state entirely; "ask" meant *visible*, never *prompt-me*. The doc's own proposed fix (Slice A, stripping publish/commit tools from the mounted set) is marked unimplemented and gated on sign-off as of the doc's date. The repo's current HEAD has `f0890e4 fix: honor host-approved commands at execute` which is plausibly related but was **not confirmed against this doc's text** by this review — this needs to be reconciled before anyone repeats "draft-only doctrine" as a shipped, settled property.
2. **The agent loop and live commit path are structurally untested.** No unit test imports `agent.ts` or `+server.ts`. `tests/agent-eval`'s only session-gated lane reports session-gated assertions as `INCONCLUSIVE` in offline/mock mode because a Playwright route mock cannot forge the HMAC the server re-validates. `scripts/harness`'s keyless mode authors its own intake artifact via direct POST and deliberately stops at `preview_ready`, never reaching `commitActiveIntakeCommand`. This is precisely the layer risk #1 lives in — the test suite is structurally blind to the one path that matters most.
3. **824-line single-file concentration of unrelated concerns** in `+server.ts` (rate-limit, parse, skill-resolve, prompt-compose, persist, telemeter, stream, title-extract). A bug in any one concern (e.g., the title-marker-extraction `TransformStream` at line 308-346) risks masking or breaking the others; this is also the file every future change to the trust/streaming/telemetry layers has to touch.
4. **Single shared signing secret with no rotation/revocation story spans both identity and command-approval.** A compromised or misconfigured envelope-issuer grants both at once, with no separable blast-radius containment observed.
5. **No cost/token budget ceiling.** The only loop-runaway guard is a step count (`stepCountIs(12)`), not a token or dollar ceiling — a small number of steps can still be arbitrarily expensive depending on tool-output size, and nothing stops a runaway-cost turn short of the step cap.

*(Runner-up, worth tracking but not top-5: the `claim_without_receipt` detector is detection-only — a hallucinated "saved" claim still reaches the user before telemetry ever fires. It mitigates risk #1's blast radius for visibility but not for prevention.)*

---

## 3. Benchmark matrix

Columns: **sonik** = this repo · **onyx** = relayed from the dedicated onyx dive (not independently re-verified here) · **open-webui** = independently reviewed this pass · **best-2026** = July-2026 external best practice, cited in §6.

| Capability area | sonik-agent-ui | onyx *(relayed)* | open-webui | best-practice-2026 |
|---|---|---|---|---|
| **Orchestration** | Hand-rolled Vercel AI SDK `ToolLoopAgent`, `stepCountIs(12)`, per-turn conditional tool mounting via skill intent (`agent.ts:100-139`) | Hand-rolled loop, **not** LangGraph — clarify→plan→orchestrator ≤8 cycles, `tool_choice=REQUIRED`, `generate_report` stop tool + 30-min wall-clock force | No agent-loop concept at all — `Pipe`/`Filter`/`Action`/`Event` plugin dispatch via `exec()`-in-process (`utils/plugin.py:281`) | `ToolLoopAgent` (AI SDK 6) is the documented 2026 production baseline; Mastra layers graph workflows (`.then/.branch/.parallel`) with durable state on top for multi-step cases |
| **Deep research / multi-agent** | None — single agent, no sub-agent fan-out | Thread-pool sub-agent fan-out (≤3 parallel, prompt-enforced), fresh context per child, synthetic-failure-message injection, `Placement{turn,tab,sub_turn}` discriminated-union packet protocol with `TopLevelBranching` pre-announcement | None found | OpenAI Agents SDK: explicit typed handoffs (sequential, debuggable, no native parallel routing). Claude Agent SDK: favors single-agent depth over fan-out. Fan-out is a deliberate, non-default choice for genuinely parallelizable research, not standard for an embedded copilot |
| **HITL approval** | Signed envelope + `approvedCommandIds` + `evaluateCommandPolicy`; draft-only doctrine drafted but **R5 unresolved as of this doc** (§2.3 #1) | Not covered in relayed scope | **None** — admin-trust-only `exec()` plugin loading, zero approval gate | LangGraph `interrupt()`/`Command` resume with checkpointer + `thread_id`; verb set = approve-as-is / edit-args / reject-with-feedback. CopilotKit's "Controlled Generative UI" is the closest taxonomy match to an execution-inert renderer |
| **Streaming UX** | `pipeJsonRender → tap → safety filter` (12-char chunk cap, explicitly a workaround for a real Chromium crash, not a fix) → progressive mount with dry-run prop resolution + "keep last good" fallback (`streaming-artifact.ts:44-118`) | `Placement`/`TopLevelBranching` packet protocol pre-allocates UI tabs before content arrives | Not surveyed this pass | CopilotKit taxonomy: Controlled / Declarative (A2UI, Open-JSON-UI) / Open-ended (MCP Apps) generative UI, ranked by control-vs-freedom tradeoff |
| **Observability** | Structured `console.info` (Cloudflare Tail Workers path) + dev-only JSONL + best-effort mirror; **no OTel, no external trace backend, no cost rollup**; `claim_without_receipt` drift detector is detect-only | Braintrust used for eval tracking (per relayed dive) | Elo human-feedback ranking (`routers/evaluations.py`), not tracing | OTel GenAI semantic conventions (`gen_ai.request.model`, `gen_ai.usage.*_tokens`; still "Development" status, semconv 1.40.0, April 2026) + Langfuse/Braintrust trace-and-eval as the emerging standard stack |
| **Eval / testing** | 85 unit files, 3,215 lines of tool/policy tests, but **zero touch `agent.ts`/`+server.ts` directly**; `agent-eval` requires deployed creds and reports `INCONCLUSIVE` on session-gated assertions offline; keyless harness never reaches the real commit path | Braintrust, **tool-assertion-only** — no LLM-judge, no deep-research evals (an admitted gap in onyx's own system, per relayed dive) | No automated eval suite at all — Elo arena is the only quality signal, and it's human-feedback-only | Offline golden-case regression suites run identically local/CI/prod, plus online LLM-judge/rule-based scorers on production traces; deployment-blocking eval gates (Braintrust's CI-gate model) |
| **Embed architecture** | Signed host-context envelope carries identity + session; page-context injected into system prompt, length-bounded but not content-sanitized | Standalone deep-research product, not an embedded copilot — not a comparable architecture | Standalone chat UI, not an embedded copilot | "Best copilots are embedded, not attached" — live inside existing views, single-click confirm/override (EPC Group, 2026) |
| **Artifact generation** | Streaming JSON-UI spec, `spec-repair` (lossless field-relocation + lossy dangling-child pruning, post-stream-complete only), execution-inert renderer — no client-side code execution ever | Not an artifact-generation product | N/A | Sonik's renderer sits close to CopilotKit's "Controlled Generative UI" (pre-built components, agent only populates); open-webui's `exec()`-based plugins sit at the opposite, least-controlled end of the same spectrum |

---

## 4. Gap analysis

### Where we're behind

- **No RAG layer at all**, vs. open-webui's 14 pluggable vector-store backends and hybrid dense+sparse retrieval (`retrieval/utils.py`, 1,738 lines). Not necessarily a gap for this product's scope (booking-artifact generation vs. document Q&A), but worth naming explicitly rather than leaving unexamined.
- **No OTel GenAI conventions, no external trace backend.** "What good looks like": `gen_ai.*` span attributes exported to a backend that supports trace-plus-eval (Langfuse or Braintrust), not just structured console logs. Study: the OTel GenAI semconv spec directly (§6).
- **No deployment-blocking eval gate.** `tests/agent-eval` exists but isn't wired to block merges the way Braintrust's CI-gate model is designed to. Study: Braintrust's offline/online eval split (§6) — note onyx itself hasn't fully solved this either (tool-assertion-only, no LLM-judge), so this is an industry-wide immature area, not a sonik-specific embarrassment.
- **HITL approval verb set is binary (approved/not), no edit-args-before-execution.** LangGraph's `interrupt()`/`Command` pattern supports approve-as-is, edit, or reject-with-feedback; sonik has no "edit the model's proposed args before approving" path. Study: LangGraph interrupts docs (§6).
- **No sandboxed extensibility model** (not currently a gap since sonik has no plugin system at all — but if one is ever added, open-webui's `exec()`-in-process pattern is the concrete anti-example to avoid; ui-dojo's Mastra `createTool` typed-schema-per-file model is the concrete positive example).

### Where we're ahead — validated, refuted, or mixed

- **Execution-inert renderer: VALIDATED as a genuine, strong advantage.** Sonik's spec-repair'd JSON-UI never executes model-authored code; open-webui's plugin system runs raw model-influenced Python via `exec()` in-process with no sandbox (`utils/plugin.py:281`) — a real, concrete anti-example this review directly confirmed by reading the code, not inferring from docs. This maps cleanly onto CopilotKit's safest taxonomy tier ("Controlled Generative UI").
- **Signed host-context envelope: MIXED.** The cryptographic implementation itself (HMAC, timing-safe compare, multi-factor validity, documented incident-driven size-cap fix) is solid and arguably better-engineered than anything found in open-webui's equivalent surface. But it is **not yet delivering the guarantee it's being credited for**: (a) it shares one signing root across identity and authorization with no rotation/revocation path, unlike the separation LangGraph's checkpointer model implies; (b) per risk #1 above, a cryptographically sound envelope carried an insecure default (standing grant overriding "ask") — soundness of the signature doesn't equal soundness of the policy it authorizes. Call this "well-built, not yet fully sound" rather than "ahead of the field."
- **Draft-only approval doctrine: NOT YET VALIDATED, status unknown.** Directionally correct and consistent with LangGraph interrupt semantics and CopilotKit's controlled-GenUI framing — but the resolution-plan doc marks its concrete implementation (Slice A) as unimplemented and ungated as of 2026-07-08, and this review could not confirm whether `f0890e4` on current HEAD actually closes it. **Do not repeat this as a settled strength until that's confirmed against current HEAD**, not the pinned review worktree.

---

## 5. Onyx deep-research & multi-agent (merged from dedicated dive)

*This section is relayed verbatim-in-substance from a separate dedicated onyx-dive agent's report to team-lead. It was not independently re-verified against onyx's source by this reviewer — treat file:line-level claims within it as secondhand pending direct spot-check.*

- Hand-rolled agent loop, **not** LangGraph: clarify → plan → orchestrator, bounded to ≤8 cycles, `tool_choice=REQUIRED` on each step, a dedicated `generate_report` stop tool, plus a 30-minute wall-clock force-stop independent of cycle count.
- Multi-agent fan-out via a thread pool, capped at ≤3 parallel sub-agents, enforced by prompt rather than a hard scheduler limit; each child gets a fresh context (no shared history bleed); failures are converted into synthetic failure messages fed back to preserve strict-provider invariants (i.e., the parent always sees a well-formed turn even when a child errors).
- Citations are mechanical bookkeeping only — a `collapse_citations` renumbering pass, with **no verification or reranking** of the underlying claims.
- UI/timeline protocol: a `Placement{turn, tab, sub_turn}` discriminated union, with a `TopLevelBranching` pre-announcement event that lets the client pre-allocate UI tabs before the corresponding content streams in.
- Evals: Braintrust, but **tool-assertion-only** — no LLM-judge scoring, no deep-research-quality evals. Flagged by the dive as a gap in onyx's own system, not just a sonik gap.

**Relayed verdict (adopt/adapt/skip for sonik-agent-ui):**
- **Adopt (S):** the `Placement`/`TopLevelBranching` packet-protocol idea for pre-announcing UI structure before content streams in; bounded-loop-with-forced-synthesis-on-timeout as a second runaway guard alongside `stepCountIs`; synthetic-failure-message injection as a pattern for any future sub-agent call so a parent turn never sees a malformed history.
- **Adapt:** the `think_tool` reasoning-scratchpad trick; the clarify-before-plan gate; isolated-DB eval sessions (useful eval-infra idea independent of the multi-agent context).
- **Skip as premature for an embedded copilot:** sub-agent fan-out and citation-merge machinery — sonik's scope (booking-artifact generation, not open-ended multi-source research) doesn't currently justify either.

---

## 6. Prioritized improvement list (max 10)

Ordered by consequence, not by effort. Each ties to evidence gathered directly in this review.

1. **[S] Verify and close R5.** Confirm whether `f0890e4` makes "ask" actually gate execution, not just visibility. If not closed, ship Slice A (strip publish/commit tools from the mounted set for creation flows) before repeating the draft-only claim. *Evidence: `docs/plans/experience-seams-resolution-plan-2026-07-08.md` §0, `command-catalog.ts:155`.*
2. **[M] Build the rendered-E2E Playwright lane** (the resolution plan's own unbuilt "Slice G"/R7) that exercises the real commit path under a real signed session. This is the only thing that would have caught R5, and it's explicitly out of scope for every existing test layer today. *Evidence: fork-C testing report; `tests/agent-eval/README.md` "Offline/local mode."*
3. **[S] Add a token/cost budget ceiling** alongside `stepCountIs(12)` as an independent runaway guard. *Evidence: `agent.ts:137`.*
4. **[M] Split `+server.ts`'s 824 lines** into parse / build-agent / stream-response layers. *Evidence: `+server.ts`, full-file line count and concern list in §2.2.*
5. **[S] Surface `claim_without_receipt` as at least a soft UI signal**, not telemetry-only — a hallucinated "saved" claim currently reaches the user unmodified before any detection fires. *Evidence: `spec-stream-tap-telemetry.ts:48`.*
6. **[M] Adopt OTel GenAI semantic conventions** (`gen_ai.request.model`, `gen_ai.usage.*_tokens`) in the telemetry layer so it's ingestible by Langfuse/Braintrust/Datadog without a bespoke schema. *Evidence: `agent-telemetry.ts:14-32` (console-only sink today); OTel GenAI semconv (§7).*
7. **[S] Extract duplicated skill-id string literals** (`"booking.context.create"` / `"booking-context-create"`) into one shared constant. *Evidence: `agent.ts:113`, `artifact-state.ts:328`.*
8. **[M] Add a rotation/versioning story for the host-context signing secret**, separating identity-signing from command-approval-signing where feasible. *Evidence: `workspace-services.ts:382,408-409`.*
9. **[S] Cap or debounce the per-chunk `resolveElementProps` dry-run** in `streaming-artifact.ts` to avoid O(n²) cost on large specs over a long stream. *Evidence: `streaming-artifact.ts:94-105`.*
10. **[S] Resolve the AGPL-3.0 vendored-but-unwired Odysseus drag/resize JS** before any release. *Evidence: `docs/reviews/ux-parity-ledger-2026-07-08.md`.*

---

## 7. Sources

**Internal (this repo, read at `origin/main` @ `aba57bf` via worktree):** `apps/standalone-sveltekit/src/lib/agent.ts`, `apps/standalone-sveltekit/src/routes/api/generate/+server.ts`, `runtime-skill-intent.ts`, `agent-prompt.ts`, `workspace-services.ts`, `tools/command-catalog.ts`, `packages/tool-contracts/src/index.ts`, `trusted-intake-controller.ts`, `artifact-state.ts`, `apps/standalone-sveltekit/src/lib/artifacts/streaming-artifact.ts`, `packages/json-ui-runtime/src/spec-repair.ts`, `agent-telemetry.ts`, `spec-stream-tap-telemetry.ts`, `run-event-log.ts`, `packages/core/src/types.ts`, `tests/unit/*`, `tests/agent-eval/*`, `scripts/harness/*`, `docs/plans/experience-seams-resolution-plan-2026-07-08.md`, `docs/reviews/pressure-test-findings-2026-07-08.md`, `docs/reviews/ux-parity-ledger-2026-07-08.md`.

**open-webui** (`/Users/danielletterio/Documents/GitHub/sonik-dev/amplify/open-webui`): `backend/open_webui/functions.py`, `backend/open_webui/utils/plugin.py`, `backend/open_webui/retrieval/utils.py`, `backend/open_webui/retrieval/vector/dbs/*`, `backend/open_webui/routers/evaluations.py`.

**Local reference repos (agent-pattern skim only):** odysseus (`src/tool_policy.py`, `routes/chat_routes.py`, `src/tool_security.py`); ui-dojo (`src/mastra/workflows/approval-workflow.ts`, `src/mastra/agents/hitl-planning-agent.ts`); json-render upstream `examples/harness-chat` (`app/api/agent/route.ts`, `lib/agent.ts`); open-design (`apps/daemon/src/tool-loop-guard.ts`, `packages/contracts/src/critique.ts`, `packages/contracts/src/sse/chat.ts`).

**External (July-2026 web research, 12 sources):**
- [Agents: Overview — AI SDK](https://ai-sdk.dev/docs/agents/overview)
- [Vercel AI SDK 6: Building Production Agents with ToolLoopAgent and MCP — xplodivity](https://xplodivity.com/explore/vercel-ai-sdk-6-toolloopagent-mcp-typescript-2026)
- [Mastra Docs — Agents overview](https://mastra.ai/docs/agents/overview)
- [Mastra — GitHub](https://github.com/mastra-ai/mastra)
- [Claude Agents SDK vs. OpenAI Agents SDK vs. Google ADK — Composio](https://composio.dev/content/claude-agents-sdk-vs-openai-agents-sdk-vs-google-adk)
- [Interrupts — LangChain Docs](https://docs.langchain.com/oss/python/langgraph/interrupts)
- [LangGraph JS — Human-in-the-Loop Guide](https://langgraphjs.guide/human-in-the-loop/)
- [Semantic conventions for generative client AI spans — OpenTelemetry](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/)
- [semantic-conventions-genai — GitHub](https://github.com/open-telemetry/semantic-conventions-genai)
- [Inside the LLM Call: GenAI Observability with OpenTelemetry — OpenTelemetry blog](https://opentelemetry.io/blog/2026/genai-observability/)
- [Agent observability: The complete guide for 2026 — Braintrust](https://www.braintrust.dev/articles/agent-observability-complete-guide-2026)
- [LLM-as-a-Judge — Langfuse Docs](https://langfuse.com/docs/evaluation/evaluation-methods/llm-as-a-judge)
- [The Developer's Guide to Generative UI in 2026 — CopilotKit](https://www.copilotkit.ai/blog/the-developer-s-guide-to-generative-ui-in-2026)
- [Generative UI — CopilotKit](https://www.copilotkit.ai/generative-ui)
- [GitHub — CopilotKit/generative-ui](https://github.com/CopilotKit/generative-ui)
- [Copilot Agents 2026: 9 Patterns That Actually Work in Production — EPC Group](https://www.epcgroup.net/blog/microsoft-copilot-agents-complete-enterprise-guide-2026)

*Scope note carried from the web-research fork: OpenAI Agents SDK's and Anthropic's Claude Agent SDK's own primary docs were not directly fetched (only third-party comparison pieces) — a gap to fill if primary-source citations for those two specifically are needed later.*

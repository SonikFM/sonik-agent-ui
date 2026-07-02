# Sonik Agent UI vs Open Design — Architecture Gap Analysis + Retrofit Plan

Date: 2026-07-01
Repo: `/Users/danielletterio/Documents/GitHub/sonik-agent-ui`
Donor: `/Users/danielletterio/Documents/GitHub/open-design` (pulled to latest upstream today)
Supersedes focus of: `agent-ui-open-design-feature-suite-upgrade-2026-07-01.md` (live artifacts de-prioritized — already good, Odysseus-sourced)

---

## TLDR

Sonik Agent UI's streaming foundation is already modern: Vercel AI SDK UI-message
streaming with `pipeJsonRender`, typed host/page context, and the partial-json
island copied from Open Design. What Open Design has that Sonik is missing is
**not rendering** — it is the *lifecycle and contract layer around a run*:

1. **User-visible, attachable context** (composer context chips, persisted per message)
2. **Runs as persisted, resumable objects** (event logs, reattach, Continue affordance)
3. **A versioned streaming event protocol** owned as a shared contract (incl. live tool-input deltas)
4. **Per-turn skill composition** instead of a monolithic system prompt

Recommended order: run lifecycle first (reliability), context sources second
(UX leap), live tool-input streaming third (wow-per-effort), skill composition
fourth, analytics/gate fifth.

---

## 1. What was compared

### Sonik seams verified directly

| Seam | Location |
|---|---|
| Streaming endpoint | `apps/standalone-sveltekit/src/routes/api/generate/+server.ts` — `createUIMessageStream` + `pipeJsonRender` + `pipeArtifactToolOutputsToSpecParts` |
| Agent + system prompt | `apps/standalone-sveltekit/src/lib/agent.ts` — `ToolLoopAgent`, monolithic `AGENT_INSTRUCTIONS` |
| Context model | `AgentPageContext` (`@sonik-agent-ui/tool-contracts`), `HostSessionEnvelope` (`@sonik-agent-ui/platform-adapters`), trusted host header, approved-command allowlist |
| Render system | `apps/standalone-sveltekit/src/lib/render/` — component-registry, catalog, json-render-state-controller, question-state; 33 registered components |
| Artifact streaming | `apps/standalone-sveltekit/src/lib/artifacts/artifact-stream.ts` |

### Open Design seams verified directly

| Seam | Location |
|---|---|
| Context contract | `packages/contracts/src/api/context.ts` — `RunContextSelection`, `WorkspaceContextItem` (10 kinds) |
| Composer context UI | commit `31d98634c` "feat(web): add composer context sources (#4869)" — `ChatComposer.tsx`, `ComposerPlusMenu.tsx`, `ContextChipHoverCard.tsx`, `workspace-context.ts`, `ProjectReferenceModal.tsx` |
| Chat/run contract | `packages/contracts/src/api/chat.ts` — `ChatRequest`, `ChatRunStatusResponse`, `PersistedAgentEvent`, `ChatMessage.runContext`, `resumable`, `eventsLogPath`, `promptCache` diagnostics |
| Streaming protocol | `packages/contracts/src/sse/chat.ts` — `CHAT_SSE_PROTOCOL_VERSION`, `DaemonAgentPayload` union (`text_delta`, `thinking_delta`, `tool_use`, `tool_input_delta`, `usage`, live-artifact events) |
| Resume semantics | `apps/web/src/runtime/resume.ts` — canonical `RESUME_CONTINUE_PROMPT`; resume vs retry distinction |
| SSE reconnect | `apps/web/src/providers/project-events.ts` — exponential backoff, reset on `ready`, injectable test seams |

---

## 2. The gaps (Open Design → Sonik)

### Gap 1 — Context as a first-class, user-visible object

Open Design (#4869, merged 2026-07-01): `RunContextSelection` carries
`skillIds`, `pluginIds`, `mcpServerIds`, `connectorIds`, and `workspaceItems`
with ten typed kinds (`file`, `folder`, `project`, `local-code`, `browser`,
`terminal`, `side-chat`, `live-artifact`, `design-files`, `design-system`).
Users attach these as composer chips with hover cards; the selection is
persisted on each message (`ChatMessage.runContext`).

Sonik today: context is implicit and one-shaped — signed host session +
`AgentPageContext` injected server-side into the system prompt. Well-typed, but
invisible, non-editable, and not persisted per turn.

Sonik translation: chips for `document`, `artifact`, `booking-context`,
`page`, `command-family`, `runtime-skill`.

### Gap 2 — Runs as persisted, resumable objects

Open Design: every run has `runId`, a status object, and a per-run JSONL event
log mirroring the SSE stream (`eventsLogPath`) → reattach after reload;
messages rebuild `producedFiles` from a `preTurnFileNames` diff baseline.
Failed runs carry `resumable`, driving a "Continue the run" affordance with a
canonical resume prompt — deliberately distinct from retry-from-scratch.
Per-run prompt-cache diagnostics (`stablePromptHash`, hit/missReason).

Sonik today: a stream with telemetry. Reload or Worker hiccup mid-turn → the
turn is gone. Given the recurring stale-deploy / missing-host-context failures,
this is the highest-leverage reliability import.

### Gap 3 — Versioned streaming protocol as a shared contract

Open Design: `CHAT_SSE_PROTOCOL_VERSION` + `DaemonAgentPayload` union with an
explicit mapping to persisted events (`daemonAgentPayloadToPersistedAgentEvent`).
Producer and consumer share one type "so they can't drift." Notable member:
`tool_input_delta` — live incremental tool-call JSON args, accumulated by
content-block id, so the UI previews code/spec generation while the model is
still emitting it.

Sonik today: AI SDK `UIMessageChunk` gives some of this for free, but Sonik
does not own a persisted event union and does not render tool-input deltas.
Streaming `createJsonArtifact` specs live into the canvas is the "streaming UI
feels alive" quality gap.

### Gap 4 — Per-turn skill composition

Open Design: `ChatRequest.skillIds` are @-mentioned in the composer and
concatenated into the system prompt for that run only — never persisted onto
the project.

Sonik today: `AGENT_INSTRUCTIONS` is a single enormous block (booking command
conventions + artifact rules + page-context rules, permanently). The runtime
skill registry (`searchSkillCatalog`/`learnSkill`) already exists; the missing
move is letting selected skills compose the system prompt per turn.

### Gap 5 — Error taxonomy + analytics contracts (smaller, cheap)

- Structured `code` on error status events (`AGENT_AUTH_REQUIRED`,
  `RATE_LIMITED`) driving error-specific affordances. Sonik's
  `missing-host-context` deserves a typed code + targeted "reconnect host
  context" affordance instead of a dead chat.
- `ChatAnalyticsHints`: `entryFrom` enums, `turnIndex`, `isFirstRun`,
  `hasExistingArtifact` → "did this session reach an artifact, and on which
  turn?" becomes queryable. Maps directly onto Pipe-B.

### Already at parity (do NOT retrofit)

- AI-SDK UI-message streaming + `pipeJsonRender` artifact piping
- Typed page context with sanitization and length caps
- Trusted host envelope + approved-command allowlist
- partial-json island (already copied from Open Design)
- Live artifacts (Odysseus-sourced; explicitly de-prioritized)

---

## 3. The plan

### Phase 1 — Run lifecycle hardening (size L, no deps)

Goal: every agent turn is a persisted, resumable run.

1. `run` contract (new `@sonik-agent-ui/run-contracts` or extend
   `tool-contracts`): `runId`, status (`running | succeeded | failed |
   canceled`), `resumable`, timestamps, correlation IDs.
2. In `api/generate/+server.ts`, tee the UI-message stream into a persisted
   per-run event log (`run_events` table via existing `DATABASE_URL`).
3. Reattach on reload: history loads persisted run events and rebuilds the
   message including artifact/tool parts.
4. "Continue" affordance on failed runs, canonical resume prompt, distinct
   from retry.
5. Typed error codes: `MISSING_HOST_CONTEXT`, `RATE_LIMITED`,
   `STALE_DEPLOYMENT` — each with a specific UI affordance.

Verify: Playwright — kill connection mid-stream, reload, assert reattach +
Continue completes. Pipe-B smoke asserts run rows.

### Phase 2 — Composer context sources (size L, depends on 1)

Goal: Sonik's version of open-design #4869.

1. `AgentRunContextSelection` contract with kinds: `document`, `artifact`,
   `booking-context`, `page`, `command-family`, `runtime-skill`.
2. Composer plus-menu + chips + hover card (mirror
   `workspaceContextKindLabel` / `workspaceContextDetailLine`).
3. Auto-seeded chips from host context (current page, active document),
   user-removable; removal is authoritative.
4. Persist selection per message; render as provenance in history.
5. Server: `resolveAgentPageContext` consumes the explicit selection.

Deliverable: `manifests/copy-retrofit/open-design-run-context.json`
(same style as `open-design-intake.json`: small, behavior-focused, test-backed).

Verify: Playwright — attach document chip → message records selection, agent
uses it; removed chip stays removed after send.

### Phase 3 — Live tool-input streaming (size M, parallel with 2)

1. Check AI SDK streaming-tool-args support (may provide transport for free).
2. Accumulate deltas through partial-json island into
   json-render-state-controller so components mount as the spec streams.
3. Gate to `createJsonArtifact` / document tools.

Verify: first component mount timestamp < stream-end timestamp.

### Phase 4 — Per-turn skill prompt composition (size M, depends on 1, 2)

1. Split `AGENT_INSTRUCTIONS`: small core (identity, safety, rendering
   basics) + skill bodies in the runtime skill registry.
2. `skillIds` on generate request — auto-seeded from page context + Phase 2
   skill chips; concatenated per run only.
3. Regression-guard with booking intake Pipe-B smokes; use Phase 1's
   persisted runs for before/after evidence.

Verify: smokes pass unchanged; standing prompt token count drops measurably.

### Phase 5 — Analytics hints + release gate (size S, depends on 1)

1. `AgentAnalyticsHints`: `entryFrom` (launcher chip, composer,
   question-answer, resume-continue), `turnIndex`, `isFirstRun`,
   `hasExistingArtifact` — stamped onto Pipe-B run events.
2. Extend the release gate (per feature-suite handoff Rank 1) to assert run
   persistence + reattach in the deployed environment.

Verify: Pipe-B artifact-reached-by-turn distribution query; gate green.

### Sequencing

| Phase | Size | Depends on |
|---|---|---|
| 1 Run lifecycle | L | — |
| 2 Context sources | L | 1 |
| 3 Tool-input streaming | M | — (parallel with 2) |
| 4 Skill composition | M | 1, 2 |
| 5 Analytics + gate | S | 1 |

Phases 1 and 3 can start immediately and in parallel.

---

## 4. Strategic tie-in (web builder fast-follow)

Per `/Users/danielletterio/Documents/Sonik_Amplify/prds-vision-2026-05-01/web-builder-prd-vision-2026-05-01.md`
§5 and `prd-registry-editor-assumptions-v2-2026-04-17.md`:

- The builder is an ecosystem-stickiness layer, not a Framer competitor
  (U1/blind-rank explicitly killed in assumptions v2). Nothing in this plan
  waits on builder scoping.
- Web-builder PRD §5 commits to registry-constrained AI over json-render with
  typed `ComponentContract`s. Phase 2 (persisted per-run context selection)
  and Phase 4 (registry-grounded, skill-composed prompting) are exactly the
  "AI co-author grounded in the registry" plumbing that PRD assumes — this
  work is direct groundwork for the fast-follow.

## 5. Notable recent Open Design commits (donor freshness)

```txt
31d98634c feat(web): add composer context sources (#4869)   ← Gap 1 donor
6be4e5654 feat(workspace): add plan mode and Excalidraw sketch flows (#4862)
27e89e83e feat(files): add HTML file version history (#4872)
56d51b8c9 [codex] Handle AMR stderr balance retries (#5015)
572b87cfc Classify opaque runtime failure details (#4966)   ← Gap 5 error-taxonomy donor
```

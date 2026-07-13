# Stop-Gate Package — 2026-07-12

**GATE 1 CLEARED — RATIFIED BY DAN 2026-07-12 (evening).** All five decisions:
Tier A ports (all four; `idempotent` ships only wired to real retry logic),
Tier B pattern inventory (n8n = reimplement-only, hard license line), all three
contract fixes (MCP transport/authMode; registry GENERATED from the 113-command
booking manifest; agent-definition loader), framework = **STAY** on AI SDK +
Sonik contracts (memory stack explicitly not mourned — Dan has his own memory
direction, separate future track; studio/playground inspiration comes from the
Dify walkthroughs), Tier C read-only scope. Gate 2 (bring-ups, one at a time,
Dan's clock) is open.

Everything staged for Dan's return, per the agreed research process. Three gates:
(1) review this preliminary evaluation → (2) bring-ups one by one on Dan's clock →
(3) guided walkthroughs with OTel capture → final findings → deep interview →
Ralph plan.

## 1. Copy-retrofit preliminary evaluation (pre-runner candidates)

Full per-donor detail in `docs/research/copy-retrofit-prerunners/{n8n,activepieces,
flowise-composio,dify-plugin-daemon}.md`. Ranked, deduplicated, license-checked.

### Tier A — port near-verbatim (small, license-clean, lands in tool-contracts)

| # | Item | Donor / license | Size | Lands in |
|---|---|---|---|---|
| A1 | Waitpoint Zod contract (one pause primitive: PENDING→COMPLETED, unique (runId,stepName), pre-completed race check) | activepieces / MIT | 24 LOC | pause/HITL primitive under workflow-run-state |
| A2 | `audience: human\|ai\|both` + `aiMetadata.idempotent` capability fields | activepieces / MIT | 19 LOC | capability-registry descriptor — CAVEAT: donor never enforces `idempotent`; wire it into retry logic or don't ship it |
| A3 | `min/maxSupportedRelease` + `isSupportedRelease()` host-compat gate (fail-open) | activepieces / MIT | 12 LOC + semver | manifest schema — decide ONE host-release anchor first |
| A4 | Date-stamp version + `latest` resolution util — INVERT default to pinned | Composio / MIT | ~30 LOC | registry version resolution |

### Tier B — reimplement from spec (pattern ports; vendoring blocked or pointless)

| # | Item | Donor / license note | Spec quality | Lands in |
|---|---|---|---|---|
| B1 | EngineRequest/EngineResponse chokepoint (agent loop asks ENGINE to run tools; every call audited) | n8n / **Sustainable Use License — never vendor** | extracted | controller cutover; capability gate placement |
| B2 | VersionedNodeType registry (`{version: impl}` resolution) | n8n / SUL | 30-line spec | capability version axis |
| B3 | Type-derived Zod (`z.ZodType<T>`) convention | n8n / SUL | trivial | tool-contracts hygiene |
| B4 | IWaitingNode join-barrier scheduler (fan-in convergence) | Flowise / Apache 2.0 (entangled with their node model) | ~200 LOC shape | controller Phase 3b/6 |
| B5 | Content-addressed package identity (`identity@sha256`, idempotent installs) | dify-plugin-daemon / Apache 2.0 | precise spec | packageVersionId + manifestHash enforcement |
| B6 | RPC-boundary per-call permission dispatch table (their upload-file always-allow listed as anti-pattern) | dify-plugin-daemon / Apache 2.0 | precise spec | where evaluateCapabilityAccess wires at execution |
| B7 | Offline RSA signature over file-hashes + timestamp — INVERT their off-by-default enforcement | dify-plugin-daemon / Apache 2.0 | precise spec | package signing (R6) |
| B8 | Meta-tool discovery wire contract (search → plan → multi-execute). No server code exists to copy — hosted-side only | Composio / MIT (client types only) | wire schema | `search_capabilities` + `multi_execute` meta-commands over the 113-command registry |
| B9 | Confirm-page-then-POST resume (scanner-prefetch defense) | activepieces / MIT | ~120 LOC logic | only when external-channel (email/Slack) approvals ship |
| B10 | SessionContext re-entrancy (`ctx.execute`) — MUST route through our approval gate (donor's version has none; do not reproduce their gap) | Composio / MIT | 25-line interface | custom nodes/tools, post-cutover |

### Tier C — read-for-technique only (license or shape forbids copying)

- **odysseus (AGPL)**: skill-extractor pipeline (agent runs → SKILL.md candidates — direct input to marketplace package authoring), plan-mode read-only tool gating by inversion, fresh-context verifier subagent. Reimplement concepts only.
- **openhuman**: `MemoryTaint` provenance-as-tool-gate (Internal vs ExternalSync, fail-closed) and the untrusted-source prompt wrapper at the memory→prompt boundary — both directly relevant to our host-context trust story; cheap-first admission scoring. Verify license before any code movement.
- **OpenAgent** (Go): working skill-marketplace source adapters + lazy `load_skill` tool (thin catalog, full content on demand) + per-workspace merged tool registry. Closest existing implementation of our R3 discovery surface; verify license.
- **Onyx**: connector registry (`CONNECTOR_CLASS_MAP` + capability mixins + lazy import) as registry-shape reference; `DynamicBottomSpacer` + `MinimalMarkdown` as small chat-surface port candidates; admin nav as category checklist.

### Contract fixes surfaced by the scans (do regardless)

1. `mcpAddonDefinitionSchema`: add `transport: stdio|sse|http` + `authMode` discriminator (open-design finding — most real MCP servers are not stdio).
2. Capability registration generated from booking-service `bookingOperationManifest` (113 commands / 15 families) with drift verification — never hand-written.
3. Sonik agent definition: `agentDefinitionSchema` (marketplace.ts) + a runtime loader — the STAY decision's follow-up; keep field names Mastra-adjacent for cheap future interop.

### Framework decision (pending Dan's ratification)

**STAY on Vercel AI SDK + Sonik contracts** (`docs/research/mastra-vs-ai-sdk-decision-2026-07.md`).
Deciding facts: Mastra has no approval authority (resume payload `any`, zero identity
— source-verified `agent.approveToolCallGenerate` requires only runId/toolCallId);
weekly breaking renames on the stable channel + the Mar–Jun 2026 npm supply-chain
compromise wave touched their package; we already ship what a switch would rewrite.
Steal their memory-config shape as a Sonik contract; agent definition stays native.

## 2. Bring-up readiness (one at a time, Dan's clock)

| Tool | Path | RAM | Conf. | Dan must provide | Watch-outs |
|---|---|---|---|---|---|
| n8n | `npx n8n` → :5678 | light | ~95% | LLM key only if exercising AI nodes | OTel: one env flip (`N8N_OTEL_ENABLED`) |
| Flowise | `npm i -g flowise && npx flowise start` → :3000 | ~2GB floor | ~85% | signup email/pw; LLM key; **EE license if Workspace/Roles capture wanted** | Workspace/Roles EE-gated, no bypass; node engine ^24 vs host v26 flagged |
| Langflow | `uv pip install langflow -U; uv run langflow run` → :7860 | 0.3–0.6GB proc; 1.5–3GB venv | 85–90% | LLM key; decide `LANGFLOW_DO_NOT_TRACK=true` | multi-minute install (torch); AUTO_LOGIN on |
| activepieces | source dev mode (`npm start`, PGLITE+memory queue) | 1.5–3GB | ~80% | nothing beyond Node 22 PATH fix (documented) | **Todos approval inbox absent from OSS** — capture approval piece + forms instead |
| Dify (Dan's fork) | runbook, 11 containers | heaviest | 80–85% | LLM key post-boot | agent_backend/local_sandbox/plugin_daemon are hard deps; start Docker Desktop first |
| OpenAgent | `go run main.go` (:14000) + `yarn start` in web/ (:13001); SQLite fallback | light | high | LLM key in-app | marketplace UI is the capture target |
| Onyx | Onyx Lite overlay compose → :3000 | <1GB claimed | high | LLM key via admin UI | port 3000 collides with Flowise — one at a time anyway |
| odysseus | `./start-macos.sh` → :7860 | <1GB app | high | Ollama or provider key | port 7860 collides with Langflow — one at a time |
| openhuman | headless compose :7788 in 5 min; full UI needs Tauri build + hosted backend | light headless | medium | tinyhumans.ai account for full UI (not fully self-hostable) | memory vault (SQLite+Markdown) inspectable without UI |
| open-design | already local; `pnpm tools-dev` (daemon :7456, currently down) | light | high | nothing | inspect-not-boot; MCP tools return active-context |

Runbooks: `docs/research/*-local-bringup-runbook-2026-07.md` and `*-scan-and-bringup-2026-07.md`.

## 3. Walkthrough kit

- **Scorecard**: `docs/product/agent-workspace-marketplace/deep-dive/capture-scorecard.html`
  — per-screen STEAL/FINE/AVOID verdicts + notes, localStorage-persisted, JSON export.
  Serve the deep-dive folder (`python3 -m http.server 8791`) and open in Chrome.
- **OTel**: `docs/research/local-otel-capture-plan-2026-07.md` (being finalized).
  Survey verdicts: n8n native traces (env flip); Dify native traces+metrics
  (ENABLE_OTEL); Flowise metrics-only natively — Phoenix credential is the trace tap;
  Langflow — Langfuse/LangWatch taps; activepieces — OTLP logs only, NDJSON file
  drain cheapest; Onyx — Langfuse-native, no OTel.
- 12-screen Dify capture shortlist + per-tool checklists pre-seeded in the scorecard.

## 4. Known unknowns going into the interview

1. Live-cutover sequencing (Phase 3a-2) and source-pinned test updates.
2. Registry generation from the 113-command manifest (decision now cheap).
3. Review surface design (D011) — no OSS precedent exists for an approvals queue;
   Dify's human-input form is the only benchmark and it's a pause, not a queue.
4. Standing/recurring agent grants (Dan's deferred-approval idea; WS6 agent calendar
   is the first consumer) — nobody in the field has this either.
5. Isolation posture for third-party packages: review-only trust (Dify's actual
   shipped posture) vs budgeting a real sandbox. Explicit accepted-trade-off decision.
6. SDK-on-any-website embed safety envelope.
7. Admin console tiering (plan addendum 4.5) — Flowise EE-gating means our Tier-2
   multi-tenant screens have no free OSS benchmark; Onyx's admin nav is the best
   category checklist.
8. Framework decision ratification (STAY recommendation above).

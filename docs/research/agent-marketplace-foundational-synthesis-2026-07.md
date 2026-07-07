# Agent Marketplace — Foundational Research Synthesis (L1–L3)

Status: INTERIM (foundational lanes complete; L4–L5 pending) · 2026-07-06
Sources: `lane-L1-agent-marketplaces-2026-07.md`, `lane-L2-workflow-template-marketplaces-2026-07.md`, `lane-L3-permission-trust-supplychain-2026-07.md`
Posture: thorough (≥2 sources per load-bearing claim); horizon July 2026.

## The one finding all three lanes reached independently

**Install-time approval is where every 2025–2026 marketplace breach succeeded, and it is insufficient on its own — the real exploits are runtime and update-time.** L1 (ForcedLeak, ClawHub ClawHavoc), L2 (ClawHub 341→800+ malicious skills evading scanners), and L3 (Nx Console 3,800-repo exfil via poisoned *update*, GlassWorm, Shai-Hulud npm worm, MCP tool-poisoning) converged from three different angles. Three independent lanes agreeing is the strongest signal in this pass.

Corollary the lanes agree on: **the most-exploited failure mode is a trusted publisher pushing a malicious update to an already-installed package** — not a cleverly disguised first-time submission.

## Where Sonik is genuinely AHEAD (position these as claims, not defaults)

1. **Execution-inert JSON-render + trusted-controller-commit.** Most leaders either allow code execution on install (ClawHub) or ship advisory-only trust signals (Hugging Face/ARD). Our renderer literally cannot execute — that's a category-leading safety posture.
2. **"Chat is never authorization."** L3: this doctrine sidesteps the single most historically-exploited pattern (OAuth-consent/click hijacking — 2017 Google Docs worm, 2023 ChatGPT plugin OAuth flaw). We already avoid it by design.
3. **Immutable `packageVersionId`.** L2: nobody else gives installed copies durable version identity or an update path — everyone else is snapshot-and-fork. Differentiator to lean into.

## Where Sonik is BEHIND or has dangerous gaps (the deltas that should change our model)

| # | Delta | Source | Recommendation |
|---|---|---|---|
| D1 | **No install-time human gate** — the exact moment every headline breach succeeded | L3 #1, L1, L2 | Highest-risk gap. Add a plain-language install screen (publisher, requested command families, mutating-vs-read-only) before any package registers. Chrome-level plainness closes most of it — doesn't need CASA rigor. |
| D2 | **Provenance/trust-tier is conflated into `off/ask/allow`** | L1 #1 | Make trust-tier a first-class attribute (first-party / verified-partner / community), shown at discovery, independent of both `kind` and the runtime grant. Microsoft's Agent Store is the reference. |
| D3 | **Immutable install ≠ safety over time** — exploits were runtime on approved packages | L1 #2, L3 | Pair immutable installs with a post-install kill-switch + per-install Activity view. Install approval is not permanent trust. |
| D4 | **`off/ask/allow` is coarser than enterprise peers; and "ask" rubber-stamps** | L1 #3, L3 #3 | Add a scope axis (which data/API boundary a grant covers). Anthropic's own data: pure per-action prompts degrade to ~93% blanket approval — pair "ask" with blast-radius containment (scoped tokens) and instrument approval-rate metrics from day one. |
| D5 | **Unregistered free-string capability IDs** | L3 #2 | Stand up a registered, versioned capability-ID namespace before scale. VS Code's "verified" badge persisted after malicious changes because it wasn't re-evaluated — free strings create the same staleness. Cheap now, expensive once IDs are squatted. |
| D6 | **Envelope may be over-uniform** — `provider_integration`/`mcp_addon` should "enable a live connection," not fork-and-own | L2 #2, L1 | Differentiate install semantics by kind rather than one uniform install verb. |
| D7 | **Curated human review > scan-and-approve** before third-party publishing | L1, L2, L3 #5 | Prompt-injection detection is unsolved industry-wide (OWASP/NSA/CISA). Lean on our execution-inert architecture + human review; do NOT build the roadmap on automated scanning catching malicious skills. |

## Uninstall/revocation stance (L3 #4)

Design revocation as "stop trusting going forward," not "guarantee all downstream copies purged" — matches how Shopify/Google actually operate. Don't over-promise purge semantics.

## Implication for our current corpus

- `DECISIONS.md` D001 (unified envelope) needs a caveat: install *semantics* should vary by kind (D6).
- The vision-review's earlier "critical" findings (install has no gate; `off/ask/allow` unenforced) are now externally corroborated as the two highest-risk items — matches D1 and D4.
- Our PRD §3 invariants (execution-inert, chat-is-never-auth) are validated as competitive strengths, not just internal rules.

## What L4/L5 should now target (refined by the foundation)

- **L4 (business/moderation, light-touch commerce):** the moderation half is now the priority over monetization — dig into curated-review operations (how Microsoft/Salesforce staff review, verified-partner programs) and creator-economy rev-share ranges (Dify 50%, CrewAI/Gumloop planned) as forward context. Add: post-install monitoring/kill-switch operational models (D3).
- **L5 (vertical + wow-UX):** unchanged focus, plus one addition — how vertical marketplaces (Toast/Square/ServiceTitan) present trust-tier and permissions at install without killing the "wow" (reconcile D1/D2 with the frictionless install→value path from L2's Zapier Guided Templates pattern).

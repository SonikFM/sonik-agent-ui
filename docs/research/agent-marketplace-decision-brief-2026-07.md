# Agent Marketplace — Decision Brief

Status: FOR RATIFICATION · 2026-07-06 · Owner: Dan
Basis: 5-lane deep-research pass (L1–L5, thorough posture, horizon July 2026) + foundational synthesis.
Detail: `lane-L1…L5-*.md`, `agent-marketplace-foundational-synthesis-2026-07.md`.

> This brief turns the research into decisions you ratify. Each item: the decision, the evidence, a recommendation, and whether it needs your sign-off. Ratified items flow into `docs/product/agent-workspace-marketplace/DECISIONS.md` and the PRD.

## The headline

The research found a **precisely-shaped, unclaimed market position** and a **thin industry frontier on the exact risk we worried about** — which together mean Sonik can lead rather than catch up, if it makes a few specific moves.

- **White space (L5):** the differentiator is *self-serve agent setup that ends in a real live action, with no human sales call and no multi-week shadow-mode trust ramp*. The closest competitor (RebootAI) connects to our exact stack (Toast/Square/Mindbody/ServiceTitan) but still gates trust behind a sales call + 2–4 week shadow period. Our preview→approve→receipt loop is a more advanced trust mechanism — if executed with discipline.
- **Thin frontier (L1–L4):** nobody has solved the #1 exploited risk (trusted publisher pushes a malicious update) cryptographically — the leaders rely on process + account-hardening. And post-install kill-switches are uneven-to-absent (Salesforce has none). These are places to get ahead, not gaps to backfill.
- **We're already ahead on:** execution-inert JSON-render + trusted-controller-commit, "chat is never authorization," and immutable `packageVersionId`. Position these as competitive claims.

## Decisions

### DR-1 — Adopt the fused "Intent Preview + Trust" screen as the core wow mechanic
**Evidence:** L5 — the industry solved "permission gate without killing flow" by *fusion, not sequencing*: one screen shows the concrete command AND the exact permission/action-tier, rendered from the same execution plan that runs (no cosmetic previews). Google's 2026 granular-consent redesign + emerging Suggest→Co-pilot→Autopilot tiers point the same way. This resolves the foundation's D1/D2 friction concern: the trust gate *is* the wow moment.
**Recommendation:** make this the canonical install/commit UX. Our existing approval card is the seed; upgrade it to show permission tier + reversibility inline, sourced from the same plan.
**Sign-off:** YES (UX direction).

### DR-2 — Build a per-install kill-switch as a first-class primitive
**Evidence:** L4 — even Salesforce lacks platform-side revocation of an already-installed capability; industry has "kill criteria without kill architecture." L1/L3 — the real exploits (ForcedLeak, Nx Console) were runtime on already-approved packages. Foundational D3.
**Recommendation:** ship a per-install kill-switch + per-install Activity view early. This puts us *ahead* of the market, not catching up.
**Sign-off:** NO (clear build; sequencing only).

### DR-3 — Make trust-tier a first-class, discovery-visible attribute with published revocation criteria
**Evidence:** L1 (Microsoft Agent Store shows named tiers separate from grants), L4 (nobody publishes falsifiable revocation criteria — Salesforce admits this in its own FAQ). Foundational D2.
**Recommendation:** add `trustTier` (first-party / verified-partner / community) to the package envelope, shown at discovery, independent of `kind` and the runtime grant — with *published* revocation criteria. Differentiator, not table stakes.
**Sign-off:** YES (taxonomy + policy).

### DR-4 — Add a scope axis to permissions; instrument approval-rate to catch rubber-stamping
**Evidence:** L1/L3 — `off/ask/allow` is coarser than enterprise peers; Anthropic's own data shows pure per-action prompts degrade to ~93% blanket approval. Foundational D4.
**Recommendation:** extend grants with a scope dimension (which data/API boundary), pair "ask" with blast-radius containment (scoped tokens), and instrument approval-rate metrics from day one. Sequence AFTER the tomorrow-planned `toolPolicy` enforcement (the off/ask/allow layer must actually enforce first).
**Sign-off:** NO (extends an already-planned slice).

### DR-5 — Stand up a registered, versioned capability-ID namespace before scale
**Evidence:** L3 — free-string IDs go stale like VS Code's "verified" badge (persisted after malicious changes). Foundational D5. Corroborates the vision-review's earlier free-string finding.
**Recommendation:** replace free-string `requiredCapabilities` with a registered enum/namespace now — cheap pre-scale, expensive once third-party IDs are squatted/ambiguous.
**Sign-off:** NO (internal hardening).

### DR-6 — Differentiate install SEMANTICS by kind (don't ship one uniform install verb)
**Evidence:** L2/L1 — `provider_integration`/`mcp_addon` should "enable a live connection," while `workflow`/`artifact_template` are fork-and-own. Foundational D6.
**Recommendation:** keep the unified envelope (D001 stands) but let install behavior vary by kind. Add a caveat to `DECISIONS.md` D001.
**Sign-off:** LIGHT (confirm the envelope-vs-semantics split).

### DR-7 — Curated human review + publish-credential MFA; do NOT bet on automated scanning
**Evidence:** All lanes — ClawHub's malicious skills evaded scanners; prompt-injection detection is unsolved (OWASP/NSA/CISA). L4 — Microsoft's dated MFA-enforcement timeline is the one concrete control that hits the actual exploited mechanism (credential theft), not exotic supply-chain tooling.
**Recommendation:** for any third-party publishing, require human/curated review + mandatory MFA on author accounts + re-review on update. Lean on our execution-inert architecture as the structural defense.
**Sign-off:** YES (moderation policy — but only relevant once third-party publishing is on the table; internal-only packages defer this).

### DR-8 — Monetization: freemium now, defer take-rate
**Evidence:** L4 — monetization is still settling; OpenAI's Apps SDK discloses no revenue share; the widely-cited "Dify 50%" is actually an affiliate/referral rate, NOT a marketplace fee (research correction — do not plan against it).
**Recommendation:** free tier + paid premium capability as the near-term lever; do not lock in a take-rate. Revisit when the commerce marketplace is actually scoped.
**Sign-off:** LIGHT (business direction).

## Sequencing recommendation

Near-term, low-regret (no design needed): DR-5 (capability namespace), DR-2 (kill-switch primitive), DR-4 (after toolPolicy). These harden the model regardless of when the marketplace ships.

Needs your design/policy sign-off before build: DR-1 (fused preview+trust UX), DR-3 (trust-tier + revocation policy), DR-7 (moderation, only when third-party publishing is real).

Defer: DR-8 take-rate, full commerce marketplace, browse/install UI (L5: build the "what my agent can do" dashboard first — it seeds the future surface).

## What did NOT change

Our core invariants (execution-inert renderer, chat-is-never-auth, immutable versioned installs, unified envelope) survived contact with the research as strengths. The changes are additive hardening + one UX reframe (the trust gate as the wow), not a rebuild.

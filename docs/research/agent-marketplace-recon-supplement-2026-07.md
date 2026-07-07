# Agent Marketplace — Recon-Mission Supplement

Status: FINAL · 2026-07-07 · Input for the product-documentation update decision
Sources: 4-lane Sonnet extraction of `~/Documents/Sonik_Amplify/recon-mission-2026-05-06` (332 files: strategy docs, 11 per-repo deep-dives, 9 cross-cutting patterns, referendum matrices, the May vision PRD corpus, summit source captures) read through the July-2026 research lens, plus direct verification of the load-bearing leads.
Companion: `agent-marketplace-decision-brief-2026-07.md` (the July web research). This supplement amends it.

## Headline: we don't need to invent most of this — we need to RESUME it

The single biggest correction to the July research: several things it recommended as *new* already have designed internal substrate in amp.pkg v3. The marketplace docs should reuse that vocabulary and pick up those specs, not create parallel concepts.

| July research said "build" | Internal reality (with refs) |
|---|---|
| Trust-tiers (DR-3) | **An 8-rung promotion ladder already exists** — untrusted-draft → docs-only → scaffolded → mock-backed → adapter-backed → sandbox-live → production-live → first-party-managed, each with named evidence requirements, live tier assignments for 12 real packages, and a working quarantine/demotion precedent (`BASELINE-amp-pkg-v3-architecture.md §11`). What's missing vs DR-3 is only the *published revocation criteria* and discovery-visible labeling. |
| Fused Intent-Preview+Trust screen (DR-1) | **Already spec'd as Priority Mockup #5 "Package Install / Connection Drawer"**: package identity, capabilities, proof tier, permissions, secrets, surfaces/CLI/agent-tools added, normalized data, known limitations (`BASELINE §12`). DR-1 is a resumption + the same-plan-renders-preview discipline from L5, not a blank page. |
| Registered capability-ID namespace (DR-5) | **Partially built**: `command-registry.csv` compiles one row into five consumers (TS dispatcher, MCP descriptor, Mastra tool wrapper, CLI, wizard form) under one `capability_id` (`STATEFUL-AGENT-AND-SURFACE-SEQUENCING.md` Pt 1). The namespace exists; it needs to become the marketplace's required vocabulary. |
| Kill-switch (DR-2) | **Half-exists in two forms, neither per-install**: `liveGuard: dry_run_default \| guarded_live` on every action (May PRDs, `substrate-shapes-frontend-registry-prd:113-116`) and platform-wide tier-demotion/quarantine (`BASELINE §11`). A **user-triggered per-install kill-switch is confirmed absent everywhere** — genuinely new design, as the July research said. |
| Freemium before take-rate (DR-8) | **Was already the house position**: Workflow Builder playbooks free at 0% to build author reputation, 20–30% take-rate later (`workflow-builder-prd:813-817`); recon explicitly disclaims pricing, so no internal contradiction exists. |

## The three-marketplace disambiguation (must go in every doc)

The corpus uses "Marketplace" for three unrelated things with unrelated sequencing:
1. **Commerce Marketplace** — B2B event commerce (venues/talent/ad inventory, Stripe Connect escrow). PRD exists; phased months 12–18+; starts with ONE listing type.
2. **amp.pkg package registry** — provider integrations with promotion tiers. This is the true internal ancestor of our "agent marketplace."
3. **Marketplace of Playbooks** — shareable versioned workflows, a Workflow Builder sub-feature (months 10–16). **The "dangling §4.14" is resolved: the Workflow Builder PRD exists in full (943 lines)** — `workflow-builder-prd-vision-2026-05-01.md:413-425`; the earlier "missing PRD" finding was a search miss.

Our agent marketplace = (2) + (3) converging. Docs must say so explicitly.

## Corrections to July research claims

1. **"No update path anywhere" needs tightening → "no update path for forked/copied templates."** Counter-examples at other layers: Twenty's `universalIdentifier` UUID-in-source makes deploy idempotently install/update/uninstall in place (`02-twenty.md §4`); n8n's `VersionedNodeType` ships multiple node versions simultaneously with workflows pinning a `typeVersion` (`05-n8n/CODE-EXCERPTS.md:106-158`); Directus gates installs on host-version compatibility. Our immutable `packageVersionId` remains ahead *for the template layer specifically* — and Twenty's model is the closest cousin to ours.
2. **The Dify rev-share figure is unverifiable from the corpus** (the Dify packet is purely architectural). The July correction ("it's an affiliate rate") stands on its web sourcing alone — treat as single-source and don't build on it either way.
3. **"Install-time review insufficient" is confirmed with a sharper mechanism**: every recon repo that reviews at install *also* built a runtime sandbox (n8n isolated-vm, emdash Worker Loader, Directus isolated runtime), and Directus even ships `MARKETPLACE_TRUST=sandbox` as an opt-out of signing entirely (`11-directus.md §3`, C6 §3). Nobody trusts install review in practice.

## New adoption candidates the web research missed (internal + recon-sourced)

1. **Per-call capability gating with implication rules** (emdash `PluginBridge`: `write:content` auto-implies `read:content`, every host call checked per-invocation — `04-emdash.md §3`). This makes capability-namespace and kill-switch ONE mechanism: revocation = stop granting on next call. Cleanest existing blueprint for DR-2+DR-5.
2. **Async audit pipeline as the tier-movement mechanism** (emdash's post-submission Cloudflare-Workflows bundle audit, distinct from the fast install gate) — the "how does a package move between tiers after install" machinery DR-3 needs.
3. **Live credential resolution for "live connection" installs** (n8n's `credential-resolution-provider` fetches from a vault at call time instead of storing) — prior art that shareable templates and provider connections are *architecturally different problems* (supports DR-6).
4. **`builderHint`-style agent-legibility metadata in capability manifests** (n8n) — steers agents to the right capability; belongs in the fused install screen and manifest schema. Pairs with the already-seeded Directus `prompt.md`-per-tool convention (Seed 9).
5. **Zod-validate-on-import is an already-decided internal control** (recon flags n8n's missing import validation as a mistake not to repeat — `EXECUTIVE-SUMMARY` finding #4). The marketplace install path must schema-validate every manifest at install AND update.
6. **Usage-metric billing primitive** (n8n's `triggerCount` for tier enforcement) — a concrete freemium-boundary mechanism that avoids the take-rate question entirely near-term.
7. **Directus registry metadata schema** (`{id, type, version, directory, manifest, description, icon}`) — the only fully-specified marketplace manifest in the corpus; useful skeleton to check ours against.
8. **Explicit no-go zones** (Directus documents what can never be extended: permissions engine, query layer, core services) — publish the same for Sonik regardless of trust tier.

## Reusable product assets (things the docs can lift wholesale)

- **Persona: Ricardo, the Ops Lead** (`workflow-builder-prd:114,654-661`) — the actual near-term marketplace user; better than any commerce persona.
- **Author-skill ladder** (Template-pickers → AI-co-authors → Manual composers → Power users → Marketplace authors, `workflow-builder-prd:128-136`) — ready-made progressive disclosure.
- **Moderation checklist** (no leaked secrets / no malicious code / no PII before listing, `workflow-builder-prd:692-693`) — seed of the DR-7 review gate.
- **Export-as-trust** (every playbook exportable as typed JSON, explicitly framed as churn-lowering — `workflow-builder-prd:886`).
- **Quantitative stage-gating** (Inbox's Stage 0→3 gates on usage counts, not calendar — `inbox-prd:471-479`) — pattern for gating public browse.
- **Agent-controls screens precedent** (`amp_pkg_demo_wow_screens_prd.md:502-666`: containment rate, confidence meter, live test simulator, escalation/approval queue) — most concrete prior UI for the "what my agent can do" dashboard (L5's recommended first surface). Verified directly: the bot-management screens are the right skeleton.
- **Dan's binding design-taste rules** (`HANDOFF.md:120-122`): no gradients, no unapproved emoji, no left-stripe cards, no Inter/Roboto; "one thousand no's for every yes."

## Gaps the corpus CONFIRMS are genuinely new work

1. Per-install, user-triggered kill-switch (absent everywhere internal + external).
2. Trust layer on playbook/package installs (May fused preview into install but never attached trust/verification to it — `TrustScoreBadge` exists only for commerce listings).
3. Tri-state grant schema: the amp.pkg descriptor today has only boolean `requiresApproval` (`BASELINE §4`) vs our contracts' `off/ask/allow` — a schema migration to plan, not a conflict of intent.
4. **The §4 enforcement decision is the biggest unresolved internal call**: strict "packages never ship arbitrary UI" vs relax-for-categories vs blessed-partner-tier (8 of 11 reference repos violate strict; `EXECUTIVE-SUMMARY` TL;DR #4-5). The marketplace threat model depends on which is chosen — this should be a named decision (proposed DR-9) rather than an implicit assumption.

## Recommended amendments to the decision brief (for the doc-update decision)

- **A1**: Reframe DR-1/DR-3/DR-5 from "build" to "resume amp.pkg v3 specs" (Mockup #5, §11 ladder, command-registry) — adopt amp.pkg vocabulary (proof tiers, `capability_id`) in the marketplace contracts.
- **A2**: Add the three-marketplace disambiguation to every marketplace doc (PRD §8, DECISIONS.md, contracts).
- **A3**: Tighten the versioning claim (template-layer only) and mark the Dify figure single-source.
- **A4**: Add DR-9 — decide §4 enforcement posture (strict/categories/blessed-partner) before third-party publishing is scoped.
- **A5**: Fold the adoption candidates above into the roadmap as concrete mechanisms for DR-2/3/5/6/7/8.
- **A6**: Lift the reusable assets (Ricardo, skill ladder, moderation checklist, wow-screens dashboard skeleton, taste rules) into the eventual marketplace design brief.

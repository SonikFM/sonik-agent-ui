# Agent Workspace + Marketplace decisions

Status: draft
Audience: reviewers, implementers, design agents
Verified against: `c9011e4` plus uncommitted marketplace/workspace draft files
Last updated: 2026-07-13 (D018–D020 ratified from `.omc/plans/agent-creation-tool-plan-2026-07-13.md`; D008–D017 ratified from the July research pass + recon supplement)

## D001 — Use one marketplace package envelope with first-class kinds

Decision: Sonik marketplace uses a single package/version/install envelope and preserves first-class package kinds for `bundle`, `app`, `workflow`, `skill`, `command_tool_pack`, `agent`, `artifact_template`, `mcp_addon`, `provider_integration`, and `managed_internal`.

Evidence: `docs/contracts/marketplace-package-contracts-v0.md:7-16` states the canonical root/version/install/bundle model. `packages/tool-contracts/src/marketplace.ts:8-18` defines the package kind schema. `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/MARKETPLACE-ORPC-PLANNING.md:21-34` lists the canonical package kinds.

Rationale: A bundle can install a useful solution, while individual components remain installable, updatable, and permission-reviewable.

Amendment (2026-07-07): the envelope stays unified, but install SEMANTICS vary by kind — see D014.

## D002 — Install package versions, not mutable package ids

Decision: User/org installs target immutable `packageVersionId`; mutable package records are discovery/update pointers only.

Evidence: `docs/contracts/marketplace-package-contracts-v0.md:18-27` lists version/install invariants. `packages/tool-contracts/src/marketplace.ts:420-570` validates packageVersionId, package id, semver, and manifest-envelope consistency. `tests/unit/marketplace-package-contracts.test.mjs:28-35` checks packageVersionId/packageSemver invariants.

Rationale: This supports safe updates, provenance, audit, copied/forked installs, and creator marketplace versioning.

## D003 — Bundle is default composition, not the only installable object

Decision: `bundle` is the default composite solution kind, but not a replacement for app/workflow/skill/tool-pack first-class installs.

Evidence: `docs/contracts/marketplace-package-contracts-v0.md:9-16` explicitly preserves individual installs. `packages/tool-contracts/src/marketplace.ts:347-398` validates bundle composition selectors and install order. `tests/unit/marketplace-package-contracts.test.mjs:37-43` asserts bundles compose app and command-tool-pack entries.

Rationale: One-click usefulness should not erase component-level update, copy, fork, permission, or publish flows.

## D004 — JSON-render is canonical; HTML is an escape hatch

Decision: Deterministic apps should use JSON-render manifests as the canonical authored/runtime form. HTML may exist for document/artifact escape hatches, but not as the first runtime model for command-backed apps.

Evidence: `docs/contracts/marketplace-package-contracts-v0.md:55-72` defines command-backed app invariants for JSON-render apps. `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/WORKSPACE-CREATION-DESIGN-BRIEF.md:39-55` frames tool result → component and structuredContent/widget state separation. `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/README.md:31-38` states JSON-render/ask-user-question collect input and do not execute commands.

Rationale: JSON-render keeps agent and human state inspectable, patchable, testable, and command-bindable without a sandbox runtime.

## D005 — Renderer-origin actions cannot commit trusted writes

Decision: Renderer actions can request state updates, command previews, approval requests, navigation, and events, but cannot directly execute command commits or grant trusted approvals.

Evidence: `packages/tool-contracts/src/marketplace.ts:137-193` defines allowed app actions and rejects command-binding refs in renderer actions. `docs/contracts/marketplace-package-contracts-v0.md:59-72` lists allowed/forbidden renderer actions. `tests/unit/marketplace-package-contracts.test.mjs:44-82` asserts write command bindings require trusted approval and host context.

Rationale: This keeps interactive artifacts useful while preserving a hard trust boundary between UI interaction and backend mutation.

## D006 — Preview → trusted approval → receipt is mandatory for writes

Decision: Write/destructive/external commands and workflow nodes require preview_then_trusted_approval, trusted host context, and receipts.

Evidence: `packages/tool-contracts/src/marketplace.ts:98-129` enforces permission and binding host-context gates. `packages/tool-contracts/src/marketplace.ts:207-222` enforces workflow-node gates. `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/MARKETPLACE-ORPC-PLANNING.md:87-93` declares endpoint invariants. `tests/unit/tool-contracts.test.mjs:745-755` checks approval-gated command commit behavior.

Rationale: Agent workflows must be powerful enough to act, but writes must remain auditable, host-authorized, and reversible by policy.

## D007 — Current endpoint map is planned, not implemented production API

Decision: Marketplace/search/install/workflow endpoint names are planning contracts until implemented as typed ORPC routes.

Evidence: `docs/contracts/marketplace-package-contracts-v0.md:74-90` labels endpoint map as contract shapes, not production ORPC implementation. `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/MARKETPLACE-ORPC-PLANNING.md:48-51` says planned typed contract names only and excludes production ORPC routes, persistence, publishing, runtime execution, and visual builders.

Rationale: The docs must not imply production support until backend routes, persistence, auth, and tests exist.

## D008 — Three marketplaces are distinct concepts with unrelated sequencing

Decision: "Marketplace" is disambiguated everywhere as (a) the agent/package marketplace (this corpus: installable capabilities — the amp.pkg registry + workflow playbooks converging), (b) the future two-sided commerce marketplace (venues/talent/ad inventory, Stripe Connect — separate PRD, deferred), and (c) Meta/WhatsApp message templates (a false-friend usage, unrelated). Docs must name which they mean.

Evidence: `docs/research/agent-marketplace-recon-supplement-2026-07.md` (three-marketplace disambiguation; resolved Workflow Builder PRD §4.14 "Marketplace of Playbooks"). Dan's framing 2026-07-06: agent marketplace is a primer for the future commerce marketplace.

Rationale: The overloaded term caused a phantom "missing PRD" and incompatible data-model assumptions; naming the split prevents both.

## D009 — Resume amp.pkg v3 trust machinery; do not invent parallel concepts

Decision: The marketplace adopts amp.pkg v3 vocabulary and specs: the §11 promotion-tier ladder (untrusted-draft → … → first-party-managed) is the trust-tier system; Priority Mockup #5 "Package Install / Connection Drawer" is the basis of the install screen; `command-registry.csv` capability_ids are the capability namespace.

Evidence: `BASELINE-amp-pkg-v3-architecture.md §11–§12` (recon corpus); `docs/research/agent-marketplace-recon-supplement-2026-07.md` A1.

Rationale: Designed-and-partially-built internal substrate beats parallel invention; reuse preserves vocabulary across Sonik systems.

## D010 — Trust-tier is a first-class, discovery-visible attribute with published revocation criteria

Decision: Every package shows a named trust tier (first-party / verified-partner / community, mapped onto the §11 ladder) at discovery, independent of both package kind and runtime permission grants; tier demotion/revocation criteria are published and falsifiable.

Evidence: `docs/research/agent-marketplace-decision-brief-2026-07.md` DR-3; `lane-L1` (Microsoft Agent Store tier model), `lane-L4` (no player publishes revocation criteria — differentiator).

Rationale: Provenance and permission answer different questions; conflating them weakened every surveyed competitor.

## D011 — Fused Intent-Preview+Trust screen is the canonical install/commit UX

Decision: Install and commit approvals use one fused screen: the concrete command/effect preview rendered from the SAME execution plan that will run, alongside the requested permissions/trust tier — verbose on first use per category, lighter on repeat. No cosmetic previews; no separate blocking trust modal.

Evidence: `docs/research/agent-marketplace-decision-brief-2026-07.md` DR-1; `lane-L5` (Intent Preview pattern; trust is the #1 agentic-commerce barrier); `BASELINE §12` Mockup #5 (internal ancestor).

Rationale: The trust gate is the wow moment; same-plan rendering is what makes the preview honest.

## D012 — Per-install kill-switch and activity view are first-class primitives

Decision: Every installation gets a user/org-triggered kill-switch (stop trusting going forward; no purge guarantees) and a per-install activity view. Install-time approval is never treated as permanent trust.

Evidence: `docs/research/agent-marketplace-decision-brief-2026-07.md` DR-2; `lane-L1/L3` (runtime exploits of already-approved packages dominate); `lane-L4` (even Salesforce lacks this); internal seeds: liveGuard + §11 quarantine (`recon-supplement` — per-install switch confirmed absent internally, new work).

Rationale: The dominant real-world exploit is post-install; revocation must be as easy as installation.

## D013 — Registered, versioned capability-ID namespace before marketplace scale

Decision: `requiredCapabilities` and grant targets reference a registered capability-ID namespace (seeded from command-registry capability_ids), not free strings. Per-call capability gating with implication rules (write implies read) is the enforcement model, making kill-switch and namespace one mechanism.

Evidence: `docs/research/agent-marketplace-decision-brief-2026-07.md` DR-5; `lane-L3` (free-string staleness); `recon-supplement` (emdash PluginBridge per-call gating blueprint; command-registry substrate).

Rationale: Every later control (tiers, grants, audits) keys off capability identity; free strings rot.

## D014 — Install semantics vary by package kind under one envelope

Decision: The single package envelope (D001) stands, but install behavior differs by kind: workflow/artifact_template are fork-and-own snapshots with immutable packageVersionId; provider_integration/mcp_addon are "enable a live connection" (runtime credential resolution, no forked copy). D001 is amended accordingly.

Evidence: `docs/research/agent-marketplace-decision-brief-2026-07.md` DR-6; `lane-L2` (universal fork-and-own for templates), `recon-supplement` (n8n live credential resolution; Twenty universalIdentifier update-in-place as the adjacent model; versioning claim scoped to the template layer).

Rationale: Shareable templates and live provider connections are architecturally different problems; one install verb miscasts one of them.

## D015 — Curated human review plus publisher MFA gates third-party publishing; scanning assists, never decides

Decision: When third-party publishing opens: human/curated review before listing, mandatory MFA on publisher accounts, schema validation (Zod) of every manifest at install AND update, re-review on update, and an async post-listing audit pipeline as the tier-movement mechanism. Automated scanning (including GitNexus cypher gates) pre-screens; it does not approve.

Evidence: `docs/research/agent-marketplace-decision-brief-2026-07.md` DR-7; `lane-L1/L2/L3` (scanner-evading malicious skills; publish-credential theft as the exploited mechanism); `recon-supplement` (Zod-on-import already an internal decision; emdash async audit pattern).

Rationale: Prompt-injection detection is unsolved industry-wide; the defensible gates are structural (execution-inert), procedural (review), and credential-hardening (MFA).

## D016 — §4 posture: JSON-first descriptors-only; HTML/custom UI is a future exploration, not a plan

Decision (Dan, 2026-07-07): Descriptors-only is our novel implementation — packages declare descriptors mapped to approved design-system components and never ship arbitrary UI code. Whether to ever introduce HTML/sandboxed code execution is decided down the line if real needs require it (the website builder may or may not force that question). Canonical phrasing: "JSON first; explore future HTML/custom UI only if the needs require it."

Evidence: Dan's ratification answer 2026-07-07; `EXECUTIVE-SUMMARY.md` TL;DR #4-5 (recon corpus — the three options); `docs/research/agent-marketplace-recon-supplement-2026-07.md` DR-9.

Rationale: The strict posture keeps the execution-inert safety claim absolute and the threat model small; the door stays explicitly open rather than implicitly ambiguous.

## D017 — Freemium before take-rate; usage-metric boundaries as the near-term monetization primitive

Decision: Free tier with paid premium capability precedes any take-rate; usage-metric boundaries (n8n triggerCount-style) are the preferred freemium mechanism. Take-rate decisions defer to commerce-marketplace scoping. The widely-cited "Dify 50%" figure is an affiliate rate per web sourcing (single-source; internal corpus silent) — do not plan against it.

Evidence: `docs/research/agent-marketplace-decision-brief-2026-07.md` DR-8; `workflow-builder-prd:813-817` (internal free-first precedent); `recon-supplement` corrections.

Rationale: Monetization is unsettled market-wide; reputation-first matches both the research and the May vision.

## D018 — Capability registry is generated from a vendored, SHA-pinned booking-service manifest; no legacy-fallback carve-out

Decision: The capability registry expands from 8 hand-written entries to the full command surface by generating rows from a vendored copy of the booking-service SDK's committed `sonik-command-registry.generated.json` (copied into `packages/tool-contracts/vendor/`, source commit SHA recorded alongside it), instead of letting unregistered commands fall back to `toolPermissionModes`/`approvedCommandIds`. The Amplify-campaign capability rows (`amplify.campaign.preview`, `amplify.campaign.create`) have no generator source and are hand-authored, carrying a `source: "hand-authored"` provenance flag so a future Amplify SDK generator won't double-register them.

Evidence: `.omc/plans/agent-creation-tool-plan-2026-07-13.md` §2 Decision 1 (capability-registry coverage, rejected legacy-fallback option, hand-authored rider), §4 Phase 2 (generator scope, vendored path, drift test, superset-preservation and live-reachability proofs), §6 risk 2 (hermetic vendoring mitigation). `packages/tool-contracts/src/capability-registry.ts:212-222` (today's 8-entry `sonikBookingCapabilityRegistry`), `capability-registry.ts:142` (`evaluateCapabilityAccess` default-deny).

Rationale: A legacy-fallback carve-out would leave 105 of 113 commands ungoverned by the registry, reviving the free-string/coverage rot D013 warns against and keeping two enforcement authorities alive. Generating from a committed, SHA-pinned artifact keeps booking-service reads-only and hermetic (no live dependency on a sibling worktree), while superset-preservation and live-reachability tests turn an unregistered-but-reachable command into a build failure instead of a silent runtime default-deny.

## D019 — The Amplify campaign wow-demo is scoped to the 5 controller-live workflow node types; campaign artifacts ride tool_commit receipts, not the artifact node

Decision: The campaign workflow is a linear graph (`trigger → ask_user → tool_preview → approval → tool_commit`) built only from the 5 node types the controller currently executes (`trigger, ask_user, tool_preview, approval, tool_commit`); `skill, artifact, remote_execution, evidence, branch` stay out of scope for this demo and are rejected by the drafting agent's live-type gate. The campaign artifact is emitted as the `tool_commit` node's semantic-receipt payload, rendered execution-inert via json-render (D004) — never through the parse-only `artifact` node — and any model-side `createJsonArtifact` output on this path is preview-only content, never the success surface (D006). No conditional `branch` and no new Amplify backend; the campaign write persists to the file-based Knowledge v1 store, host-signed and receipted.

Evidence: `.omc/plans/agent-creation-tool-plan-2026-07-13.md` §2 Decision 2 (node-type scoping, R3 trust pinning), §4 Phase 6 (drafting-agent live-type gate) and Phase 7 (R2 campaign-path trust invariants), §6 risk 3 (branch/artifact scope-creep mitigation).

Rationale: Reaching for `branch`/`artifact` would be a manufactured requirement for a demo that needs no conditional logic, and would parse but silently no-op (`unsupported_node_type`) if it ever reached the controller. Pinning the artifact to the commit receipt keeps the "it worked" affordance sourced only from a host-signed receipt, never a model-drawn preview, preserving the D004/D005/D006 trust boundary while still satisfying the wow-demo acceptance criterion.

## D020 — The third workspace mode absorbs console-track B1 (agent config) + B2 (workflow builder) now; A2–A5 console items sequence after, consuming the same definitions

Decision: A new workflow-builder workspace mode inside `apps/standalone-sveltekit` (not a separate admin app) delivers B1 (model, prompt-module, tool-scoping, knowledge-attach config) and B2 (workflow library, graph builder, draft/locked versions, test-run). The capability-registry browser (A2), runs/observability (A3), and the remaining console items (A4, B4, B5) are deferred as natural follow-ons once the generated registry (D018) and workflow-run-id stamping make them cheap; B5 (endpoint-exposure toggle semantics) remains the only item needing fresh trust design and stays explicitly out of v1.

Evidence: `.omc/plans/agent-creation-tool-plan-2026-07-13.md` §2 Decision 3 (confirms consensus §4.5 sequencing), §4 Phase 5 (builder-mode scope), citing `docs/product/agent-workspace-marketplace`'s companion consensus plan `workflow-state-machine-consensus-2026-07-10.md` §4.5 (console addendum origin).

Rationale: Building the builder chrome once, inside the existing app shell, avoids standing up a second admin surface and lets the config/canvas/preview loop reuse the shipped adapter and controller; deferring A2–A5 holds scope to the phases with concrete acceptance criteria while keeping the console items' sequencing on record for the next follow-on.

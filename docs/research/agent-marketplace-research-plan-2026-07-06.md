# Agent Marketplace — Competitive & Product Research Plan

Status: SIGNED OFF · 2026-07-06
Requested by: Dan · Executed by: Sonnet research agents · Search horizon: as of July 2026
Feeds: the parked agent-marketplace program (`docs/product/agent-workspace-marketplace/`) and the PRD's §8

> This plan defines WHAT we research and HOW we bound it before spending Sonnet tokens. Nothing runs until Dan signs off. Deliverable is a cited, adversarially-verified research report + a decision brief, not raw link dumps.

## 0. Skill/tooling reality check

- **Engine:** the `deep-research` skill (fan-out web search → fetch sources → adversarial claim verification → synthesized cited report). This is what each lane runs on.
- **Framing:** `nngroup-ux` for the UX/adoption lane's method; the existing marketplace corpus (`docs/product/agent-workspace-marketplace/00–11`) as the internal baseline to test findings against.
- **Not used:** `$prd-development`, `$product-strategy-session`, `$roadmap-planning`, `$user-story-mapping`, `$derisk-measurement-advisor` — these were named in an earlier handoff but do **not exist** in the installed registry. We won't pretend to route through them.

## 1. What we already believe (our baseline — to be challenged, not confirmed)

From the corpus + decisions, our current stance is:
- One package envelope, first-class kinds (`bundle/app/workflow/skill/command_tool_pack/agent/artifact_template/mcp_addon/provider_integration`), installs target immutable `packageVersionId`.
- Renderer-inert JSON-render apps; trusted-controller commits; `off/ask/allow` permission grants.
- This is the **agent** marketplace (installable capabilities for an embedded agent), a primer for a later two-sided **commerce** marketplace.

The research must *stress-test* this, not rubber-stamp it. A good report tells us where our model is wrong or behind.

## 2. Core research questions (what we actually need answered)

1. **What does a category-defining agent/capability marketplace look like in mid-2026?** Who are the reference implementations and what did they get right/wrong?
2. **Package/permission/trust model:** how do the best players handle install-time permission review, revocation, versioning, and supply-chain trust for agent-executable content? Where does our `off/ask/allow` + host-signed-approval model sit vs theirs?
3. **The "wow" mechanic:** what install→use experiences make people say wow (vs. feel like an app store chore)? What's the shortest path from discovery to a real outcome?
4. **Business model:** how are agent/workflow/template marketplaces monetized (rev-share, subscription, usage, free-primer-then-commerce)? What's viable for a vertical booking platform specifically?
5. **Moderation & creator trust:** how do two-sided agent marketplaces handle publishing, review, and the supply-chain risk of user-authored executable templates?
6. **Vertical fit:** what's specific about a *booking/hospitality operations* marketplace vs a generic dev-tool one — and does anyone serve that niche?

## 3. Research lanes (parallel Sonnet `deep-research` agents)

Each lane = one bounded deep-research run with its own question set and a required "how this challenges our baseline" section.

| Lane | Focus | Key targets (July 2026) | Primary output |
|---|---|---|---|
| **L1 — Agent/AI marketplaces** | Reference implementations of agent/app/tool marketplaces | OpenAI GPT Store / Apps SDK ecosystem, Anthropic MCP registry/directory, ChatGPT apps, Claude ecosystem, Salesforce Agentforce/AppExchange for agents, Microsoft Copilot agent store, Hugging Face Spaces, Zapier/n8n/Make template galleries | Capability matrix + what wins/fails |
| **L2 — Workflow/template marketplaces** | Installable workflow & template models | n8n/Make/Zapier template libraries, Notion/Airtable template galleries, Retool, Gumroad/creator-template economies, Dify | Package & install-UX patterns |
| **L3 — Permission/trust/supply-chain** | Install-time trust for executable content | VS Code/Chrome extension permission models, npm/marketplace supply-chain incidents & mitigations, MCP security posture, app-store review models | Trust-model recommendations vs our `off/ask/allow` |
| **L4 — Business model & moderation** | Monetization + creator/moderation ops | rev-share %s, take rates, subscription vs usage, moderation pipelines, creator payout/trust systems (incl. Stripe Connect patterns) | Monetization options + moderation playbook |
| **L5 — Vertical & wow-UX** | Booking/hospitality ops fit + install→wow mechanics | vertical SaaS marketplaces (Toast, Square, ServiceTitan app marketplaces), onboarding/install UX best practice (nngroup-ux lens) | Vertical positioning + wow-mechanic shortlist |

Default: run L1–L3 first (foundational), then L4–L5 (informed by the first three). Or all five parallel if you want speed over sequencing — your call (§6).

## 4. Guardrails (so this stays research, not a token furnace)

- Each lane: bounded source count, adversarial verification on every load-bearing claim (a claim used in a recommendation must have ≥2 independent sources or be flagged single-source), cite every URL.
- Every lane ends with a **"where this contradicts our baseline"** section — the value is in the deltas.
- No recommendations without a cited basis; speculation labeled as such.
- Search horizon: prioritize sources dated 2025–2026; flag anything older as potentially stale.
- Wall-clock/token budget per lane set at launch; a lane that hits budget classifies and stops rather than sprawling.

## 5. Final deliverables

1. **`agent-marketplace-competitive-landscape-2026-07.md`** — the synthesized cited report (capability matrix across all lanes, per-lane findings, contradictions-to-baseline).
2. **`agent-marketplace-decision-brief-2026-07.md`** — the "so what": 5–8 concrete decisions the research forces (package model keep/change, permission model keep/change, monetization direction, moderation stance, wow-mechanic pick, vertical positioning), each with the evidence and a recommendation for your sign-off.
3. Updates back into the PRD §8 and the corpus `DECISIONS.md` once you ratify the brief.

## 6. Scoping decisions (signed off 2026-07-06)

| Decision | Choice |
|---|---|
| Lane scope | **All five** (L1–L5) |
| Sequencing | **Foundational-first** — L1–L3 run now; L4–L5 launch after their results are read |
| Commerce depth | **Light touch** — near-term agent marketplace is the focus; commerce (rev-share, Stripe Connect, escrow, trust scoring) captured only as forward-looking context |
| Budget posture | **Thorough** — more sources per lane; any load-bearing claim needs ≥2 independent sources or is flagged single-source; deeper adversarial verification |
| Named competitors | none excluded; L1–L3 targets in §3 stand |

Execution note: L1–L3 launched 2026-07-06. L4 (business model/moderation, light-touch commerce) and L5 (vertical + wow-UX) are gated on reading L1–L3 output so they build on the foundational findings.

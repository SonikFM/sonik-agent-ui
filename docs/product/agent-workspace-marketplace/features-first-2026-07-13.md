# What We Build — Features-First Distillation (2026-07-13)

Companion to `docs/research/walkthrough-findings-2026-07-13.md`. That doc is
HOW-flavored (trust moat, telemetry, steals). This one is Dan's directive:
**the critical findings are not about how we build it but what we build.**
Dify is the ceiling — "you can do everything on it AND anybody can figure it
out." We do not build Dify; we ship sliced-down subsets per audience.

Design rule carried from Dan (8:26pm): **build the best product; ignore what's
copyable/licensable today.** License rework is a tomorrow problem. Never design
shittier because a source might need replacing later.

## The three products (one platform, three power levels)

### P1 — Guest Surface (organizer's end customer)
"Intercom-level agent response." The organizer's branded agent, published to
their own website and to Sonik event pages.

| Feature | v1 | Source pattern |
|---|---|---|
| Chat with the organizer's agent (availability, policies, booking Qs) | yes | Dify webapp |
| Conversation opener + suggested follow-ups | yes | Dify Features panel |
| Booking request → pending reservation the organizer approves | yes | A2 reservation-commit |
| Human handoff | yes | Intercom norm |
| File/image upload | organizer-toggled | Dify Features |
| Citations ("per your event page…") | organizer-toggled | Dify citations |

Explicitly absent: any configuration, workflow visibility, model choice,
settings of any kind. The guest never sees a builder.

### P2 — Organizer Console (deliberately narrow — "smaller than we may think")
The smallest control set that lets a non-technical organizer own their agent.

| Feature | v1 | Source pattern |
|---|---|---|
| Agents list + identity-first create (name / role / description) | yes | Dify Agents tab |
| Prompt with "Generate" assist | yes | Dify Instructions |
| Knowledge: upload docs → ready-made KB (no pipeline builder) | yes | Dify "ready-to-use KB" path only |
| Tools: toggle from a curated catalog (booking reads default; writes exist only behind approval flows) | yes | Dify tool picker, sliced |
| Publish: embed on their site, Sonik page slots, share link — In-Service toggle per surface | yes | Dify 4-surface access point, sliced to 2–3 |
| Approvals queue: approve/deny agent-proposed writes | yes | OURS (D011) — no precedent |
| Runs + receipts: what did my agent do, what did it cost ($) | yes | Dify Monitoring, sliced |

Explicitly absent for organizers: canvas/node editor, custom code, MCP
config, model management, variables, evals, marketplace *publishing*
(install-only), knowledge pipeline builder, API keys.

**Different organizer types need different experiences**: P2 is not one fixed
console — it is a profile-shaped subset. A venue with a hostess needs approvals
+ runs; a festival ops team needs tools + multiple agents. The organizer
*type* selects which P2 modules are mounted. This is the same mechanism as
page-level plugins (below): the console itself is composed of installable,
audience-scoped modules.

### P3 — Sonik Internal (everything)
Full authoring (agent-drafted workflows; canvas exists only as a
power-user/debug view — workflows stay invisible), command registry,
capability grants + kill-switch, marketplace curation and publishing, evals
playground, cross-org monitoring, package lifecycle. Dify-ceiling parity where
useful, never at the cost of P1/P2 simplicity.

## Page-level plugins — decomposition (first-class field)

Dan: "we're going to have to decompose what it looks like to have a page-level
plug-in when we try to consider apps as publishable artifacts." Non-hypothetical
decomposition — five contracts, all with existing homes:

1. **Artifact** — package kind `app` / `artifact_template`; JSON-first render
   document (D016); no executable code in manifests. The publishable thing.
2. **Slot** — a page-slot registry: which Sonik pages (organizer dashboard,
   event page, public microsite) expose named mount points, and what data
   context each slot provides. Sibling of the existing target registry.
3. **Install** — organizer installs artifact→slot binding, pinned
   `packageVersionId`, per-org (D014 install semantics).
4. **Capabilities** — slot-scoped grants: plugin's allowed calls =
   intersection(manifest declares, organizer grants, slot allows). Per-call
   gated like everything else.
5. **Lifecycle** — draft → publish → version pin → kill-switch (D012).

Nobody in the field has slot-level page plugins with gated capabilities —
Dify's unit is the whole app (webapp/API/MCP), never a page region. First-class
differentiator. v1 scope: **one slot** (organizer dashboard card) to stay
concrete; the guest chat widget (P1) is itself the second plugin instance.

## Feature disposition — Dify ceiling → tiers

| Dify feature (witnessed) | P1 | P2 | P3 | Cut |
|---|---|---|---|---|
| Chat webapp w/ opener, follow-ups, uploads, citations | ● | config | ● | |
| Agent: model/prompt/skills/files/tools/knowledge | | prompt+knowledge+tools only | full | |
| Workflow canvas + 14 node types | | | debug view | guest/organizer |
| Chatflow vs workflow vs chatbot app types | | hidden (we pick) | ● | |
| Knowledge pipeline builder | | ready-made only | ● | |
| Model provider marketplace (142) | | | curated few | organizer choice |
| Tools from OpenAPI paste | | | ● (registry-generated) | |
| Triggers (webhook: Gmail/Stripe/Slack) | | later | ● | v1 |
| Multi-surface publish + In-Service toggles | ● | ● | ● | |
| Fork-the-client customization | | | ● | organizers get branded embed instead |
| Monitoring w/ $ cost | | sliced | full | |
| Annotations / feedback loops | | later | ● | v1 |
| DSL import/export | | | ● | organizer |
| Agent Strategies plugin kind | | | maybe | v1 |
| Install counts as trust signal | | | | replaced by verifiable trust tiers |

## Standing constraints (unchanged)
Renderer execution-inert; chat text never approval; success copy only from
semantic receipts; writes behind host-signed approval; manifests carry no
secrets or code; booking-service testing is reads-only; no deploys without
explicit request.

## Notes
- activepieces: NOT run locally (Dan: docs suffice) —
  `~/Documents/GitHub/activepieces/docs`; run it only if a UX gap emerges.
- Drag-and-drop grid + calendar commentary in Dan's session notes belongs to
  the calendar/lab lane, not this distillation.
- Next: deep interview settles per-tier feature pins (esp. confirming the
  organizer tier's narrowness) + page-slot v1 scope, then ralplan amendment.

# Design Agent Handoff — Sonik Workspace Creation Tool

Date: 2026-07-05  
Owner context: Sonik Agent UI / Booking Platform / Amplify SDK contracts  
Purpose: give a design agent enough product, UX, and implementation context to explore a first-class workspace creation experience for agent-built live artifacts / JSON-rendered mini apps.

## 1. North star

Design a **live artifact workspace** where a user can ask an agent to create, compare, configure, and operationalize domain-specific mini apps backed by typed Sonik contracts.

The core mental model is:

> chat is the collaborator; canvas is the live object; contracts are the source of truth; approval is the boundary between draft and mutation.

Example prompts the UI should make feel natural:

- “Compare these two artists and show me which one is better for a Nashville event.”
- “Create a restaurant booking setup for Dan’s Club.”
- “Build a campaign wizard template for this artist announcement.”
- “Create an event intake workspace from this flyer and ask me only what’s missing.”
- “Turn this booking context into a customer-facing reservation flow.”

## 2. Strategic substrate from the intelligence corpus

Source corpus: `/Users/danielletterio/Documents/Sonik_Amplify/intelligence-schema-corpus-2026-07-02`.

The workspace should not be music-first. The intelligence corpus defines a vertical-neutral subject model:

- entity supertypes: `act`, `place`, `happening`, `work`, `org`, `audience_segment`
- open `entity_kind`: artist, speaker, venue, festival, tee_time_slot, menu, room, campaign, etc.
- append-only enrichment snapshots with typed projections only when product queries need them
- org-scoped delivery through entitlements, not duplicated provider data
- provenance must stay visible: provider, fetched_at, license class, command receipt, and source confidence

Design implication: the UI should say **workspace**, **subject**, **artifact**, **manifest**, **command preview**, and **approval**, not “artist dashboard” as the root concept.

## 3. Current trend anchors to use

### Generative UI: tool result → component, not text wall

Vercel AI SDK describes generative UI as connecting model/tool results to rendered components, producing adaptive UI instead of pure text. The docs describe the flow as: provide tools, let the model call them, execute the tool, then render the result in a component. This maps directly to Sonik’s JSON-render artifact system.

Design implication: every workspace object should have a model-readable structured result and a human-readable component projection.

### Apps SDK / MCP widget pattern

OpenAI’s Apps SDK reference shows the modern bridge pattern:

- tool inputs and outputs are delivered to a UI bridge
- `structuredContent` is visible to both model and component
- `_meta` is component-only and hidden from the model
- UI state can be persisted between renders
- approval-gated tools may mount before their final tool input exists

Design implication: separate **model-visible summary**, **widget/private hydration metadata**, and **widget state**. Do not dump everything into chat.

### Claude Design / artifacts pattern

Anthropic’s Claude Design positions the canvas as a collaborative design surface where users refine through conversation, inline comments, direct edits, and fine-grained controls. It also emphasizes team design systems, sharing, export, and handoff bundles.

Design implication: Sonik should copy the interaction pattern, not the visual style: direct editing, inline comments, sliders/knobs for controlled changes, org sharing, and implementation handoff bundles.

## 4. Product framing

The product is not just “JSON renderer.” It is a **Workspace Creation Tool for Agents**.

Candidate names:

- Sonik Workspaces
- Sonik Live Artifacts
- Sonik Operator Canvas
- Sonik Intelligence Workspace
- Sonik Contract Workbench

Recommended internal vocabulary:

| Term | Meaning |
| --- | --- |
| Workspace | durable project container: chat + artifacts + contracts + state |
| Artifact | rendered mini app/document/dashboard inside the workspace |
| Manifest | typed draft object that can validate/export/commit |
| Contract | Booking/Amplify/Intelligence SDK schema and command capability |
| Command Preview | safe, readable preflight of a future mutation |
| Approval Card | explicit trusted approval boundary for writes |
| Evidence Chip | source/provenance/receipt link |
| Skill Step | guided workflow state, not a freeform hallucinated instruction |

## 5. Canvas UI recommendation

Use a three-zone workspace:

```text
┌──────────────────────────────────────────────────────────────┐
│ Workspace header: title · subject chips · mode · share · logs │
├───────────────┬───────────────────────────────┬──────────────┤
│ Chat / Steps  │ Canvas artifact                │ Inspector    │
│               │                               │              │
│ - agent notes │ - live mini app                │ - schema     │
│ - questions   │ - editable fields              │ - state      │
│ - approvals   │ - charts/tables/forms          │ - commands   │
│ - activity    │ - comments                     │ - evidence   │
└───────────────┴───────────────────────────────┴──────────────┘
```

### Chat / Steps rail

- should be compact and workflow-aware
- hide low-level tool names by default
- show friendly activity labels like “Checking availability,” “Preparing preview,” “Saving draft,” “Needs approval”
- provide an expandable technical log for Pipe-B/tool receipts
- show current skill step and next best action

### Canvas

- live artifact, not a static screenshot
- supports direct edit, selectable components, and comment pins
- supports progressive rendering while generation continues
- should survive stream interruption and reload
- should have clear empty states: “Ask the agent to create a workspace,” “Import a brief,” “Choose a template”

### Inspector

Tabs:

1. **State** — current artifact/workspace JSON with safe redact/pretty view
2. **Schema** — contract/schema validation, missing fields, types
3. **Commands** — available actions, previews, approval status
4. **Evidence** — sources, snapshots, receipts, provenance
5. **Versions** — artifact version timeline and rollback

The inspector should be collapsible. It should not dominate the default demo experience.

## 6. First-class workspace templates

The design agent should prototype these as launcher cards, not generic chips:

### A. Compare two artists / acts

Goal: compare external intelligence + internal outcome potential.

Inputs:

- act A and act B
- market/geo
- target event type
- date window
- optional budget/capacity

Artifact sections:

- summary recommendation
- audience/demand fit
- momentum trend
- geo fit
- risk/confidence
- evidence chips
- campaign/booking next actions

Contract backing:

- `growth.intelligence.*` read commands
- entity resolution
- enrichment snapshots / typed projections
- org entitlements
- no write until user asks to save/report/create campaign

### B. Create a venue / booking setup

Goal: turn messy operator requirements into a booking context manifest.

Artifact sections:

- business identity
- inventory/resources
- schedule/service periods
- policies
- menus/offers
- validation report
- command preview
- approval card

Contract backing:

- booking context intake skill
- `booking.create.context`
- schedule rules
- resources/tables/slots
- command preview/commit

### C. Create an event

Goal: convert an event description/flyer into an event manifest.

Artifact sections:

- event identity
- time/location
- tickets/reservations
- capacity
- eligibility/access rules
- marketing hooks
- validation + publish checklist

Contract backing:

- event package/context commands
- booking/event schema
- Amplify campaign handoff

### D. Create a campaign wizard template

Goal: create an Amplify campaign plan from a subject/workspace.

Artifact sections:

- audience
- offer
- channel sequence
- creative brief
- timing
- success metrics
- approval/publish checklist

Contract backing:

- Amplify SDK campaign contracts
- org context
- asset/copy generation
- no send/publish without explicit approval

## 7. Interaction principles

### The user should not have to prompt-engineer

Bad:

> Use searchSkillCatalog, learnSkill, createJsonArtifact...

Good:

> “Set up a restaurant booking workspace.”

The UI should discover the skill, show the draft artifact, and ask one high-impact question.

### Questions are inputs, not approvals

QuestionCard / ask-user-question surfaces collect typed answers only. They must not execute tools or mutate Booking/Amplify directly.

Approval is separate:

1. collect answers
2. validate manifest
3. render command preview
4. user approves with explicit approval card/button
5. trusted host executes command
6. receipt appears as evidence

### Direct manipulation beats chat repetition

Users should be able to:

- click a field and edit it
- use dropdowns/date pickers/tables
- drag to reorder campaign steps
- annotate a chart or row
- ask the agent to apply a change globally

### Every artifact needs three views

1. **Operator view** — beautiful mini app / dashboard / form
2. **Schema view** — typed manifest with validation
3. **Execution view** — commands, approvals, receipts

## 8. Component inventory to hand to the design agent

Core components to design or refine:

- WorkspaceHeader
- SubjectChipBar
- WorkspaceLauncherCard
- ArtifactCanvasFrame
- ArtifactTabBar: Preview / Edit / Schema / Commands / Evidence / Versions
- QuestionCard
- CommandPreviewCard
- ApprovalCard
- EvidenceChip
- SourceConfidenceBadge
- ManifestCompletenessMeter
- WorkflowStepRail
- ActivityPill / FriendlyToolStatus
- InspectorPanel
- VersionTimeline
- InlineCommentPin
- EmptyCanvasState
- ErrorRecoveryCard

## 9. Implementation seams to preserve

The design must respect these engineering boundaries:

- JSON-render/ask-user-question surfaces are presentation/input collectors only.
- Command execution stays in trusted host/controller tools.
- User answer is not approval.
- Approval card must map to trusted host session approval.
- Every mutation returns a receipt/correlation id.
- Page context is machine-readable through `window.__sonikAgentUI`.
- Host embed opens through `window.__sonikAgentHost`, not coordinate clicks.
- Artifact state persists versioned drafts.
- Workspace state belongs to authenticated org/user context.
- Licensed intelligence is entitlement-delivered; do not expose raw hidden provider data casually.

## 10. Design exploration prompts for the design agent

Use these prompts to generate directions:

1. “Design the empty state and launcher cards for a Sonik Workspace where an operator can create a venue, event, campaign, or intelligence comparison.”
2. “Design a live artifact workspace for comparing two artists for a venue booking decision, with evidence chips and confidence.”
3. “Design the booking setup artifact as an editable mini app with validation and an approval card.”
4. “Design the inspector panel for schema, commands, evidence, and versions.”
5. “Design a friendly activity stream that hides raw tool names but keeps technical logs one click away.”
6. “Design the approval flow: draft → preview → approve → receipt → rollback.”

## 11. Visual direction

Base direction from `ui-ux-pro-max` search:

- style: AI-native enterprise workspace
- typography: Plus Jakarta Sans or current Sonik operator typography
- tone: dense but calm; canvas neutral; one accent moment per screen
- avoid: heavy chrome, slow feedback, emoji structural icons, buried errors

For current Sonik dark theme, prefer `sonik-operator-dark` token contract when embedded in booking/amplify surfaces.

## 12. What the design agent should deliver

Minimum handoff output:

1. One full-screen workspace concept
2. One embedded sidecar concept
3. One live artifact canvas concept
4. One inspector panel concept
5. One approval flow concept
6. One empty-state/launcher concept
7. Component inventory with states
8. UX risk list
9. Implementation handoff notes for Svelte/JSON-render
10. A demo script: artist comparison → artifact → command preview / next action

## 13. Acceptance criteria for the concept

A successful design concept should prove:

- the user can start without knowing skill/tool names
- the canvas makes a durable object, not a disposable chat response
- typed schemas and contract validation are visible but not intimidating
- approvals are explicit and separate from answers
- evidence/provenance is first-class
- artifacts can be edited, versioned, shared, and handed off
- the same UI pattern works for Booking, Amplify, and Intelligence

## 14. Sources and provenance

Local:

- `/Users/danielletterio/Documents/Sonik_Amplify/intelligence-schema-corpus-2026-07-02/00-README.md`
- `/Users/danielletterio/Documents/Sonik_Amplify/intelligence-schema-corpus-2026-07-02/01-intelligence-schema-prd.md`
- `/Users/danielletterio/Documents/Sonik_Amplify/intelligence-schema-corpus-2026-07-02/02-domain-model.md`
- `/Users/danielletterio/Documents/Sonik_Amplify/intelligence-schema-corpus-2026-07-02/04-dataflow-and-commands.md`

External trend anchors:

- Vercel AI SDK Generative UI: tool results rendered as components, not only text.
- OpenAI Apps SDK reference: MCP Apps UI bridge, structuredContent/content/_meta separation, widget state, approval-gated tool input behavior.
- Anthropic Claude Design: conversational design, direct edits, inline comments, custom controls, org sharing, export/handoff bundles.

## 15. Marketplace and template packaging doctrine

The workspace creation tool should treat **agents, apps, workflows, skills, and artifact templates** as publishable packages, not one-off buttons. A user should be able to create a workflow in chat/canvas, save it, share it inside an org, and eventually publish it to a marketplace.

### Publishable object families

| Family | What it is | Draft owner | Runtime boundary | Marketplace posture |
| --- | --- | --- | --- | --- |
| Agent template | System prompt, model/provider preference, installed skills, tool permission defaults, page-context expectations | Agent UI workspace | Agent runtime/session config | Installable org/user template |
| App template | Packaged workspace surface with artifacts, settings, and optional external app/MCP connections | Workspace/app registry | App host + SDK contracts | Installable app surface |
| Workflow template | Graph or ordered steps: trigger → ask → artifact → preview → approval → command/run | Workflow registry | Trusted workflow runner/controller | Installable workflow |
| Skill template | Markdown skill + examples + tests + runtime registry metadata | Skill registry | Search/learn skill surface | Installable skill |
| Tool/command pack | ORPC/OpenAPI/MCP-backed command metadata, schemas, examples, permission policy | Command registry | Public SDK / host command runtime | Installable capability pack |
| Artifact template | JSON-render/workspace UI template with state schema and validation | Artifact registry | Renderer + trusted controller | Installable live artifact |

### Marketplace record shape

Every publishable item should have a normalized record:

```json
{
  "id": "booking.restaurant.setup.workflow",
  "kind": "workflow_template",
  "title": "Set up a Restaurant",
  "summary": "Guided booking context intake and trusted booking.create.context preview/approval.",
  "version": "0.1.0",
  "publisher": { "type": "org", "id": "sonik", "label": "Sonik" },
  "visibility": "private|org|public|marketplace",
  "installScope": "user|organization|workspace",
  "requiredSkills": ["booking.context.intake", "booking.context.create"],
  "requiredCommands": ["booking.create.context", "booking.create.schedule.rule"],
  "requiredCapabilities": ["bookable_context", "schedule.rules"],
  "hostRequirements": ["signed_host_context", "trusted_command_runtime"],
  "approvalPolicy": "preview_then_trusted_approval",
  "status": "draft|private|submitted|approved|published|deprecated",
  "provenance": { "source": "workspace", "createdBy": "agent", "copiedFrom": null },
  "tests": [{ "name": "booking-context-preview", "type": "ultratest" }]
}
```

### Sonik capability/accessibility constraints

- Non-event verticals such as restaurants, tee sheets, gyms, rentals, and hotel-like resources must anchor to `venue_schedule` or `resource`, not daily fake Events.
- Availability remains computed from schedule/resource rules; artifact templates may draft rules but must not author availability slot rows as truth.
- Marketplace contracts should label capability readiness honestly: `EXISTS`, `FIXTURE`, `MISSING`, `CANDIDATE-GAP`, `FROZEN`, `UNDECIDED`.
- Public SDK and ORPC surfaces are the external command boundary. Marketplace installs must not import service internals or generated private files.
- User answers are input only. Approval remains a separate trusted host/controller command receipt boundary.

## 16. Pages and components the design agent should create

### Required pages

1. **Workspace Home / Launcher Gallery**
   - Purpose: start from a template without prompt engineering.
   - Components: template cards, recent workspaces, marketplace/install CTA, page-context chips, skill/tool availability status.

2. **Workspace Editor**
   - Purpose: chat + live artifact + inspector.
   - Components: Chat/Steps rail, Canvas, Inspector, Evidence chips, Version timeline, Approval card, Activity log.

3. **Workflow Builder**
   - Purpose: visual builder for saved workflows and automation-like agent actions.
   - Components: node canvas, node palette, edge labels, validation badges, trigger nodes, ask-user nodes, skill nodes, artifact nodes, command-preview nodes, approval nodes, remote-execution nodes.

4. **Template Detail / Marketplace Listing**
   - Purpose: inspect before install/publish.
   - Components: overview, required skills/tools/capabilities, screenshots, security/approval notes, install scope, version history, test evidence.

5. **Template Install / Permission Review**
   - Purpose: safe install of agents/apps/workflows.
   - Components: permission matrix, tool-call policy `off|ask|allow`, required host context, secrets/connectors needed, approval gates.

6. **Agent Settings / Runtime Controls**
   - Purpose: configure model, skills, tools, MCP/app add-ons, page context, and system prompt.
   - Components: dynamic model picker, skill installer, tool permission table, context manager, system prompt editor, telemetry/log toggles.

7. **Publish Review / Submission**
   - Purpose: package a workflow/template for org or marketplace distribution.
   - Components: metadata form, dependency scan, capability labels, tests checklist, preview screenshots, publish status.

### Required component inventory

| Component | Purpose | Key states |
| --- | --- | --- |
| TemplateCard | Launch saved/public workflow or app template | draft, installed, update_available, incompatible |
| WorkflowCanvas | Graph editor for workflow templates | empty, editing, dirty, validating, saved |
| WorkflowNode | Generic node shell | valid, invalid, disabled, selected, running, failed |
| TriggerNode | Start condition: manual, page context, webhook, schedule | configured, missing_input |
| AskUserNode | Human input collection | pending, answered, cancelled, expired, invalid |
| SkillNode | Search/learn skill step | unresolved, learned, unavailable |
| ArtifactNode | Create/update live artifact | draft, persisted, invalid, promoted |
| CommandPreviewNode | Render typed command payload | ready, blocked, invalid_schema |
| ApprovalNode | Trusted approval boundary | preview_required, approval_required, approved, denied |
| RemoteExecutionNode | Webhook/MCP/worker trigger | disabled, ask, allow, running, failed |
| PermissionMatrix | Review install permissions | no_access, ask, allow |
| EvidenceChip | Source/provenance/receipt | source, receipt, warning, error |
| VersionTimeline | Save/rollback history | current, restored, archived |
| MarketplaceListingCard | Browse/install/publish templates | private, org, public, deprecated |

## 17. Workflow builder copy-retrofit source package

A design/share package was created here:

```txt
docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/
```

It contains a direct copied source island from Amplify's Svelte campaign flow implementation:

```txt
source-copies/amplify/src/campaign-canvas/
source-copies/amplify/src/design-system/patterns/CampaignFlow/
```

Copy manifest:

```txt
docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/manifests/amplify-campaign-flow-copy-manifest.json
```

Use this source as Open Design upload material and as the parity donor for the future Agent UI workflow canvas. Do not rewrite behavior from memory; use the copied source and adapt outside the copied island.

## 18. ORPC/SDK marketplace planning questions for the final planning pass

The final planning pass should decide these seams before implementation:

1. Marketplace data model: one table for all publishable items or per-family tables with a shared package envelope?
2. Installation model: user-scoped, org-scoped, workspace-scoped, or all three?
3. Permission model: how `off|ask|allow` maps to tool families, individual commands, and destructive writes.
4. Runtime trigger model: manual-only v0, then webhook/schedule/page-context triggers later?
5. SDK surface: which marketplace endpoints become public SDK/client-safe vs business-safe?
6. Versioning: draft/current/published/deprecated, optimistic lock, rollback, and install pinning.
7. Search: text search plus capability/skill/command filters; marketplace ranking; org-private results.
8. Security review: approval boundaries, secret handling, MCP/app add-ons, remote execution limits.
9. Packaging: export/import format for agents/apps/workflows/artifacts that can be uploaded to Open Design and installed in Sonik.
10. UltraTest gates: page context, permission review, install, run, approval, receipt, uninstall.

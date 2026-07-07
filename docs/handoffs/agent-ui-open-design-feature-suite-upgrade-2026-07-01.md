# Sonik Agent UI — Feature Suite Upgrade + Open Design Parity Handoff

Date: 2026-07-01  
Repo: `/Users/danielletterio/Documents/GitHub/sonik-agent-ui`  
Current branch: `codex/booking-command-copy-retrofit-20260629150347`

## 1. Current status

### Agent UI repo

Open PR:

- GitHub PR: `#4` — **Add booking command copy-retrofit gate**
- Branch: `codex/booking-command-copy-retrofit-20260629150347`
- Current local status:
  - Branch tracks remote.
  - Untracked local files existed during analysis:
    - `.codex/`
    - `booking-agent-ui-embed-local-2026-06-25.png`

Do not casually clean or overwrite those without checking.

### Sonik Skills repo

Recently completed:

- `$analyze-copy-retrofit` was updated and published globally.
- PR `sonikfm/sonik-skills#18` was cleaned and merged.
- That PR now only contains the intended `analyze-copy-retrofit` skill update.

### Open Design repo

Local path:

```txt
/Users/danielletterio/Documents/GitHub/open-design
```

Important note:

- Local `open-design` branch was behind upstream by about 28 commits during analysis.
- Before copying anything new, fetch/compare upstream so we do not retrofit stale behavior.

---

## 2. Production readiness priority

The next major upgrade should **not** be a broad Open Design clone.

The right production-ready path is:

1. Harden Sonik Agent UI deployment and host-context parity.
2. Make JSON-render artifacts truly stateful and reliable.
3. Copy/retrofit only the best Open Design “live artifact” and registry ideas.
4. Turn booking/event/campaign setup into first-class workflow launchers.
5. Add deterministic Pipe-B / `$ultratest` gates so regressions stop recurring after deployment.

---

## 3. Ranked feature suite upgrade

### Rank 1 — Deployment + host-context reliability gate

Problem observed repeatedly:

- Booking service or Agent UI deploys an older embed/runtime.
- Host context disappears.
- Agent says `missing-host-context`.
- Pipe-B proves the deployed environment is stale or misconfigured.

Add a required release gate:

- Verify Agent UI deployed Worker commit.
- Verify booking app deployed commit.
- Verify booking service deployed commit.
- Verify shared `SONIK_AGENT_UI_HOST_CONTEXT_SECRET`.
- Verify signed host context reaches Agent UI.
- Verify `/api/workspace` and document/artifact APIs work.
- Verify a page-aware prompt works before merge/deploy signoff.

This should become a reusable release checklist and probably a script.

### Rank 2 — Stateful JSON-render artifact object

This is currently the most important UX gap.

Open Design’s strength is that artifacts feel alive. Sonik needs that for:

- booking context intake
- event creation
- campaign wizard templates
- reservation workflows
- manifest preview/edit/export

The target object model:

```txt
artifact = schema + state + actions + versions + provenance + validation
```

The renderer should not just display JSON. It should support:

- selecting days
- editing operating hours
- repeater rows
- tabs
- question cards
- manifest preview
- save/update/version
- submit answer back to agent
- persist on refresh

This aligns with the existing `prd-json-render-stateful-object-v0.md`.

### Rank 3 — Open Design live artifact parity

Do **not** copy the whole Open Design app shell or daemon.

Best copy/retrofit candidates:

```txt
open-design/specs/2026-04-29-live-artifacts/spec.md
open-design/packages/contracts/src/api/live-artifacts.ts
open-design/apps/daemon/src/live-artifacts/schema.ts
open-design/apps/daemon/src/live-artifacts/store.ts
open-design/apps/daemon/src/live-artifacts/render.ts
open-design/design-templates/live-artifact/*
open-design/design-templates/live-dashboard/*
```

Use these as donor material for:

- live artifact manifest shape
- template/data separation
- refresh/re-render contract
- provenance fields
- forbidden raw credential fields
- validation examples
- dashboard/live artifact conventions

Retrofit into Sonik’s Svelte/JSON-render system, not Open Design’s daemon.

### Rank 4 — Runtime skill + workflow registry

Open Design has a useful split:

```txt
skills = functional behavior
design templates = rendering/presentation
plugins = installable capabilities
```

Sonik should mirror this as:

```txt
runtime skills = agent workflows
command registry = executable typed tools
artifact templates = renderable UI/data forms
PRD registry = structured product/workflow definitions
```

This should power:

- “Set up a venue”
- “Create an event”
- “Create a reservation”
- “Create a campaign”
- “Analyze this page”
- “Build a booking manifest”
- “Export to booking service”

### Rank 5 — PRD / registry builder

Open Design’s plugin/registry docs are useful, but this is a second-order feature.

Future Sonik version can use a registry for:

- PRDs
- templates
- workflow recipes
- command families
- demo scenarios
- agent skills
- page-aware launchers

This should be built around Sonik contracts, ORPC, SDK, and JSON-render—not copied wholesale.

---

## 4. Open Design copy/retrofit recommendations

### Already copied / used

The Open Design question parser island is already represented in Sonik work:

```txt
apps/web/src/artifacts/question-form.ts
apps/web/src/runtime/partial-json.ts
apps/web/tests/artifacts/question-form.test.ts
```

Sonik manifest evidence:

```txt
manifests/copy-retrofit/open-design-intake.json
```

This was the right kind of copy:

- small
- behavior-focused
- test-backed
- not a full app rewrite

### Next best donor island

Create a new copy-retrofit manifest for Open Design live artifacts:

```txt
manifests/copy-retrofit/open-design-live-artifacts.json
```

Candidate sources:

```txt
/Users/danielletterio/Documents/GitHub/open-design/specs/2026-04-29-live-artifacts/spec.md
/Users/danielletterio/Documents/GitHub/open-design/packages/contracts/src/api/live-artifacts.ts
/Users/danielletterio/Documents/GitHub/open-design/design-templates/live-artifact
/Users/danielletterio/Documents/GitHub/open-design/design-templates/live-dashboard
```

Sonik destination ideas:

```txt
docs/open-design/live-artifact-parity.md
packages/json-ui-runtime/src/contracts/live-artifact.ts
apps/standalone-sveltekit/src/lib/server/intake-artifacts.ts
apps/standalone-sveltekit/src/lib/render/component-registry.ts
apps/standalone-sveltekit/src/lib/render/catalog.ts
```

### Do not copy yet

Avoid copying these wholesale:

```txt
open-design/apps/daemon
open-design full app shell
open-design MCP installer
open-design plugin marketplace UI
```

Use them as reference only until Sonik’s runtime contracts stabilize.

---

## 5. Suggested Sonik feature suite

### A. Production release gate

Create a deterministic release gate that checks:

- Agent UI Worker deployment.
- Booking app Worker deployment.
- Booking service Worker deployment.
- Shared host-context secret.
- Signed host context arrives.
- Pipe-B logs are enabled.
- Cloud runtime is available.
- Artifact API works.
- Document API works.
- Skill search/learn works.
- Booking command search/learn works.
- A simple page-aware chat works.

### B. First-class workflow launchers

Replace generic starter chips:

```txt
Weather comparison
GitHub repo stats
Crypto dashboard
Hacker News top stories
```

with Sonik-first chips:

```txt
Set up a venue
Create an event
Create a reservation
Create a campaign
Analyze this page
Create booking manifest
```

The generic demos can remain in standalone/dev mode, but embedded Sonik mode should prioritize Sonik workflows.

### C. Booking intake artifact v1

This should become a first-class JSON-render artifact.

Required components:

- `ChoiceCards`
- `QuestionCard`
- `EditableField`
- `TextareaField`
- `DaySelector`
- `TimeRangeEditor`
- `ServicePeriodEditor`
- `TableSectionRepeater`
- `ManifestPreview`
- `MissingFieldsList`
- `ConfidenceTable`
- `ActionRail`
- `ValidationSummary`

### D. Ask-user-question integration

The agent should not only ask plain chat questions.

It should render structured questions:

```txt
question
why this matters
choices
default
skip
writes_to
```

Answers should patch artifact state and become persisted versions.

### E. Manifest validation/export

For booking intake:

```txt
draft intake artifact
→ validate manifest
→ show warnings/missing fields
→ export manifest
→ request explicit trusted approval
→ execute booking context creation
```

Do not let the model jump directly from conversation to mutation.

### F. Web builder foundation

Do not start with a full web builder.

Start with:

```txt
Live Artifact Template Builder
```

Inputs:

- manifest
- artifact template
- design tokens
- data source
- publish target

First use cases:

- booking context landing page
- event page
- campaign landing page
- reservation widget

---

## 6. Skills to use in the next chat

Use these in order depending on task:

### Analysis / copy

```txt
$analyze
$analyze-copy-retrofit
```

### Skill authoring

```txt
$writing-skills
$sonik-skill-creation
```

### Agent UI

```txt
$sonik-agent-ui
$sonik-component-design
```

### Tool / command registry

```txt
$sonik-tool-creation
$sonik-accessibility
```

### Svelte implementation

```txt
$sveltekit-patterns
$svelte-runes
$sveltekit-data-flow
$svelte-code-writer
```

### Amplify / host context

```txt
$amplify-auth
$amplify-org-context
$amplify-theming
```

### Verification

```txt
$ultratest
$ultraqa
```

### Planning / implementation

```txt
$ralplan
$ultragoal
```

---

## 7. Deployment notes

### Agent UI deployment

From Agent UI repo:

```bash
pnpm --filter svelte-chat build
cd apps/standalone-sveltekit
pnpm exec wrangler deploy
```

Important Worker env/secrets:

```txt
AI_GATEWAY_API_KEY
PUBLIC_AGENT_UI_MODEL
PUBLIC_AGENT_UI_ALLOWED_HOST_ORIGINS
SONIK_AGENT_UI_HOST_CONTEXT_SECRET
DATABASE_URL
```

Current desired model for stronger structured workflow testing:

```txt
deepseek/deepseek-v4-pro
```

### Booking / Amplify host context

Host apps must pass signed context. Browser page context is display-only; trusted server context is authority.

Expected shared secret:

```txt
SONIK_AGENT_UI_HOST_CONTEXT_SECRET
```

This must match between:

```txt
sonik-agent-ui
sonik-booking-service
booking app host
```

### Pipe-B telemetry

Relevant deployment target:

```txt
sonik-booking-app-pipe-b.liam-trampota.workers.dev
```

Tail worker:

```txt
sonik-dev-observability-pipe-b
```

Use Pipe-B logs to prove:

- host context received
- skill learned
- tool call attempted
- command preflight passed/failed
- artifact create/update succeeded
- document create/update succeeded
- API 500s or missing runtime errors

---

## 8. Recommended next `$ultragoal`

Use this as the next implementation objective:

```txt
$ultragoal implement production-ready Open Design live artifact parity v0:
copy-retrofit Open Design live artifact contracts/templates into Sonik Agent UI,
map them to stateful JSON-render artifacts,
add Sonik workflow launcher templates for venue/event/campaign setup,
and prove with Pipe-B ultratest that booking intake artifacts can be created,
edited, persisted, validated, and exported without host-context regressions.
```

Suggested phases:

1. **Open Design sync + donor confirmation**
   - fetch Open Design
   - confirm current upstream files
   - produce copy-retrofit manifest

2. **Live artifact contract mapping**
   - map Open Design live artifact fields to Sonik artifact/session/version tables
   - define forbidden credential/raw fields
   - add provenance/confidence/refresh metadata

3. **Stateful JSON-render component registry**
   - day selector
   - time range editor
   - service period editor
   - table section repeater
   - question card
   - validation summary

4. **Workflow launcher replacement**
   - replace generic embedded starter chips with Sonik workflow launchers
   - keep generic demos only in standalone/dev mode

5. **Booking intake artifact proof**
   - create venue schedule artifact
   - fill/edit schedule and tables
   - persist version
   - refresh and reload
   - validate manifest
   - export manifest

6. **Pipe-B release gate**
   - deploy Agent UI
   - deploy booking host if needed
   - run authenticated `$ultratest`
   - record logs and screenshots

---

## 9. What “good” looks like

A user should be able to open embedded Sonik Agent UI and click:

```txt
Set up a venue
```

Then the system should:

1. Load the relevant runtime skill.
2. Render a booking setup artifact.
3. Ask one high-impact question at a time.
4. Let the user edit structured fields directly.
5. Persist each answer/update as a version.
6. Validate the manifest.
7. Export a draft booking context manifest.
8. Require explicit trusted approval before mutation.
9. Log every step in Pipe-B.

This is the production-ready Open Design parity target: not just pretty generated HTML, but live, stateful, skill-aware, contract-backed artifacts.

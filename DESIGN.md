# Design

## Source of truth

**Status:** Draft
**Last refreshed:** 2026-07-15

This document is the durable product and UI contract for Sonik Agent UI. It records what the repository demonstrates today, the product decisions adopted for subsequent work, and the questions that still require validation. It does not make an unimplemented surface, integration, or dependency real by describing it.

### Evidence notation

- **[Observed]** is directly supported by current repository behavior, tests, or an authoritative external specification.
- **[Decision]** is the product and interaction contract adopted here. It remains a decision even when implementation is pending.
- **[Open]** is unresolved. It must not be presented to users as a shipped capability.

### Primary product surfaces

- Embedded, host-aware agent sidecar.
- Full workspace and canvas modal.
- Standalone SvelteKit development and evaluation harness.
- Chat, artifact, document, agent-configuration, and Workflow Builder surfaces.
- Future Creative Studio surfaces defined in this contract but not assumed to be implemented.

### Evidence reviewed

Local product and implementation evidence:

- [`PRODUCT.md`](./PRODUCT.md)
- [`apps/standalone-sveltekit/src/routes/+page.svelte`](./apps/standalone-sveltekit/src/routes/+page.svelte)
- [`apps/standalone-sveltekit/src/lib/components/workflow-builder/WorkflowBuilderRoot.svelte`](./apps/standalone-sveltekit/src/lib/components/workflow-builder/WorkflowBuilderRoot.svelte)
- [`apps/standalone-sveltekit/src/lib/components/workflow-builder/AgentConfigPanel.svelte`](./apps/standalone-sveltekit/src/lib/components/workflow-builder/AgentConfigPanel.svelte)
- [`apps/standalone-sveltekit/src/lib/components/workflow-builder/DebugPreviewPane.svelte`](./apps/standalone-sveltekit/src/lib/components/workflow-builder/DebugPreviewPane.svelte)
- [`apps/standalone-sveltekit/src/lib/components/workflow-builder/WorkflowCanvas.svelte`](./apps/standalone-sveltekit/src/lib/components/workflow-builder/WorkflowCanvas.svelte)
- [`apps/standalone-sveltekit/src/lib/components/workflow-builder/WorkflowRunPanel.svelte`](./apps/standalone-sveltekit/src/lib/components/workflow-builder/WorkflowRunPanel.svelte)
- [`apps/standalone-sveltekit/src/lib/components/workflow-builder/builder-model.ts`](./apps/standalone-sveltekit/src/lib/components/workflow-builder/builder-model.ts)
- [`apps/standalone-sveltekit/src/lib/server/workflow-runs.ts`](./apps/standalone-sveltekit/src/lib/server/workflow-runs.ts)
- [`packages/tool-contracts/src/marketplace.ts`](./packages/tool-contracts/src/marketplace.ts)
- [`tests/e2e/workflow-builder.spec.ts`](./tests/e2e/workflow-builder.spec.ts)
- [`tests/e2e/workflow-builder-embed.spec.ts`](./tests/e2e/workflow-builder-embed.spec.ts)
- [`apps/standalone-sveltekit/src/app.css`](./apps/standalone-sveltekit/src/app.css)
- [`apps/standalone-sveltekit/src/lib/theme/theme-registry.ts`](./apps/standalone-sveltekit/src/lib/theme/theme-registry.ts)
- [`apps/standalone-sveltekit/src/lib/theme/foundations/themes/daisy.css`](./apps/standalone-sveltekit/src/lib/theme/foundations/themes/daisy.css)
- [`packages/workspace-core/src/components/WorkspaceRoot.svelte`](./packages/workspace-core/src/components/WorkspaceRoot.svelte)
- [`packages/chat-surface/src/components/AgentConversation.svelte`](./packages/chat-surface/src/components/AgentConversation.svelte)

Primary external references:

- Vercel AI Gateway: [Models and providers](https://vercel.com/docs/ai-gateway/models-and-providers), [provider options](https://vercel.com/docs/ai-gateway/models-and-providers/provider-options), and [model catalog](https://vercel.com/ai-gateway/models).
- AI SDK Core: [`generateText`](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text), [`generateImage`](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-image), and experimental [`generateVideo`](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-video).
- HyperFrames: [repository](https://github.com/heygen-com/hyperframes), [`@hyperframes/core`](https://hyperframes.heygen.com/packages/core), [`@hyperframes/player`](https://hyperframes.heygen.com/packages/player), and [`@hyperframes/studio`](https://hyperframes.heygen.com/packages/studio).
- Image-editor candidates for evaluation only: [miniPaint](https://github.com/viliusle/miniPaint), [Fabric.js repository](https://github.com/fabricjs/fabric.js), [Fabric.js documentation](https://fabricjs.com/docs/), and [Filerobot Image Editor](https://github.com/scaleflex/filerobot-image-editor).

## Brand

- **[Observed]** Sonik is a portable, host-aware workspace rather than a standalone chatbot. The host supplies trusted page context, command grants, and theme; Sonik supplies agent, chat, document, artifact, and workflow experiences.
- **[Decision]** The brand posture is calm, capable, precise, and operational. The UI explains authority and prerequisites without alarmism and never implies that an AI action has happened before the system has evidence.
- **[Decision]** Existing theme variables and component conventions are the visual source of truth. New surfaces use semantic tokens and current Daisy theme foundations rather than introducing a parallel palette.
- **[Decision]** Product language favors concrete nouns and verbs: “Preview changes,” “Request host approval,” and “Commit” instead of vague claims such as “AI magic” or “Done.”

## Product goals

1. **Make capability truthful per turn.** A user must be able to distinguish discovery, context readiness, host authority, and executable callability before acting.
2. **Keep work portable and inspectable.** Chat, agent definitions, workflow drafts, creative documents, and receipts have explicit boundaries and lifecycles.
3. **Preserve host authority.** Agent settings and tool permissions never bypass signed host grants, authorization, row-level security, or server preflight.
4. **Support workflow-first operation.** Users can configure, draft, review, preview, approve, commit, and recover without inferring hidden state.
5. **Scale catalogs without losing the current choice.** Model and capability discovery remains searchable, bounded, filterable, and explicit about compatibility.
6. **Establish Creative Studio bones without false promises.** Asset, document, edit, preview, and render responsibilities are distinct before an editor dependency is selected.

Non-goals:

- Treating a catalog entry as an executable tool.
- Treating “Allow” as host or server authorization.
- Claiming workflow publication, arbitrary workflow execution, or Creative Studio implementation before those capabilities exist.
- Selecting an image editor or HyperFrames package solely through this document.

### Success signals

- Capability UI produces no false-positive “callable” state in test fixtures for missing bindings, context, host grants, or implementation.
- Every successful mutating workflow ends with an authoritative result or receipt; preview and approval are never reported as completion.
- The model picker keeps search and the selected model available while presenting a keyboard-operable 10-row results viewport at supported desktop densities.
- Workflow Builder copy and tests distinguish agent-definition persistence, in-memory workflow state, controller node-type support, callback registration, and publication.
- Host-session failures identify the missing authenticated session, organization, or user/principal field without asserting a user role.
- WCAG 2.2 AA keyboard, focus, name/role/value, zoom/reflow, reduced-motion, and contrast checks pass for changed surfaces.

## Personas and jobs

| Persona | Primary jobs | Required product assurance |
| --- | --- | --- |
| Workspace operator | Ask questions, use attached context, configure an agent, review and run workflows | What the agent can do now, what needs approval, what changed, and how to recover |
| Workflow author | Define agent behavior, tools, knowledge, steps, and approvals | Draft persistence is explicit; validation and runtime support are not conflated |
| Creative operator | Organize assets, build a creative document, preview, and request a render | Originals are preserved; preview is not the canonical document; jobs have durable states |
| Host implementation team | Donate context, command bindings, signed grants, and theme | Clear protocol boundaries, failure reasons, and no client-side authorization shortcuts |
| Platform and security team | Govern providers, data handling, tools, and mutations | Provenance, policy, ZDR status, audit receipts, and fail-closed behavior |

### Contexts of use

- **Embedded sidecar:** narrow, host-themed, page-aware operation inside a signed host session.
- **Full workspace modal:** longer authoring, review, comparison, and run-lifecycle tasks with room for adjacent panels.
- **Standalone harness:** development and evaluation; it must not be mistaken for evidence of a production host grant.
- **Connected trusted host:** the session is authenticated and contains an organization plus a user or principal identifier; command-specific grants may still be absent.
- **Disconnected or incomplete host:** catalog and local editing may remain available, while cloud-backed and mutating actions fail closed with a concrete diagnostic.
- **Input and display variation:** keyboard-only, screen reader, pointer, touch, reduced motion, high zoom, short viewport, and long catalog/result sets.

## Information architecture

### Workspace hierarchy

- **Workspace shell:** navigation, chat history, session context, and access to Agent, Workspace document, Support, Workflow Builder, and future Creative Studio surfaces.
- **Conversation:** turn history, attached context, tool proposals/results, errors, and composer.
- **Agent definition:** identity, model, prompt modules, tool policy, and knowledge references.
- **Workflow definition:** triggers, nodes, edges, validation, runtime support, approvals, and run receipts.
- **Creative document:** asset references, structured composition state, versions, and render intent.

### Per-turn capability truth model

**[Decision]** Every capability shown for a turn has exactly one user-visible truth state. The state is computed from the same structured reason used to enable or disable the action; label, tooltip, accessible description, and behavior may not disagree.

| Truth state | Meaning | Required UI behavior |
| --- | --- | --- |
| **Actually callable** | A mounted executable binding exists; required context is present; policy permits the action; required host grant is present | Enable invocation and identify the bound command/provider |
| **Requires context** | The command exists, but required page, selection, document, entity, or session context is missing | Disable invocation; name the missing context and the action that can provide it |
| **Requires host grant** | The command and context exist, but a trusted signed host grant or approval is absent | Disable invocation; offer the supported reconnect or approval path |
| **Catalog-only** | A manifest or catalog advertises the capability, but the current surface/session has no mounted executable binding | Permit inspection, never Run; say “Available in catalog, not connected here” |
| **Not implemented** | The product behavior, adapter, or runtime path has not shipped | Render an honest unavailable state or omit it; never use a silent no-op |

The evaluation fails closed. “Actually callable” is returned only after every prerequisite passes. An unimplemented product path takes precedence over catalog discovery; absence of a binding produces catalog-only; a callable binding then checks context and host grant before becoming executable. Unknown metadata is not positive evidence.

Discovery, authority, and callability are separate dimensions in data even though they resolve to one display state. A capability manifest answers “what exists”; a host grant answers “what this host authorizes”; a mounted binding plus satisfied prerequisites answers “what can run now.”

### Workflow Builder IA

**[Observed]** The current builder exposes **Config**, **Canvas**, and **Debug & Preview** tabs. Save draft persists only the `AgentDefinition`; the workflow draft remains in component memory. Canvas is an ordered form, not a graph editor. There is no Publish control. Canvas badges report whether a node type is supported by the controller; they do not report whether a server callback is registered. Only registered server callbacks can preview or commit a run, and callback readiness is not surfaced. The locked **Example: Amplify campaign workflow** card is the one known complete example.

**[Observed]** The current Config panel derives display-family keys from the first two dotted segments of each capability ID and saves those keys into `toolPolicy`. Runtime policy resolution compares saved family modes with family IDs supplied by the mounted command catalog. Those identifiers can differ, so the displayed Off/Ask/Allow value is configuration intent, not reliable proof of the effective runtime mode. The runtime pin, server preflight, host grant, diagnostics, and final receipt remain authoritative.

**[Decision]** The durable IA separates three stages and their persistence:

1. **Configure agent** — identity, model, prompt modules, tool families, and knowledge.
2. **Build workflow** — current workflow, validation, controller node-type support, nodes, edges, required host context, and approval/effect semantics. Callback readiness is a separate preflight fact and must not be inferred from Canvas badges.
3. **Test & run** — agent conversation test and workflow lifecycle as distinct panels; preflight, Start, Preview, Approve, Commit, and receipt.

The header identifies the agent and workflow, reports dirty/saved state, and uses explicit actions: **Save agent draft**, **Save workflow draft**, and **Publish** only when each corresponding backend exists. Until workflow persistence and publication exist, those actions are not simulated. Templates and examples live in a separate chooser and never masquerade as the current saved draft.

### Model catalog IA

**[Observed]** Vercel AI Gateway distinguishes models from providers and publishes model metadata including model type and provider availability. The current Sonik configuration searches a fetched or fallback list across label, ID, provider, and description.

**[Decision]** The model picker contract is:

- Search is always visible and available; opening details must not replace or hide it.
- The results viewport is bounded to exactly **10 standard-density rows** with internal scrolling. This is a viewport, not pagination.
- The selected model remains visible as a pinned selected row/group when query or filters would otherwise hide it. It is not duplicated in results.
- Each row expands and collapses. The collapsed row shows display name, provider, type/modality, context summary, and compatibility status. Expanded details may show model ID, supported modalities, relevant limits/pricing, provider endpoints, ZDR metadata, and provenance.
- Type/modality filters cover the catalog’s real categories, including language/text, image, video, and embedding; additional audio/speech categories appear only when the source reports them.
- Hard incompatibility is explicit, not merely disabled: show the failed requirement, such as unsupported tools, modality mismatch, or policy/ZDR requirement. Hard-incompatible models are not selectable.
- Missing or stale metadata is labeled **Unknown** and validated again at request time; it is never treated as compatible by default.
- Fallback catalog data remains available for resilience but is labeled with its source and freshness. Provider-specific options remain separate from a model identity.

### Creative Studio bones

**[Decision]** Creative Studio uses the following entity and responsibility chain:

`asset library → creative document → editor → player preview → asynchronous render job`

| Boundary | Responsibility | Must not become |
| --- | --- | --- |
| Asset library | Immutable originals, derived variants, media metadata, ownership, provenance, and access policy | An editor-local blob cache with no durable identity |
| Creative document | Canonical, versioned, structured state referencing assets and edits | A rendered binary or UI-component state dump |
| Editor | Produces document changes through a stable adapter and command/history model | The source of truth or authority boundary |
| Player preview | Sandboxed, seekable preview of a document/version | The canonical document store or proof of a final render |
| Async render job | Durable queued/running/succeeded/failed/cancelled lifecycle, progress, inputs, outputs, logs, and receipt | A blocking browser request or an optimistic “done” state |

**[Decision]** Generated images and videos are new derived assets associated with a job and provenance. They do not mutate the editor canvas optimistically. AI SDK `generateImage` can support prompt-based generation and image/mask editing at the server boundary. AI SDK `generateVideo` remains explicitly experimental and stays behind a capability flag and asynchronous job contract.

## Design principles

1. **Truth before convenience.** A disabled action explains its missing prerequisite. A completed action has a receipt or authoritative result.
2. **Progressive disclosure without concealment.** Default views stay scannable; expanded details expose identity, policy, provenance, and technical reasons.
3. **Preview before mutation.** Write, destructive, and external effects require an inspectable preview when the command contract supports one, followed by explicit approval and commit.
4. **One source for state and copy.** Enablement, reason codes, visual labels, and accessible descriptions derive from the same state model.
5. **Host trust is not agent preference.** Tool-family settings shape agent behavior; host grants and server authorization decide whether a command may execute.
6. **Portable domain boundaries.** Sonik owns agent, workflow, asset, creative-document, and render-job contracts. UI libraries and runtimes sit behind adapters.
7. **Recovery is a first-class path.** Preserve user work where possible; state exactly what Reset, Clear, Back, New agent, retry, and reconnect affect.

## Visual language

- Use existing semantic theme tokens, Daisy theme foundations, typography, radius, border, focus, and elevation conventions. Do not add raw brand colors to feature components.
- Structure dense operational surfaces with restrained borders, compact cards, tables, status rows, and whitespace rather than decorative gradients or oversized marketing treatments.
- Reserve color for status and action hierarchy. Every color-coded state also has text and, where useful, an icon.
- Capability and compatibility badges use stable labels from the truth model. Avoid generic labels such as “Unavailable” when a concrete reason exists.
- Primary action is singular within a local step. Destructive or committing actions remain visually distinct from preview and navigation.
- Motion reinforces spatial or lifecycle change, respects reduced-motion preferences, and never carries the only state signal.

## Components

### Capability status

- Accepts structured capability identity, binding state, required context, grant state, and implementation state.
- Emits one truth state and one stable reason code.
- Renders a badge in summaries and a full reason plus recovery action in detail views.
- Never infers authorization from `allow`, catalog membership, or a client-only state.

### Command and tool controls

**[Observed]** Current builder controls save configuration intent, but their derived family keys can differ from mounted runtime family IDs. They must not be described as effective runtime enforcement until the mapping is unified and verified.

**[Decision]** After that mapping is verified, commands and tools use these honest semantics:

- **Off:** the agent cannot select or invoke the tool family for this definition.
- **Ask:** the agent may propose or use it through the product’s approval path.
- **Allow:** the agent may use it with less operator friction, but host grant, server authorization, RLS/organization policy, command preflight, and effect-specific approval still apply.
- Inherited command settings name the family they inherit from. A command override is visible and reversible.
- Catalog-only commands can be inspected but have no enabled Run action.
- A proposal is not an execution; a preview is not a commit; a successful commit supplies an authoritative result or receipt.

### Model picker

- Persistent search input; filter controls; pinned selected row; 10-row scroll viewport; expandable model rows.
- Clear loading, empty, fallback, stale, and fetch-error states.
- Compatibility status includes a text reason and is available before selection.
- Keyboard navigation follows listbox/disclosure semantics without trapping focus inside the scroll region.

### Workflow editor

- Stage navigation, validation summary, structured nodes and edges, controller node-type support, and explicit required host context.
- Callback readiness is a separately sourced preflight state. A controller-supported node type does not imply that Preview or Commit has a registered callback.
- Mutation nodes display effect and approval; preview nodes remain none/read and bind to the same command when required by the contract.
- The run panel uses stable disabled reasons, a preflight checklist, and a visible lifecycle with receipt.
- Save status distinguishes agent persistence, workflow persistence, and publication.

### Creative document shell

- Asset browser, document outline/timeline, property inspector, player preview, history, and render-job drawer are separable regions.
- The editor loads and writes through adapters. The shell remains usable when an optional editor integration is unavailable.
- Long-running render state persists beyond the modal and is recoverable by job ID.

### HyperFrames package boundaries

**[Observed]** HyperFrames documents distinct core, studio, and player packages; its repository also describes CLI, engine, and producer responsibilities.

**[Decision]** If HyperFrames passes a future adoption review:

- `@hyperframes/core` may sit at the structured composition boundary for types, parsing, linting, HTML/runtime generation, and validation.
- `@hyperframes/studio` stays behind a Sonik editor adapter. It is React-based and must not leak React component state into Sonik’s Svelte domain contract.
- `@hyperframes/player` is preview/playback only and enters Sonik through its framework-neutral custom-element boundary. It is not an editor or state store. Any additional iframe or sandbox isolation is a future embedding/security spike and Sonik decision, not an upstream-documented contract assumed here.
- HyperFrames producer/engine responsibilities run in a server worker for render orchestration and capture; they never ship as browser authority.
- The HyperFrames CLI is a development/authoring surface, not an end-user runtime dependency.
- Sonik continues to own assets, creative documents, versions, permissions, render jobs, and receipts.

### Image-editing seam

**[Decision]** The domain exposes an `ImageEditorAdapter` with lifecycle responsibilities equivalent to:

1. load an asset reference and relevant creative-document slice;
2. emit non-destructive edit operations and a derived preview/output reference;
3. serialize/restores edits without editor-private UI state;
4. cancel, unload, and destroy resources cleanly.

The adapter is lazy-loaded and may be sandboxed. miniPaint, Fabric.js, and Filerobot Image Editor are evaluation candidates only. **No dependency is selected by this document.** A spike must validate license and transitive-license fit, maintenance and vulnerability posture, bundle/runtime cost, CSP and DOM/iframe isolation, Svelte interoperability, keyboard and screen-reader behavior, serialization stability, image input/output controls, worker/off-main-thread behavior, and asset-exfiltration risk before a recommendation is made.

## Accessibility

- Target WCAG 2.2 AA for authored surfaces.
- Use native controls and semantic regions before custom roles. Name every icon-only action.
- Keyboard users can reach, operate, and leave model lists, disclosures, canvas forms, previews, approval controls, and drawers without a pointer or focus trap.
- Focus remains visible against every supported theme and moves intentionally after stage changes, validation jumps, dialogs, and async completion.
- Disabled actions remain discoverable when their reason is material: use `aria-describedby` or adjacent reason text rather than an inaccessible tooltip-only explanation.
- Status does not rely on color. Announce consequential asynchronous changes in a polite live region; do not repeatedly announce progress noise.
- Error summaries link to fields; errors identify the problem and corrective action. Preserve entered values after validation failure.
- Meet a minimum 44-by-44 CSS-pixel target for primary touch actions, with adequate spacing for compact controls.
- Respect reduced motion, increased contrast, zoom, text resizing, and reflow. Preview playback offers pause/stop controls when motion is not user-initiated.
- A virtualized or internally scrolling model list must retain logical reading order, programmatic selected state, and the pinned selected model without duplicate accessible options.

## Responsive behavior

- Embedded sidecar, full workspace modal, and standalone harness are first-class layouts, not scaled copies of one desktop canvas.
- At compact widths, stage navigation becomes a labeled tab/step control; details and inspectors move into sheets or stacked sections. Primary content retains a usable reading width.
- The model catalog keeps its 10-row bounded viewport at standard density where space permits. On short screens, it may reduce physical row height only within accessible density limits; search and the selected row remain visible.
- Workflow forms stack before labels or reasons truncate. Run lifecycle and receipt remain in document order.
- Creative Studio prioritizes player/canvas plus one active inspector on narrow screens; asset library, outline, properties, and jobs are toggled regions with state-preserving transitions.
- No essential action, explanation, or status is hover-only. Horizontal scrolling is limited to media/timeline regions that provide keyboard alternatives.

## Interaction states

Every interactive surface defines at least: initial, loading, ready, empty, filtered-empty, dirty, saving, saved, validation error, runtime error, permission blocked, offline/reconnecting where relevant, and success with authoritative evidence.

### Capability and command states

- Recompute the single truth state when the turn, attached context, selected document, host session, or grant changes.
- If a grant expires between preview and commit, fail closed, keep the preview, and explain how to renew authority.
- Server denial replaces optimistic client state; it does not get softened into a generic generation error.

### Workflow lifecycle

`draft → validated → started → previewed → approved → committed`

- Busy operations prevent duplicate submission and name the active step.
- Reset clears run state, not the workflow definition. Clear in Debug & Preview clears that test conversation, not saved definitions.
- New agent warns before discarding dirty in-memory state once a confirmation pattern exists; until then, copy must candidly state the current behavior.
- Arbitrary valid drafts without registered callbacks can be started but cannot preview or commit. Show `no_callback_registered` as a supported-runtime limitation, not a malformed workflow.

### Render-job lifecycle

`queued → running → succeeded | failed | cancelled`

- Progress may be indeterminate, but status and last update are always available.
- Success links to durable output assets and a receipt. Failure preserves input/version references, diagnostic ID, and an eligible retry action.
- Closing the editor never cancels a job implicitly.

## Content voice

- Use concise enterprise language: calm, factual, and specific.
- Name the object and consequence: “Save agent draft” rather than “Save”; “Commit campaign creation” rather than “Continue.”
- Prefer a reason plus remedy: “Host approval is required. Reconnect this workspace or ask an authorized host operator to approve the command.”
- Never expose raw JSON as the primary user error. Preserve diagnostic details behind a disclosure or copy action.
- Distinguish unavailable, unsupported, and unauthorized. Do not use “Generation failed” for host-session or command-grant failures.
- Do not say “published,” “saved,” “connected,” “approved,” or “completed” until the corresponding durable or authoritative state exists.
- Label experimental behavior explicitly, especially video generation.

## Implementation constraints

- Signed host context is authoritative for cloud-backed or mutating operations. Client settings cannot bypass host approval, authentication, organization policy, RLS, or server preflight.
- Mutation workflow nodes require trusted approval and required host context under the current tool contract. Preview nodes remain none/read and obey command-pair validation.
- Dynamic model discovery uses Vercel AI Gateway metadata when available, with a clearly identified fallback. Provider identity/options remain distinct from model identity.
- Zero-data-retention requirements are request-time policy constraints. Catalog metadata can inform the UI but cannot alone guarantee runtime ZDR handling.
- Custom markdown skills are session-scoped unless an explicit publishing system says otherwise.
- Domain types must not depend on Svelte, React, a specific image editor, or HyperFrames package-private state.
- HyperFrames and image-editor integrations require license, security, accessibility, CSP/isolation, bundle, and embedding validation before adoption. This document approves no new dependency.
- Image and video generation run on trusted server boundaries. Generated outputs become versioned derived assets with provenance.
- Experimental AI SDK video generation is feature-gated and asynchronous; no stable-product promise depends on it.
- UI copy and disabled behavior derive from stable reason codes. Raw API reasons remain available for diagnostics but are mapped to actionable user language.
- Current implementation truth must remain visible: agent draft persistence does not imply workflow persistence, and a valid draft does not imply registered runtime callbacks.
- Tool-policy family identity must come from the same mounted command-catalog mapping in Config, persistence, and runtime enforcement. Until that is implemented and tested, Off/Ask/Allow is configuration intent only.

### Ownership and reuse

- Reuse current shared `Button`, `Badge`, `Card`, `Tabs`, `Input`, `Textarea`, `Select`, and `Accordion` primitives before creating feature-local equivalents.
- Reuse the existing workspace shell, conversation, approval affordance, disabled-reason, workflow validation, and receipt patterns where their contracts fit; do not clone them into Creative Studio or the model picker.
- Theme foundations and semantic tokens are owned by the theme layer in `apps/standalone-sveltekit/src/lib/theme` and `app.css`. Feature components consume those tokens and do not add independent brand palettes.
- Cross-surface primitives belong in the existing shared component/package boundary; workflow-specific composition remains with Workflow Builder; asset/document/job domain contracts remain framework-neutral packages; host authorization remains a server/host-protocol concern.
- A new component is justified only when existing ownership cannot represent the state or accessibility contract without misleading semantics.

### Verification and screenshot expectations

- Add unit coverage for capability-state precedence, stable disabled reasons, model filtering/pinned selection, tool-family identity mapping, and workflow persistence boundaries.
- Add component coverage for keyboard navigation, disclosures, focus restoration, errors, disabled explanations, internal scrolling, and reduced motion.
- Keep an end-to-end proof for the locked Amplify Run → Preview → Approve → Commit path, including missing/incomplete host session, missing grant, busy state, callback absence, and receipt.
- Capture review screenshots at embedded-sidecar and full-workspace widths in at least the default light and dark themes. Include ready, loading, empty, error, requires-context, requires-host-grant, catalog-only, incompatible-model, 10-row catalog, validation-error, preview-ready, and committed-receipt states when those states are implemented.
- Screenshot evidence supplements, but never replaces, DOM assertions, accessibility checks, or authoritative run receipts.

## Open questions

- [ ] **[Open] Workflow persistence** — **Owner:** Workflow platform. **Impact:** Without a durable schema, versioning, and migration policy, workflow drafts remain vulnerable to loss and cannot support trustworthy publication.
- [ ] **[Open] Publication** — **Owner:** Product and workflow platform. **Impact:** Publish cannot ship until review, authorization, versioning, rollback, and audit gates are defined.
- [ ] **[Open] Capability transport** — **Owner:** Host protocol and agent runtime. **Impact:** The five-state model cannot be authoritative until binding, context, grant, expiry, and invalidation facts share a per-turn contract.
- [ ] **[Open] Tool-family identity mapping** — **Owner:** Agent runtime and Workflow Builder. **Impact:** Off/Ask/Allow remains configuration intent until Config uses the same command-catalog family IDs as runtime enforcement and regression tests prove the mapping.
- [ ] **[Open] Model compatibility** — **Owner:** AI platform. **Impact:** Selection can be misleading until hard blockers, warnings, unknown metadata, and request-time enforcement have a single policy source.
- [ ] **[Open] Catalog freshness** — **Owner:** AI platform. **Impact:** Operators cannot assess fallback risk without cache, timestamp, and provenance requirements.
- [ ] **[Open] Workflow runtime** — **Owner:** Workflow platform. **Impact:** Authored workflows beyond Amplify cannot be represented as runnable until callbacks are registered and readiness is reported separately from controller node support.
- [ ] **[Open] Creative document format** — **Owner:** Creative platform architecture. **Impact:** Asset/version portability and HyperFrames integration depend on a framework-neutral canonical document decision.
- [ ] **[Open] Editor integration** — **Owner:** Creative platform and security. **Impact:** No image-editor candidate can be adopted until license, security, accessibility, embedding, performance, and serialization validation passes.
- [ ] **[Open] Render infrastructure** — **Owner:** Media platform. **Impact:** Durable render status, retry, cancellation, quota, storage, and receipts are blocked without a worker contract.
- [ ] **[Open] Generated-media policy** — **Owner:** Trust, security, and AI platform. **Impact:** Image and experimental video generation cannot ship broadly without provider, provenance, retention, content-control, and review policy.
- [ ] **[Open] Responsive Studio** — **Owner:** Product design. **Impact:** Embedded-sidecar scope and full-workspace parity remain undefined.
- [ ] **[Open] Accessibility verification** — **Owner:** Design systems and quality engineering. **Impact:** Creative Studio and revised model-picker release gates remain incomplete without automated and assistive-technology expectations.

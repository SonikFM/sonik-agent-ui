# Workflow Builder operator guide

Workflow Builder configures agents and governed workflows inside an authenticated workspace. It saves drafts, reloads saved workflows, publishes immutable workflow versions with dependency pins, and runs supported workflow definitions through server authority.

## Before you begin

- Use a trusted host session with an organization ID and a user or principal ID.
- Obtain the exact host grant/approval required by any mutating command. Agent tool policy never replaces host authorization, organization policy, RLS, or server preflight.
- Supply authoritative workflow publish pins before publishing.
- Know the ID of any knowledge store you want to attach. Workflow Builder cannot create a knowledge store.

Agent and workflow repositories use Neon/Postgres when a supported database URL is configured. Without one, the server uses a process-memory fallback: save/reload works within that process but does not survive a restart.

## Saved and published state

| Object | Current behavior |
| --- | --- |
| Agent definition | **Save draft** validates and saves the current `AgentDefinition`. |
| Workflow draft | **Save draft** also creates or updates the workflow draft with an expected revision and definition digest. |
| Saved workflow list | Saved drafts can be selected and reloaded. Revision conflicts fail instead of overwriting a newer draft. |
| Workflow versions | Version history is listed for the selected workflow; a draft can also be cloned. |
| Published workflow | **Publish** creates an immutable published version only when the current draft revision, workflow version ID, definition digest, and dependency pins agree. |
| Debug conversation | Temporary; **Clear** removes its messages. |
| Workflow run | Server-backed. Generic supported definitions can start, but later steps still require registered node executors/callbacks and applicable authority. |

## Configure the agent

### Identity and model

Set the display title and select a model compatible with the agent’s tool and modality needs. The agent ID is generated and read-only. If the live model catalog fails, the builder may show fallback entries; confirm the intended model before production use.

### Prompt modules

Prompt modules are ordered. A missing override uses the module default, a non-empty override replaces it, and an explicit empty override suppresses it.

### Tool policy and authoritative readiness

Each capability family can be **Off**, **Ask**, or **Allow**. The current draft `toolPolicy` is sent to the server readiness endpoint; it is not treated as authorization.

Readiness is computed from the registered capability, implementation and authoring support, definition compatibility, mounted runtime binding, authenticated context/scopes, host grant or approval, kill switch, version pin, preview state, and commit approval. The UI displays the server result for each capability.

- **Off** keeps the family unavailable.
- **Ask** or **Allow** can be selected only when authoritative readiness proves the family is otherwise runnable.
- A current **Off** value can be changed only from a separate server-authoritative policy-neutral check, preventing the Off policy itself from creating an edit deadlock.
- Fetch errors, HTTP errors, malformed responses, and missing capability rows are explicitly **readiness unavailable** and default deny: Ask and Allow stay disabled.
- Host grant/approval remains a separate authority layer. Allow never bypasses it.

### Knowledge

Attach an existing store by ID and title. Knowledge-store creation remains unavailable in Workflow Builder.

## Draft and edit a workflow

1. Use **Debug & Preview** to describe the outcome, trigger, ordered steps, commands, context, and approval expectations.
2. A valid generated draft is loaded into **Canvas**.
3. Review and edit the ordered workflow form.
4. Select **Save draft**. Both the validated agent definition and workflow draft are saved.
5. Use **Saved workflows** to reload a draft. Resolve a revision conflict rather than retrying an overwrite blindly.

Canvas is an ordered authoring surface, not a freeform graph editor. Schema validity and a supported node type do not prove that a registered executor or preview/commit callback exists.

## Publish

Publish is available for a saved, valid workflow when the host supplies authoritative dependency pins. Publication checks:

- the authenticated organization/user owner;
- current expected draft revision;
- workflow version ID and definition digest;
- organization-matching dependency pins;
- capability registration, implementation, authorability, and definition compatibility; and
- registered workflow node executors required for publication.

A published version is immutable and can be resolved by its pins. Publishing does not issue a host grant and does not guarantee that every environment has the callbacks needed for every later run step.

## Run supported workflows

The run controller accepts generic published or pinned definitions that pass its supported contract; it is not limited to a single hard-coded workflow. The shipped Amplify campaign workflow remains the reliable full **Run → Preview → Approve → Commit** example.

For a governed mutation:

1. Start the run from the intended published source.
2. Supply any paused user input.
3. Preview and inspect the proposed effect.
4. Obtain trusted approval for the exact command after preview.
5. Commit once.
6. Verify the authoritative result, artifact, and receipt in history.

An arbitrary valid workflow may start and later fail with `no_callback_registered` or an unsupported executor result. Register the required executor/callback or use a supported workflow; do not treat schema validation as execution readiness.

## Controls and recovery

| Control | Effect |
| --- | --- |
| **Save draft** | Saves the agent definition and creates/updates the workflow draft. |
| **Saved workflows** | Reloads a server-side workflow draft. |
| **Clone** | Creates a new draft from the selected pinned source. |
| **Publish** | Creates an immutable version using authoritative pins. |
| **Reset** | Clears current run lifecycle state, not the workflow draft. |
| **Clear** | Clears the Debug & Preview transcript. |
| **Back to chat** | Returns to chat while preserving the active conversation. |
| **New agent** | Starts a new working agent/workflow; unsaved changes require confirmation where the builder detects them. |

Common recovery:

- `revision_conflict_or_archived`: reload the latest draft or clone it; do not overwrite it.
- `dependency_pins_mismatch`: refresh authoritative pins for the current digest/revision.
- `trusted_host_approval_required` or `run_approval_does_not_cover_command`: obtain a new signed grant for the exact command.
- `no_callback_registered`: register the workflow callback/executor or use the supported example.
- readiness unavailable: restore the workspace session or endpoint, then wait for a complete authoritative response.

## Current limitations

- Canvas remains ordered rather than freeform.
- Arbitrary valid workflows may lack registered executors or preview/commit callbacks.
- Knowledge-store creation is unavailable.
- Debug & Preview does not provide main-chat attachment/context-chip controls.
- Prompt-module default and explicit-empty states are not visually distinct.
- Host grant/approval remains separate from agent tool policy.
- Database durability requires a configured Neon/Postgres URL; otherwise storage is process-local.
- G007 remains deferred; this guide does not claim that deferred scope is implemented.

## Preflight checklist

- [ ] Trusted host session is authenticated with organization and user/principal identity.
- [ ] Agent definition and workflow draft saved successfully.
- [ ] The intended saved revision was reloaded and validation passes.
- [ ] Capability readiness is authoritative and complete; no unavailable or missing rows are being treated as allow.
- [ ] Required executor/callback support is registered for the planned run path.
- [ ] Publish version ID, definition digest, organization, and dependency pins match.
- [ ] Exact host grant covers the commit command.
- [ ] Preview was inspected before approval.
- [ ] Commit returned an authoritative result or receipt.

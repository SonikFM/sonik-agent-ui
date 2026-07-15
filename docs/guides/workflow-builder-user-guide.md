# Workflow Builder operator guide

Workflow Builder lets a user with a complete authenticated host session configure an agent, draft a workflow, inspect validation, and exercise the one known supported preview-to-commit lifecycle. This guide describes the behavior that exists today, including the boundaries that are easy to miss.

## Before you begin

Confirm all applicable prerequisites:

- [ ] The host session is authenticated and contains a non-empty organization ID plus a user ID or principal ID. The workflow-run boundary requires those fields; it does not establish or require a named user role.
- [ ] The embedded workspace has a trusted, signed host session when the workflow needs host context or a mutating command.
- [ ] The host has granted the exact command required for approval and commit.
- [ ] You know the existing knowledge-store ID if you plan to attach one. Creating a store from Workflow Builder is not currently available.

> **Important:** Agent tool settings do not replace a host grant, workspace authorization, organization policy, row-level security, or server preflight.

## What is saved today

| Object | Current behavior |
| --- | --- |
| Agent definition | **Save draft** validates and saves the `AgentDefinition` |
| Workflow draft | Kept in memory while the current builder is open; Save draft does not persist it |
| Workflow publication | No Publish control or publication lifecycle is available |
| Debug conversation | A temporary test surface; **Clear** removes its messages |
| Workflow run | Server-backed for the run lifecycle, but preview/commit require registered callbacks |

Do not treat **Save draft** as a workflow save. Leaving, refreshing, or choosing **New agent** can discard an in-memory workflow. New agent currently resets the working configuration and workflow without a confirmation dialog.

## Open Workflow Builder

1. Open the Sonik workspace.
2. Select **Workflow Builder** from the workspace toolbar.
3. Use **Back to chat** to return. The existing agent chat is preserved when you move between chat and Workflow Builder.

## 1. Configure the agent

Open **Config**, then review each section.

### Identity

The panel shows a generated, read-only **Agent ID** and an editable **Title**. Set a clear title that tells operators what the agent is intended to do. The current panel does not expose a description field.

### Model

- Search matches model label, ID, provider, and description.
- Select a model that supports the agent’s required tool and modality behavior.
- Treat model-catalog metadata as discovery information. Runtime provider policy and zero-data-retention requirements are enforced separately.
- If the live catalog cannot load, the builder may show fallback entries; verify the intended model before production use.

### Prompt modules

Each prompt module has a default instruction and an optional override.

| Override state | Effective behavior |
| --- | --- |
| No override | Use the module’s default instruction |
| Non-empty override | Replace the default with the entered instruction |
| Explicit empty override | Suppress that module’s instruction |

The current interface can make “no override” and “explicit empty override” look the same. If a module unexpectedly disappears from behavior, re-enter a non-empty override or recreate the agent definition rather than assuming the default is active.

### Tool policy: Off, Ask, and Allow

These controls currently record **configuration intent only**. The builder groups capabilities using the first two dotted segments of a capability ID and saves those group keys. Runtime enforcement uses family IDs from the mounted command catalog, and the two identifiers can differ. Until the mapping is unified and verified, the displayed value is not proof of the effective runtime mode.

| Setting | Intended configuration meaning | Current operational limit |
| --- | --- | --- |
| **Off** | Request that the family be unavailable | May not govern runtime when the saved grouping key does not match the mounted family ID |
| **Ask** | Request the operator-approval path | Does not prove that runtime mapped the family or that the host granted the command |
| **Allow** | Request lower-friction agent use | Does not prove effective runtime mode and never bypasses authorization, host approval, RLS, organization policy, or preflight |

The panel presents individual commands as inheriting their displayed family setting unless an override is shown, but runtime behavior must be verified through diagnostics and an actual run. Review command-level effects before expressing Ask or Allow intent for a family that includes write, destructive, or external actions.

### Knowledge

Attach an existing store by its ID and title. **Create new store** is currently disabled. If retrieval fails, verify the store ID, workspace access, and authenticated session before changing the agent prompt.

## 2. Draft with Debug & Preview

This is the recommended drafting path.

1. Open **Debug & Preview**.
2. Describe the desired outcome, trigger, steps, command, required context, and approval expectations.
3. Select **Send**.
4. The builder saves the current agent definition and includes its draft agent ID in the generation request.
5. When the response contains a valid structured workflow draft, the builder loads it and switches to **Canvas**.

Use concrete instructions. For example: “Draft a workflow that previews and creates an Amplify campaign. Require authenticated workspace context and explicit approval before commit.”

If generation fails:

- Keep the prompt text and visible diagnostic message available for diagnosis.
- Check whether the workspace still has an authenticated host session.
- Confirm that the host session contains an organization plus a user or principal identifier.
- Retry the text prompt after reconnecting the host; do not interpret a generic generation error as proof that the prompt was invalid.
- Use diagnostic details to distinguish authentication, host-grant, model, and server failures.

**Debug & Preview has only its transcript and message textarea.** It does not provide file or context-chip attach/remove controls. If the failure occurred in the main chat after a file upload, use **Back to chat** and diagnose that main-chat turn there; builder Debug & Preview cannot modify its attachments or context.

You may also edit the workflow manually in Canvas, but a valid schema does not guarantee that the server has callbacks capable of previewing or committing it.

## 3. Review the Canvas

Canvas is currently an ordered workflow form, not a freeform graph editor.

Review this checklist before testing:

- [ ] The workflow has a clear title and supported trigger.
- [ ] Every node has a unique identity and valid type.
- [ ] Edges reference existing nodes and describe the intended order.
- [ ] A mutation’s effect and approval level are correct.
- [ ] Write, destructive, or external actions declare required host context.
- [ ] The preview node uses a none/read effect where required and targets the correct command pair.
- [ ] No validation errors remain.
- [ ] No node is marked `controller-unsupported`; this checks node type only, not callback readiness.

The current node form does not expose every schema field equally. If required host context is missing from a write/destructive/external node, regenerate or update the structured draft rather than assuming the runtime will infer it. Canvas does not show whether preview/commit callbacks are registered. A supported node badge is not evidence that the workflow can run.

## 4. Save the agent draft

Select **Save draft** after configuration changes. A successful save means the agent definition was persisted. It does **not** mean:

- the current workflow was saved;
- the workflow was published;
- its callbacks were registered;
- a host grant was issued; or
- a production run is ready.

Keep a separate source record for any important workflow draft until workflow persistence is implemented.

## 5. Test the agent

Use **Debug & Preview** to test instructions, model choice, tool-policy behavior, and knowledge access.

- Press Enter to send from the message field.
- Use **Clear** to remove the temporary debug conversation.
- Confirm that answers use only the context represented in the test transcript and do not claim unavailable tools.
- Do not infer callability from a command name or the Off/Ask/Allow controls. Current proof is limited to run responses, committed receipts, and diagnostic details.

Debugging the agent is separate from running the workflow lifecycle.

### Capability truth is a future contract

Sonik’s design contract defines five future per-turn states: actually callable, requires context, requires host grant, catalog-only, and not implemented. **Workflow Builder does not currently provide an authoritative five-state capability UI.** Any isolated badge, permission selector, or catalog row is non-authoritative until the per-turn binding, context, grant, and implementation facts are wired to one resolver. For current operation, rely on server run results, commit receipts, and diagnostics.

## 6. Test the reliable workflow example

The locked **Example: Amplify campaign workflow** card on **Canvas** is the current end-to-end wired workflow. Use its adjacent Run panel to validate the full lifecycle.

1. Open **Canvas** and scroll to the locked **Example: Amplify campaign workflow** card. There is no load action; do not replace the editable draft with it.
2. Enter Product name, Audience, Offer, and Launch date in that card’s Run panel. Confirm the authenticated host session and exact command grant separately.
3. Select **Run** to start the workflow.
4. Select **Preview** and inspect the proposed effect.
5. Select **Approve** only after the preview is correct and the host identifies the exact covered command.
6. Select **Commit**.
7. Verify the authoritative result and receipt. A preview or approval alone is not a completed mutation.

Arbitrary drafted workflows can pass schema validation and start a run but still fail at Preview or Commit with `no_callback_registered`. That is a runtime-support limitation, not evidence that the draft was saved or published incorrectly.

## Disabled actions and recovery

The run panel uses structured reasons. Use the remedy rather than repeatedly selecting a disabled action.

| Reason code | Meaning | Recovery |
| --- | --- | --- |
| `workflow_action_busy` | Another lifecycle action is in progress | Wait for it to finish; do not submit a duplicate |
| `workflow_run_not_started` | Preview or later actions need an active run | Select **Run** first |
| `workflow_preview_node_missing` | The workflow has no controller-supported preview node | Add or regenerate a valid preview node; this still does not prove callback registration |
| `workflow_commit_node_missing` | The workflow has no controller-supported commit node | Add or regenerate the commit node; this still does not prove callback registration |
| `workflow_preview_not_ready` | Approval/commit is blocked until preview completes | Run **Preview**, resolve its error, and inspect the result |
| `trusted_host_approval_required` | No trusted host approval/grant is available | Reconnect the signed host session or request authorization from the host |
| `workflow_run_already_approved` | The current run is already approved | Continue to Commit if otherwise eligible; do not approve twice |
| `run_approval_required` | Commit has not received run approval | Approve the reviewed preview |
| `run_approval_does_not_cover_command` | Approval covers a different command | Request approval for the exact commit command and rerun preflight |
| `workflow_run_committed` | The run has already committed | Review the receipt or start a new run; do not duplicate the mutation |

Other common failures:

| Symptom | Recovery |
| --- | --- |
| Save draft fails | Keep the builder open; verify authentication, validation messages, and network status, then retry |
| `no_callback_registered` | Use the wired Amplify example or have the runtime team register explicit callbacks for the drafted command |
| Authenticated host session required | Reopen/reconnect through the trusted host and confirm it is authenticated with an organization plus a user or principal identifier |
| Host grant missing or stale | Request a new signed grant for the exact command; a tool-family Allow setting is insufficient |
| Builder Debug & Preview generation error | Preserve the prompt and diagnostic, reconnect the complete host session, then retry; attachment controls are not available in this panel |
| Main-chat generation error after file upload | Use **Back to chat** and diagnose the upload turn in main chat; Workflow Builder cannot inspect or change those attachment chips |
| Model catalog fails to load | Confirm the fallback selection and retry when the live catalog is available |

## Reset, Clear, Back, and New agent

| Control | Current effect |
| --- | --- |
| **Reset** in the run panel | Clears the current run lifecycle state; it does not clear the workflow draft |
| **Clear** in Debug & Preview | Clears the temporary preview conversation |
| **Back to chat** | Returns to the agent chat and preserves that chat history |
| **New agent** | Creates a new in-memory agent and workflow without a confirmation prompt; unsaved work can be lost |

Before choosing **New agent**, save the agent definition and copy any important workflow draft to a durable record.

## Current limitations

- Save draft persists only the agent definition.
- Workflow drafts are in-memory and have no publication control.
- Canvas is an ordered form rather than a full graph authoring surface.
- Arbitrary valid workflows may have no registered preview/commit callbacks.
- The Amplify campaign example is the reliable wired Run → Preview → Approve → Commit path.
- Creating a knowledge store in the builder is unavailable.
- Prompt-module default and explicit-empty override states are not visually distinct.
- Some required schema details, including host context for mutation nodes, are not fully represented in the current form.
- Tool settings describe agent behavior, not host or server authorization.
- Current tool grouping keys can differ from runtime command-family IDs, so Off/Ask/Allow is configuration intent until the mapping is verified.
- The five-state capability truth model is a future design contract and is not an authoritative current Workflow Builder UI.
- Canvas reports controller node-type support, not callback readiness.
- Raw or generic generation failures may obscure an authentication or host-grant cause; use diagnostics and reconnect before editing content.

## Preflight checklist

Before relying on a workflow:

- [ ] Agent definition saved successfully.
- [ ] Workflow copied to a durable record if it matters.
- [ ] Canvas validation passes.
- [ ] For arbitrary workflows, callback registration is confirmed outside Canvas; the UI does not report it. Otherwise use the known wired Amplify example.
- [ ] Host session is authenticated and includes an organization plus a user or principal identifier.
- [ ] Required host context fields are supplied by the host/session; Debug & Preview has no attachment controls.
- [ ] Trusted host grant covers the exact commit command.
- [ ] Preview was inspected by a human operator.
- [ ] Approval occurred after preview and covers the same command.
- [ ] Commit returned an authoritative result or receipt.

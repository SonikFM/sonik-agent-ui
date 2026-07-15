import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createEmptyAgentDefinition,
  createEmptyWorkflowDefinition,
  groupCapabilitiesByFamily,
  effectiveFamilyMode,
  validateAgentDefinition,
  validateWorkflowDefinition,
  WORKFLOW_NODE_TYPES,
  LIVE_CONTROLLER_NODE_TYPES,
  agentRequiresToolUse,
  isModelIncompatible,
  formatModelContextWindow,
  createWorkflowBuilderApprovalState,
  resolveWorkflowRunActionDisabledState,
  resolveWorkflowRunBusyDisabledState,
  selectActiveWorkflowRun,
  resolveWorkflowDraftLifecycle,
  hasUnsavedWorkflowChanges,
  workflowDefinitionToVNext,
  workflowVNextToDefinition,
} from "../../apps/standalone-sveltekit/src/lib/components/workflow-builder/builder-model.ts";

// Phase 5 (agent-creation-tool-plan-2026-07-13.md, Decision 3): the missing
// workflow-builder verification wave -- builder-model.ts pure logic + source
// assertions on the third workspace mode's wiring (+page.svelte,
// AgentConfigPanel, DebugPreviewPane) and the agent-definitions API. Mirrors
// the source-content-assertion style of app-shell-session-rail.test.mjs /
// reservation-approval-ui.test.mjs -- no DOM rendering framework.

// -- builder-model.ts pure logic --------------------------------------------

const emptyAgent = createEmptyAgentDefinition("agent_test");
assert.equal(emptyAgent.agentId, "agent_test");
assert.equal(emptyAgent.title, "Untitled agent");
assert.deepEqual(emptyAgent.toolPolicy, {}, "a fresh agent definition grants nothing by default");
assert.deepEqual(emptyAgent.promptModules, { moduleIds: [], overrides: {} });
assert.deepEqual(emptyAgent.knowledgeRefs, []);

const emptyWorkflow = createEmptyWorkflowDefinition("agent_test.workflow");
assert.equal(emptyWorkflow.workflowId, "agent_test.workflow");
assert.equal(emptyWorkflow.nodes.length, 1);
assert.equal(emptyWorkflow.nodes[0].type, "trigger");

assert.deepEqual(WORKFLOW_NODE_TYPES, [
  "trigger", "ask_user", "tool_preview", "approval", "tool_commit",
  "skill", "artifact", "remote_execution", "evidence", "branch",
], "the canvas node-type picker must offer exactly the 10 schema node types");
assert.deepEqual(
  [...LIVE_CONTROLLER_NODE_TYPES].sort(),
  ["approval", "ask_user", "tool_commit", "tool_preview", "trigger"].sort(),
  "the controller-live set (Decision 2) must stay exactly the 5 live node types",
);
for (const type of LIVE_CONTROLLER_NODE_TYPES) {
  assert.ok(WORKFLOW_NODE_TYPES.includes(type), `every live-controller type (${type}) must also be a valid schema node type`);
}

const families = groupCapabilitiesByFamily();
assert.ok(families.length > 0, "the shipped capability registry must group into at least one family");
assert.deepEqual(
  families.map((family) => family.familyId),
  families.map((family) => family.familyId).slice().sort((a, b) => a.localeCompare(b)),
  "families must be sorted for stable UI ordering",
);
for (const family of families) {
  assert.ok(family.capabilities.length > 0, `family ${family.familyId} must not be empty`);
  for (const capability of family.capabilities) {
    assert.equal(
      capability.capabilityId.split(".").slice(0, 2).join("."),
      family.familyId,
      "every capability in a family bucket must share that family's dotted prefix",
    );
  }
  const ids = family.capabilities.map((capability) => capability.capabilityId);
  assert.deepEqual(ids, ids.slice().sort((a, b) => a.localeCompare(b)), `capabilities within family ${family.familyId} must be sorted`);
}

// -- builder-model.ts: model-picker helpers (Dify-bar incompatible flag) ----

assert.equal(agentRequiresToolUse(emptyAgent), false, "a fresh agent with no tool grants must not require tool-use");
const toolGrantedAgent = { ...emptyAgent, toolPolicy: { [families[0].familyId]: "ask" } };
assert.equal(agentRequiresToolUse(toolGrantedAgent), true, "any non-off family grant means the agent requires tool-use");
const offOnlyAgent = { ...emptyAgent, toolPolicy: { [families[0].familyId]: "off" } };
assert.equal(agentRequiresToolUse(offOnlyAgent), false, "an explicit off grant must not count as requiring tool-use");

assert.equal(isModelIncompatible(emptyAgent, { supportsTools: false }), false, "no tool grants at all means no model can be incompatible on tool-use grounds");
assert.equal(isModelIncompatible(toolGrantedAgent, { supportsTools: false }), true, "a tool-granted agent on a model that explicitly lacks tool-use must flag incompatible");
assert.equal(isModelIncompatible(toolGrantedAgent, { supportsTools: true }), false, "a model that explicitly supports tools must never flag incompatible");
assert.equal(isModelIncompatible(toolGrantedAgent, {}), false, "unknown tool-use capability (undefined) must never read as a false incompatibility");

assert.equal(formatModelContextWindow(undefined), "context unknown");
assert.equal(formatModelContextWindow(8_000), "8K context");
assert.equal(formatModelContextWindow(2_000_000), "2M context");

assert.equal(effectiveFamilyMode(emptyAgent, families[0].familyId), "off", "an ungranted family must read as off, never silently allow");
const grantedAgent = { ...emptyAgent, toolPolicy: { [families[0].familyId]: "allow" } };
assert.equal(effectiveFamilyMode(grantedAgent, families[0].familyId), "allow", "effectiveFamilyMode must reflect an actual grant");
assert.equal(effectiveFamilyMode(grantedAgent, "nonexistent.family"), "off", "an unknown family must fail closed to off");

const validAgentResult = validateAgentDefinition(emptyAgent);
assert.equal(validAgentResult.ok, true);
assert.equal(validAgentResult.definition?.agentId, "agent_test");
assert.equal(validAgentResult.issues, undefined);

const invalidAgentResult = validateAgentDefinition({ title: "Missing agentId" });
assert.equal(invalidAgentResult.ok, false, "a definition missing required fields must fail validation");
assert.ok(Array.isArray(invalidAgentResult.issues) && invalidAgentResult.issues.length > 0);
assert.equal(invalidAgentResult.definition, undefined);

const validWorkflowResult = validateWorkflowDefinition(emptyWorkflow);
assert.equal(validWorkflowResult.ok, true);
assert.equal(validWorkflowResult.workflow?.workflowId, "agent_test.workflow");

const invalidWorkflowResult = validateWorkflowDefinition({ nodes: [{ nodeId: "n1", type: "not_a_real_type" }] });
assert.equal(invalidWorkflowResult.ok, false, "an invalid node type must fail workflowDefinitionSchema validation");
assert.ok(Array.isArray(invalidWorkflowResult.issues) && invalidWorkflowResult.issues.length > 0);

const lifecycle = (overrides = {}) => resolveWorkflowDraftLifecycle({
  valid: true, saving: false, publishing: false, conflicted: false, failed: false,
  dirty: false, draftRevision: 1, publishedRevision: null, ...overrides,
});
assert.equal(lifecycle({ draftRevision: null }), "new");
assert.equal(lifecycle({ dirty: true }), "dirty");
assert.equal(lifecycle({ saving: true, dirty: true }), "saving");
assert.equal(lifecycle(), "saved");
assert.equal(lifecycle({ publishing: true }), "publishing");
assert.equal(lifecycle({ conflicted: true }), "conflicted");
assert.equal(lifecycle({ valid: false }), "invalid");
assert.equal(lifecycle({ failed: true, dirty: true }), "failed");
assert.equal(lifecycle({ draftRevision: 2, publishedRevision: 1 }), "outdated");
assert.equal(lifecycle({ draftRevision: 2, publishedRevision: 2 }), "published");
assert.equal(hasUnsavedWorkflowChanges({ dirty: false, saving: false, publishing: false }), false);
assert.equal(hasUnsavedWorkflowChanges({ dirty: true, saving: false, publishing: false }), true);
assert.equal(hasUnsavedWorkflowChanges({ dirty: false, saving: true, publishing: false }), true);
assert.equal(hasUnsavedWorkflowChanges({ dirty: false, saving: false, publishing: true }), false, "publishing an already-saved revision is not unsaved work");

const vNextWorkflow = workflowDefinitionToVNext(emptyWorkflow);
assert.equal(vNextWorkflow.schemaVersion, "sonik.workflow.vnext.v1");
assert.equal(vNextWorkflow.entryNodeId, "trigger");
assert.equal(workflowVNextToDefinition(vNextWorkflow).workflowId, emptyWorkflow.workflowId, "the explicit legacy/VNext bridge preserves workflow identity");

// A tool_commit node without preview_then_trusted_approval must fail the
// schema's write/commit refinement (marketplace.ts:219-220) -- the canvas
// must never let a hand-edited draft silently skip the approval gate.
const uncommittedTrustNode = validateWorkflowDefinition({
  workflowId: "wf_bad",
  title: "Bad workflow",
  version: "0.1.0",
  nodes: [{ nodeId: "commit1", type: "tool_commit", title: "Commit", effect: "write", approvalPolicy: "none" }],
});
assert.equal(uncommittedTrustNode.ok, false, "a tool_commit node must require preview_then_trusted_approval");

// -- builder approval projection: controller state + signed host grant only --

const previewReadyRun = {
  runId: "run_builder_preview",
  workflowId: "amplify.campaign.create",
  workflowVersionId: "sonik.amplify.campaign.workflow@0.1.0",
  artifactId: null,
  phase: "preview_ready",
  currentNodeId: "preview",
  facadeToolIds: [],
  nodeStates: {
    preview: {
      nodeId: "preview",
      type: "tool_preview",
      status: "preview_ready",
      commandId: "amplify.campaign.create",
      effect: "external",
      required: false,
      preview: {
        commandId: "amplify.campaign.create",
        stableInputHash: "campaign-hash",
        effect: "external",
        approvalRequired: true,
      },
    },
    commit: {
      nodeId: "commit",
      type: "tool_commit",
      status: "pending",
      commandId: "amplify.campaign.create",
      effect: "write",
      required: false,
    },
  },
  approvalState: { status: "none", hostSigned: false, approvedCommandIds: [], approvedInputHashes: {} },
  receipts: [],
};

assert.deepEqual(createWorkflowBuilderApprovalState(null, []), {
  schemaVersion: "sonik.agent_ui.approval_state.v1",
  phase: "idle",
  activeArtifactId: null,
  canRequestApproval: false,
  canApproveAndRun: false,
  disabledReasons: ["workflow_run_not_started"],
  commandPreview: null,
});

const unsignedBuilderApproval = createWorkflowBuilderApprovalState(previewReadyRun, []);
assert.equal(unsignedBuilderApproval.canRequestApproval, true, "a controller preview should be readable through the existing approval-state API");
assert.equal(unsignedBuilderApproval.canApproveAndRun, false, "preview readiness alone must never manufacture host approval");
assert.deepEqual(unsignedBuilderApproval.disabledReasons, ["trusted_host_approval_required"]);
assert.deepEqual(unsignedBuilderApproval.commandPreview, {
  commandId: "amplify.campaign.create",
  stableInputHash: "campaign-hash",
  effect: "write",
  approvalRequired: true,
}, "unsupported external effects normalize to the existing approval API's write effect");

const signedBuilderApproval = createWorkflowBuilderApprovalState(previewReadyRun, ["amplify.campaign.create"]);
assert.equal(signedBuilderApproval.canApproveAndRun, true, "the signed host's exact approved command id unlocks the host approval action");
assert.deepEqual(signedBuilderApproval.disabledReasons, []);
assert.equal(
  createWorkflowBuilderApprovalState(previewReadyRun, ["booking.create.booking"]).canApproveAndRun,
  false,
  "a signed grant for another command must fail closed",
);

const approvedRun = {
  ...previewReadyRun,
  phase: "approved",
  approvalState: {
    status: "approved",
    hostSigned: true,
    approvedCommandIds: ["amplify.campaign.create"],
    approvedInputHashes: { "amplify.campaign.create": "campaign-hash" },
  },
};
assert.deepEqual(
  createWorkflowBuilderApprovalState(approvedRun, ["amplify.campaign.create"]).disabledReasons,
  [],
  "an approved run remains readable only when both current signed context and run approval cover the command",
);
assert.deepEqual(
  createWorkflowBuilderApprovalState({ ...approvedRun, approvalState: { ...approvedRun.approvalState, approvedCommandIds: [] } }, ["amplify.campaign.create"]).disabledReasons,
  ["run_approval_does_not_cover_command"],
  "a hostSigned boolean without command coverage is not sufficient",
);

const actionStateInput = (overrides = {}) => ({
  action: "approve",
  busy: false,
  hasRun: true,
  hasPreviewNode: true,
  hasCommitNode: true,
  phase: "preview_ready",
  approvalStatus: "none",
  signedHostGrantCoversCommit: true,
  runApprovalCoversCommit: false,
  ...overrides,
});
assert.equal(resolveWorkflowRunActionDisabledState(actionStateInput()), null, "a ready, signed approval action is enabled");
assert.deepEqual(resolveWorkflowRunActionDisabledState(actionStateInput({ action: "preview", busy: true })), {
  code: "workflow_action_busy",
  message: "Wait for the current workflow action to finish.",
});
assert.deepEqual(resolveWorkflowRunBusyDisabledState(true), {
  code: "workflow_action_busy",
  message: "Wait for the current workflow action to finish.",
});
assert.equal(resolveWorkflowRunBusyDisabledState(false), null);
assert.equal(resolveWorkflowRunActionDisabledState(actionStateInput({ action: "preview" })), null);
assert.equal(resolveWorkflowRunActionDisabledState(actionStateInput({ action: "commit", approvalStatus: "approved", runApprovalCoversCommit: true })), null);
for (const [overrides, code] of [
  [{ hasRun: false }, "workflow_run_not_started"],
  [{ action: "preview", hasPreviewNode: false }, "workflow_preview_node_missing"],
  [{ hasCommitNode: false }, "workflow_commit_node_missing"],
  [{ signedHostGrantCoversCommit: false }, "trusted_host_approval_required"],
  [{ approvalStatus: "approved" }, "workflow_run_already_approved"],
  [{ phase: "intake" }, "workflow_preview_not_ready"],
  [{ action: "commit", phase: "committed", approvalStatus: "approved", runApprovalCoversCommit: true }, "workflow_run_committed"],
  [{ action: "commit" }, "run_approval_required"],
  [{ action: "commit", approvalStatus: "approved" }, "run_approval_does_not_cover_command"],
]) {
  const disabled = resolveWorkflowRunActionDisabledState(actionStateInput(overrides));
  assert.equal(disabled?.code, code, `${code} is a typed workflow action disabled reason`);
  assert.ok(disabled?.message && !disabled.message.includes("_"), `${code} has visible human-readable copy`);
}

const otherRun = { ...previewReadyRun, runId: "run_other", workflowId: "other.workflow" };
let activeSelection = selectActiveWorkflowRun(null, previewReadyRun.workflowId, previewReadyRun);
activeSelection = selectActiveWorkflowRun(activeSelection, otherRun.workflowId, otherRun);
assert.equal(activeSelection?.run.runId, "run_other", "the most recently interacted run panel must own the shared approval projection");
activeSelection = selectActiveWorkflowRun(activeSelection, previewReadyRun.workflowId, null);
assert.equal(activeSelection?.run.runId, "run_other", "resetting an inactive panel must not clear the active run");
activeSelection = selectActiveWorkflowRun(activeSelection, otherRun.workflowId, null);
assert.equal(activeSelection, null, "resetting the active panel must clear the shared approval projection");

// -- +page.svelte: workflow-builder mode wiring ------------------------------

const pageSource = await readFile("apps/standalone-sveltekit/src/routes/+page.svelte", "utf8");

assert.equal(
  pageSource.includes('import WorkflowBuilderRoot, { type WorkflowBuilderController } from "$lib/components/workflow-builder/WorkflowBuilderRoot.svelte"'),
  true,
  "app shell should import the workflow-builder root component",
);
assert.equal(
  pageSource.includes('let workspaceMode = $state<"workspace" | "workflow-builder" | "channels">("workspace")'),
  true,
  "app shell should preserve workflow builder as a local mode alongside the default and channels workspaces",
);
assert.equal(
  pageSource.includes('{#if workspaceMode === "workflow-builder"}'),
  true,
  "app shell should conditionally mount the workflow builder instead of the chat workspace",
);
assert.equal(
  pageSource.includes("signedHostApprovedCommandIds={getSignedWorkspaceApprovedCommandIds()}") && pageSource.includes("{workspaceFetch}"),
  true,
  "app shell should mount WorkflowBuilderRoot, capture its controller, and pass an onExit that returns to chat (the builder toolbar toggle unmounts in builder mode)",
);
assert.equal(
  pageSource.includes("getBuilderState: () => builderController?.snapshot() ?? null"),
  true,
  "__sonikAgentUI page control must expose the workflow-builder snapshot for agent/Playwright readability",
);
assert.equal(
  pageSource.includes('workspaceMode = workspaceMode === "workspace" ? "workflow-builder" : "workspace"'),
  true,
  "app shell should expose a human toggle button between chat workspace and workflow builder",
);
assert.equal(
  pageSource.includes("setWorkspaceMode:"),
  true,
  "__sonikAgentUI actions must expose a semantic setWorkspaceMode action for agent-driven mode switching",
);
assert.equal(
  pageSource.includes("saveAgentDefinitionDraft:"),
  true,
  "__sonikAgentUI actions must expose a semantic saveAgentDefinitionDraft action",
);
assert.equal(
  pageSource.includes('"The workflow builder is not mounted."'),
  true,
  "saveAgentDefinitionDraft must fail closed with a clear reason when the builder controller is not mounted",
);

// -- WorkflowBuilderRoot.svelte: save discipline + controller shape ---------

const builderRootSource = await readFile(
  "apps/standalone-sveltekit/src/lib/components/workflow-builder/WorkflowBuilderRoot.svelte",
  "utf8",
);
const workflowRunPanelSource = await readFile(
  "apps/standalone-sveltekit/src/lib/components/workflow-builder/WorkflowRunPanel.svelte",
  "utf8",
);
assert.match(workflowRunPanelSource, /resolveWorkflowRunActionDisabledState/, "run controls derive disabled state from the typed helper");
assert.match(workflowRunPanelSource, /data-disabled-reason=\{previewDisabledState\?\.code\}/);
assert.match(workflowRunPanelSource, /data-disabled-reason=\{approveDisabledState\?\.code\}/);
assert.match(workflowRunPanelSource, /data-disabled-reason=\{commitDisabledState\?\.code\}/);
assert.equal((workflowRunPanelSource.match(/data-disabled-reason=\{busyDisabledState\?\.code\}/g) ?? []).length, 2, "Run and Reset expose the shared typed busy reason");
assert.equal((workflowRunPanelSource.match(/aria-describedby=\{busyDisabledState \? `\$\{disabledReasonIdBase\}-busy-disabled` : undefined\}/g) ?? []).length, 2, "Run and Reset describe the shared visible busy copy");
assert.match(workflowRunPanelSource, /data-workflow-run-disabled-reason=\{runId \? "reset" : "run"\}[\s\S]*\{busyDisabledState\.message\}/, "Run and Reset expose the typed busy state as visible human copy");
assert.match(workflowRunPanelSource, /aria-describedby=\{previewDisabledState[\s\S]*aria-describedby=\{approveDisabledState[\s\S]*aria-describedby=\{commitDisabledState/);
assert.match(workflowRunPanelSource, /data-workflow-run-disabled-reason="preview"[\s\S]*data-workflow-run-disabled-reason="approve"[\s\S]*data-workflow-run-disabled-reason="commit"/, "each disabled control owns visible described-by copy");
assert.equal(
  builderRootSource.includes("snapshot(): WorkflowBuilderSnapshot;"),
  true,
  "the builder controller contract must expose a snapshot() the page-control seam can read",
);
assert.equal(
  builderRootSource.includes('const validation = validateAgentDefinition($state.snapshot(definition));'),
  true,
  "D016 emit discipline: saveDraft must re-validate the working definition through the schema, never trust it directly",
);
assert.equal(
  builderRootSource.includes('body: JSON.stringify({ action: "save_draft", definition: validation.definition })'),
  true,
  "saveDraft must POST the schema-validated definition, not the raw working object",
);
assert.equal(
  builderRootSource.includes('method: "POST"'),
  true,
  "saveDraft must call the agent-definitions API with POST",
);
assert.equal(
  builderRootSource.includes('workspaceFetch("/api/agent-definitions"'),
  true,
  "saveDraft must call the Phase 4 agent-definitions endpoint",
);
const saveDraftSource = builderRootSource.match(/async function saveDraft\(\)[\s\S]*?\n  }/)?.[0] ?? "";
assert.match(saveDraftSource, /if \(!workspaceContextReady\)/,
  "saveDraft must fail closed before creating a contextless cloud request");
assert.ok(
  saveDraftSource.indexOf("if (!workspaceContextReady)") < saveDraftSource.indexOf('workspaceFetch("/api/agent-definitions"'),
  "the signed workspace-context guard must run before the draft request",
);
assert.equal(
  builderRootSource.includes("draftAgentId={agentId}"),
  true,
  "the preview tab must pass the current working agentId into Debug & Preview",
);
assert.equal(
  builderRootSource.includes("onWorkflowDrafted") && builderRootSource.includes("setTab(\"canvas\")"),
  true,
  "Debug & Preview drafts must load onto the canvas (describe -> draft -> canvas)",
);
assert.equal(
  builderRootSource.includes("workflow={draftWorkflow}") && builderRootSource.includes("onRunStateChange={handleRunStateChange}"),
  true,
  "the user's own draft workflow must be runnable, not only the shipped fixtures",
);

// -- AgentConfigPanel.svelte: reflects grants, never issues them ------------

const configPanelSource = await readFile(
  "apps/standalone-sveltekit/src/lib/components/workflow-builder/AgentConfigPanel.svelte",
  "utf8",
);
assert.equal(
  configPanelSource.includes('import { groupCapabilitiesByFamily, effectiveFamilyMode, type KnowledgeRef } from "./builder-model"'),
  true,
  "config panel should source tool-scoping data from the registry-derived builder-model helpers",
);
assert.equal(
  configPanelSource.includes("effectiveFamilyMode(definition, family.familyId)"),
  true,
  "config panel should read effective grants through the read-only projection, not compute its own",
);
assert.equal(configPanelSource.includes("fetch("), false, "AgentConfigPanel must never call the network directly -- the parent owns save/publish");
assert.equal(
  configPanelSource.includes("executeHostCatalogCommand") || configPanelSource.includes("createCommandCatalogTools"),
  false,
  "AgentConfigPanel must never call capability-granting execution seams directly (Onyx drill-down: reflect, never grant)",
);
assert.equal(
  configPanelSource.includes("definition = { ...definition, toolPolicy: { ...definition.toolPolicy, [familyId]: mode } }"),
  true,
  "tool-scoping edits should patch toolPolicy on the bindable definition for the parent to validate/save",
);
assert.equal(
  configPanelSource.includes('import { formatModelContextWindow } from "./builder-model"')
    && configPanelSource.includes("modelDisabledReason"),
  true,
  "config panel's model picker must source authoritative disabled reasons and shared context-window formatting",
);
assert.equal(
  configPanelSource.includes("modelOptions?: AgentModelOption[]"),
  true,
  "config panel must accept the live model catalog as a prop rather than hardcoding the static list",
);
assert.equal(
  configPanelSource.includes("Search models"),
  true,
  "the model picker must be searchable (Dify-bar UX), not a plain static select",
);
assert.equal(
  configPanelSource.includes("modelDisabledReason(isModelIncompatible(definition, option), option"),
  true,
  "each rendered model option must be checked against the current definition's tool grants for incompatible flagging",
);

// -- WorkflowBuilderRoot.svelte: owns the model-catalog fetch (D016-adjacent
// separation -- AgentConfigPanel above asserts it never calls fetch itself) --

assert.equal(
  builderRootSource.includes('workspaceFetch("/api/agent-models")'),
  true,
  "WorkflowBuilderRoot must fetch the live model catalog itself since AgentConfigPanel is not allowed to call the network",
);
assert.equal(
  builderRootSource.includes("modelOptions={modelOptions}") || builderRootSource.includes("{modelOptions}"),
  true,
  "WorkflowBuilderRoot must pass the fetched model catalog down into AgentConfigPanel",
);
const refreshAgentModelCatalogSource = pageSource.match(/async function refreshAgentModelCatalog\(\)[\s\S]*?\n  }/)?.[0] ?? "";
assert.match(refreshAgentModelCatalogSource, /workspaceFetch\("\/api\/agent-models"\)/,
  "the page model catalog must use the authority-waiting and one-replay workspace fetch path");
assert.doesNotMatch(refreshAgentModelCatalogSource, /(?<!workspace)fetch\("\/api\/agent-models"\)/,
  "the page model catalog must not bypass host-authority recovery with raw fetch");

// -- DebugPreviewPane.svelte: sends draftAgentId ----------------------------

const debugPreviewSource = await readFile(
  "apps/standalone-sveltekit/src/lib/components/workflow-builder/DebugPreviewPane.svelte",
  "utf8",
);
assert.equal(
  debugPreviewSource.includes('return { body: { ...body, id, trigger, messageId, messages, draftAgentId } };'),
  true,
  "Debug & Preview must send draftAgentId in every generate request body so the server resolves the current DRAFT, not the published definition",
);
assert.equal(
  debugPreviewSource.includes('api: "/api/generate"'),
  true,
  "Debug & Preview must run through the real generate route so preview behavior matches production",
);

// -- WorkflowCanvas.svelte: locked/draft discipline + live-type surfacing ---

const canvasSource = await readFile(
  "apps/standalone-sveltekit/src/lib/components/workflow-builder/WorkflowCanvas.svelte",
  "utf8",
);
assert.equal(canvasSource.includes('const locked = $derived(lockState === "locked")'), true, "canvas must derive a locked flag instead of duplicating the check ad hoc");
assert.equal(
  canvasSource.includes("{#if !LIVE_CONTROLLER_NODE_TYPES.has(node.type)}"),
  true,
  "canvas must surface controller-unsupported node types to the builder before they ever reach the controller",
);
assert.equal(canvasSource.includes("function addNode(): void {\n    if (locked) return;"), true, "locked (published/example) workflows must reject node mutation");
assert.equal(canvasSource.includes("function removeEdge(edgeId: string): void {\n    if (locked) return;"), true, "locked workflows must reject edge mutation");
assert.match(canvasSource, /function redo\(\): void/);
assert.match(canvasSource, /data-workflow-port="input"/);
assert.match(canvasSource, /data-workflow-port="output"/);
assert.match(canvasSource, /function openInspector\(nodeId: string\): void/);
assert.match(canvasSource, /Workflow is valid\.|Workflow is invalid:/, "canvas mutations announce validation recovery");
assert.match(builderRootSource, /beforeunload/);
assert.match(builderRootSource, /hasUnsavedWorkflowChanges/);
assert.match(builderRootSource, /data-builder-action="publish"/);
assert.match(builderRootSource, /focusBuilderAction/);

// -- agent-definitions API: save_draft zod-validates, publish delegates ----

const agentDefinitionsRouteSource = await readFile(
  "apps/standalone-sveltekit/src/routes/api/agent-definitions/+server.ts",
  "utf8",
);
assert.equal(
  agentDefinitionsRouteSource.includes("agentDefinitionSchema.safeParse((body as Record<string, unknown>).definition)"),
  true,
  "save_draft must zod-validate the incoming definition before it ever reaches the store (D016 emit discipline)",
);
assert.equal(
  agentDefinitionsRouteSource.includes('{ ok: false, error: "invalid_agent_definition", issues: parsed.error.issues }'),
  true,
  "save_draft must return structured validation issues instead of a bare failure",
);
assert.equal(
  agentDefinitionsRouteSource.includes("agentDefinitionStore.saveDraft(authority, parsed.data)"),
  true,
  "save_draft must pass only the zod-parsed data into the store, never the raw request body",
);
assert.equal(
  agentDefinitionsRouteSource.includes("agentDefinitionStore.publish(authority, {"),
  true,
  "publish action must delegate to the store's publish (immutable packageVersionId, D002) -- no inline envelope construction in the route",
);
assert.equal(
  agentDefinitionsRouteSource.includes('return Response.json({ ok: false, error: "unknown_action" }, { status: 400 })'),
  true,
  "the route must fail closed on an unrecognized action instead of defaulting to a write",
);

console.log(JSON.stringify({ ok: true, checked: "workflow-builder-mode" }));

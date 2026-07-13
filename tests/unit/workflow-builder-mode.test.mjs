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

// -- +page.svelte: workflow-builder mode wiring ------------------------------

const pageSource = await readFile("apps/standalone-sveltekit/src/routes/+page.svelte", "utf8");

assert.equal(
  pageSource.includes('import WorkflowBuilderRoot, { type WorkflowBuilderController } from "$lib/components/workflow-builder/WorkflowBuilderRoot.svelte"'),
  true,
  "app shell should import the workflow-builder root component",
);
assert.equal(
  pageSource.includes('let workspaceMode = $state<"workspace" | "workflow-builder">("workspace")'),
  true,
  "app shell should track the third workspace mode alongside the default chat workspace",
);
assert.equal(
  pageSource.includes('{#if workspaceMode === "workflow-builder"}'),
  true,
  "app shell should conditionally mount the workflow builder instead of the chat workspace",
);
assert.equal(
  pageSource.includes('<WorkflowBuilderRoot onController={(controller) => { builderController = controller; }} />'),
  true,
  "app shell should mount WorkflowBuilderRoot and capture its controller",
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
  builderRootSource.includes('fetch("/api/agent-definitions"'),
  true,
  "saveDraft must call the Phase 4 agent-definitions endpoint",
);
assert.equal(
  builderRootSource.includes("<DebugPreviewPane draftAgentId={agentId} />"),
  true,
  "the preview tab must pass the current working agentId into Debug & Preview",
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
  agentDefinitionsRouteSource.includes("agentDefinitionStore.saveDraft(parsed.data)"),
  true,
  "save_draft must pass only the zod-parsed data into the store, never the raw request body",
);
assert.equal(
  agentDefinitionsRouteSource.includes("agentDefinitionStore.publish({"),
  true,
  "publish action must delegate to the store's publish (immutable packageVersionId, D002) -- no inline envelope construction in the route",
);
assert.equal(
  agentDefinitionsRouteSource.includes('return Response.json({ ok: false, error: "unknown_action" }, { status: 400 })'),
  true,
  "the route must fail closed on an unrecognized action instead of defaulting to a write",
);

console.log(JSON.stringify({ ok: true, checked: "workflow-builder-mode" }));

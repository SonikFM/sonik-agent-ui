import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createEmptyWorkflowDefinition } from "../../apps/standalone-sveltekit/src/lib/components/workflow-builder/builder-model.ts";
import {
  COLLAPSED_MODEL_ROW_LIMIT,
  createOrganizerPatchRequest,
  filterCatalogModels,
  modelCapabilityBadges,
  modelDisabledReason,
  workflowHistoryItemKey,
} from "../../apps/standalone-sveltekit/src/lib/components/workflow-builder/organizer-model.ts";

const workflow = createEmptyWorkflowDefinition("organizer.test");
const parameters = [
  { path: "nodes.identity.config.title", kind: "safe_patch", label: "Title", type: "text", value: "Original" },
  { path: "parameters.intake.capacity", kind: "parameter_edit", label: "Capacity", type: "number", value: 10 },
  { path: "nodes.graph.topology", kind: "safe_patch", label: "Graph", type: "text", value: "hidden" },
];
const request = createOrganizerPatchRequest(
  workflow,
  7,
  parameters,
  ["nodes.identity.config.title", "parameters.intake.capacity", "nodes.graph.topology"],
  { "nodes.identity.config.title": "Updated", "parameters.intake.capacity": 20, "nodes.graph.topology": "rewrite", undeclared: "drop" },
);
assert.deepEqual(request, {
  action: "organizer_patch",
  workflowId: "organizer.test",
  patch: {
    expectedDraftRevision: 7,
    edits: [
      { kind: "safe_patch", path: "nodes.identity.config.title", value: "Updated" },
      { kind: "parameter_edit", path: "parameters.intake.capacity", value: 20 },
    ],
  },
}, "P2 emits only declared, allowlisted patches and carries the expected revision");
assert.deepEqual(
  createOrganizerPatchRequest(workflow, 7, parameters, ["parameters.intake.capacity"], { "parameters.intake.capacity": Number.NaN }).patch.edits,
  [],
  "invalid numeric input never crosses the organizer callback boundary",
);

assert.equal(COLLAPSED_MODEL_ROW_LIMIT, 10, "the collapsed catalog viewport is exactly ten fixed-height rows");
const largeCatalog = Array.from({ length: 31 }, (_, index) => ({ id: `provider/model-${index}`, label: `Model ${index}`, provider: "Provider" }));
assert.deepEqual(filterCatalogModels(largeCatalog, "model 30").map((model) => model.id), ["provider/model-30"], "search covers models beyond the ten-row viewport");
assert.deepEqual(
  modelCapabilityBadges({
    id: "provider/model",
    label: "Model",
    provider: "Provider",
    supportsTools: true,
    supportsImages: true,
    supportsReasoning: true,
    supportsVideo: true,
    task: "Chat",
    inputModalities: ["text", "image"],
    outputModalities: ["video"],
  }),
  ["Tools", "Image", "Reasoning", "Video", "Chat", "Text"],
  "catalog metadata normalizes capability, task, and modality badges without duplicates",
);
assert.match(modelDisabledReason(true, { id: "no-tools", label: "No tools", provider: "Test", supportsTools: false }), /does not support tool use/);
assert.equal(modelDisabledReason(false, { id: "tools", label: "Tools", provider: "Test", supportsTools: true }), null);
assert.equal(modelDisabledReason(false, { id: "disabled", label: "Disabled", provider: "Test", disabledReason: "Provider outage" }), "Provider outage");
assert.notEqual(workflowHistoryItemKey("run-a", "shared"), workflowHistoryItemKey("run-b", "shared"), "history keys retain workflow run identity");
assert.notEqual(workflowHistoryItemKey("a:b", "c"), workflowHistoryItemKey("a", "b:c"), "history keys cannot collide through ambiguous concatenation");

const componentRoot = new URL("../../apps/standalone-sveltekit/src/lib/components/workflow-builder/", import.meta.url);
const [configSource, organizerSource, historySource, rootSource, guideSource] = await Promise.all([
  readFile(new URL("AgentConfigPanel.svelte", componentRoot), "utf8"),
  readFile(new URL("OrganizerPanel.svelte", componentRoot), "utf8"),
  readFile(new URL("RunHistoryPanel.svelte", componentRoot), "utf8"),
  readFile(new URL("WorkflowBuilderRoot.svelte", componentRoot), "utf8"),
  readFile(new URL("../../../../../../docs/guides/workflow-builder-user-guide.md", componentRoot), "utf8"),
]);

assert.match(configSource, /role="listbox"/);
assert.match(configSource, /role="option"/);
assert.match(configSource, /aria-live="polite"/);
assert.match(configSource, /ArrowDown/);
for (const key of ["ArrowDown", "ArrowUp", "Home", "End"]) assert.match(configSource, new RegExp(key));
assert.match(configSource, /Selected model:/, "screen readers receive selection changes");
assert.match(configSource, /disabled=\{mode !== "off"/, "non-callable families cannot be saved runnable");
assert.match(configSource, /Readiness unavailable\. Ask and Allow stay disabled\./, "missing authority explicitly fails closed");
assert.match(configSource, /rows\.some\(\(readiness\) => !readiness\)/, "a missing capability row cannot enable a family");
assert.match(configSource, /effectiveFamilyMode\(definition, familyId\) === "off" \? policyChangeReadinessById : readinessById/, "leaving Off requires separate policy-neutral server proof");
assert.match(configSource, /max-h-\[50rem\]/, "ten h-20 rows define the collapsed scrolling viewport");
assert.match(configSource, /h-20 shrink-0/, "catalog rows have a fixed height so the viewport cap is deterministic");
assert.match(organizerSource, /createOrganizerPatchRequest\(workflow, revision/);
assert.doesNotMatch(organizerSource, /nodes|edges|topology/i, "the organizer surface exposes no graph or topology editor");
for (const action of ["configure", "test", "publish", "approve", "receipt"]) {
  assert.match(organizerSource, new RegExp(action, "i"), `organizer supports ${action} through an injected callback`);
}
for (const surface of ["Identity", "Instructions", "Knowledge", "Curated capabilities", "Pending approval", "Recent run", "Receipts"]) {
  assert.match(organizerSource, new RegExp(surface), `organizer exposes ${surface}`);
}
for (const field of ["history.query", "events", "approvals", "artifacts", "receipts"]) {
  assert.match(historySource, new RegExp(field), `operator history renders typed ${field}`);
}
assert.match(historySource, /workflowHistoryItemKey\(approval\.workflowRunId, approval\.approvalId\)/, "approval rows use collision-safe causal identity");
assert.match(historySource, /workflowHistoryItemKey\(receipt\.workflowRunId, receipt\.receiptId\)/, "receipt rows use collision-safe causal identity");
assert.match(historySource, /receipt\.semanticStatus/, "receipt rows render the server projection field");
assert.match(rootSource, /<OrganizerPanel/, "the root mounts the graph-free P2 organizer audience");
assert.match(rootSource, /<RunHistoryPanel/, "the root mounts redacted operator history without merging stores");
assert.match(rootSource, /workflowDefinitions\(request as unknown as Record<string, unknown>\)/, "organizer_patch crosses the root boundary unchanged");
assert.match(rootSource, /workspaceFetch\(`\/api\/workflow-history\?\$\{query\}`\)/, "history uses the shared workspace fetch with active correlation filters");

for (const obsolete of [
  /Workflow drafts are in-memory/i,
  /No Publish control/i,
  /Capability truth is a future contract/i,
]) assert.doesNotMatch(guideSource, obsolete, `guide rejects obsolete claim ${obsolete}`);
for (const current of [
  /Save draft.*workflow draft/is,
  /saved workflows.*reload/is,
  /expected revision/i,
  /immutable published version/i,
  /dependency pins/i,
  /readiness unavailable.*default deny/is,
]) assert.match(guideSource, current, `guide documents shipped contract ${current}`);

console.log("organizer component unit and accessibility checks passed");

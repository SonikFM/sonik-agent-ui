import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createEmptyAgentDefinition, createEmptyWorkflowDefinition } from "../../apps/standalone-sveltekit/src/lib/components/workflow-builder/builder-model.ts";
import {
  COLLAPSED_MODEL_ROW_LIMIT,
  createOrganizerPatchRequest,
  modelCapabilityBadges,
  modelDisabledReason,
} from "../../apps/standalone-sveltekit/src/lib/components/workflow-builder/organizer-model.ts";

const workflow = createEmptyWorkflowDefinition("organizer.test");
const parameters = [
  { path: "title", kind: "set_title", label: "Title", type: "text", value: "Original" },
  { path: "capacity", kind: "set_parameter", label: "Capacity", type: "number", value: 10 },
  { path: "internal.graph", kind: "set_topology", label: "Graph", type: "text", value: "hidden" },
];
const request = createOrganizerPatchRequest(
  workflow,
  7,
  parameters,
  ["title", "capacity"],
  { title: "Updated", capacity: 20, "internal.graph": "rewrite", undeclared: "drop" },
);
assert.deepEqual(request, {
  action: "organizer_patch",
  workflowId: "organizer.test",
  patch: {
    expectedDraftRevision: 7,
    edits: [
      { kind: "set_title", path: "title", value: "Updated" },
      { kind: "set_parameter", path: "capacity", value: 20 },
    ],
  },
}, "P2 emits only declared, allowlisted patches and carries the expected revision");
assert.deepEqual(
  createOrganizerPatchRequest(workflow, 7, parameters, ["capacity"], { capacity: Number.NaN }).patch.edits,
  [],
  "invalid numeric input never crosses the organizer callback boundary",
);

assert.equal(COLLAPSED_MODEL_ROW_LIMIT, 10, "the collapsed catalog viewport is exactly ten fixed-height rows");
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
const toolAgent = { ...createEmptyAgentDefinition("agent_tools"), toolPolicy: { "booking.create": "ask" } };
assert.match(modelDisabledReason(toolAgent, { id: "no-tools", label: "No tools", provider: "Test", supportsTools: false }), /does not support tool use/);
assert.equal(modelDisabledReason(toolAgent, { id: "tools", label: "Tools", provider: "Test", supportsTools: true }), null);
assert.equal(modelDisabledReason(toolAgent, { id: "disabled", label: "Disabled", provider: "Test", disabledReason: "Provider outage" }), "Provider outage");

const componentRoot = new URL("../../apps/standalone-sveltekit/src/lib/components/workflow-builder/", import.meta.url);
const [configSource, organizerSource, historySource] = await Promise.all([
  readFile(new URL("AgentConfigPanel.svelte", componentRoot), "utf8"),
  readFile(new URL("OrganizerPanel.svelte", componentRoot), "utf8"),
  readFile(new URL("RunHistoryPanel.svelte", componentRoot), "utf8"),
]);

assert.match(configSource, /role="listbox"/);
assert.match(configSource, /role="option"/);
assert.match(configSource, /aria-live="polite"/);
assert.match(configSource, /ArrowDown/);
assert.match(configSource, /max-h-\[50rem\]/, "ten h-20 rows define the collapsed scrolling viewport");
assert.match(configSource, /h-20 shrink-0/, "catalog rows have a fixed height so the viewport cap is deterministic");
assert.match(organizerSource, /createOrganizerPatchRequest\(workflow, revision/);
assert.doesNotMatch(organizerSource, /nodes|edges|topology/i, "the organizer surface exposes no graph or topology editor");
for (const action of ["configure", "test", "publish", "approve", "receipt"]) {
  assert.match(organizerSource, new RegExp(action, "i"), `organizer supports ${action} through an injected callback`);
}
for (const field of ["correlationId", "events", "approvals", "artifacts", "receipts"]) {
  assert.match(historySource, new RegExp(field), `operator history renders typed ${field}`);
}

console.log("organizer component unit and accessibility checks passed");

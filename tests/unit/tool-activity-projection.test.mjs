import assert from "node:assert/strict";
import {
  normalizeToolName,
  resolveToolActivity,
  TOOL_ACTIVITY_REGISTRY,
} from "../../packages/chat-surface/src/tool-activity.ts";

const leakedRawToolNames = [
  "searchSkillCatalog",
  "learnSkill",
  "searchCommandCatalog",
  "learnCommand",
  "executeCommand",
  "commitCommand",
  "previewActiveIntakeCommand",
  "commitActiveIntakeCommand",
  "createBookingIntakeArtifact",
];

for (const toolName of leakedRawToolNames) {
  assert.ok(TOOL_ACTIVITY_REGISTRY[toolName], `${toolName} must have a friendly descriptor`);
  for (const state of ["input-streaming", "output-available", "output-error"]) {
    const activity = resolveToolActivity(toolName, state);
    assert.notEqual(activity.label, toolName, `${toolName} ${state} should not render raw tool name`);
    assert.equal(activity.technicalLabel, toolName, `${toolName} should keep raw id for debug/audit title`);
    assert.ok(activity.label.length > 0);
  }
}

assert.equal(normalizeToolName("tool-learnSkill"), "learnSkill");
assert.equal(normalizeToolName("executeCommand"), "executeCommand");

{
  const activity = resolveToolActivity("unregisteredInternalThing", "input-streaming");
  assert.equal(activity.label, "Working");
  assert.equal(activity.phase, "unknown");
  assert.equal(activity.technicalLabel, "unregisteredInternalThing");
}

{
  const activity = resolveToolActivity("unregisteredInternalThing", "output-available");
  assert.equal(activity.label, "Finished step");
}

{
  const activity = resolveToolActivity("unregisteredInternalThing", "output-error");
  assert.equal(activity.label, "Step failed");
}

{
  const activity = resolveToolActivity("tool-listAvailableTools", "input-streaming", {
    listAvailableTools: { pending: "Reading tool manifest", done: "Read tool manifest" },
  });
  assert.equal(activity.label, "Reading tool manifest");
  assert.equal(activity.technicalLabel, "listAvailableTools");
}


const toolCallBlockSource = await import("node:fs/promises")
  .then((fs) => fs.readFile(new URL("../../packages/chat-surface/src/components/ToolCallBlock.svelte", import.meta.url), "utf8"));
assert.match(toolCallBlockSource, /resolveToolActivity\(tool\.toolName, tool\.state, labels\)/);
assert.doesNotMatch(toolCallBlockSource, /title=\{.*technicalLabel/);
assert.doesNotMatch(toolCallBlockSource, /title=\{title\}/);
assert.match(toolCallBlockSource, /<details/);
assert.match(toolCallBlockSource, /Technical tool receipt/);
assert.match(toolCallBlockSource, />Receipt<\/span>/);
assert.doesNotMatch(toolCallBlockSource, /return\s+tool\.toolName/);
assert.doesNotMatch(toolCallBlockSource, /\?\?\s*tool\.toolName/);

const appPageSource = await import("node:fs/promises")
  .then((fs) => fs.readFile(new URL("../../apps/standalone-sveltekit/src/routes/+page.svelte", import.meta.url), "utf8"));
assert.match(appPageSource, /resolveToolActivity\(latestTool\.type, latestTool\.state\)/);
assert.doesNotMatch(appPageSource, /label:\s*["']Calling tool["']/);
assert.doesNotMatch(appPageSource, /function\s+formatToolActivityDetail/);

assert.doesNotMatch(appPageSource, /const\s+TOOL_LABELS/);
assert.doesNotMatch(appPageSource, /toolLabels=\{TOOL_LABELS\}/);
assert.doesNotMatch(appPageSource, /reason:\s*activity\.label/);

console.log("tool-activity-projection tests passed");

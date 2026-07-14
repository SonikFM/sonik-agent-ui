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
  "previewBookingReservationCommand",
  "commitActiveIntakeCommand",
  "commitBookingReservationCommand",
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

// Slice C (R2): while a turn is still streaming, an error state renders as a
// neutral retry -- not the tool's scary error label -- and keeps the pulsing
// (isLoading) presentation instead of the error one.
{
  const streaming = resolveToolActivity("createJsonArtifact", "output-error", {}, { isTurnStreaming: true });
  assert.notEqual(streaming.label, "Canvas creation failed");
  assert.match(streaming.label, /retrying/i);
  assert.equal(streaming.isError, false);
  assert.equal(streaming.isLoading, true);
}

// Once the turn ends without recovery, the same error state promotes to the
// tool's real failure label.
{
  const terminal = resolveToolActivity("createJsonArtifact", "output-error", {}, { isTurnStreaming: false });
  assert.equal(terminal.label, "Canvas creation failed");
  assert.equal(terminal.isError, true);
}

// A later successful call for the same tool marks the earlier error as
// recovered, even after the turn has ended -- still neutral, not a failure.
{
  const recovered = resolveToolActivity("createJsonArtifact", "output-error", {}, { isTurnStreaming: false, recovered: true });
  assert.match(recovered.label, /retrying/i);
  assert.equal(recovered.isError, false);
}

// output-denied follows the same recoverable-during-stream policy as output-error.
{
  const denied = resolveToolActivity("createJsonArtifact", "output-denied", {}, { isTurnStreaming: true });
  assert.equal(denied.isError, false);
  assert.match(denied.label, /retrying/i);
}

const toolCallBlockSource = await import("node:fs/promises")
  .then((fs) => fs.readFile(new URL("../../packages/chat-surface/src/components/ToolCallBlock.svelte", import.meta.url), "utf8"));
assert.match(toolCallBlockSource, /resolveToolActivity\(tool\.toolName, tool\.state, labels, \{ isTurnStreaming, recovered: tool\.recovered \}\)/);
assert.doesNotMatch(toolCallBlockSource, /title=\{.*technicalLabel/);
assert.doesNotMatch(toolCallBlockSource, /title=\{title\}/);
assert.match(toolCallBlockSource, /<details/);
assert.match(toolCallBlockSource, /Technical tool receipt/);
assert.match(toolCallBlockSource, />Receipt<\/span>/);
assert.match(toolCallBlockSource, /Retry the document request\./, "sanitized terminal document errors retain an actionable recovery hint");
assert.doesNotMatch(toolCallBlockSource, /return\s+tool\.toolName/);
assert.doesNotMatch(toolCallBlockSource, /\?\?\s*tool\.toolName/);

const appPageSource = await import("node:fs/promises")
  .then((fs) => fs.readFile(new URL("../../apps/standalone-sveltekit/src/routes/+page.svelte", import.meta.url), "utf8"));
assert.match(appPageSource, /resolveToolActivity\(latestTool\.type, latestTool\.state, \{\}, \{ isTurnStreaming: true \}\)/);
assert.doesNotMatch(appPageSource, /label:\s*["']Calling tool["']/);
assert.doesNotMatch(appPageSource, /function\s+formatToolActivityDetail/);

assert.doesNotMatch(appPageSource, /const\s+TOOL_LABELS/);
assert.doesNotMatch(appPageSource, /toolLabels=\{TOOL_LABELS\}/);
assert.doesNotMatch(appPageSource, /reason:\s*activity\.label/);

// Slice C telemetry join: a tool failure is reported as recovered or terminal,
// never as an immediate "output_error" the moment it arrives mid-stream.
assert.match(appPageSource, /event: recovered \? "tool\.failure\.recovered" : "tool\.failure\.terminal"/);
assert.doesNotMatch(appPageSource, /event:\s*["']chat\.tool\.output_error["']/);

console.log("tool-activity-projection tests passed");

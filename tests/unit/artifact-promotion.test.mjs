import assert from "node:assert/strict";
import { createJsonRenderArtifact } from "../../packages/artifact-model/dist/index.js";
import { decideArtifactPromotion } from "../../apps/standalone-sveltekit/src/lib/artifacts/artifact-promotion.ts";
import { promoteJsonRenderArtifact } from "../../apps/standalone-sveltekit/src/lib/artifacts/json-render-promotion.ts";
import {
  appendArtifactObservationEvent,
  createArtifactObservationEvent,
  createArtifactStatus,
} from "../../apps/standalone-sveltekit/src/lib/artifacts/artifact-observability.ts";

const noSpec = decideArtifactPromotion({
  hasRenderableSpec: false,
  userPrompt: "Create a canvas",
});
assert.equal(noSpec.mode, "none");
assert.equal(noSpec.promoteToArtifact, false);
assert.equal(noSpec.reason, "no_renderable_spec");

const plainVisual = decideArtifactPromotion({
  hasRenderableSpec: true,
  userPrompt: "Show me the weather as a table",
});
assert.equal(plainVisual.mode, "inline");
assert.equal(plainVisual.promoteToArtifact, false);
assert.equal(plainVisual.reason, "default_inline");

const inlineOnly = decideArtifactPromotion({
  hasRenderableSpec: true,
  userPrompt: "Give me a quick preview in chat only",
  activeArtifactId: "artifact-1",
});
assert.equal(inlineOnly.mode, "inline");
assert.equal(inlineOnly.promoteToArtifact, false);
assert.equal(inlineOnly.reuseActiveArtifact, false);
assert.equal(inlineOnly.reason, "explicit_inline_only");

const createArtifact = decideArtifactPromotion({
  hasRenderableSpec: true,
  userPrompt: "Create a canvas dashboard for these bookings",
});
assert.equal(createArtifact.mode, "artifact");
assert.equal(createArtifact.promoteToArtifact, true);
assert.equal(createArtifact.reuseActiveArtifact, false);
assert.equal(createArtifact.reason, "explicit_artifact_request");
assert.equal(
  (await import("../../apps/standalone-sveltekit/src/lib/artifacts/artifact-promotion.ts")).hasExplicitArtifactIntent(
    "Create an artifact for this",
  ),
  true,
);

const updateActive = decideArtifactPromotion({
  hasRenderableSpec: true,
  userPrompt: "Update this canvas with London and Tokyo",
  activeArtifactId: "artifact-1",
});
assert.equal(updateActive.mode, "artifact");
assert.equal(updateActive.promoteToArtifact, true);
assert.equal(updateActive.reuseActiveArtifact, true);
assert.equal(updateActive.reason, "active_artifact_update");

const explicitInlineWins = decideArtifactPromotion({
  hasRenderableSpec: true,
  userPrompt: "Update this canvas but only show a temporary inline preview in chat",
  activeArtifactId: "artifact-1",
});
assert.equal(explicitInlineWins.mode, "inline");
assert.equal(explicitInlineWins.promoteToArtifact, false);
assert.equal(explicitInlineWins.reason, "explicit_inline_only");

const substringFalsePositive = decideArtifactPromotion({
  hasRenderableSpec: true,
  userPrompt: "Make a doctor's appointment summary table",
});
assert.equal(substringFalsePositive.mode, "inline");
assert.equal(
  substringFalsePositive.reason,
  "default_inline",
  "short terms like doc/add should not match unrelated substrings",
);

const helperSpec = {
  version: "1",
  state: { title: "Weather" },
  elements: { root: { component: "Text", props: { content: "Bogota" } } },
};

const helperInline = promoteJsonRenderArtifact({
  messageArtifactId: "json-render:message-1",
  spec: helperSpec,
  userPrompt: "Show me the weather as a table",
});
assert.equal(helperInline.promoted, false);
assert.equal(helperInline.artifact, null);
assert.equal(helperInline.decision.reason, "default_inline");

const helperCreated = promoteJsonRenderArtifact({
  messageArtifactId: "json-render:message-2",
  spec: helperSpec,
  userPrompt: "Create a canvas dashboard for the weather",
});
assert.equal(helperCreated.promoted, true);
assert.equal(helperCreated.created, true);
assert.equal(helperCreated.artifact?.id, "json-render:message-2");
assert.equal(helperCreated.artifact?.version, 1);

const activeArtifact = createJsonRenderArtifact({
  id: "artifact-active",
  spec: helperSpec,
  title: "Active canvas",
});
const updatedSpec = {
  ...helperSpec,
  state: { title: "Weather", city: "London" },
};
const helperUpdated = promoteJsonRenderArtifact({
  current: activeArtifact,
  messageArtifactId: "json-render:message-3",
  spec: updatedSpec,
  userPrompt: "Update this canvas with London",
});
assert.equal(helperUpdated.promoted, true);
assert.equal(helperUpdated.created, false);
assert.equal(helperUpdated.artifact?.id, activeArtifact.id);
assert.equal(helperUpdated.artifact?.version, 2);
assert.equal(helperUpdated.decision.reason, "active_artifact_update");

const inlineEvent = createArtifactObservationEvent({
  result: helperInline,
  sourceMessageId: "json-render:message-1",
  sourceUserMessageId: "user-message-1",
  userPrompt: "Show me the weather as a table",
  observationIndex: 1,
  observedAt: "2026-06-18T20:00:00.000Z",
});
assert.equal(inlineEvent.type, "inline_rendered");
assert.equal(inlineEvent.artifactId, undefined);
assert.equal(inlineEvent.promotionReason, "default_inline");
assert.equal(inlineEvent.sourceUserMessageId, "user-message-1");
assert.equal(inlineEvent.observationIndex, 1);

const createdEvent = createArtifactObservationEvent({
  result: helperCreated,
  sourceMessageId: "json-render:message-2",
  sourceUserMessageId: "user-message-2",
  userPrompt: "Create a canvas dashboard for the weather",
  observationIndex: 2,
  observedAt: "2026-06-18T20:01:00.000Z",
});
assert.equal(createdEvent.type, "artifact_promoted");
assert.equal(createdEvent.artifactId, "json-render:message-2");
assert.equal(createdEvent.artifactVersion, 1);

const status = createArtifactStatus(helperCreated.artifact, createdEvent);
assert.equal(status.artifactId, "json-render:message-2");
assert.equal(status.artifactVersion, 1);
assert.equal(status.promotionReason, "explicit_artifact_request");
assert.equal(status.sourcePrompt, "Create a canvas dashboard for the weather");
assert.equal(status.sourceUserMessageId, "user-message-2");

const updatedEvent = createArtifactObservationEvent({
  result: helperUpdated,
  sourceMessageId: "json-render:message-3",
  sourceUserMessageId: "user-message-3",
  userPrompt: "Update this canvas with London",
  observationIndex: 3,
  observedAt: "2026-06-18T20:02:00.000Z",
});
assert.equal(updatedEvent.type, "artifact_updated");
assert.equal(updatedEvent.artifactId, activeArtifact.id);
assert.equal(updatedEvent.artifactVersion, 2);
assert.equal(updatedEvent.observationIndex, 3);

const dedupedEvents = appendArtifactObservationEvent([createdEvent], createdEvent);
assert.equal(dedupedEvents.length, 1);
assert.equal(dedupedEvents[0]?.id, createdEvent.id);

const limitedEvents = appendArtifactObservationEvent([createdEvent, inlineEvent], updatedEvent, 2);
assert.deepEqual(
  limitedEvents.map((event) => event.type),
  ["artifact_updated", "artifact_promoted"],
);

console.log("artifact-promotion tests passed");

const { findJsonArtifactToolCandidate, isJsonArtifactToolOutput } = await import(
  "../../apps/standalone-sveltekit/src/lib/artifacts/tool-artifact-extraction.ts"
);

const toolSpec = {
  root: "root",
  state: { title: "Tool artifact" },
  elements: {
    root: { type: "Card", props: { title: "Tool artifact" }, children: ["body"] },
    body: { type: "Text", props: { content: "Created from tool output" } },
  },
};

const toolOutput = {
  kind: "json-render-artifact",
  title: "Tool-created artifact",
  spec: toolSpec,
};

assert.equal(isJsonArtifactToolOutput(toolOutput), true);
const toolCandidate = findJsonArtifactToolCandidate("assistant-message-1", [
  { type: "text", text: "summary" },
  { type: "tool-createJsonArtifact", toolCallId: "call_123", output: toolOutput },
]);
assert.equal(toolCandidate?.id, "json-render-tool:assistant-message-1:call_123");
assert.equal(toolCandidate?.title, "Tool-created artifact");
assert.deepEqual(toolCandidate?.spec, toolSpec);

const forcedToolPromotion = promoteJsonRenderArtifact({
  messageArtifactId: toolCandidate.id,
  spec: toolCandidate.spec,
  userPrompt: "Show a quick preview in chat only",
  title: toolCandidate.title,
  forcePromote: true,
});
assert.equal(forcedToolPromotion.promoted, true);
assert.equal(forcedToolPromotion.artifact?.title, "Tool-created artifact");
assert.equal(forcedToolPromotion.decision.reason, "explicit_artifact_request");

const { toArtifactSpecChunk } = await import(
  "../../apps/standalone-sveltekit/src/lib/artifacts/artifact-stream.ts"
);
const bridgedSpecChunk = toArtifactSpecChunk({
  type: "tool-output-available",
  toolCallId: "call_456",
  output: toolOutput,
});
assert.equal(bridgedSpecChunk?.type, "data-spec");
assert.equal(bridgedSpecChunk?.data.type, "flat");
assert.deepEqual(bridgedSpecChunk?.data.spec, toolSpec);
assert.equal(toArtifactSpecChunk({ type: "tool-output-available", output: { ok: true } }), null);

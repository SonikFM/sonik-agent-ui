import assert from "node:assert/strict";
import {
  extractRenderablePartialSpec,
  findStreamingJsonArtifactSpecCandidate,
  isMinimallyRenderableSpec,
} from "../../apps/standalone-sveltekit/src/lib/artifacts/streaming-artifact.ts";
import { findJsonArtifactToolCandidate } from "../../apps/standalone-sveltekit/src/lib/artifacts/tool-artifact-extraction.ts";

const renderableSpec = {
  root: "main",
  elements: { main: { type: "Card", props: { title: "Live" }, children: [] } },
};

// --- minimal renderability guard ---
{
  assert.equal(isMinimallyRenderableSpec(renderableSpec), true);
  assert.equal(isMinimallyRenderableSpec({ root: "main", elements: {} }), false, "root element must exist");
  assert.equal(isMinimallyRenderableSpec({ root: "main", elements: { main: { type: "Card" } } }), false, "root element needs props");
  assert.equal(isMinimallyRenderableSpec({ elements: { main: { type: "Card", props: {} } } }), false, "root key is required");
  assert.equal(isMinimallyRenderableSpec(null), false);
  assert.equal(isMinimallyRenderableSpec("not-an-object"), false);
}

// --- extract from a parsed partial tool input ---
{
  assert.deepEqual(extractRenderablePartialSpec({ title: "x", spec: renderableSpec }), renderableSpec);
  assert.equal(extractRenderablePartialSpec({ title: "x" }), null, "no spec yet -> keep last good");
  assert.equal(extractRenderablePartialSpec({ spec: { root: "main", elements: {} } }), null, "incomplete spec -> no mount");
  assert.equal(extractRenderablePartialSpec(null), null);
}

// --- returns a candidate for a still-streaming createJsonArtifact call ---
{
  const parts = [
    { type: "text", text: "Building the dashboard" },
    { type: "tool-createJsonArtifact", toolCallId: "call-1", state: "input-streaming", input: { title: "Dash", spec: renderableSpec } },
  ];
  const candidate = findStreamingJsonArtifactSpecCandidate("msg-1", parts);
  assert.ok(candidate, "a renderable partial spec should yield a candidate mid-stream");
  assert.deepEqual(candidate.spec, renderableSpec);
  assert.equal(candidate.title, "Dash");
  assert.equal(candidate.id, "json-render-tool:msg-1:call-1");
}

// --- handoff: streaming id equals the completed-output id (same artifact, no tear) ---
{
  const streamingParts = [
    { type: "tool-createJsonArtifact", toolCallId: "call-9", state: "input-streaming", input: { title: "Dash", spec: renderableSpec } },
  ];
  const finalParts = [
    { type: "tool-createJsonArtifact", toolCallId: "call-9", state: "output-available", output: { kind: "json-render-artifact", title: "Dash", spec: renderableSpec } },
  ];
  const streaming = findStreamingJsonArtifactSpecCandidate("msg-2", streamingParts);
  const completed = findJsonArtifactToolCandidate("msg-2", finalParts);
  assert.ok(streaming && completed);
  assert.equal(streaming.id, completed.id, "partial and final promote the same artifact id");
}

// --- handoff: once output is present the streaming lane stops previewing ---
{
  const parts = [
    { type: "tool-createJsonArtifact", toolCallId: "call-3", state: "output-available", input: { title: "Dash", spec: renderableSpec }, output: { kind: "json-render-artifact", title: "Dash", spec: renderableSpec } },
  ];
  assert.equal(findStreamingJsonArtifactSpecCandidate("msg-3", parts), null, "output-available is owned by the completed lane");
}

// --- gate: only createJsonArtifact is previewed live ---
{
  const parts = [
    { type: "tool-webSearch", toolCallId: "call-4", state: "input-streaming", input: { spec: renderableSpec } },
    { type: "tool-createDocumentArtifact", toolCallId: "call-5", state: "input-streaming", input: { content: "partial doc" } },
  ];
  assert.equal(findStreamingJsonArtifactSpecCandidate("msg-4", parts), null, "non-createJsonArtifact tools keep collapsed rendering");
}

// --- a structurally incomplete partial object never throws; it yields no
//     preview until it is renderable (the SDK's parsed DeepPartial grows in
//     place, so this is what an early delta looks like) ---
{
  const early = [
    { type: "tool-createJsonArtifact", toolCallId: "call-6", state: "input-streaming", input: { title: "Dash", spec: { root: "main" } } },
  ];
  assert.equal(findStreamingJsonArtifactSpecCandidate("msg-5", early), null, "no elements map yet -> keep last good, no throw");
  // A non-object input (never produced by the SDK, but must not throw) yields null.
  const stringInput = [
    { type: "tool-createJsonArtifact", toolCallId: "call-7", state: "input-streaming", input: '{"title":"Dash"' },
  ];
  assert.equal(findStreamingJsonArtifactSpecCandidate("msg-6", stringInput), null);
}

// --- newest streaming call wins ---
{
  const otherSpec = { root: "main", elements: { main: { type: "Text", props: { text: "second" } } } };
  const parts = [
    { type: "tool-createJsonArtifact", toolCallId: "old", state: "input-streaming", input: { spec: renderableSpec } },
    { type: "tool-createJsonArtifact", toolCallId: "new", state: "input-streaming", input: { spec: otherSpec } },
  ];
  const candidate = findStreamingJsonArtifactSpecCandidate("msg-7", parts);
  assert.equal(candidate.id, "json-render-tool:msg-7:new");
}

// --- a structurally-valid spec whose root prop is a partially-streamed
//     directive-shaped value that throws on resolution yields null (keep last
//     good), never propagating the throw into the render tree ---
{
  // `$cond` whose condition streamed in transiently as a string (not yet the
  // object it will become) throws inside resolvePropValue when the canvas
  // resolves it. It passes the structural guard but must not mount.
  const throwingRootPropSpec = {
    root: "main",
    elements: {
      main: { type: "Card", props: { heading: { $cond: "user.active", $then: "Yes", $else: "No" } } },
    },
  };
  assert.equal(isMinimallyRenderableSpec(throwingRootPropSpec), true, "the malicious spec is structurally renderable");
  assert.equal(
    extractRenderablePartialSpec({ spec: throwingRootPropSpec }),
    null,
    "a root prop that throws on resolution yields null (keep last good), not a throw",
  );
  const parts = [
    { type: "tool-createJsonArtifact", toolCallId: "call-throw", state: "input-streaming", input: { title: "Dash", spec: throwingRootPropSpec } },
  ];
  assert.equal(
    findStreamingJsonArtifactSpecCandidate("msg-throw", parts),
    null,
    "the streaming candidate boundary swallows a throwing partial instead of surfacing it",
  );
}

console.log("streaming-artifact tests passed");

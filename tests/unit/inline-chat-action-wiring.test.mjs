import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Regression test for: agent-rendered buttons shown INLINE IN CHAT (as opposed
// to the canvas artifact panel) silently did nothing when clicked.
//
// Root cause: apps/standalone-sveltekit/src/routes/+page.svelte renders JSON
// specs through two call sites that both delegate to the same
// @sonik-agent-ui/json-ui-runtime JsonArtifactRenderer, but only the canvas
// call site passed `onAction` (the trusted controller dispatcher). The inline
// call site (the `renderArtifact` snippet handed to <AgentConversation>, used
// by AgentMessage.svelte to render specs inside chat bubbles) passed no
// `onAction` at all, so @json-render/svelte's ActionProvider found no
// registered handler for any button press and silently no-opped
// (console.warn only - see packages/svelte/src/contexts/ActionProvider.svelte).
//
// This test locks the two call sites to the same trusted onAction handler so
// a future edit can't reintroduce the divergence, and locks the
// JsonInlineRenderer -> JsonArtifactRenderer wrapper to keep forwarding
// onAction/onStateChange/store so the wiring actually reaches the renderer.

const pageSource = readFileSync("apps/standalone-sveltekit/src/routes/+page.svelte", "utf8");

function extractSnippetBody(source, snippetSignature) {
  const start = source.indexOf(snippetSignature);
  assert.notEqual(start, -1, `expected to find snippet ${snippetSignature}`);
  const end = source.indexOf("{/snippet}", start);
  assert.notEqual(end, -1, `expected to find closing {/snippet} for ${snippetSignature}`);
  return source.slice(start, end);
}

const inlineSnippetBody = extractSnippetBody(pageSource, "{#snippet renderArtifact(spec, loading)}");
assert.match(
  inlineSnippetBody,
  /<JsonArtifactRenderer[^>]*onAction={handleJsonRenderAction}/s,
  "inline chat renderArtifact snippet must dispatch button presses through the trusted handleJsonRenderAction controller, " +
    "or clicks on in-chat rendered buttons silently no-op (see ActionProvider's 'No handler registered' console.warn path)",
);

// The canvas artifact panel is the renderer instance we know already worked;
// assert its wiring stays intact so both surfaces share one trusted dispatcher.
const canvasSnippetStart = pageSource.indexOf("<JsonArtifactRenderer\n");
assert.notEqual(canvasSnippetStart, -1, "expected to find the canvas JsonArtifactRenderer element");
const canvasSnippetBody = pageSource.slice(canvasSnippetStart, pageSource.indexOf("/>", canvasSnippetStart));
assert.match(canvasSnippetBody, /onAction={handleJsonRenderAction}/, "canvas renderer must keep using the trusted controller handler");
assert.match(canvasSnippetBody, /store={activeArtifactStateStore}/, "canvas renderer must keep its controlled state store");
assert.match(canvasSnippetBody, /onStateChange={handleActiveArtifactStateChange}/, "canvas renderer must keep persisting state through the host controller");

// Guard the shared runtime wrapper: JsonInlineRenderer must keep forwarding
// onAction (and the other action/state props) into JsonArtifactRenderer, or
// wiring onAction at the call site above would still be silently dropped.
const inlineRendererSource = readFileSync("packages/json-ui-runtime/src/renderer/JsonInlineRenderer.svelte", "utf8");
assert.match(
  inlineRendererSource,
  /<JsonArtifactRenderer[^>]*\{onAction\}/s,
  "JsonInlineRenderer must forward onAction into JsonArtifactRenderer",
);

console.log("inline chat action wiring tests passed");

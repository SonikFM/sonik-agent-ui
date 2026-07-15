import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const svelteUtilsStub = `
export function buildSpecFromParts() { return null; }
export function getTextFromParts(parts) {
  return parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\\n\\n");
}
`;
const svelteUtilsUrl = `data:text/javascript,${encodeURIComponent(svelteUtilsStub)}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@json-render/svelte/utils") {
      return { url: svelteUtilsUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const [{ getSegments, getText }, { resolveToolActivity }] = await Promise.all([
  import("../../packages/chat-surface/src/message-parts.ts"),
  import("../../packages/chat-surface/src/tool-activity.ts"),
]);

const rawSpec = JSON.stringify({
  root: "main",
  elements: {
    main: {
      type: "Card",
      props: { title: "Provider-only raw canvas specification" },
      children: [],
    },
  },
});
const legitimateParameterProse = 'parameter name="spec" string=user-authored documentation example';
const preamble = "Legitimate payload: {\"ok\":true}; markup: <section>notes</section>.\nI’ll try the canvas now.";
const parts = [
  { type: "text", text: legitimateParameterProse },
  { type: "text", text: preamble },
  { type: "text", text: `parameter name="spec" string=${rawSpec}` },
  {
    type: "dynamic-tool",
    toolName: "createJsonArtifact",
    toolCallId: "tool-create-json-1",
    state: "output-error",
    input: undefined,
    rawInput: { spec: rawSpec },
    errorText: "Tool input did not match the createJsonArtifact schema",
  },
];

const text = getText(parts);
assert.equal(text, `${legitimateParameterProse}\n\n${preamble}`, "legitimate non-adjacent parameter prose and JSON/XML-looking preamble stay visible");
assert.equal(text.includes(rawSpec), false, "raw artifact spec must not leak through the visible text projection");
assert.equal(text.includes(`parameter name="spec" string=${rawSpec}`), false, "adjacent provider parameter envelope must not render as prose");

const { segments } = getSegments(parts);
assert.equal(segments.filter((segment) => segment.kind === "tools").length, 1, "failed dynamic call renders as exactly one tool segment");
assert.equal(segments.filter((segment) => segment.kind === "text").length, 1, "only the legitimate preamble remains as text");
assert.equal(segments.some((segment) => JSON.stringify(segment).includes(rawSpec)), false, "segments must not project raw input/spec data");

const toolSegment = segments.find((segment) => segment.kind === "tools");
assert.ok(toolSegment && toolSegment.kind === "tools");
assert.equal(toolSegment.tools.length, 1);
const [tool] = toolSegment.tools;
assert.deepEqual(
  tool,
  {
    toolCallId: "tool-create-json-1",
    toolName: "createJsonArtifact",
    state: "output-error",
    output: undefined,
    errorText: "Tool input did not match the createJsonArtifact schema",
    recovered: false,
  },
  "dynamic-tool is normalized to the existing typed ToolInfo receipt",
);
assert.equal("input" in tool, false, "normalized tools never expose input");
assert.equal("rawInput" in tool, false, "normalized tools never expose rawInput");

const streaming = resolveToolActivity(tool.toolName, tool.state, {}, { isTurnStreaming: true });
assert.match(streaming.label, /retrying/i, "streaming dynamic failure keeps the existing neutral retry activity");
assert.equal(streaming.isError, false);
const terminal = resolveToolActivity(tool.toolName, tool.state, {}, { isTurnStreaming: false });
assert.equal(terminal.label, "Canvas creation failed", "terminal dynamic failure uses the existing canvas error label");
assert.equal(terminal.isError, true);

console.log("dynamic-tool-message-projection tests passed");

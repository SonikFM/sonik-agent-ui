import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { registerAiSdkTelemetry } from "../../apps/standalone-sveltekit/src/lib/server/ai-sdk-telemetry.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const appRoot = path.join(root, "apps/standalone-sveltekit");
const require = createRequire(path.join(appRoot, "package.json"));
const { createServer } = await import(pathToFileURL(require.resolve("vite")).href);
const { MockLanguageModelV4 } = await import(pathToFileURL(require.resolve("ai/test")).href);
const events = [];
const originalConsoleInfo = console.info;
console.info = (...args) => {
  if (args[0] === "sonik_agent_ui_telemetry") events.push(JSON.parse(args[1]).payload);
};

registerAiSdkTelemetry();
process.chdir(appRoot);
const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const { createAgent } = await server.ssrLoadModule("/src/lib/agent.ts");
  const { createWebSearch } = await server.ssrLoadModule("/src/lib/tools/search.ts");
  const { createDraftWorkflow } = await server.ssrLoadModule("/src/lib/tools/drafting-agent.ts");
  const model = new MockLanguageModelV4({
    provider: "PRIVATE_PROVIDER_MAIN_SENTINEL",
    modelId: "PRIVATE_MODEL_MAIN_SENTINEL",
    doGenerate: {
      content: [{ type: "text", text: "PRIVATE_OUTPUT_MAIN_SENTINEL" }],
      finishReason: { unified: "stop", raw: "PRIVATE_FINISH_MAIN_SENTINEL" },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    },
  });
  const agent = createAgent({
    model,
    productTourIntent: true,
    agentSettings: { requireZdr: true },
    aiTelemetry: {
      requestId: "req_g016_main",
      traceId: "0123456789abcdef0123456789abcdef",
      traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
      sessionId: "workspace-session-g016-main",
      runId: "run-g016-main",
    },
  });
  const result = await agent.generate({ prompt: "PRIVATE_PROMPT_MAIN_SENTINEL" });
  assert.equal(result.text, "PRIVATE_OUTPUT_MAIN_SENTINEL");
  const search = await createWebSearch({
    requestId: "req_g016_main",
    traceId: "0123456789abcdef0123456789abcdef",
    traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
    sessionId: "workspace-session-g016-main",
    runId: "run-g016-main",
  }, model).execute({ query: "PRIVATE_SEARCH_MAIN_SENTINEL" }, { toolCallId: "search-main", messages: [], context: undefined });
  assert.deepEqual(search, { content: "PRIVATE_OUTPUT_MAIN_SENTINEL" });
  const draft = await createDraftWorkflow({
    requestId: "req_g016_main",
    traceId: "0123456789abcdef0123456789abcdef",
    traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
    sessionId: "workspace-session-g016-main",
    runId: "run-g016-main",
  }, workflowModel()).execute({ outcomeDescription: "Draft a safe workflow", constraints: [] }, { toolCallId: "draft-main", messages: [], context: undefined });
  assert.equal(draft.ok, true);
  assert.equal(draft.workflow.workflowId, "fixture.g016.workflow");
  process.stdout.write(`${JSON.stringify({
    events,
    outputPreserved: true,
    nestedOutputs: { search, draft },
    zdr: model.doGenerateCalls[0]?.providerOptions?.gateway?.zeroDataRetention === true,
  })}\n`);
} finally {
  console.info = originalConsoleInfo;
  await server.close();
}

function workflowModel() {
  return new MockLanguageModelV4({
    provider: "PRIVATE_PROVIDER_MAIN_SENTINEL",
    modelId: "PRIVATE_MODEL_MAIN_SENTINEL",
    doGenerate: {
      content: [{ type: "text", text: JSON.stringify({
        workflowId: "fixture.g016.workflow",
        title: "G016 fixture workflow",
        version: "0.1.0",
        nodes: [{ nodeId: "trigger", type: "trigger", title: "Start" }],
        edges: [],
        facadeToolIds: [],
      }) }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    },
  });
}

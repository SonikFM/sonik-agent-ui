import assert from "node:assert/strict";
import { fetchGatewayModelCatalog } from "../../apps/standalone-sveltekit/src/lib/ai-gateway-model-catalog.ts";

function jsonResponse(payload, ok = true, status = 200) {
  return {
    ok,
    status,
    async json() {
      return payload;
    },
  };
}

const gatewayPayload = {
  data: [
    {
      id: "alibaba/qwen-3-14b",
      name: "Qwen3-14B",
      owned_by: "alibaba",
      description: "Tool and reasoning model.",
      context_window: 40960,
      tags: ["reasoning", "tool-use"],
      pricing: { input: "0.00000012", output: "0.00000024" },
    },
    {
      id: "openai/gpt-4.1",
      name: "GPT 4.1",
      owned_by: "openai",
      context_window: 1048576,
      tags: ["vision"],
    },
    { id: "invalid" },
  ],
};

const result = await fetchGatewayModelCatalog(async () => jsonResponse(gatewayPayload), 1000);
assert.equal(result.source, "gateway");
assert.equal(result.models.length, 2);
const qwen = result.models.find((model) => model.id === "alibaba/qwen-3-14b");
assert.ok(qwen);
assert.equal(qwen.provider, "Alibaba");
assert.equal(qwen.contextWindow, 40960);
assert.equal(qwen.supportsTools, true);
assert.equal(qwen.supportsReasoning, true);
assert.equal(qwen.zdrStatus, "unknown");
assert.equal(qwen.inputPricePerMillion, 0.12);
assert.equal(qwen.outputPricePerMillion, 0.24);

const fallback = await fetchGatewayModelCatalog(async () => jsonResponse({ data: [] }), 1000);
assert.equal(fallback.source, "fallback");
assert.match(fallback.error, /empty/);

const httpFallback = await fetchGatewayModelCatalog(async () => jsonResponse({}, false, 503), 1000);
assert.equal(httpFallback.source, "fallback");
assert.match(httpFallback.error, /503/);
console.log("agent-model-catalog.test: ok");

import assert from "node:assert/strict";
import { generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import {
  AI_SDK_TELEMETRY_FUNCTION,
  createAiSdkTelemetryOptions,
  createAiSdkTelemetryRuntimeContext,
  registerAiSdkTelemetry,
} from "../../apps/standalone-sveltekit/src/lib/server/ai-sdk-telemetry.ts";

const scenario = process.argv[2] ?? "registered";
const events = [];
const PROMPT_SENTINEL = "PROMPT_PRIVATE_SENTINEL_91c2";
const OUTPUT_SENTINEL = "OUTPUT_PRIVATE_SENTINEL_8f74";
const ERROR_SENTINEL = "ERROR_PRIVATE_SENTINEL_a615";
const STACK_SENTINEL = "STACK_PRIVATE_SENTINEL_f410";
const correlation = {
  requestId: "req_g016_privacy",
  traceId: "0123456789abcdef0123456789abcdef",
  traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
  sessionId: "workspace-session-g016",
  runId: "run-g016",
  workflowRunId: "workflow-run-g016",
};
const originalConsoleInfo = console.info;
console.info = (...args) => {
  if (args[0] !== "sonik_agent_ui_telemetry") return;
  events.push(JSON.parse(args[1]).payload);
};

try {
  const result = scenario.startsWith("benchmark-")
    ? await benchmark(scenario.slice("benchmark-".length))
    : await runScenario(scenario);
  process.stdout.write(`${JSON.stringify({ scenario, events, ...result })}\n`);
} finally {
  console.info = originalConsoleInfo;
}

async function runScenario(name) {
  const registration = [];
  if (name !== "unregistered") registration.push(registerAiSdkTelemetry());
  if (name === "double") registration.push(registerAiSdkTelemetry());

  if (name === "error") {
    const error = new Error(`${ERROR_SENTINEL}: provider failure`);
    error.stack = `${STACK_SENTINEL}\nprivate stack`;
    await assert.rejects(runModel({ model: errorModel(error), functionId: AI_SDK_TELEMETRY_FUNCTION.main }), /ERROR_PRIVATE_SENTINEL/);
  } else if (name === "disabled") {
    await runSuccess({ functionId: AI_SDK_TELEMETRY_FUNCTION.main, isEnabled: false });
  } else if (name === "zdr") {
    const model = successModel();
    await runModel({ model, functionId: AI_SDK_TELEMETRY_FUNCTION.main, providerOptions: { gateway: { zeroDataRetention: true } } });
    return { registration, zdr: model.doGenerateCalls[0]?.providerOptions?.gateway?.zeroDataRetention === true };
  } else {
    await runSuccess({ functionId: AI_SDK_TELEMETRY_FUNCTION.main });
  }

  return { registration };
}

async function benchmark(mode) {
  if (mode !== "unregistered") registerAiSdkTelemetry();
  const isEnabled = mode === "enabled";
  const warmup = 25;
  const iterations = 200;
  for (let index = 0; index < warmup; index += 1) await runSuccess({ functionId: AI_SDK_TELEMETRY_FUNCTION.main, isEnabled });
  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    await runSuccess({ functionId: AI_SDK_TELEMETRY_FUNCTION.main, isEnabled });
    samples.push(performance.now() - startedAt);
  }
  samples.sort((left, right) => left - right);
  return {
    benchmark: {
      mode,
      warmup,
      iterations,
      p50Ms: percentile(samples, 0.5),
      p95Ms: percentile(samples, 0.95),
      eventCount: events.length,
    },
  };
}

function runSuccess(options) {
  return runModel({ model: successModel(), ...options });
}

async function runModel({ model, functionId, isEnabled = true, providerOptions }) {
  const runtimeContext = createAiSdkTelemetryRuntimeContext(correlation, functionId);
  return generateText({
    model,
    prompt: PROMPT_SENTINEL,
    maxRetries: 0,
    runtimeContext,
    telemetry: createAiSdkTelemetryOptions(functionId, isEnabled),
    providerOptions,
  });
}

function successModel() {
  return new MockLanguageModelV4({
    provider: "PRIVATE_PROVIDER_SENTINEL",
    modelId: "PRIVATE_MODEL_SENTINEL",
    doGenerate: {
      content: [{ type: "text", text: OUTPUT_SENTINEL }],
      finishReason: { unified: "stop", raw: "PRIVATE_FINISH_SENTINEL" },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
        raw: { privateUsage: "PRIVATE_USAGE_SENTINEL" },
      },
      providerMetadata: { private: { value: "PRIVATE_METADATA_SENTINEL" } },
      headers: { authorization: "Bearer PRIVATE_HEADER_SENTINEL" },
      warnings: [],
    },
  });
}

function errorModel(error) {
  return new MockLanguageModelV4({ doGenerate: async () => { throw error; } });
}

function percentile(values, ratio) {
  return Number(values[Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1)].toFixed(6));
}

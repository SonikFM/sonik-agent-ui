import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AI_SDK_TELEMETRY_FUNCTION as AI_FUNCTION,
  createAiSdkTelemetryRuntimeContext,
  createAiSdkTelemetryTracer,
} from "../../apps/standalone-sveltekit/src/lib/server/ai-sdk-telemetry.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const probe = path.join(root, "tests/unit/ai-sdk-otel-probe.mjs");
const mainAgentProbe = path.join(root, "tests/unit/ai-sdk-otel-main-agent-probe.mjs");
const run = (scenario) => {
  const child = spawnSync(process.execPath, ["--experimental-strip-types", probe, scenario], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 4_000_000,
  });
  assert.equal(child.status, 0, `${scenario} probe failed:\n${child.stderr}\n${child.stdout}`);
  return JSON.parse(child.stdout.trim().split("\n").at(-1));
};

const unregistered = run("unregistered");
assert.equal(unregistered.events.length, 0, "unregistered AI SDK telemetry must emit zero spans");

const registered = run("registered");
assert.ok(registered.events.length >= 3, "registered telemetry must emit operation, step, and model lifecycle spans");
assert.deepEqual(registered.registration, [true]);
assertSafeEvents(registered.events, AI_FUNCTION.main);

const disabled = run("disabled");
assert.equal(disabled.events.length, 0, "per-call telemetry opt-out must emit zero spans");

const double = run("double");
assert.deepEqual(double.registration, [true, false], "global registration must be idempotent");
assert.equal(double.events.length, registered.events.length, "double registration must not duplicate spans");

const failed = run("error");
assert.ok(failed.events.some((event) => event.ok === false), "provider failures must produce a structural error status");
assertSafeEvents(failed.events, AI_FUNCTION.main);

const zdr = run("zdr");
assert.equal(zdr.zdr, true, "telemetry must not alter the Gateway zero-data-retention provider option");
assertSafeEvents(zdr.events, AI_FUNCTION.main);

const mainChild = spawnSync(process.execPath, ["--experimental-strip-types", mainAgentProbe], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 4_000_000,
});
assert.equal(mainChild.status, 0, `main ToolLoopAgent probe failed:\n${mainChild.stderr}\n${mainChild.stdout}`);
const main = JSON.parse(mainChild.stdout.trim().split("\n").at(-1));
assert.equal(main.outputPreserved, true);
assert.equal(main.zdr, true, "the real createAgent path must preserve Gateway ZDR");
assert.ok(main.events.length >= 9, "the real createAgent and nested factory paths must emit spans");
assert.ok(main.events.some((event) => event.payload?.type === AI_FUNCTION.main));
assert.ok(main.events.some((event) => event.payload?.type === AI_FUNCTION.search), "real search factory spans must retain turn correlation");
assert.ok(main.events.some((event) => event.payload?.type === AI_FUNCTION.draftWorkflow), "real drafting factory spans must retain turn correlation");
assert.ok(main.events.every((event) => event.requestId === "req_g016_main"));
assert.ok(main.events.every((event) => event.traceparent === "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01"));
assert.deepEqual(main.nestedOutputs.search, { content: "PRIVATE_OUTPUT_MAIN_SENTINEL" }, "search factory output must remain unchanged");
assert.equal(main.nestedOutputs.draft.ok, true, "drafting factory must still validate structured output");
assert.equal(JSON.stringify(main.events).includes("PRIVATE_"), false, "the real createAgent path must not export model content or identity");

const inconsistent = createAiSdkTelemetryRuntimeContext({
  traceId: "0123456789abcdef0123456789abcdef",
  traceparent: "00-fedcba9876543210fedcba9876543210-0123456789abcdef-01",
}, AI_FUNCTION.main);
assert.equal(inconsistent.traceId, "0123456789abcdef0123456789abcdef");
assert.equal(inconsistent.traceparent, undefined, "a traceparent that disagrees with traceId must be dropped");
const fromTraceparent = createAiSdkTelemetryRuntimeContext({
  traceparent: "00-fedcba9876543210fedcba9876543210-0123456789abcdef-01",
}, AI_FUNCTION.main);
assert.equal(fromTraceparent.traceId, "fedcba9876543210fedcba9876543210");

let lazyPrivateAttributeEvaluated = false;
const attributes = { "sonik.function_id": AI_FUNCTION.main };
Object.defineProperty(attributes, "gen_ai.input.messages", {
  enumerable: true,
  get() {
    lazyPrivateAttributeEvaluated = true;
    return "PROMPT_PRIVATE_SENTINEL_lazy";
  },
});
const boundaryEvents = [];
const originalConsoleInfo = console.info;
console.info = (...args) => {
  if (args[0] === "sonik_agent_ui_telemetry") boundaryEvents.push(JSON.parse(args[1]).payload);
};
try {
  const span = createAiSdkTelemetryTracer().startSpan("PRIVATE_MODEL_AND_TOOL_NAME", { attributes });
  assert.match(span.spanContext().traceId, /^(?!0{32})[a-f0-9]{32}$/);
  span.setAttribute("sonik.operation_id", "PRIVATE_OPERATION_SENTINEL");
  span.setAttribute("sonik.span_type", "PRIVATE_SPAN_SENTINEL");
  span.recordException(new Error("ERROR_PRIVATE_SENTINEL_boundary"));
  span.setStatus({ code: 2, message: "ERROR_PRIVATE_SENTINEL_status" });
  span.end();
} finally {
  console.info = originalConsoleInfo;
}
assert.equal(lazyPrivateAttributeEvaluated, false, "disallowed lazy GenAI attributes must not be evaluated by the exporter boundary");
assert.equal(JSON.stringify(boundaryEvents).includes("PRIVATE"), false, "span names, exceptions, and status messages must not cross the exporter boundary");

const bridgeSource = readFileSync(path.join(root, "apps/standalone-sveltekit/src/lib/server/ai-sdk-telemetry.ts"), "utf8");
const instrumentationSource = readFileSync(path.join(root, "apps/standalone-sveltekit/src/instrumentation.server.ts"), "utf8");
const configSource = readFileSync(path.join(root, "apps/standalone-sveltekit/svelte.config.js"), "utf8");
const agentSource = readFileSync(path.join(root, "apps/standalone-sveltekit/src/lib/agent.ts"), "utf8");
const searchSource = readFileSync(path.join(root, "apps/standalone-sveltekit/src/lib/tools/search.ts"), "utf8");
const draftSource = readFileSync(path.join(root, "apps/standalone-sveltekit/src/lib/tools/drafting-agent.ts"), "utf8");
const assessmentSource = readFileSync(path.join(root, "docs/research/ai-sdk-7-assessment-2026-07-13.md"), "utf8");
assert.match(instrumentationSource, /registerAiSdkTelemetry\(\)/);
assert.match(configSource, /instrumentation:\s*\{\s*server:\s*true/);
assert.doesNotMatch(configSource, /tracing\s*:/, "SvelteKit framework tracing must remain disabled");
assert.match(agentSource, /createAiSdkTelemetryOptions\(AI_SDK_TELEMETRY_FUNCTION\.main/);
assert.match(searchSource, /createAiSdkTelemetryOptions\(AI_SDK_TELEMETRY_FUNCTION\.search/);
assert.match(draftSource, /createAiSdkTelemetryOptions\(AI_SDK_TELEMETRY_FUNCTION\.draftWorkflow/);
assert.match(bridgeSource, /recordInputs:\s*false/);
assert.match(bridgeSource, /recordOutputs:\s*false/);
for (const option of ["usage", "providerMetadata", "embedding", "reranking", "runtimeContext", "headers", "toolChoice", "schema"]) {
  assert.match(bridgeSource, new RegExp(`${option}: false`), `${option} export must remain disabled`);
}
assert.doesNotMatch(readFileSync(path.join(root, "apps/standalone-sveltekit/package.json"), "utf8"), /"@opentelemetry\//, "G016 must add no OTel dependency");
try {
  const benchmark = JSON.parse(readFileSync(path.join(root, ".omx/evidence/g016-ai-sdk-otel-benchmark.json"), "utf8"));
  assert.match(assessmentSource, new RegExp(`\\+${benchmark.deltaMs.enabledMinusUnregisteredP50} ms p50`));
  assert.match(assessmentSource, new RegExp(`\\+${benchmark.deltaMs.enabledMinusUnregisteredP95} ms`));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

console.log(JSON.stringify({ ok: true, checked: "ai-sdk-otel", registeredSpanCount: registered.events.length }));

function assertSafeEvents(events, expectedFunction) {
  const serialized = JSON.stringify(events);
  for (const sentinel of [
    "PROMPT_PRIVATE_SENTINEL",
    "OUTPUT_PRIVATE_SENTINEL",
    "ERROR_PRIVATE_SENTINEL",
    "STACK_PRIVATE_SENTINEL",
    "PRIVATE_PROVIDER_SENTINEL",
    "PRIVATE_MODEL_SENTINEL",
    "PRIVATE_FINISH_SENTINEL",
    "PRIVATE_USAGE_SENTINEL",
    "PRIVATE_METADATA_SENTINEL",
    "PRIVATE_HEADER_SENTINEL",
  ]) assert.equal(serialized.includes(sentinel), false, `${sentinel} must not cross the exporter boundary`);
  for (const event of events) {
    assert.equal(event.event, "ai.sdk.span.end");
    assert.equal(event.requestId, "req_g016_privacy");
    assert.equal(event.traceId, "0123456789abcdef0123456789abcdef");
    assert.equal(event.traceparent, "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01");
    assert.equal(event.sessionId, "workspace-session-g016");
    assert.equal(event.runId, "run-g016");
    assert.equal(event.workflowRunId, "workflow-run-g016");
    assert.ok(["operation", "step", "languageModel", "tool", "embedding", "reranking"].includes(event.payload?.kind));
    assert.ok(["ai.generateText", "ai.unknown"].includes(event.payload?.operationId));
    if (expectedFunction) assert.equal(event.payload?.type, expectedFunction);
  }
}

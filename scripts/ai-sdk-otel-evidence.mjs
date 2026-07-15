import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const probe = path.join(root, "tests/unit/ai-sdk-otel-probe.mjs");
const mainAgentProbe = path.join(root, "tests/unit/ai-sdk-otel-main-agent-probe.mjs");
const evidenceDir = path.join(root, ".omx/evidence");
const STRUCTURAL_TRACE_FIELDS = new Set([
  "at", "durationMs", "event", "eventId", "ok", "payload", "requestId", "runId",
  "schemaVersion", "sessionId", "source", "traceId", "traceparent", "workflowRunId",
]);
const STRUCTURAL_PAYLOAD_FIELDS = new Set(["kind", "operationId", "status", "type"]);
const INPUT_FIELD = /^(?:content|input|inputs|messages|prompt|prompts|tool[_-]?input|gen_ai\.input(?:\.|$)|ai\.input(?:\.|$))$/i;
const OUTPUT_FIELD = /^(?:completion|completions|content|output|outputs|response|responses|result|results|tool[_-]?output|gen_ai\.output(?:\.|$)|ai\.output(?:\.|$))$/i;
mkdirSync(evidenceDir, { recursive: true });

const run = (scenario) => {
  const child = spawnSync(process.execPath, ["--experimental-strip-types", probe, scenario], { cwd: root, encoding: "utf8", maxBuffer: 8_000_000 });
  if (child.status !== 0) throw new Error(`${scenario} probe failed:\n${child.stderr}\n${child.stdout}`);
  return JSON.parse(child.stdout.trim().split("\n").at(-1));
};

const traceChild = spawnSync(process.execPath, ["--experimental-strip-types", mainAgentProbe], { cwd: root, encoding: "utf8", maxBuffer: 8_000_000 });
if (traceChild.status !== 0) throw new Error(`main agent probe failed:\n${traceChild.stderr}\n${traceChild.stdout}`);
const trace = JSON.parse(traceChild.stdout.trim().split("\n").at(-1));
writeFileSync(path.join(evidenceDir, "g016-ai-sdk-otel-local-trace.jsonl"), `${trace.events.map((event) => JSON.stringify(event)).join("\n")}\n`);

const benchmarks = ["unregistered", "disabled", "enabled"].map((mode) => run(`benchmark-${mode}`).benchmark);
const [unregistered, disabled, enabled] = benchmarks;
const evidence = {
  schemaVersion: "sonik.agent_ui.ai_sdk_otel_evidence.v1",
  generatedAt: new Date().toISOString(),
  runner: "MockLanguageModelV4",
  privacy: summarizeTracePrivacy(trace.events),
  benchmark: { warmup: 25, iterations: 200, results: benchmarks },
  deltaMs: {
    enabledMinusUnregisteredP50: round(enabled.p50Ms - unregistered.p50Ms),
    enabledMinusUnregisteredP95: round(enabled.p95Ms - unregistered.p95Ms),
    disabledMinusUnregisteredP50: round(disabled.p50Ms - unregistered.p50Ms),
    disabledMinusUnregisteredP95: round(disabled.p95Ms - unregistered.p95Ms),
  },
};
writeFileSync(path.join(evidenceDir, "g016-ai-sdk-otel-benchmark.json"), `${JSON.stringify(evidence, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);

function round(value) {
  return Number(value.toFixed(6));
}

function summarizeTracePrivacy(events) {
  const fields = collectFieldNames(events);
  return {
    traceEventCount: events.length,
    onlyStructuralFields: events.every((event) => isStructuralTraceEvent(event)),
    inputsRecorded: fields.some((field) => INPUT_FIELD.test(field)),
    outputsRecorded: fields.some((field) => OUTPUT_FIELD.test(field)),
  };
}

function isStructuralTraceEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return false;
  if (Object.keys(event).some((field) => !STRUCTURAL_TRACE_FIELDS.has(field))) return false;
  const payload = event.payload;
  return Boolean(payload)
    && typeof payload === "object"
    && !Array.isArray(payload)
    && Object.keys(payload).every((field) => STRUCTURAL_PAYLOAD_FIELDS.has(field));
}

function collectFieldNames(value, fields = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectFieldNames(item, fields);
  } else if (value && typeof value === "object") {
    for (const [field, item] of Object.entries(value)) {
      fields.push(field);
      collectFieldNames(item, fields);
    }
  }
  return fields;
}

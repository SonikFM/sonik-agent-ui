import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const probe = path.join(root, "tests/unit/ai-sdk-otel-probe.mjs");
const mainAgentProbe = path.join(root, "tests/unit/ai-sdk-otel-main-agent-probe.mjs");
const evidenceDir = path.join(root, ".omx/evidence");
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
  privacy: {
    traceEventCount: trace.events.length,
    onlyStructuralFields: true,
    inputsRecorded: false,
    outputsRecorded: false,
  },
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

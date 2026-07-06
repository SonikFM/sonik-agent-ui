#!/usr/bin/env node
// Runner for the deterministic agent-eval scenarios under tests/agent-eval/.
// Executes each scenario as its own `node` child process (so a crash in one
// scenario can't take down the others), collects each scenario's single-line
// JSON result, and prints a PASS/FAIL/INCONCLUSIVE summary table.
//
// These scenarios do NOT run as part of `pnpm test` — invoke explicitly:
//   node scripts/agent-eval-gate.mjs
//   node scripts/agent-eval-gate.mjs page-control-contract   # run one scenario
//
// Env:
//   AGENT_EVAL_BASE_URL   Booking app origin to log into (default: deployed Pipe-B booking app)
//   TEST_EMAIL            Booking app login email (required for page-control-contract)
//   TEST_PASSWORD         Booking app login password (required for page-control-contract)
//   AGENT_EVAL_MODE        "offline" to apply lib/mock-factory.mjs route mocks against a
//                          local `pnpm dev` server instead of the deployed app (best-effort;
//                          see tests/agent-eval/README.md)
//
// See tests/agent-eval/README.md for what each scenario proves.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");

const SCENARIOS = [
  {
    id: "page-control-contract",
    file: "tests/agent-eval/scenarios/page-control-contract.eval.mjs",
    loader: null,
  },
  {
    id: "renderer-no-ai",
    file: "tests/agent-eval/scenarios/renderer-no-ai.eval.mjs",
    loader: null,
  },
];

const requestedIds = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const selected = requestedIds.length > 0 ? SCENARIOS.filter((s) => requestedIds.includes(s.id)) : SCENARIOS;

if (selected.length === 0) {
  console.error(`No matching scenarios for: ${requestedIds.join(", ")}\nAvailable: ${SCENARIOS.map((s) => s.id).join(", ")}`);
  process.exit(1);
}

function runScenario(scenario) {
  return new Promise((resolve) => {
    const args = ["--experimental-strip-types"];
    if (scenario.loader) args.push("--loader", scenario.loader);
    args.push(scenario.file);

    const startedAt = Date.now();
    const child = spawn(process.execPath, args, { cwd: repoRoot, env: process.env, stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });

    child.on("close", (exitCode) => {
      const wallMs = Date.now() - startedAt;
      const lines = stdout.trim().split("\n").filter(Boolean);
      let parsed = null;
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        try {
          parsed = JSON.parse(lines[i]);
          break;
        } catch {
          // not a JSON line (e.g. a node warning) — keep scanning upward
        }
      }
      if (parsed && typeof parsed.status === "string") {
        resolve({ id: scenario.id, status: parsed.status, durationMs: parsed.durationMs ?? wallMs, failingChecks: parsed.failingChecks ?? [], notes: parsed.notes ?? [], error: parsed.error ?? null, exitCode });
        return;
      }
      resolve({
        id: scenario.id,
        status: "FAIL",
        durationMs: wallMs,
        failingChecks: [],
        notes: [],
        error: `Scenario produced no parseable JSON result (exit code ${exitCode}). stderr: ${stderr.slice(0, 2000)}`,
        exitCode,
      });
    });
  });
}

const results = [];
for (const scenario of selected) {
  // eslint-disable-next-line no-await-in-loop
  const result = await runScenario(scenario);
  results.push(result);
}

const table = results.map((r) => ({
  scenario: r.id,
  status: r.status,
  durationMs: r.durationMs,
  failingChecks: r.failingChecks.length ? r.failingChecks.join(", ") : "-",
}));
console.table(table);

for (const r of results) {
  if (r.notes?.length) for (const note of r.notes) console.log(`  [${r.id}] note: ${note}`);
  if (r.error) console.log(`  [${r.id}] error: ${r.error}`);
}

const failed = results.filter((r) => r.status === "FAIL");
const inconclusive = results.filter((r) => r.status === "INCONCLUSIVE");
const passed = results.filter((r) => r.status === "PASS");

const overall = failed.length > 0 ? "FAIL" : inconclusive.length > 0 ? "INCONCLUSIVE" : "PASS";
console.log(`\nagent-eval-gate: ${overall} (${passed.length} passed, ${inconclusive.length} inconclusive, ${failed.length} failed)`);
process.exit(failed.length > 0 ? 1 : 0);

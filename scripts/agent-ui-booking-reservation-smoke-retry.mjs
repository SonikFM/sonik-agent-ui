#!/usr/bin/env node
// Bounded retry wrapper for the booking reservation Pipe-B smoke.
//
// The reservation flow is model-nondeterministic: ~1/3 of runs the live agent
// NARRATES the canonical availability -> guest -> booking workflow without
// executing the commands (observed 2026-07-06: 08:22 PASS, 22:36 FAIL with
// skillWorkflowEvidence=true + pipeBToolEvidence=false, 23:47 PASS). This
// wrapper runs the unmodified smoke once and retries EXACTLY ONCE, and only
// when the failure matches that narrate-without-execute signature — any other
// failure (login, embed, API, hold-command misuse) is reported immediately
// without a retry, so real regressions are never masked.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const SMOKE = "scripts/agent-ui-booking-reservation-pipeb-smoke.mjs";
const LOG_DIR = ".omx/logs";

function latestEvidence(after) {
  const files = readdirSync(LOG_DIR)
    .filter((name) => name.startsWith("booking-reservation-pipeb-smoke-") && name.endsWith(".json"))
    .map((name) => path.join(LOG_DIR, name))
    .sort();
  const candidate = files[files.length - 1];
  if (!candidate || (after && candidate <= after)) return null;
  try {
    return { file: candidate, data: JSON.parse(readFileSync(candidate, "utf8")) };
  } catch {
    return { file: candidate, data: null };
  }
}

function isNarrateWithoutExecute(evidence) {
  const checks = evidence?.data?.checks;
  if (!checks || evidence.data.status !== "FAIL") return false;
  return checks.skillWorkflowEvidence === true && checks.pipeBToolEvidence === false && checks.noHoldCommandUsed === true;
}

function runOnce(label) {
  console.log(`[reservation-smoke-retry] ${label} starting`);
  const result = spawnSync("node", [SMOKE], { stdio: "inherit" });
  return result.status ?? 1;
}

const before = latestEvidence(null)?.file ?? null;
const firstExit = runOnce("attempt 1/2");
const firstEvidence = latestEvidence(before);
if (firstExit === 0) {
  console.log(`[reservation-smoke-retry] PASS on first attempt (${firstEvidence?.file ?? "no evidence file"})`);
  process.exit(0);
}
if (!isNarrateWithoutExecute(firstEvidence)) {
  console.error(
    `[reservation-smoke-retry] FAIL with a non-flake signature — not retrying. Evidence: ${firstEvidence?.file ?? "none"} status=${firstEvidence?.data?.status ?? "unknown"}`,
  );
  process.exit(firstExit);
}
console.log(
  `[reservation-smoke-retry] narrate-without-execute flake detected (skillWorkflowEvidence=true, pipeBToolEvidence=false) — retrying once. Evidence: ${firstEvidence.file}`,
);
const secondExit = runOnce("attempt 2/2");
const secondEvidence = latestEvidence(firstEvidence.file);
console.log(
  `[reservation-smoke-retry] final: ${secondExit === 0 ? "PASS (flaky — passed on retry)" : "FAIL (reproduced twice — treat as real)"} (${secondEvidence?.file ?? "no evidence file"})`,
);
process.exit(secondExit);

import assert from "node:assert/strict";
import {
  CHECK_STATUS,
  runReleaseGateChecks,
  buildReport,
  formatReport,
} from "../../scripts/lib/agent-ui-release-gate-core.mjs";

// Stubbed checks: the orchestration is proven without any live infra.
function stub(name, outcome) {
  return { name, title: name, category: "local", run: async () => outcome };
}

// --- pass / fail / skipped are each reported and counted -----------------
{
  const report = await runReleaseGateChecks([
    stub("build", { status: CHECK_STATUS.PASS, reason: "ok" }),
    stub("unit", { status: CHECK_STATUS.PASS }),
    stub("migrations", { status: CHECK_STATUS.SKIPPED, reason: "no DATABASE_URL" }),
    stub("parity", { status: CHECK_STATUS.FAIL, reason: "sha mismatch" }),
  ]);
  assert.equal(report.summary.total, 4);
  assert.equal(report.summary.passed, 2);
  assert.equal(report.summary.skipped, 1);
  assert.equal(report.summary.failed, 1);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  // order is preserved and each check is present
  assert.deepEqual(report.results.map((r) => r.name), ["build", "unit", "migrations", "parity"]);
  const skipped = report.results.find((r) => r.name === "migrations");
  assert.equal(skipped.status, "skipped");
  assert.equal(skipped.reason, "no DATABASE_URL");
}

// --- all pass / skipped → green, exit 0 (skips never fail the gate) ------
{
  const report = await runReleaseGateChecks([
    stub("build", { status: CHECK_STATUS.PASS }),
    stub("live-check", { status: CHECK_STATUS.SKIPPED, reason: "no target base url" }),
  ]);
  assert.equal(report.ok, true);
  assert.equal(report.exitCode, 0);
  assert.equal(report.summary.failed, 0);
  assert.equal(report.summary.skipped, 1);
}

// --- a throwing check becomes a FAIL, never a silent pass ----------------
{
  const report = await runReleaseGateChecks([
    { name: "boom", title: "boom", run: async () => { throw new Error("kaboom"); } },
  ]);
  assert.equal(report.results[0].status, "fail");
  assert.match(report.results[0].reason, /kaboom/);
  assert.equal(report.exitCode, 1);
}

// --- SKIPPED without a reason is rejected (would be a silent pass) -------
{
  const report = await runReleaseGateChecks([
    stub("sneaky", { status: CHECK_STATUS.SKIPPED }),
  ]);
  assert.equal(report.results[0].status, "fail");
  assert.match(report.results[0].reason, /without a reason/);
  assert.equal(report.exitCode, 1);
}

// --- an invalid/unknown status is a FAIL (defensive) --------------------
{
  const report = await runReleaseGateChecks([
    stub("weird", { status: "maybe" }),
  ]);
  assert.equal(report.results[0].status, "fail");
  assert.equal(report.exitCode, 1);
}

// --- logger is invoked once per check, in order --------------------------
{
  const seen = [];
  await runReleaseGateChecks(
    [stub("a", { status: CHECK_STATUS.PASS }), stub("b", { status: CHECK_STATUS.SKIPPED, reason: "x" })],
    { logger: (result) => seen.push(result.name) },
  );
  assert.deepEqual(seen, ["a", "b"]);
}

// --- buildReport / formatReport are consistent with the run report -------
{
  const results = [
    { name: "build", title: "pnpm build", category: "local", status: "pass", reason: null, detail: null, durationMs: 1 },
    { name: "mig", title: "migrations", category: "live", status: "skipped", reason: "no DATABASE_URL", durationMs: 0 },
  ];
  const report = buildReport(results);
  assert.equal(report.ok, true);
  assert.equal(report.summary.skipped, 1);
  const text = formatReport(report);
  assert.match(text, /\[PASS\] pnpm build/);
  assert.match(text, /\[SKIP\] migrations \(live\) — no DATABASE_URL/);
  assert.match(text, /GATE: GREEN/);
}

console.log("agent-ui-release-gate.test.mjs OK");

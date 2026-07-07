// Deterministic release-gate orchestration core.
//
// Pure, infra-free orchestration so it can be unit-tested with stubbed check
// functions. The CLI (scripts/agent-ui-release-gate.mjs) supplies the real
// checks; this module only runs them in order, normalizes each outcome, and
// decides pass/fail/skip + the process exit code.
//
// Contract for a check:
//   { name, title?, category?, run: async () => ({ status, reason?, detail? }) }
// A check MUST resolve to one of PASS / FAIL / SKIPPED. A throw is treated as a
// FAIL (never a silent pass). A SKIPPED check must carry a reason — this module
// enforces that so no check can be silently dropped from the gate.

export const CHECK_STATUS = Object.freeze({
  PASS: "pass",
  FAIL: "fail",
  SKIPPED: "skipped",
});

// Redact the password in a credentialed connection string (postgres://user:pass@…
// and other userinfo URLs) before it reaches a log line or the persisted evidence
// file. Defense-in-depth: the migration runner already keeps credentials out of
// argv, but any captured output still passes through this scrubber.
const CONNECTION_STRING_CREDENTIAL_PATTERN = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):[^\s/@]+@/gi;

export function scrubCredentials(value) {
  if (typeof value !== "string") return value;
  return value.replace(CONNECTION_STRING_CREDENTIAL_PATTERN, "$1:***@");
}

const VALID_STATUSES = new Set(Object.values(CHECK_STATUS));

function normalizeOutcome(outcome) {
  const status = outcome && typeof outcome === "object" ? outcome.status : undefined;
  if (!VALID_STATUSES.has(status)) {
    return { status: CHECK_STATUS.FAIL, reason: `Check returned an invalid status: ${JSON.stringify(status)}`, detail: null };
  }
  const reason = outcome.reason ?? null;
  if (status === CHECK_STATUS.SKIPPED && !reason) {
    // A skip with no reason would be indistinguishable from a silent pass; that
    // is exactly the failure mode the gate exists to prevent.
    return { status: CHECK_STATUS.FAIL, reason: "Check reported SKIPPED without a reason (skips must be explained).", detail: outcome.detail ?? null };
  }
  return { status, reason, detail: outcome.detail ?? null };
}

/**
 * Run gate checks in order and return a structured report. Never throws for a
 * failing/throwing check — it is captured as a FAIL result so every check is
 * always accounted for.
 */
export async function runReleaseGateChecks(checks, options = {}) {
  const logger = typeof options.logger === "function" ? options.logger : null;
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const results = [];

  for (const check of checks) {
    const startedAt = now();
    let outcome;
    try {
      outcome = await check.run();
    } catch (error) {
      outcome = { status: CHECK_STATUS.FAIL, reason: error instanceof Error ? error.message : String(error) };
    }
    const normalized = normalizeOutcome(outcome);
    const result = {
      name: check.name,
      title: check.title ?? check.name,
      category: check.category ?? "local",
      status: normalized.status,
      reason: normalized.reason,
      detail: normalized.detail,
      durationMs: now() - startedAt,
    };
    results.push(result);
    logger?.(result);
  }

  return buildReport(results);
}

export function buildReport(results) {
  const summary = { total: results.length, passed: 0, failed: 0, skipped: 0 };
  for (const result of results) {
    if (result.status === CHECK_STATUS.PASS) summary.passed += 1;
    else if (result.status === CHECK_STATUS.FAIL) summary.failed += 1;
    else if (result.status === CHECK_STATUS.SKIPPED) summary.skipped += 1;
  }
  // Skips never fail the gate, but they are always reported. Only a FAIL fails.
  const ok = summary.failed === 0;
  return { results, summary, ok, exitCode: ok ? 0 : 1 };
}

const STATUS_GLYPH = {
  [CHECK_STATUS.PASS]: "PASS",
  [CHECK_STATUS.FAIL]: "FAIL",
  [CHECK_STATUS.SKIPPED]: "SKIP",
};

export function formatReport(report) {
  const lines = ["", "Agent UI release gate", "====================="];
  for (const result of report.results) {
    const tag = STATUS_GLYPH[result.status] ?? "????";
    const suffix = result.reason ? ` — ${result.reason}` : "";
    lines.push(`[${tag}] ${result.title} (${result.category})${suffix}`);
  }
  const { total, passed, failed, skipped } = report.summary;
  lines.push("---------------------");
  lines.push(`${passed}/${total} passed, ${failed} failed, ${skipped} skipped`);
  lines.push(report.ok ? "GATE: GREEN" : "GATE: RED");
  lines.push("");
  return lines.join("\n");
}

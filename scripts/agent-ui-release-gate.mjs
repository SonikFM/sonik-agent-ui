#!/usr/bin/env node
// Agent UI production release gate.
//
// A single deterministic runner that composes the existing checks — build, unit
// tests, embed smoke, run-reattach smoke (Phase 1), booking Pipe-B smokes — plus
// deploy-time checks: postgres migration state, deployed-commit parity, the
// shared host-context secret's presence, and a run persistence + reattach
// assertion against a target environment.
//
// Every check reports PASS, FAIL, or SKIPPED. A check that needs infra/env it
// was not given reports SKIPPED with a reason — never a silent pass. The process
// exits non-zero if any check FAILS (skips do not fail the gate).
//
// See docs/release-gate.md for env vars and what each check proves.
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHECK_STATUS, runReleaseGateChecks, formatReport, scrubCredentials } from "./lib/agent-ui-release-gate-core.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runId = process.env.AGENT_UI_GATE_RUN_ID ?? `agent-ui-release-gate-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const evidencePath = path.join(repoRoot, ".omx", "logs", `${runId}.json`);
const skipSet = new Set(
  (process.env.AGENT_UI_GATE_SKIP ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean),
);

function pass(reason, detail) {
  return { status: CHECK_STATUS.PASS, reason: reason ?? null, detail: detail ?? null };
}
function fail(reason, detail) {
  return { status: CHECK_STATUS.FAIL, reason, detail: detail ?? null };
}
function skip(reason, detail) {
  return { status: CHECK_STATUS.SKIPPED, reason, detail: detail ?? null };
}

// Run a command, resolving to a PASS/FAIL outcome from its exit code. Keeps a
// bounded tail of combined output for the evidence file (never the full log).
function runCommand(command, args, { env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: repoRoot, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    const append = (chunk) => {
      tail = scrubCredentials(`${tail}${chunk}`).slice(-4000);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", (error) => resolve(fail(`spawn failed: ${error.message}`)));
    child.on("close", (code) => {
      if (code === 0) return resolve(pass(`${command} ${args.join(" ")}`, { tail: tail.trim().slice(-1200) }));
      resolve(fail(`${command} ${args.join(" ")} exited ${code}`, { tail: tail.trim().slice(-1200) }));
    });
  });
}

// Wrap a check so `AGENT_UI_GATE_SKIP=<name>` reports it as an explicit skip
// (with a reason) rather than silently dropping it.
function skippable(check) {
  if (!skipSet.has(check.name)) return check;
  return { ...check, run: async () => skip("explicitly skipped via AGENT_UI_GATE_SKIP") };
}

// --- deploy-time check helpers ------------------------------------------

const SHA_HEADER_CANDIDATES = ["x-commit-sha", "x-commit", "x-git-sha", "x-sonik-commit", "x-version"];
const SHA_JSON_CANDIDATES = ["commit", "sha", "gitSha", "git_sha", "commitSha", "version"];

function shaMatches(actual, expected) {
  if (!actual || !expected) return false;
  const a = actual.toLowerCase();
  const b = expected.toLowerCase();
  return a === b || a.startsWith(b) || b.startsWith(a);
}

async function checkDeployedCommit({ url, expectedSha }) {
  let response;
  try {
    response = await fetch(url, { headers: { accept: "application/json" } });
  } catch (error) {
    return fail(`could not reach ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (const header of SHA_HEADER_CANDIDATES) {
    const value = response.headers.get(header);
    if (value && shaMatches(value, expectedSha)) return pass(`header ${header} matches ${expectedSha}`);
    if (value && !shaMatches(value, expectedSha)) return fail(`deployed sha ${value} != expected ${expectedSha} (header ${header})`);
  }
  let body = null;
  try {
    body = await response.clone().json();
  } catch {
    body = null;
  }
  if (body && typeof body === "object") {
    for (const key of SHA_JSON_CANDIDATES) {
      const value = body[key];
      if (typeof value === "string" && value) {
        return shaMatches(value, expectedSha) ? pass(`body.${key} matches ${expectedSha}`) : fail(`deployed sha ${value} != expected ${expectedSha} (body.${key})`);
      }
    }
  }
  return fail(`no commit sha found at ${url} (checked headers ${SHA_HEADER_CANDIDATES.join("/")} and body keys ${SHA_JSON_CANDIDATES.join("/")})`);
}

function deployedCommitCheck({ name, title, urlEnv, shaEnv }) {
  return {
    name,
    title,
    category: "deploy",
    run: async () => {
      const url = process.env[urlEnv];
      const expectedSha = process.env[shaEnv];
      if (!url || !expectedSha) return skip(`set ${urlEnv} and ${shaEnv} to verify deployed-commit parity`);
      return checkDeployedCommit({ url, expectedSha });
    },
  };
}

// --- check registry ------------------------------------------------------

const checks = [
  // Composed local checks (each spawns its own dev server on the fixed dev port).
  // The run-reattach smoke runs before the embed smoke so it always starts from a
  // free port and its own fresh server, rather than racing the embed smoke's
  // teardown on the shared port.
  { name: "build", title: "pnpm build", category: "local", run: () => runCommand("pnpm", ["build"]) },
  { name: "unit", title: "pnpm test (unit suite)", category: "local", run: () => runCommand("pnpm", ["test"]) },
  {
    name: "run-reattach-smoke",
    title: "Run persistence + reattach smoke (local dev server)",
    category: "local",
    run: () => runCommand("pnpm", ["smoke:agent-ui:run-reattach"]),
  },
  {
    name: "embed-smoke",
    title: "Agent UI embed smoke",
    category: "local",
    run: () => runCommand("pnpm", ["smoke:agent-ui:embed"], { env: { AGENT_UI_EMBED_SMOKE_REAL_MODEL: "false" } }),
  },

  // Booking Pipe-B smokes need deployed workers + test credentials, so they are
  // skipped (reported) unless creds are supplied.
  {
    name: "booking-pipeb-document",
    title: "Booking Pipe-B document smoke",
    category: "live",
    run: () => {
      if (!process.env.TEST_EMAIL || !process.env.TEST_PASSWORD) return skip("set TEST_EMAIL/TEST_PASSWORD (and BOOKING_URL) to run the deployed booking Pipe-B document smoke");
      return runCommand("pnpm", ["smoke:agent-ui:booking-pipeb:document"]);
    },
  },
  {
    name: "booking-pipeb-reservation",
    title: "Booking Pipe-B reservation smoke",
    category: "live",
    run: () => {
      const hasCreds = (process.env.TEST_EMAIL && process.env.TEST_PASSWORD) || process.env.AGENT_UI_BOOKING_RESERVATION_USE_FAKE_HOST === "1";
      if (!hasCreds) return skip("set TEST_EMAIL/TEST_PASSWORD (or AGENT_UI_BOOKING_RESERVATION_USE_FAKE_HOST=1) to run the deployed booking Pipe-B reservation smoke");
      return runCommand("pnpm", ["smoke:agent-ui:booking-pipeb:reservation"]);
    },
  },

  // Postgres migration state against a provided DATABASE_URL. Applies 0003/0004
  // (and any later migrations) via the existing runner when explicitly asked;
  // otherwise verify-only (dry-run) and report.
  {
    name: "migrations",
    title: "Postgres migrations up-to-date",
    category: "live",
    run: () => {
      if (!process.env.DATABASE_URL) return skip("set DATABASE_URL to verify/apply postgres migrations");
      const apply = process.env.AGENT_UI_GATE_APPLY_MIGRATIONS === "1";
      return runCommand("pnpm", [apply ? "db:migrate" : "db:migrate:dry-run"]);
    },
  },

  // Deployed-commit parity for each surface.
  deployedCommitCheck({ name: "commit-parity-agent-ui", title: "Deployed commit parity — Agent UI worker", urlEnv: "AGENT_UI_GATE_AGENT_UI_URL", shaEnv: "AGENT_UI_GATE_AGENT_UI_SHA" }),
  deployedCommitCheck({ name: "commit-parity-booking-app", title: "Deployed commit parity — booking app", urlEnv: "AGENT_UI_GATE_BOOKING_APP_URL", shaEnv: "AGENT_UI_GATE_BOOKING_APP_SHA" }),
  deployedCommitCheck({ name: "commit-parity-booking-service", title: "Deployed commit parity — booking service", urlEnv: "AGENT_UI_GATE_BOOKING_SERVICE_URL", shaEnv: "AGENT_UI_GATE_BOOKING_SERVICE_SHA" }),

  // Shared host-context secret presence. Never prints the value — only whether
  // it is set and its length, which is enough to catch a missing/blank secret.
  {
    name: "host-context-secret",
    title: "Shared host-context secret present",
    category: "deploy",
    run: async () => {
      const secret = process.env.SONIK_AGENT_UI_HOST_CONTEXT_SECRET;
      if (!secret) return skip("SONIK_AGENT_UI_HOST_CONTEXT_SECRET not set (deploy-time secret; export it to verify presence)");
      if (secret.trim().length === 0) return fail("SONIK_AGENT_UI_HOST_CONTEXT_SECRET is set but blank");
      return pass(`present (length ${secret.length})`);
    },
  },

  // Run persistence + reattach against a target (deployed) environment.
  {
    name: "run-persistence-target",
    title: "Run persistence + reattach against target environment",
    category: "live",
    run: () => {
      const targetBaseUrl = process.env.AGENT_UI_GATE_TARGET_BASE_URL;
      if (!targetBaseUrl) return skip("set AGENT_UI_GATE_TARGET_BASE_URL to assert run persistence + reattach against a deployed environment");
      return runCommand("pnpm", ["smoke:agent-ui:run-reattach"], {
        env: { AGENT_UI_BASE_URL: targetBaseUrl, AGENT_UI_SMOKE_START_SERVER: "false" },
      });
    },
  },
].map(skippable);

async function main() {
  const report = await runReleaseGateChecks(checks, {
    logger: (result) => {
      const tag = result.status === CHECK_STATUS.PASS ? "PASS" : result.status === CHECK_STATUS.FAIL ? "FAIL" : "SKIP";
      console.log(`[gate] ${tag} ${result.title}${result.reason ? ` — ${result.reason}` : ""}`);
    },
  });

  await mkdir(path.dirname(evidencePath), { recursive: true });
  // Final scrub: no credentialed connection string ever reaches the on-disk
  // evidence file, regardless of which check produced the captured output.
  await writeFile(
    evidencePath,
    scrubCredentials(JSON.stringify({ schemaVersion: "sonik.agent_ui.release_gate.v1", runId, finishedAt: new Date().toISOString(), ...report }, null, 2)),
  );

  console.log(formatReport(report));
  console.log(`[gate] evidence: ${evidencePath}`);
  process.exit(report.exitCode);
}

main().catch((error) => {
  console.error(`[gate] fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exit(1);
});

// Best-effort Pipe-B (sonik-dev-observability-pipe-b) tail correlation for
// the persona harness, following the same `wrangler tail --format json`
// pattern scripts/agent-ui-booking-context-pipeb-smoke.mjs already uses for
// its Playwright-driven smoke run. This harness has no browser and drives
// many short-lived conversations back to back, so instead of one tail per
// conversation, a single tail spans the whole persona batch and lines are
// correlated per-run at finalize time by sessionId/runId substring match.

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export function pipeBLogPaths(repoRoot, batchId) {
  const dir = path.join(repoRoot, ".omx", "logs", "persona-runs");
  return {
    dir,
    logPath: path.join(dir, `${batchId}.pipe-b.jsonl`),
    stderrPath: path.join(dir, `${batchId}.pipe-b.stderr.log`),
    pidPath: path.join(dir, `${batchId}.pipe-b.pid`),
  };
}

export async function startPipeBTail(repoRoot, batchId, { worker = "sonik-dev-observability-pipe-b" } = {}) {
  const { dir, logPath, stderrPath, pidPath } = pipeBLogPaths(repoRoot, batchId);
  await mkdir(dir, { recursive: true });
  const stdoutStream = createWriteStream(logPath, { flags: "a" });
  const stderrStream = createWriteStream(stderrPath, { flags: "a" });
  const child = spawn("pnpm", ["-C", "apps/standalone-sveltekit", "exec", "wrangler", "tail", worker, "--format", "json"], {
    cwd: repoRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  child.stdout.pipe(stdoutStream);
  child.stderr.pipe(stderrStream);
  child.unref();
  const { writeFile } = await import("node:fs/promises");
  await writeFile(pidPath, String(child.pid));
  return { pid: child.pid, logPath, stderrPath };
}

export async function stopPipeBTail(repoRoot, batchId) {
  const { pidPath } = pipeBLogPaths(repoRoot, batchId);
  const pidText = await readFile(pidPath, "utf8").catch(() => null);
  if (!pidText) return { stopped: false, reason: "no pid file (tail was not started, or already stopped)" };
  const pid = Number(pidText.trim());
  try {
    process.kill(pid, "SIGTERM");
    return { stopped: true, pid };
  } catch (error) {
    return { stopped: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Read the tail log (if any) and return raw lines mentioning any of `markers`. */
export async function correlatePipeBEvidence(repoRoot, batchId, markers) {
  const { logPath } = pipeBLogPaths(repoRoot, batchId);
  const exists = await stat(logPath).catch(() => null);
  if (!exists) {
    return { attempted: false, available: false, note: "Pipe-B tail log not found for this batch — tail was not started or produced no output." };
  }
  const text = await readFile(logPath, "utf8").catch(() => "");
  if (!text) {
    return { attempted: true, available: false, note: "Pipe-B tail log is empty (no events captured before finalize)." };
  }
  const matchingLines = text
    .split("\n")
    .filter((line) => line && markers.some((marker) => marker && line.includes(marker)))
    .slice(-100);
  return {
    attempted: true,
    available: true,
    logPath,
    markers,
    matchingLineCount: matchingLines.length,
    sample: matchingLines.slice(-20),
  };
}

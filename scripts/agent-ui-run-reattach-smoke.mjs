#!/usr/bin/env node
// Run-lifecycle reattach smoke (HTTP-only, no browser).
//
// Proves Phase 1 end-to-end against a running dev server:
//   1. An interrupted agent turn (dev-smoke fail injection) persists a run that
//      finalizes failed + resumable + AGENT_STREAM_FAILED, with partial text.
//   2. Reloading the session (GET /api/session/:id) reattaches that run: a
//      rebuilt assistant message from the persisted event log + a resumable run.
//   3. Continue (a fresh turn) completes a new run that finalizes succeeded.
//   4. A client-aborted turn persists a canceled + resumable run, then Continue
//      completes a fresh run.
//
// Requires dev mode (dev-smoke stream is gated on `dev`). Start a server first
// or let this script spawn `pnpm --filter svelte-chat dev`.
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = process.env.AGENT_UI_BASE_URL ?? "http://localhost:5173";
const startServer = process.env.AGENT_UI_SMOKE_START_SERVER !== "false";
const runId = process.env.AGENT_UI_SMOKE_RUN_ID ?? `run-reattach-smoke-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const sessionId = `${runId}-session`;
const abortSessionId = `${runId}-abort-session`;
const evidencePath = path.join(repoRoot, ".omx", "logs", `${runId}.json`);

const children = [];
const evidence = { schemaVersion: "sonik.agent_ui.run_reattach.v1", runId, sessionId, baseUrl, status: "INCONCLUSIVE", steps: [], errors: [] };

const SMOKE_HEADERS = {
  "content-type": "application/json",
  "x-sonik-agent-ui-smoke-stream": "true",
};

function step(name, detail = {}) {
  evidence.steps.push({ at: new Date().toISOString(), name, ...detail });
  console.log(`[run-reattach] ${name}${detail.note ? `: ${detail.note}` : ""}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function finish(status, reason, exitCode) {
  evidence.status = status;
  evidence.reason = reason;
  evidence.finishedAt = new Date().toISOString();
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
  for (const child of children.reverse()) {
    if (child.exitCode === null && !child.signalCode) child.kill("SIGTERM");
  }
  console.log(JSON.stringify({ status, reason, evidencePath }, null, 2));
  process.exit(exitCode ?? (status === "PASS" ? 0 : 1));
}

async function isReachable(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1_500);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok || response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function ensureServer() {
  if (await isReachable(baseUrl)) {
    step("server.reused", { note: baseUrl });
    return true;
  }
  if (!startServer) return false;
  step("server.start", { note: "pnpm --filter svelte-chat dev" });
  const child = spawn("pnpm", ["--filter", "svelte-chat", "dev"], { cwd: repoRoot, env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  child.stdout.on("data", (chunk) => { if (/Local:|localhost:5173/.test(String(chunk))) step("server.stdout", { note: String(chunk).trim().slice(0, 120) }); });
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await isReachable(baseUrl)) return true;
    await sleep(1_000);
  }
  return false;
}

async function drain(response) {
  if (!response.body) return;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
  } catch {
    // An interrupted/failed stream surfaces as a read error; that is the point.
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}

async function postGenerate({ text, fail, sessionId: targetSessionId = sessionId, abortAfterFirstChunk = false }) {
  const headers = { ...SMOKE_HEADERS };
  if (fail) headers["x-sonik-agent-ui-smoke-fail"] = "true";
  const body = JSON.stringify({
    messages: [{ id: `msg-${Date.now()}`, role: "user", parts: [{ type: "text", text }] }],
    workspace: { sessionId: targetSessionId },
  });
  const response = await fetch(`${baseUrl}/api/generate`, { method: "POST", headers, body });
  const runIdHeader = response.headers.get("x-sonik-agent-ui-run-id");
  if (abortAfterFirstChunk) {
    if (response.body) {
      const reader = response.body.getReader();
      try {
        await reader.read();
        await reader.cancel("client-abort-smoke");
      } finally {
        try { reader.releaseLock(); } catch { /* already released */ }
      }
    }
    return { status: response.status, runIdHeader };
  }
  await drain(response);
  return { status: response.status, runIdHeader };
}

async function getSession(targetSessionId = sessionId) {
  const response = await fetch(`${baseUrl}/api/session/${encodeURIComponent(targetSessionId)}`);
  if (!response.ok) return null;
  return response.json();
}

async function pollSession(predicate, { targetSessionId = sessionId, attempts = 30, intervalMs = 200 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    const detail = await getSession(targetSessionId);
    if (detail && predicate(detail)) return detail;
    await sleep(intervalMs);
  }
  return null;
}

async function main() {
  if (!(await ensureServer())) return finish("INCONCLUSIVE", `Dev server not reachable at ${baseUrl}`);

  // 1. Interrupt a turn mid-stream (deterministic fail injection).
  const interrupt = await postGenerate({ text: "Build me a dashboard", fail: true });
  step("interrupt.posted", { note: `status ${interrupt.status}, runId ${interrupt.runIdHeader ?? "none"}` });
  if (!interrupt.runIdHeader) return finish("FAIL", "Generate did not return a run id header; run persistence did not start.");

  // 2. Reload the session and assert reattach of the failed, resumable run.
  const failedDetail = await pollSession((detail) => Array.isArray(detail.runs) && detail.runs.some((run) => run.status === "failed"));
  if (!failedDetail) return finish("FAIL", "Interrupted run never persisted a failed status.");
  const reattach = failedDetail.reattach;
  evidence.reattach = reattach;
  if (!reattach?.run || reattach.run.status !== "failed") return finish("FAIL", "Session did not reattach a failed run.");
  if (!reattach.run.resumable) return finish("FAIL", "Interrupted run was not marked resumable.");
  if (reattach.run.error_code !== "AGENT_STREAM_FAILED") return finish("FAIL", `Unexpected error_code ${reattach.run.error_code}.`);
  const reattachText = JSON.stringify(reattach.message?.parts ?? []);
  if (!reattach.message || !reattachText.includes("Partial answer")) return finish("FAIL", "Reattached message did not rebuild the partial streamed text from the event log.");
  step("reattach.verified", { note: `failed+resumable run ${reattach.run.id} rebuilt with partial text` });

  // 3. Continue: a fresh turn that completes a new run.
  const cont = await postGenerate({ text: "Continue the previous turn.", fail: false });
  step("continue.posted", { note: `status ${cont.status}, runId ${cont.runIdHeader ?? "none"}` });
  const succeededDetail = await pollSession((detail) => Array.isArray(detail.runs) && detail.runs.length >= 2 && detail.runs.at(-1)?.status === "succeeded");
  if (!succeededDetail) return finish("FAIL", "Continue did not complete a succeeded run.");
  evidence.runs = succeededDetail.runs;
  const latest = succeededDetail.runs.at(-1);
  if (latest.status !== "succeeded") return finish("FAIL", `Latest run status ${latest.status}, expected succeeded.`);
  step("continue.verified", { note: `${succeededDetail.runs.length} runs; latest succeeded` });

  // 4. Client abort: cancel the response body mid-stream and assert the run is
  // canceled + resumable, then Continue completes a fresh run.
  const clientAbort = await postGenerate({ text: "Start a long answer that I will stop.", fail: false, sessionId: abortSessionId, abortAfterFirstChunk: true });
  step("client_abort.posted", { note: `status ${clientAbort.status}, runId ${clientAbort.runIdHeader ?? "none"}` });
  if (!clientAbort.runIdHeader) return finish("FAIL", "Client-abort generate did not return a run id header.");

  const canceledDetail = await pollSession(
    (detail) => Array.isArray(detail.runs) && detail.runs.some((run) => run.status === "canceled"),
    { targetSessionId: abortSessionId },
  );
  if (!canceledDetail) return finish("FAIL", "Client-aborted run never persisted a canceled status.");
  const abortedReattach = canceledDetail.reattach;
  evidence.clientAbort = abortedReattach;
  if (!abortedReattach?.run || abortedReattach.run.status !== "canceled") return finish("FAIL", "Client-aborted session did not expose a canceled latest run.");
  if (!abortedReattach.run.resumable) return finish("FAIL", "Client-aborted run was not marked resumable.");
  if (abortedReattach.run.error_code !== "AGENT_STREAM_FAILED") return finish("FAIL", `Unexpected client-abort error_code ${abortedReattach.run.error_code}.`);
  step("client_abort.verified", { note: `canceled+resumable run ${abortedReattach.run.id}` });

  const abortContinue = await postGenerate({ text: "Continue the previous turn.", fail: false, sessionId: abortSessionId });
  step("client_abort_continue.posted", { note: `status ${abortContinue.status}, runId ${abortContinue.runIdHeader ?? "none"}` });
  const abortContinueDetail = await pollSession(
    (detail) => Array.isArray(detail.runs) && detail.runs.length >= 2 && detail.runs.at(-1)?.status === "succeeded",
    { targetSessionId: abortSessionId },
  );
  if (!abortContinueDetail) return finish("FAIL", "Continue after client abort did not complete a succeeded run.");
  step("client_abort_continue.verified", { note: `${abortContinueDetail.runs.length} runs; latest succeeded` });

  return finish("PASS", "Interrupted and client-aborted runs reattached/resumed from persisted events and Continue completed new runs.");
}

main().catch((error) => {
  evidence.errors.push(error instanceof Error ? error.stack ?? error.message : String(error));
  void finish("FAIL", error instanceof Error ? error.message : String(error));
});

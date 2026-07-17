#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  VISUAL_CONTEXT_PATH,
  isStaleVisualContextResult,
  validateVisualContextPng,
  visualContextSnapshotFromResult,
} from "../apps/dev-workbench/src/lib/server/visual-context-coordinator.ts";
import {
  visualBrowserStateFromResult,
  visualBrowserStateSchema,
} from "../apps/dev-workbench/src/lib/contracts/workbench.ts";
import {
  startVisualContextPreviewFixture,
  visualBrowserStateFixtures,
} from "../tests/fixtures/visual-context-preview-fixture.mjs";

const provider = "apps/dev-workbench/scripts/capture-visual-context.mjs";
const requestId = `sandbox-smoke-${randomUUID()}`;
const outputRoot = "/vercel/sandbox/workspace/.sonik/screenshots/requests";
const outputPaths = [];
const fixture = await startVisualContextPreviewFixture();
const missingBrowserRoot = await mkdtemp(join(tmpdir(), "sonik-missing-browser-"));

try {
  await mkdir(outputRoot, { recursive: true });
  for (const state of Object.values(visualBrowserStateFixtures)) visualBrowserStateSchema.parse(state);
  const visibleIframeHtml = await (await fetch(`${fixture.origin}${fixture.route}`)).text();
  assert.match(visibleIframeHtml, /fresh-navigation-1/, "fixture seeds the already-visible iframe state");

  const missingCapability = await runProvider(request("missing-capability", {
    operation: "get-capabilities",
    provider: undefined,
  }), { PLAYWRIGHT_BROWSERS_PATH: missingBrowserRoot });
  assert.equal(visualBrowserStateFromResult(missingCapability).capability, "missing");
  assert.equal(missingCapability.screenshot, undefined);

  const capability = await runProvider(request("capability", {
    operation: "get-capabilities",
    provider: undefined,
  }));
  assert.equal(capability.status, "completed");
  assert.equal(capability.capabilities.find(({ operation }) => operation === "capture").status, "available");
  assert.equal(capability.screenshot, undefined);

  const setup = await runProvider(request("setup", { operation: "setup-browser" }));
  assert.ok(["completed", "failed"].includes(setup.status), "setup returns a controlled terminal state");
  if (setup.status === "failed") assert.ok(setup.disabledReason);
  assert.equal(setup.screenshot, undefined);

  const stable = await runProvider(request("stable", {
    targetId: "reservation.card",
    targetInstanceId: "primary",
  }));
  assert.equal(stable.status, "completed");
  assert.equal(stable.selectionResolution, "stable-target");
  assert.equal(stable.screenshot.provider, "playwright");
  assert.equal(stable.screenshot.fidelity, "controlled-preview");
  assert.equal(stable.screenshot.captureBasis, "fresh-playwright-navigation");
  assert.equal(stable.screenshot.temporaryPath, `${outputRoot}/${stable.requestId}.png`);
  assert.match(stable.ariaSnapshot, /Primary reservation/);
  assert.doesNotMatch(stable.ariaSnapshot, /never-emit|secret_password|access_token/i);

  const png = await readFile(stable.screenshot.temporaryPath);
  validateVisualContextPng(png, stable);
  assert.throws(() => validateVisualContextPng(Buffer.from("not-png"), stable), /byte length|PNG/);
  assert.throws(() => validateVisualContextPng(Buffer.alloc(10 * 1024 * 1024 + 1), stable), /byte length/);
  assert.equal(createHash("sha256").update(png).digest("hex"), stable.screenshot.sha256);
  const manifest = visualContextSnapshotFromResult(stable);
  assert.equal(VISUAL_CONTEXT_PATH, "/vercel/sandbox/workspace/.sonik/visual-context.json");
  assert.equal(manifest.status, "current");
  assert.ok(manifest.generation);
  assert.equal(manifest.screenshot.path, "/vercel/sandbox/workspace/.sonik/screenshots/latest.png");
  assert.equal(manifest.screenshot.sha256, stable.screenshot.sha256);
  assert.equal(JSON.stringify(manifest).includes(stable.screenshot.temporaryPath), false);
  assert.equal(isStaleVisualContextResult(manifest, { ...stable, requestId: `${requestId}-race` }), true);
  assert.equal(isStaleVisualContextResult(manifest, { ...stable, sourceContextRevision: 0 }), true);

  const ephemeral = await runProvider(request("ephemeral", { targetId: "ephemeral:viewport" }));
  assert.equal(ephemeral.status, "completed");
  assert.equal(ephemeral.selectionResolution, "unavailable-in-playwright");
  assert.deepEqual(ephemeral.screenshot.viewport, { width: 960, height: 640, deviceScaleFactor: 1 });
  assert.match(ephemeral.ariaSnapshot, /fresh-navigation-[3-9]/);
  assert.doesNotMatch(ephemeral.ariaSnapshot, /fresh-navigation-1/, "capture comes from a later fresh navigation, not the visible iframe");

  const ambiguous = await runProvider(request("ambiguous", { targetId: "reservation.card" }));
  assert.equal(ambiguous.status, "failed");
  assert.equal(await readFile(`${outputRoot}/${ambiguous.requestId}.png`).catch(() => null), null);

  const publicEvidence = JSON.stringify({ stable, ephemeral, manifest });
  assert.doesNotMatch(publicEvidence, /never-emit|current[- ]iframe|pngBase64|cookie|bearer/i);
  assert.ok(fixture.navigationCount() >= 4, "each capture performs a fresh navigation after the visible iframe fixture");
  console.log(JSON.stringify({
    status: "PASS",
    provider: stable.screenshot.provider,
    fidelity: stable.screenshot.fidelity,
    captureBasis: stable.screenshot.captureBasis,
    selectionResolution: [stable.selectionResolution, ephemeral.selectionResolution],
    generation: manifest.generation,
    sha256: manifest.screenshot.sha256,
    visualContextPath: VISUAL_CONTEXT_PATH,
    capability: visualBrowserStateFromResult(capability),
    setup: setup.status,
    browserStates: Object.keys(visualBrowserStateFixtures),
  }, null, 2));
} finally {
  await fixture.close();
  await Promise.all(outputPaths.map((path) => rm(path, { force: true })));
  await rm(missingBrowserRoot, { recursive: true, force: true });
}

function request(suffix, extra = {}) {
  return {
    requestId: `${requestId}-${suffix}`,
    operation: "capture",
    sourceContextRevision: 1,
    routeRevision: 1,
    source: { id: "preview", label: "Preview", surface: "sandbox-preview", route: fixture.route },
    provider: "playwright",
    messageSource: "sonik-agent-ui",
    type: "sonik:visual-context:request",
    version: "sonik.visual-context.v1",
    origin: "https://workbench.example.com",
    viewport: { width: 960, height: 640, deviceScaleFactor: 1 },
    ...extra,
  };
}

async function runProvider(input, extraEnv = {}) {
  const path = `${outputRoot}/${input.requestId}.png`;
  if (input.operation === "capture") outputPaths.push(path);
  const child = spawn(process.execPath, [provider], {
    env: {
      ...process.env,
      ...(input.operation === "capture" ? { SONIK_VISUAL_CONTEXT_PREVIEW_URL: fixture.origin } : {}),
      ...extraEnv,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end(JSON.stringify(input));
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  assert.equal(code, 0, Buffer.concat(stderr).toString("utf8"));
  return JSON.parse(Buffer.concat(stdout).toString("utf8"));
}

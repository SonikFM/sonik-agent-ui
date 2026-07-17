import assert from "node:assert/strict";
import {
  PLAYWRIGHT_VISUAL_CONTEXT_SCRIPT,
  capturePlaywrightVisualContext,
  playwrightVisualContextPaths,
} from "../../apps/dev-workbench/src/lib/server/playwright-preview-capture.ts";
import { probeBrowserCapabilities, setupBrowser } from "../../apps/dev-workbench/scripts/capture-visual-context.mjs";

const request = {
  requestId: "capture-1",
  operation: "capture",
  sourceContextRevision: 1,
  routeRevision: 2,
  source: { id: "preview", label: "Preview", surface: "sandbox-preview", route: "/reservations" },
  provider: "playwright",
  messageSource: "sonik-agent-ui",
  type: "sonik:visual-context:request",
  version: "sonik.visual-context.v1",
  origin: "https://workbench.example.com",
  targetId: "reservation.form",
  targetInstanceId: "primary",
  viewport: { width: 1200, height: 800, deviceScaleFactor: 2 },
};
const paths = playwrightVisualContextPaths(request.requestId);
const result = {
  ...request,
  messageSource: "sonik-agent-host",
  type: "sonik:visual-context:result",
  status: "completed",
  selectionResolution: "stable-target",
  ariaSnapshot: "- form Reservation",
  screenshot: {
    mime: "image/png", width: 600, height: 400, bytes: 24, sha256: "a".repeat(64), provider: "playwright",
    fidelity: "controlled-preview", captureBasis: "fresh-playwright-navigation", viewport: request.viewport,
    redactionsApplied: ["sensitive form fields"], capturedAt: "2026-07-17T12:00:00.000Z", temporaryPath: paths.screenshot,
  },
};
delete result.targetId;
delete result.targetInstanceId;
delete result.viewport;

const commands = [];
const sandbox = {
  async runCommand(command) {
    commands.push(command);
    return command.cmd === "bash" ? { exitCode: 0, async stdout() { return JSON.stringify(result); } } : { exitCode: 0, async stdout() { return ""; } };
  },
};
assert.deepEqual(await capturePlaywrightVisualContext({ sandbox, request, previewUrl: "https://preview.example.com/ignored" }), result);
assert.equal(Buffer.from(commands[0].args[4], "base64").toString("utf8"), JSON.stringify(request));
assert.equal(commands[0].args[3], PLAYWRIGHT_VISUAL_CONTEXT_SCRIPT);
assert.equal(commands.length, 1, "successful operations do not create cleanup metadata");

const failingCommands = [];
await assert.rejects(() => capturePlaywrightVisualContext({
  sandbox: {
    async runCommand(command) {
      failingCommands.push(command);
      return { exitCode: command.cmd === "bash" ? 1 : 0, async stdout() { return ""; } };
    },
  },
  request,
  previewUrl: "https://preview.example.com",
}), /operation failed/);
assert.deepEqual(failingCommands.slice(1).map((command) => command.args), [["-f", paths.screenshot]], "failure removes request-scoped pixels");

for (const operation of ["get-capabilities", "setup-browser"]) {
  const operationRequest = { ...request, requestId: `${operation}-1`, operation };
  if (operation === "get-capabilities") delete operationRequest.provider;
  delete operationRequest.targetId;
  delete operationRequest.targetInstanceId;
  delete operationRequest.viewport;
  const operationResult = {
    ...operationRequest,
    messageSource: "sonik-agent-host",
    type: "sonik:visual-context:result",
    status: "completed",
    ...(operation === "get-capabilities" ? { capabilities: [{ operation: "capture", status: "available", provider: "playwright" }] } : {}),
  };
  const operationCommands = [];
  assert.deepEqual(await capturePlaywrightVisualContext({
    sandbox: { async runCommand(command) { operationCommands.push(command); return { exitCode: 0, async stdout() { return JSON.stringify(operationResult); } }; } },
    request: operationRequest,
  }), operationResult);
  assert.equal(operationCommands.length, 1, `${operation} does not create or clean screenshot metadata`);
}

const missingCapabilities = await probeBrowserCapabilities({ chromium: { executablePath: () => "/missing" }, access: async () => { throw new Error("missing"); } });
assert.equal(missingCapabilities[0].status, "unavailable");
assert.match(missingCapabilities[0].disabledReason, /not installed/);
const launchFailedCapabilities = await probeBrowserCapabilities({ chromium: { executablePath: () => "/present", launch: async () => { throw new Error("launch"); } }, access: async () => {} });
assert.equal(launchFailedCapabilities[0].status, "failed");
assert.match(launchFailedCapabilities[0].disabledReason, /could not launch/);
const availableCapabilities = await probeBrowserCapabilities({ chromium: { executablePath: () => "/present", launch: async () => ({ close: async () => {} }) }, access: async () => {} });
assert.equal(availableCapabilities[0].status, "available");

const setupRequest = { ...request, requestId: "setup-browser-result", operation: "setup-browser" };
delete setupRequest.targetId;
delete setupRequest.targetInstanceId;
delete setupRequest.viewport;
const setupSucceeded = await setupBrowser(setupRequest, { install: async () => 0, probe: async () => availableCapabilities });
assert.equal(setupSucceeded.status, "completed");
assert.equal(setupSucceeded.capabilities[0].status, "available");
const setupFailed = await setupBrowser(setupRequest, { install: async () => 1, probe: async () => missingCapabilities });
assert.equal(setupFailed.status, "failed");
assert.equal(setupFailed.capabilities[0].status, "unavailable");

console.log("dev-workbench Playwright visual context provider: ok");

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  VISUAL_CONTEXT_PATH,
  decodeCanonicalBase64,
  invalidatedVisualContextSnapshot,
  isStaleVisualContextResult,
  requestTemporaryPath,
  validateVisualContextPng,
  validateVisualContextSubmission,
  visualContextSnapshotFromResult,
  visualContextSubmissionSchema,
} from "../../apps/dev-workbench/src/lib/server/visual-context-coordinator.ts";
import { createDevWorkbenchBootstrapPlan } from "../../apps/dev-workbench/src/lib/server/bootstrap-plan.ts";
import {
  DEFAULT_REPOSITORY_COMMANDS,
  DEV_WORKBENCH_SCHEMA_VERSION,
  repositoryManifestSchema,
} from "../../apps/dev-workbench/src/lib/contracts/workbench.ts";

const png = Buffer.alloc(24);
Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
png.write("IHDR", 12, "ascii");
png.writeUInt32BE(2, 16);
png.writeUInt32BE(3, 20);
const sha256 = createHash("sha256").update(png).digest("hex");
const request = {
  requestId: "capture-1",
  operation: "capture",
  sourceContextRevision: 4,
  routeRevision: 8,
  source: { id: "preview", label: "Preview", surface: "sandbox-preview", route: "/reservations" },
  provider: "playwright",
  messageSource: "sonik-agent-ui",
  type: "sonik:visual-context:request",
  version: "sonik.visual-context.v1",
  origin: "https://workbench.example.com",
};
const result = {
  ...request,
  messageSource: "sonik-agent-host",
  type: "sonik:visual-context:result",
  status: "completed",
  ariaSnapshot: "- main\n  - heading Reservations",
  selectionResolution: "not-requested",
  screenshot: {
    mime: "image/png",
    width: 2,
    height: 3,
    bytes: png.length,
    sha256,
    provider: "playwright",
    fidelity: "controlled-preview",
    captureBasis: "fresh-playwright-navigation",
    viewport: { width: 2, height: 3, deviceScaleFactor: 1 },
    redactionsApplied: ["sensitive inputs"],
    capturedAt: "2026-07-17T12:00:00.000Z",
    temporaryPath: "/vercel/sandbox/workspace/.sonik/screenshots/requests/capture-1.png",
  },
};
const submission = visualContextSubmissionSchema.parse({ workspaceSessionId: "workspace-1", request, result });
validateVisualContextSubmission(submission);
assert.equal(requestTemporaryPath(result), result.screenshot.temporaryPath);
assert.throws(() => requestTemporaryPath({ ...result, screenshot: { ...result.screenshot, temporaryPath: "/vercel/sandbox/workspace/.sonik/screenshots/requests/other.png" } }), /request id/);
validateVisualContextPng(png, result);
assert.throws(() => validateVisualContextPng(Buffer.from("not png"), result), /byte length|PNG/);
assert.throws(() => validateVisualContextPng(Buffer.from(png).fill(0, 16, 20), result), /dimensions|hash/);
assert.deepEqual(decodeCanonicalBase64(png.toString("base64")), png);
assert.throws(() => decodeCanonicalBase64(`${png.toString("base64")}=`), /canonical/);

const snapshot = visualContextSnapshotFromResult(result);
assert.equal(snapshot.screenshot?.path, "/vercel/sandbox/workspace/.sonik/screenshots/latest.png");
assert.equal(JSON.stringify(snapshot).includes("pngBase64"), false, "stable manifests never persist inline pixels");
assert.equal(JSON.stringify(snapshot).includes("temporaryPath"), false, "stable manifests never disclose request paths");
assert.equal(isStaleVisualContextResult(snapshot, { ...result, requestId: "capture-older", sourceContextRevision: 3 }), true);
assert.equal(isStaleVisualContextResult(snapshot, { ...result, requestId: "capture-race" }), true, "one same-revision request wins the workspace lease");
const invalidated = invalidatedVisualContextSnapshot({
  workspaceSessionId: "workspace-1",
  sourceContextRevision: 5,
  routeRevision: 9,
  source: request.source,
  staleReason: "navigation",
});
assert.equal(invalidated.status, "invalidated");
assert.equal(invalidated.screenshot, null);

const repository = repositoryManifestSchema.parse({
  schemaVersion: DEV_WORKBENCH_SCHEMA_VERSION,
  repositoryId: "sonikfm.sonik-agent-ui",
  cloneUrl: "https://github.com/sonikfm/sonik-agent-ui.git",
  revision: "abc123",
  branch: "main",
  deployment: null,
  commands: DEFAULT_REPOSITORY_COMMANDS,
});
const plan = createDevWorkbenchBootstrapPlan({ sessionId: "workspace-1", repository });
assert.equal(plan.windows.every((window) => window.command.includes(`SONIK_VISUAL_CONTEXT_PATH=${VISUAL_CONTEXT_PATH}`)), true);

const [routeSource, serviceSource, hookSource] = await Promise.all([
  readFile("apps/dev-workbench/src/routes/api/workspaces/visual-context/+server.ts", "utf8"),
  readFile("apps/dev-workbench/src/lib/server/workspace-service.ts", "utf8"),
  readFile("apps/dev-workbench/src/hooks.server.ts", "utf8"),
]);
assert.match(routeSource, /cache-control.*no-store/si, "PNG and JSON responses are not cacheable");
assert.match(routeSource, /DEV_WORKBENCH_SESSION_COOKIE/, "the endpoint requires its authenticated workspace binding");
assert.match(hookSource, /authorizeDevWorkbenchRequest/, "global Basic Auth covers the endpoint");
assert.match(serviceSource, /if mkdir \"\$lease\"/, "lease acquisition uses atomic mkdir rather than an in-memory lock");
assert.match(serviceSource, /sed -n '1p'.*\$owner/s, "only the current lease owner can release it");
assert.match(serviceSource, /mv \"\$manifest\" \"\$stable_manifest\"/, "the manifest is the stable commit marker");
assert.match(serviceSource, /rm -f \"\$stable_png\"/, "invalidation removes latest.png");

console.log("dev-workbench visual context coordinator: ok");

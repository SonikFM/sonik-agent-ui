import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Sandbox } from "../../apps/dev-workbench/node_modules/@vercel/sandbox/dist/index.js";
import {
  VISUAL_CONTEXT_PATH,
  VISUAL_CONTEXT_REQUESTS_PATH,
  createVisualContextLeaseAcquireScript,
  decodeCanonicalBase64,
  consumeVisualContextRequest,
  invalidatedVisualContextSnapshot,
  isStaleVisualContextInvalidation,
  isStaleVisualContextResult,
  isStaleVisualContextSequence,
  issueVisualContextRequest,
  requestTemporaryPath,
  validateVisualContextPng,
  validateVisualContextSubmission,
  visualContextSnapshotFromResult,
  visualContextSubmissionSchema,
} from "../../apps/dev-workbench/src/lib/server/visual-context-coordinator.ts";
import {
  createVisualContextPromotionScript,
  registerWorkspaceVisualContextRequest,
  removeVisualContextTemporaryPath,
  submitWorkspaceVisualContext,
} from "../../apps/dev-workbench/src/lib/server/workspace-service.ts";
import { createDevWorkbenchBootstrapPlan } from "../../apps/dev-workbench/src/lib/server/bootstrap-plan.ts";
import {
  DEFAULT_REPOSITORY_COMMANDS,
  DEV_WORKBENCH_MIRROR_PATHS,
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
assert.equal(isStaleVisualContextResult(snapshot, { ...result, requestId: "capture-repeat" }), false, "a later same-revision capture may refresh the snapshot");
assert.throws(() => validateVisualContextSubmission({
  workspaceSessionId: "workspace-1",
  request: { ...request, provider: "chrome-active-tab" },
  result: {
    ...result,
    provider: "chrome-active-tab",
    screenshot: { ...result.screenshot, provider: "chrome-active-tab", fidelity: "exact-active-tab", captureBasis: "native-active-tab-redacted", temporaryPath: undefined, pngBase64: png.toString("base64") },
  },
}), /attestation/, "host assertions cannot establish exact-active-tab fidelity");
assert.throws(() => validateVisualContextSubmission(visualContextSubmissionSchema.parse({
  workspaceSessionId: "workspace-1",
  request,
  result: {
    ...result,
    provider: "chrome-active-tab",
    screenshot: { ...result.screenshot, provider: "chrome-active-tab", fidelity: "exact-active-tab", captureBasis: "native-active-tab-redacted", temporaryPath: undefined, pngBase64: png.toString("base64") },
  },
})), /attestation/, "an unattested result provider fails closed even when the request claims an allowed provider");
const unattestedSubmissions = ["pair-extension", "unpair-extension", "capture"].map((operation, index) => {
  const unattestedRequest = {
    ...request,
    requestId: `unattested-${index}`,
    operation,
    source: { id: "host", label: "Host · booking.example.test", surface: "embedded-host", route: "/booking" },
    provider: "chrome-active-tab",
  };
  return visualContextSubmissionSchema.parse({
    workspaceSessionId: "workspace-1",
    request: unattestedRequest,
    result: {
      ...unattestedRequest,
      messageSource: "sonik-agent-host",
      type: "sonik:visual-context:result",
      status: "completed",
      ...(operation === "capture" ? {
        selectionResolution: "not-requested",
        screenshot: {
          ...result.screenshot,
          provider: "chrome-active-tab",
          fidelity: "exact-active-tab",
          captureBasis: "native-active-tab-redacted",
          temporaryPath: undefined,
          pngBase64: png.toString("base64"),
        },
      } : {}),
    },
  });
});
for (const unattested of unattestedSubmissions) {
  assert.throws(() => validateVisualContextSubmission(unattested), /attestation/, `${unattested.request.operation} fails closed without server-verifiable attestation`);
}
const hostClearRequest = { ...request, requestId: "host-clear", operation: "clear", source: unattestedSubmissions[0].request.source, provider: "host" };
assert.doesNotThrow(() => validateVisualContextSubmission(visualContextSubmissionSchema.parse({
  workspaceSessionId: "workspace-1",
  request: hostClearRequest,
  result: { ...hostClearRequest, messageSource: "sonik-agent-host", type: "sonik:visual-context:result", status: "completed" },
})), "ordinary Host provider operations remain allowed");
const olderRequest = { ...request, requestId: "older" };
const newerRequest = { ...request, requestId: "newer" };
const issuedFirst = issueVisualContextRequest({ nextSequence: 1, pending: {} }, olderRequest);
const issuedSecond = issueVisualContextRequest(issuedFirst.registry, newerRequest);
const persistedRegistry = JSON.parse(JSON.stringify(issuedSecond.registry));
assert.equal(
  consumeVisualContextRequest(persistedRegistry, { ...newerRequest, routeRevision: 9 }),
  null,
  "a schema-valid same-id mutation is rejected without consuming the exact issuance",
);
assert.deepEqual(persistedRegistry, issuedSecond.registry, "a rejected mutation preserves the sandbox registry for an exact retry");
const consumedSecond = consumeVisualContextRequest(persistedRegistry, newerRequest);
assert.equal(consumedSecond.sequence, 2);
assert.throws(() => consumeVisualContextRequest(consumedSecond.registry, newerRequest), /consumed/, "request issuance is one-time");
const orderedSnapshot = visualContextSnapshotFromResult({ ...result, requestId: "newer" }, consumedSecond.sequence);
assert.equal(isStaleVisualContextSequence(orderedSnapshot, consumeVisualContextRequest(consumedSecond.registry, olderRequest).sequence), true, "an older equal-revision result cannot supersede newer state");
assert.equal(isStaleVisualContextInvalidation(snapshot, { sourceContextRevision: 3, routeRevision: 9 }), true, "an older invalidation cannot replace a newer capture");
assert.equal(isStaleVisualContextInvalidation(snapshot, { sourceContextRevision: 5, routeRevision: 9 }), false);
const invalidated = invalidatedVisualContextSnapshot({
  workspaceSessionId: "workspace-1",
  sourceContextRevision: 5,
  routeRevision: 9,
  source: request.source,
  staleReason: "navigation",
});
assert.equal(invalidated.status, "invalidated");
assert.equal(invalidated.screenshot, null);
const cancelled = invalidatedVisualContextSnapshot({
  workspaceSessionId: "workspace-1",
  sourceContextRevision: result.sourceContextRevision,
  routeRevision: result.routeRevision,
  source: result.source,
  staleReason: "cancelled",
}, result.requestId);
assert.equal(cancelled.requestId, result.requestId, "cancellation binds invalidation to the request it fences");
assert.equal(isStaleVisualContextResult(cancelled, result), true, "a delayed completion cannot revive its cancelled request");
assert.equal(isStaleVisualContextResult(cancelled, { ...result, requestId: "capture-after-cancel" }), false, "a new same-revision request may capture after cancellation");
assert.equal(isStaleVisualContextResult(snapshot, { ...result, operation: "clear", sourceContextRevision: 3 }), true, "older clear results are stale");

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

const sandboxFiles = new Map([
  [DEV_WORKBENCH_MIRROR_PATHS.workspace, Buffer.from(JSON.stringify({
    schemaVersion: DEV_WORKBENCH_SCHEMA_VERSION,
    sessionId: "workspace-1",
    organizationId: "organization-1",
    sandboxName: "sandbox-1",
    repository,
    tmuxSession: "sonik-dev",
    createdAt: "2026-07-17T12:00:00.000Z",
  }))],
]);
const fakeSandbox = {
  update: async () => undefined,
  readFileToBuffer: async ({ path }) => sandboxFiles.get(path) ?? null,
  writeFiles: async (files) => {
    for (const file of files) sandboxFiles.set(file.path, Buffer.from(file.content));
  },
  runCommand: async ({ cmd, args }) => {
    if (cmd === "mv") {
      sandboxFiles.set(args[1], sandboxFiles.get(args[0]));
      sandboxFiles.delete(args[0]);
    } else if (cmd === "rm") {
      sandboxFiles.delete(args.at(-1));
    } else if (cmd === "bash" && args.length >= 10) {
      const [, , , stageManifest, stagePng, , stableManifest, stablePng, hasPng] = args;
      sandboxFiles.set(stableManifest, sandboxFiles.get(stageManifest));
      sandboxFiles.delete(stageManifest);
      if (hasPng === "1") {
        sandboxFiles.set(stablePng, sandboxFiles.get(stagePng));
        sandboxFiles.delete(stagePng);
      } else {
        sandboxFiles.delete(stablePng);
      }
    }
    return { exitCode: 0, stdout: async () => "" };
  },
};
const originalSandboxGet = Sandbox.get;
Sandbox.get = async () => fakeSandbox;
try {
  const registered = await registerWorkspaceVisualContextRequest("workspace-1", request);
  assert.equal(registered.ok, true, "authenticated PUT persists the canonical request in the sandbox registry");
  sandboxFiles.set(result.screenshot.temporaryPath, png);
  const mutatedRequest = { ...request, routeRevision: request.routeRevision + 1 };
  const rejected = await submitWorkspaceVisualContext("workspace-1", {
    workspaceSessionId: "workspace-1",
    request: mutatedRequest,
    result: { ...result, routeRevision: mutatedRequest.routeRevision },
  });
  assert.deepEqual(rejected, { ok: true, value: { accepted: false, snapshot: null } });
  assert.equal(sandboxFiles.has(VISUAL_CONTEXT_PATH), false, "a mutated POST cannot promote state");
  assert.equal(sandboxFiles.has(result.screenshot.temporaryPath), false, "a rejected staged PNG is cleaned up");
  assert.ok(JSON.parse(sandboxFiles.get(VISUAL_CONTEXT_REQUESTS_PATH)).pending[request.requestId], "the exact issuance remains pending");

  sandboxFiles.set(result.screenshot.temporaryPath, png);
  const accepted = await submitWorkspaceVisualContext("workspace-1", submission);
  assert.equal(accepted.ok && accepted.value.accepted, true, "the exact retried POST consumes and promotes once");
  assert.equal(JSON.parse(sandboxFiles.get(VISUAL_CONTEXT_PATH)).status, "current");
  assert.deepEqual(JSON.parse(sandboxFiles.get(VISUAL_CONTEXT_REQUESTS_PATH)).pending, {});
  assert.equal((await submitWorkspaceVisualContext("workspace-1", submission)).ok, false, "replay is rejected after consumption");

  const stableBeforeUnattested = Buffer.from(sandboxFiles.get(VISUAL_CONTEXT_PATH));
  for (const unattested of unattestedSubmissions) {
    assert.equal((await registerWorkspaceVisualContextRequest("workspace-1", unattested.request)).ok, true);
    const rejectedUnattested = await submitWorkspaceVisualContext("workspace-1", unattested);
    assert.equal(rejectedUnattested.ok, false, `${unattested.request.operation} cannot be accepted by the real service`);
    assert.deepEqual(sandboxFiles.get(VISUAL_CONTEXT_PATH), stableBeforeUnattested, "unattested results cannot promote state");
    assert.ok(JSON.parse(sandboxFiles.get(VISUAL_CONTEXT_REQUESTS_PATH)).pending[unattested.request.requestId], "rejection occurs before consuming the canonical issuance");
  }
} finally {
  Sandbox.get = originalSandboxGet;
}

const leaseRoot = await mkdtemp(join(tmpdir(), "sonik-visual-lease-"));
try {
  const leasePath = join(leaseRoot, "lease");
  const runLease = async (owner) => {
    const command = ["-lc", createVisualContextLeaseAcquireScript(2, 0.01), "_", leasePath, owner, String(Date.now() + 60_000)];
    try {
      await promisify(execFile)("bash", command);
      return 0;
    } catch (error) {
      return error.code;
    }
  };
  const outcomes = await Promise.all([runLease("owner-a"), runLease("owner-b")]);
  assert.deepEqual(outcomes.toSorted(), [0, 75], "exactly one contender atomically acquires an initialized lease");
  assert.match(await readFile(leasePath, "utf8"), /^owner-[ab]\n\d+\n$/, "published leases always contain owner and expiry metadata");
  await writeFile(leasePath, "incomplete\n");
  await utimes(leasePath, new Date(0), new Date(0));
  assert.equal(await runLease("owner-recovery"), 0, "bounded stale recovery replaces abandoned invalid metadata");
} finally {
  await rm(leaseRoot, { recursive: true, force: true });
}

for (const failpoint of ["before-invalidation", "after-invalidation", "after-png-rename", "before-manifest-rename"]) {
  const root = await mkdtemp(join(tmpdir(), "sonik-visual-promote-"));
  try {
    const paths = Object.fromEntries(["manifest", "png", "invalidation", "stableManifest", "stablePng"].map((name) => [name, join(root, name)]));
    await Promise.all([
      writeFile(paths.manifest, JSON.stringify({ status: "current" })),
      writeFile(paths.png, "new-png"),
      writeFile(paths.invalidation, JSON.stringify({ status: "invalidated" })),
      writeFile(paths.stableManifest, JSON.stringify({ status: "current", prior: true })),
      writeFile(paths.stablePng, "prior-png"),
    ]);
    await assert.rejects(promisify(execFile)("bash", ["-lc", createVisualContextPromotionScript(), "_", paths.manifest, paths.png, paths.invalidation, paths.stableManifest, paths.stablePng, "1", failpoint]));
    const durable = JSON.parse(await readFile(paths.stableManifest, "utf8"));
    assert.equal(durable.status, failpoint === "before-invalidation" ? "current" : "invalidated", `${failpoint} leaves only prior-valid or invalidated state`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const cleanupCommands = [];
await removeVisualContextTemporaryPath({
  async runCommand(command) {
    cleanupCommands.push(command);
    return { exitCode: 0 };
  },
}, result.screenshot.temporaryPath);
assert.deepEqual(cleanupCommands, [{ cmd: "rm", args: ["-f", result.screenshot.temporaryPath] }], "lease failure cleanup deletes the request-scoped PNG");

const [routeSource, serviceSource, hookSource] = await Promise.all([
  readFile("apps/dev-workbench/src/routes/api/workspaces/visual-context/+server.ts", "utf8"),
  readFile("apps/dev-workbench/src/lib/server/workspace-service.ts", "utf8"),
  readFile("apps/dev-workbench/src/hooks.server.ts", "utf8"),
]);
assert.match(routeSource, /cache-control.*no-store/si, "PNG and JSON responses are not cacheable");
assert.match(routeSource, /DEV_WORKBENCH_SESSION_COOKIE/, "the endpoint requires its authenticated workspace binding");
assert.match(hookSource, /authorizeDevWorkbenchRequest/, "global Basic Auth covers the endpoint");
assert.match(serviceSource, /workspaceSessionId !== sessionId/, "the submitted workspace must match the cookie session");
assert.match(serviceSource, /record\.sessionId === sessionId/, "the cookie session must match the persisted workspace record");
assert.match(serviceSource, /createVisualContextLeaseAcquireScript/, "lease acquisition uses the executable atomic publication helper");
assert.match(serviceSource, /sed -n '1p'.*\$owner/s, "only the current lease owner can release it");
assert.match(serviceSource, /mv \"\$manifest\" \"\$stable_manifest\"/, "the manifest is the stable commit marker");
assert.match(serviceSource, /rm -f \"\$stable_png\"/, "invalidation removes latest.png");
assert.match(serviceSource, /result\.status === "cancelled"[\s\S]*invalidatedVisualContextSnapshot[\s\S]*promoteVisualContextManifest\([^)]*null/, "cancelled pick/capture atomically invalidates the manifest and removes latest.png");
assert.match(serviceSource, /result\.operation === "clear"[\s\S]*isStaleVisualContextResult\(current, result\)[\s\S]*invalidatedVisualContextSnapshot/, "clear promotion applies the same revision guard as capture");
assert.match(serviceSource, /accepted: submitted\.value\.accepted/, "controlled-preview capture exposes coordinator acceptance truth");

console.log("dev-workbench visual context coordinator: ok");

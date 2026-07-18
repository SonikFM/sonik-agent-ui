import assert from "node:assert/strict";

import {
  emitVisualBrowserTelemetry,
  emitVisualContextTelemetry,
} from "../../apps/dev-workbench/src/lib/server/visual-context-coordinator.ts";

const events = [
  "visual_context.picker.started",
  "visual_context.picker.cancelled",
  "visual_context.target.selected",
  "visual_context.capture.started",
  "visual_context.capture.completed",
  "visual_context.capture.failed",
  "visual_context.extension_pairing.changed",
  "visual_context.result.discarded",
  "visual_context.browser_setup.changed",
];

for (const event of events) {
  let written = "";
  const emitted = emitVisualContextTelemetry({
    event,
    workspaceSessionId: "workspace-1",
    requestId: "capture-1",
    operation: "capture",
    provider: "playwright",
    status: "completed",
    accepted: true,
    sourceContextRevision: 4,
    routeRevision: 8,
    selector: "#credit-card",
    domPath: "/html/body/private",
    pngBase64: "secret-image-payload",
    token: "Bearer secret-token-value",
    label: "Password sk-live-secret-value",
  }, (line) => { written = line; });

  assert.equal(emitted.event, event);
  assert.equal(emitted.sessionId, "workspace-1");
  assert.equal(emitted.requestId, "capture-1");
  assert.equal(emitted.runtimeProvider, "playwright");
  assert.equal(emitted.runtimeStatus, "completed");
  assert.deepEqual(emitted.payload, {
    operation: "capture",
    accepted: true,
    sourceContextRevision: 4,
    routeRevision: 8,
  });
  assert.deepEqual(JSON.parse(written), emitted);
  for (const forbidden of ["selector", "domPath", "pngBase64", "secret-image-payload", "secret-token-value", "sk-live-secret-value"]) {
    assert.equal(written.includes(forbidden), false, `telemetry must exclude ${forbidden}`);
  }
}

const previewRequest = {
  version: "sonik.visual-context.v1",
  messageSource: "sonik-agent-ui",
  type: "sonik:visual-context:request",
  requestId: "preview-1",
  operation: "capture",
  provider: "playwright",
  sourceContextRevision: 2,
  routeRevision: 3,
  source: { id: "preview", label: "Preview", surface: "workbench-preview", route: "/private" },
  selector: "#credit-card",
  pngBase64: "secret-image-payload",
};
const previewEvents = [];
for (const phase of ["started", "completed", "failed"]) {
  const emitted = emitVisualBrowserTelemetry({
    workspaceSessionId: "workspace-1",
    request: previewRequest,
    phase,
    status: phase,
    accepted: phase === "started" ? undefined : phase === "completed",
  }, (line) => previewEvents.push(JSON.parse(line)));
  assert.equal(emitted?.event, `visual_context.capture.${phase}`);
}
assert.deepEqual(previewEvents.map((event) => event.payload), [
  { operation: "capture", sourceContextRevision: 2, routeRevision: 3 },
  { operation: "capture", accepted: true, sourceContextRevision: 2, routeRevision: 3 },
  { operation: "capture", accepted: false, sourceContextRevision: 2, routeRevision: 3 },
]);
assert.equal(JSON.stringify(previewEvents).includes("selector"), false);
assert.equal(JSON.stringify(previewEvents).includes("secret-image-payload"), false);

for (const operation of ["get-capabilities", "setup-browser"]) {
  const emitted = emitVisualBrowserTelemetry({
    workspaceSessionId: "workspace-1",
    request: { ...previewRequest, requestId: operation, operation },
    phase: "completed",
    status: "available",
    accepted: true,
  }, () => {});
  assert.equal(emitted?.event, "visual_context.browser_setup.changed");
  assert.equal(emitted?.payload.operation, operation);
}

console.log("dev-workbench visual context telemetry: ok");

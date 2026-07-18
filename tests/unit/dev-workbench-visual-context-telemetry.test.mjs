import assert from "node:assert/strict";

import { emitVisualContextTelemetry } from "../../apps/dev-workbench/src/lib/server/visual-context-coordinator.ts";

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
  assert.deepEqual(emitted.payload, {
    operation: "capture",
    provider: "playwright",
    status: "completed",
    accepted: true,
    sourceContextRevision: 4,
    routeRevision: 8,
  });
  assert.deepEqual(JSON.parse(written), emitted);
  for (const forbidden of ["selector", "domPath", "pngBase64", "secret-image-payload", "secret-token-value", "sk-live-secret-value"]) {
    assert.equal(written.includes(forbidden), false, `telemetry must exclude ${forbidden}`);
  }
}

console.log("dev-workbench visual context telemetry: ok");

import assert from "node:assert/strict";
import { workflowDefinitionSchema } from "../../packages/tool-contracts/dist/marketplace.js";
import { applyWorkflowRunEvent } from "../../packages/tool-contracts/dist/workflow-run-state.js";
import { runWorkflowNode, startControllerRun } from "../../packages/tool-contracts/dist/workflow-controller.js";
import { writeAgentTelemetry } from "../../apps/standalone-sveltekit/src/lib/server/agent-telemetry.ts";

// AC-13 (Phase 10, agent-creation-tool-plan-2026-07-13.md): every event emitted while a
// workflow-controller run is executing a node callback must carry that run's runId as
// `workflowRunId`, so telemetry can be joined back to the drafted/published-workflow run that
// produced it. Events emitted outside any controller-driven callback are unchanged (no
// workflowRunId). Mocked callbacks only -- the reservation-specific reuse proof lives in
// reservation-workflow-controller-integration.test.mjs.

const definition = workflowDefinitionSchema.parse({
  workflowId: "fixture.telemetry.join_key",
  title: "Fixture telemetry join-key workflow",
  nodes: [
    { nodeId: "trigger", type: "trigger", title: "Start" },
    { nodeId: "preview", type: "tool_preview", title: "Preview", commandId: "fixture.telemetry.create", effect: "none", approvalPolicy: "none" },
    { nodeId: "commit", type: "tool_commit", title: "Commit", commandId: "fixture.telemetry.create", effect: "write", approvalPolicy: "preview_then_trusted_approval", requiredHostContext: ["organizationId"] },
  ],
  edges: [
    { edgeId: "e1", from: "trigger", to: "preview" },
    { edgeId: "e2", from: "preview", to: "commit" },
  ],
  facadeToolIds: ["fixture.telemetry.create"],
  version: "0.1.0",
});

// Capture emitted telemetry the same way reservation-workflow-controller-integration.test.mjs does:
// writeAgentTelemetry always console.info's a "sonik_agent_ui_telemetry" line, so intercepting
// console.info is a safe, local way to observe the sanitized payload actually written.
const emitted = [];
const originalConsoleInfo = console.info;
console.info = (...args) => {
  if (args[0] === "sonik_agent_ui_telemetry") {
    try {
      emitted.push(JSON.parse(args[1]).payload);
    } catch {
      // ignore parse failures, not relevant to this assertion
    }
  }
  return originalConsoleInfo.apply(console, args);
};

try {
  await writeAgentTelemetry({ source: "server", event: "test.outside_run.before", ok: true });
  assert.equal(
    emitted.find((event) => event.event === "test.outside_run.before")?.workflowRunId,
    undefined,
    "telemetry emitted outside any controller-driven run must not carry workflowRunId",
  );

  const runId = "run-telemetry-join-key-1";
  const run0 = startControllerRun(definition, { runId, workflowVersionId: "fixture.telemetry.join_key@0.1.0" });

  const afterPreview = await runWorkflowNode(run0, definition, "preview", {
    preview: async () => {
      await writeAgentTelemetry({ source: "server", event: "test.preview.telemetry", ok: true });
      return { kind: "preview", ok: true, preview: { commandId: "fixture.telemetry.create", stableInputHash: "hash", effect: "write", approvalRequired: true } };
    },
  });
  assert.equal(afterPreview.ok, true, "preview node transition must succeed");
  assert.equal(
    emitted.find((event) => event.event === "test.preview.telemetry")?.workflowRunId,
    runId,
    "telemetry emitted inside a tool_preview callback must carry the active run's runId as workflowRunId",
  );

  const requested = applyWorkflowRunEvent(afterPreview.state, { type: "request_approval", nodeId: "commit" });
  assert.equal(requested.ok, true);
  const approved = applyWorkflowRunEvent(requested.state, { type: "approve", hostSigned: true });
  assert.equal(approved.ok, true);

  const committed = await runWorkflowNode(approved.state, definition, "commit", {
    commit: async () => {
      await writeAgentTelemetry({ source: "server", event: "test.commit.telemetry", ok: true });
      return { kind: "commit", ok: true, receiptRef: "fixture-receipt" };
    },
  });
  assert.equal(committed.ok, true, "commit node transition must succeed");
  assert.equal(committed.state.phase, "committed");
  assert.equal(
    emitted.find((event) => event.event === "test.commit.telemetry")?.workflowRunId,
    runId,
    "telemetry emitted inside a tool_commit callback must carry the active run's runId as workflowRunId",
  );

  await writeAgentTelemetry({ source: "server", event: "test.outside_run.after", ok: true });
  assert.equal(
    emitted.find((event) => event.event === "test.outside_run.after")?.workflowRunId,
    undefined,
    "telemetry emitted after the controller-driven callback returns must not retain workflowRunId",
  );

  await writeAgentTelemetry({ source: "server", event: "test.explicit_override", ok: true, workflowRunId: "run-explicit-caller" });
  assert.equal(
    emitted.find((event) => event.event === "test.explicit_override")?.workflowRunId,
    "run-explicit-caller",
    "a caller-supplied workflowRunId must win over the (here, absent) ambient run scope",
  );

  // Concurrent isolation (verify-wave P3): two interleaved runs must never
  // cross-stamp each other's workflowRunId — AsyncLocalStorage binds each
  // callback's async continuation chain to its own run scope. Run A suspends
  // mid-callback while run B executes fully inside the suspension window.
  const runA = startControllerRun(definition, { runId: "run-concurrent-A", workflowVersionId: "fixture.telemetry.join_key@0.1.0" });
  const runB = startControllerRun(definition, { runId: "run-concurrent-B", workflowVersionId: "fixture.telemetry.join_key@0.1.0" });
  let releaseA;
  const gateA = new Promise((resolve) => { releaseA = resolve; });
  const concurrentPreview = { commandId: "fixture.telemetry.create", stableInputHash: "hash", effect: "write", approvalRequired: true };
  const promiseA = runWorkflowNode(runA, definition, "preview", {
    preview: async () => {
      await gateA; // hold A across B's full execution
      await writeAgentTelemetry({ source: "server", event: "test.concurrent.A", ok: true });
      return { kind: "preview", ok: true, preview: concurrentPreview };
    },
  });
  const resultB = await runWorkflowNode(runB, definition, "preview", {
    preview: async () => {
      await writeAgentTelemetry({ source: "server", event: "test.concurrent.B", ok: true });
      return { kind: "preview", ok: true, preview: concurrentPreview };
    },
  });
  releaseA();
  const resultA = await promiseA;
  assert.equal(resultA.ok && resultB.ok, true, "both concurrent preview transitions must succeed");
  assert.equal(
    emitted.find((event) => event.event === "test.concurrent.A")?.workflowRunId,
    "run-concurrent-A",
    "run A's callback telemetry must carry run A's id even though run B executed fully while A was suspended",
  );
  assert.equal(
    emitted.find((event) => event.event === "test.concurrent.B")?.workflowRunId,
    "run-concurrent-B",
    "run B's callback telemetry must carry run B's id while interleaved inside run A's suspension window",
  );
} finally {
  console.info = originalConsoleInfo;
}

console.log(JSON.stringify({ ok: true, checked: "telemetry-workflow-run-join-key" }));

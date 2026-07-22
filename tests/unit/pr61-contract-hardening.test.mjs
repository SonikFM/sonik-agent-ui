import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { derivePreviewStatus } from "../../apps/dev-workbench/src/design-system/patterns/DevWorkbench/capability.ts";
import { DEV_WORKBENCH_MIRROR_PATHS, DEV_WORKBENCH_SCHEMA_VERSION, devWorkbenchRealtimeEnvelopeSchema } from "../../apps/dev-workbench/src/lib/contracts/workbench.ts";

const read = (path) => readFileSync(path, "utf8");
const handoff = "docs/handoffs/sonik-dev-workbench-handoff-2026-07-20";

// Six of this file's original eight tests were prose/source-regex tautologies (asserted that
// docs *described* correct behavior, not that the behavior *was* correct). Removed per the E7
// audit in docs/testing/e7-tautology-inventory-2026-07-22.md, which traced each removed claim to
// real behavioral coverage that already exists elsewhere:
//   - "host authority is relayed for server consumption without entering the guest sandbox"
//     -> tests/unit/host-authority-recovery.test.mjs (real HMAC sign/verify + replay-tamper
//        rejection) + tests/unit/dev-workbench-server.test.mjs:212-215,561 + dev-workbench-runtime-
//        security-contract.test.mjs:10-13
//   - "handoff provenance is portable" -> doc-hygiene/PII check, not product behavior; no code
//     seam exists or should exist (DELETE, no replacement)
//   - "handoff reports restored embedded controls as current behavior"
//     -> apps/dev-workbench/e2e/embedded-workbench.spec.ts:113-132 (real Playwright DOM proof)
//   - "runtime ownership pins installers and documents attested visual context"
//     -> tests/unit/dev-workbench-visual-context.test.mjs + dev-workbench-visual-context-telemetry
//        .test.mjs + dev-workbench-server.test.mjs (real coordinator functions); the one truly
//        uncovered sub-claim (skills-CLI version pin) became the new red-to-green test E7.1 in
//        tests/unit/pr61-behavioral-coverage.test.mjs
//   - "canonical visual fixture carries explicit replay attestation"
//     -> tests/unit/target-registry-contracts.test.mjs:27-68 (parses the same fixture through the
//        real Zod schemas and proves enforcement by mutating fields and asserting throws)
//   - "sandbox processes cannot receive control-plane credentials"
//     -> tests/unit/dev-workbench-server.test.mjs:264,349,416,561 + dev-workbench-runtime-security-
//        contract.test.mjs:8-13 (real schema rejection, real generated command/env checks)
// See the inventory doc for the full disposition table and citations.

test("visual artifact staleness does not make a healthy interactive preview stale", () => {
  assert.equal(derivePreviewStatus(true, true), "ready");
  assert.equal(derivePreviewStatus(true, false), "connecting");
  assert.equal(derivePreviewStatus(false, true), "unavailable");
});

test("handoff event examples parse through the strict runtime wire contract", () => {
  const architecture = read(`${handoff}/03-architecture.md`);
  const base = {
    schemaVersion: DEV_WORKBENCH_SCHEMA_VERSION,
    eventId: "event-1",
    sequence: 1,
    occurredAt: "2026-07-20T12:00:00.000Z",
    sessionId: "session-1",
    organizationId: "org-1",
    channelKey: ["org", "org-1", "agentChannel", "session-1"],
  };
  const payloads = [
    { type: "status.changed", status: "ready" },
    { type: "preview.available", expiresAt: "2026-07-20T13:00:00.000Z" },
    { type: "terminal.available", sandboxExpiresAt: "2026-07-20T13:00:00.000Z" },
    { type: "page-context.updated", path: DEV_WORKBENCH_MIRROR_PATHS.pageContext },
    { type: "repository.changed", paths: ["src/app.ts"] },
    { type: "error", error: { code: "unknown", message: "Safe failure", operation: "test", retryable: false } },
  ];

  for (const [sequence, payload] of payloads.entries()) {
    assert.equal(devWorkbenchRealtimeEnvelopeSchema.safeParse({ ...base, sequence, payload }).success, true, payload.type);
  }
  assert.equal(devWorkbenchRealtimeEnvelopeSchema.safeParse({ ...base, payload: { type: "preview.available", expiresAt: "2026-07-20T13:00:00.000Z", status: "ready" } }).success, false);
  assert.equal(devWorkbenchRealtimeEnvelopeSchema.safeParse({ ...base, payload: { ...payloads[0], extra: true } }).success, false);
  assert.equal(devWorkbenchRealtimeEnvelopeSchema.safeParse({ ...base, payload: payloads[0], kind: "status.changed" }).success, false);
  assert.match(architecture, /schemaVersion, eventId, sequence, occurredAt, sessionId, organizationId, channelKey, payload/);
});

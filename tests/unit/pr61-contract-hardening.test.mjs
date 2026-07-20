import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { derivePreviewStatus } from "../../apps/dev-workbench/src/design-system/patterns/DevWorkbench/capability.ts";
import { DEV_WORKBENCH_MIRROR_PATHS, DEV_WORKBENCH_SCHEMA_VERSION, devWorkbenchRealtimeEnvelopeSchema } from "../../apps/dev-workbench/src/lib/contracts/workbench.ts";

const read = (path) => readFileSync(path, "utf8");
const handoff = "docs/handoffs/sonik-dev-workbench-handoff-2026-07-20";

test("host authority is relayed for server consumption without entering the guest sandbox", () => {
  const requirements = read(`${handoff}/01-product-requirements.md`);
  const architecture = read(`${handoff}/03-architecture.md`);
  const ownership = read("docs/architecture/dev-workbench-runtime-ownership-2026-07-20.md");
  const page = read("apps/dev-workbench/src/routes/+page.svelte");

  assert.match(requirements, /browser-relayed[^\n]*server-consumed/i);
  assert.doesNotMatch(`${architecture}\n${ownership}`, /hostAuthorityHandle|server-only handle/i);
  assert.doesNotMatch(architecture, /contextPaths:[^}]*hostAuthority/s);
  assert.match(architecture, /host authority[^\n]*(guest filesystem|sandbox artifacts)/i);
  assert.doesNotMatch(page, /signed authority[^\n]*inside the sandbox/i);
});

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

test("handoff provenance is portable", () => {
  const paths = [
    `${handoff}/README.md`,
    ...[1, 2, 3, 4, 5].map((number) => `${handoff}/0${number}-${[
      "product-requirements",
      "current-state-and-gaps",
      "architecture",
      "delivery-plan-and-acceptance",
      "source-index",
    ][number - 1]}.md`),
    `${handoff}/handoff-manifest.json`,
    "docs/architecture/dev-workbench-runtime-ownership-2026-07-20.md",
  ];
  const sourceIndex = read(`${handoff}/05-source-index.md`);

  for (const path of paths) assert.doesNotMatch(read(path), /\/Users\/[A-Za-z0-9._-]+\//, path);
  assert.match(sourceIndex, /session identifier:[^]*019f605d/i);
  assert.match(sourceIndex, /outside the repository|external/i);
});

test("handoff reports restored embedded controls as current behavior", () => {
  const readme = read(`${handoff}/README.md`);
  const currentState = read(`${handoff}/02-current-state-and-gaps.md`);
  const delivery = read(`${handoff}/04-delivery-plan-and-acceptance.md`);
  const combined = `${readme}\n${currentState}\n${delivery}`;

  assert.doesNotMatch(combined, /terminal-only (query mode|CSS) hides the toolbar/i);
  assert.doesNotMatch(combined, /intended embedded toolbar is hidden/i);
  assert.match(readme, /restored[^\n]*(toolbar|controls|command strip)/i);
  assert.match(currentState, /DevWorkbench\.contract\.test\.ts/);
  assert.match(currentState, /embedded-workbench\.spec\.ts/);
  assert.match(delivery, /Gate 0[^]*?(complete|completed)/i);
});

test("runtime ownership pins installers and documents attested visual context", () => {
  const ownership = read("docs/architecture/dev-workbench-runtime-ownership-2026-07-20.md");

  assert.match(ownership, /npx skills@\d+\.\d+\.\d+ add/);
  for (const field of [
    "schemaVersion",
    "sourceContextRevision",
    "routeRevision",
    "requestSequence",
    "source",
    "screenshot",
  ]) assert.match(ownership, new RegExp(`"${field}"`));
  assert.match(ownership, /\$\{DEV_WORKBENCH_STATE_ROOT\}\/screenshots\/latest\.png/);
});

test("canonical visual fixture carries explicit replay attestation", () => {
  const fixture = JSON.parse(read("packages/tool-contracts/fixtures/visual-context-v1.json"));

  assert.equal(fixture.snapshot.requestSequence, 2);
  assert.equal(fixture.snapshot.sourceContextRevision, 4);
  assert.equal(fixture.snapshot.routeRevision, 8);
});

test("sandbox processes cannot receive control-plane credentials", () => {
  const ownership = read("docs/architecture/dev-workbench-runtime-ownership-2026-07-20.md");

  assert.match(ownership, /control-plane credentials[^\n]*sandbox processes/i);
  for (const credential of ["GitHub", "Cloudflare", "database", "host-authority", "visual-grounding"])
    assert.match(ownership, new RegExp(credential, "i"));
  assert.match(ownership, /server-side brokers|short-lived, least-privilege tokens/i);
});

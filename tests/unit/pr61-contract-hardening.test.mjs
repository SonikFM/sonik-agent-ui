import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");
const handoff = "docs/handoffs/sonik-dev-workbench-handoff-2026-07-20";

test("host authority stays server-only", () => {
  const requirements = read(`${handoff}/01-product-requirements.md`);
  const architecture = read(`${handoff}/03-architecture.md`);

  assert.match(requirements, /server-only[^\n]*(access|ACL)[^\n]*expir[^\n]*revoc/i);
  assert.match(architecture, /hostAuthorityHandle/);
  assert.doesNotMatch(architecture, /contextPaths:[^}]*hostAuthority/s);
  assert.match(architecture, /host authority[^\n]*(guest filesystem|client state)/i);
});

test("preview status and event payloads match runtime contracts", () => {
  const architecture = read(`${handoff}/03-architecture.md`);

  assert.match(architecture, /type PreviewStatus =[^;]*"connecting"[^;]*"ready"[^;]*"stale"[^;]*"unavailable"[^;]*"error"/);
  assert.match(architecture, /type WorkbenchEventPayloads =/);
  assert.match(architecture, /type WorkbenchEvent<K extends keyof WorkbenchEventPayloads[^>]*>/);
  assert.match(architecture, /payload: WorkbenchEventPayloads\[K\]/);
  for (const kind of [
    "status.changed",
    "preview.available",
    "terminal.available",
    "page-context.updated",
    "repository.changed",
    "error",
  ]) assert.match(architecture, new RegExp(`"${kind.replace(".", "\\.")}"`));
  assert.match(architecture, /planned event kinds/i);
  assert.doesNotMatch(architecture, /payload: unknown/);
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

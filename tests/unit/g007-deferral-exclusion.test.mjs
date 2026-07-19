import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const deferredFiles = [
  "apps/standalone-sveltekit/src/lib/components/channels/ChannelsRoot.svelte",
  "apps/standalone-sveltekit/src/lib/server/channels-state.ts",
  "apps/standalone-sveltekit/src/routes/api/session/[id]/channels/+server.ts",
  "docs/product/channels-triggers-prework.md",
  "packages/tool-contracts/src/channel-fixtures.ts",
  "packages/tool-contracts/src/channels.ts",
  "tests/e2e/channels.spec.ts",
  "tests/e2e/support/channels-host-fixture.ts",
  "tests/unit/channel-contracts.test.mjs",
  "tests/unit/channels-route.test.mjs",
  "tests/unit/channels-state.test.mjs",
  "tests/unit/channels-surface.test.mjs",
];

for (const file of deferredFiles) {
  await assert.rejects(
    () => access(file),
    { code: "ENOENT" },
    `G007 deferral keeps ${file} out of the delivery PR`,
  );
}

const [pageSource, observabilitySource, packageSource] = await Promise.all([
  readFile("apps/standalone-sveltekit/src/routes/+page.svelte", "utf8"),
  readFile("packages/agent-observability/src/index.ts", "utf8"),
  readFile("packages/tool-contracts/package.json", "utf8"),
]);

for (const forbidden of [
  "ChannelsRoot",
  "getChannelsState",
  "connectChannel",
  "enableTriggerBinding",
  "saveFixtureTriggerBinding",
  'workspaceMode === "channels"',
]) {
  assert.equal(pageSource.includes(forbidden), false, `G007 deferral excludes page wiring for ${forbidden}`);
}

for (const forbidden of ["AgentUiChannelsStateSnapshot", "getChannelsState", "connectChannel", "enableTriggerBinding", "saveFixtureTriggerBinding"]) {
  assert.equal(observabilitySource.includes(forbidden), false, `G007 deferral excludes observability contract ${forbidden}`);
}

const toolContractPackage = JSON.parse(packageSource);
assert.equal("./channels" in toolContractPackage.exports, false);
assert.equal("./channel-fixtures" in toolContractPackage.exports, false);

console.log("g007-deferral-exclusion.test.mjs passed");

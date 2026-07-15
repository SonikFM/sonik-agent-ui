import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveCapabilityReadiness, requireCallableCapability } from "../../apps/standalone-sveltekit/src/lib/server/capability-readiness.ts";

const capabilityId = "test.read.item";
const registry = {
  schemaVersion: "sonik-agent-ui.capability-registry.v1",
  capabilities: [{ capabilityId, version: 1, title: "Read item", effect: "read", status: "active", implies: [] }],
};
const command = {
  id: capabilityId,
  familyId: "test",
  effect: "read",
  transport: { runtimeStatus: "mounted" },
  auth: { required: true, orgScoped: true, scopes: ["items:read"] },
};
const base = {
  registry,
  catalog: { version: "sonik-agent-ui.command-catalog.v1", generatedAt: "2026-07-15T00:00:00.000Z", provider: "test", commands: [command] },
  runtimeAdapters: [{ provider: "test", bindings: [{ commandId: capabilityId, status: "mounted-read", execute: () => ({ summary: {} }) }] }],
  executionContext: { authenticated: true, organizationId: "org-1", scopes: ["items:read"] },
  grants: [{ capabilityId, mode: "allow" }],
  capabilityVersionPins: { [capabilityId]: 1 },
  requireVersionPins: true,
};

const ready = resolveCapabilityReadiness(base)[0];
assert.equal(ready.callable, true);
assert.deepEqual(ready.reasonCodes, []);
assert.equal(requireCallableCapability([ready], capabilityId), ready);

const missingContext = resolveCapabilityReadiness({ ...base, executionContext: { authenticated: false, organizationId: null, scopes: [] } })[0];
assert.equal(missingContext.contextReady, false);
assert.equal(missingContext.grantReady, true);
assert.deepEqual(missingContext.reasonCodes, ["missing_context"]);

const missingGrant = resolveCapabilityReadiness({ ...base, grants: [] })[0];
assert.equal(missingGrant.contextReady, true);
assert.equal(missingGrant.grantReady, false);
assert.deepEqual(missingGrant.reasonCodes, ["missing_host_grant"]);

const blockers = resolveCapabilityReadiness({
  ...base,
  catalog: { ...base.catalog, commands: [] },
  runtimeAdapters: [],
  executionContext: { authenticated: false, organizationId: null, scopes: [] },
  grants: [],
  capabilityVersionPins: {},
})[0];
assert.deepEqual(blockers.reasonCodes, ["not_implemented", "not_authorable", "definition_incompatible", "not_mounted", "missing_context", "missing_host_grant", "version_not_pinned"]);
assert.equal(blockers.nextAction, "not_implemented");

const revoked = [];
assert.equal(resolveCapabilityReadiness({ ...base, revokedCapabilityIds: revoked })[0].callable, true, "cached UI may begin callable");
revoked.push(capabilityId);
const dispatchState = resolveCapabilityReadiness({ ...base, revokedCapabilityIds: revoked })[0];
assert.deepEqual(dispatchState.reasonCodes, ["kill_switched"]);
assert.throws(() => requireCallableCapability([dispatchState], capabilityId), /kill_switched/, "dispatch re-resolves the kill switch");
assert.throws(() => requireCallableCapability([], "unknown.capability"), /not_registered/, "unknown capabilities default deny");

const wiredFiles = {
  catalog: "apps/standalone-sveltekit/src/lib/tools/command-catalog.ts",
  promptStartup: "apps/standalone-sveltekit/src/lib/server/tool-manifest.ts",
  config: "apps/standalone-sveltekit/src/lib/components/workflow-builder/AgentConfigPanel.svelte",
  preview: "apps/standalone-sveltekit/src/lib/components/workflow-builder/DebugPreviewPane.svelte",
  publish: "apps/standalone-sveltekit/src/lib/server/workflow-definitions.ts",
};
for (const [consumer, path] of Object.entries(wiredFiles)) {
  const source = await readFile(new URL(`../../${path}`, import.meta.url), "utf8");
  assert.match(source, /capabilityReadiness|resolveStandaloneCapabilityReadiness|requireCallableCapability/, `${consumer} consumes server readiness`);
}

console.log("authoritative capability readiness tests passed");

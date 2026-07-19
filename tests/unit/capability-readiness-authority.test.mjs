import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveCapabilityReadiness, requireCallableCapabilities, requireCallableCapability } from "../../apps/standalone-sveltekit/src/lib/server/capability-readiness.ts";
import { resolveStandaloneCapabilityReadiness } from "../../apps/standalone-sveltekit/src/lib/server/standalone-capability-readiness.ts";
import { sonikBookingCapabilityRegistry } from "../../packages/tool-contracts/src/capability-registry.ts";

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
assert.deepEqual(requireCallableCapabilities([ready], [capabilityId, capabilityId]), [ready], "the shared guard deduplicates required capability ids");

for (const [axis, reason] of [
  ["registered", "not_registered"], ["implemented", "not_implemented"], ["authorable", "not_authorable"],
  ["definitionCompatible", "definition_incompatible"], ["mounted", "not_mounted"], ["contextReady", "missing_context"],
  ["grantReady", "missing_host_grant"], ["previewable", "preview_required"], ["versionPinned", "version_not_pinned"],
]) {
  assert.throws(
    () => requireCallableCapability([{ ...ready, [axis]: false, callable: true, reasonCodes: [], nextAction: null }], capabilityId),
    new RegExp(reason),
    `${axis} cannot be hidden by a stale callable projection`,
  );
}
assert.throws(() => requireCallableCapability([{ ...ready, killSwitched: true, callable: true, reasonCodes: [], nextAction: null }], capabilityId), /kill_switched/);

const writeRegistry = { ...registry, capabilities: [{ ...registry.capabilities[0], effect: "write" }] };
const writeReady = resolveCapabilityReadiness({
  ...base,
  registry: writeRegistry,
  catalog: { ...base.catalog, commands: [{ ...command, effect: "write" }] },
  runtimeAdapters: [{ provider: "test", bindings: [{ commandId: capabilityId, status: "mounted-write", commit: () => ({ summary: {} }) }] }],
  approvedCommandIds: [capabilityId],
})[0];
assert.equal(writeReady.callable, true);
assert.throws(() => requireCallableCapability([{ ...writeReady, committable: false, callable: true, reasonCodes: [], nextAction: null }], capabilityId), /approval_required/);

const missingContext = resolveCapabilityReadiness({ ...base, executionContext: { authenticated: false, organizationId: null, scopes: [] } })[0];
assert.equal(missingContext.contextReady, false);
assert.equal(missingContext.grantReady, true);
assert.deepEqual(missingContext.reasonCodes, ["missing_context"]);

const missingGrant = resolveCapabilityReadiness({ ...base, grants: [] })[0];
assert.equal(missingGrant.contextReady, true);
assert.equal(missingGrant.grantReady, false);
assert.deepEqual(missingGrant.reasonCodes, ["missing_host_grant"]);

const policyOff = resolveCapabilityReadiness({ ...base, toolPermissionModes: { [capabilityId]: "off" } })[0];
assert.equal(policyOff.callable, false, "an explicit draft policy Off must override otherwise-ready runtime axes");
assert.equal(policyOff.grantReady, false);
assert.ok(policyOff.reasonCodes.includes("missing_host_grant"));
assert.throws(() => requireCallableCapability([policyOff], capabilityId), /missing_host_grant/, "dispatch uses the same policy-aware readiness result");

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

const currentPins = Object.fromEntries(sonikBookingCapabilityRegistry.capabilities.map(({ capabilityId, version }) => [capabilityId, version]));
const versionedCapability = sonikBookingCapabilityRegistry.capabilities[0];
assert.equal(resolveStandaloneCapabilityReadiness({ hostSessionMode: "standalone-demo" }).find(({ capabilityId }) => capabilityId === versionedCapability.capabilityId).versionPinned, true, "pin-less projections consume the current versioned registry");
assert.equal(resolveStandaloneCapabilityReadiness({ hostSessionMode: "standalone-demo", capabilityVersionPins: { ...currentPins, [versionedCapability.capabilityId]: versionedCapability.version + 1 } }).find(({ capabilityId }) => capabilityId === versionedCapability.capabilityId).versionPinned, false, "supplied stale pins fail closed without a separate requireVersionPins flag");

const wiredFiles = {
  catalog: "apps/standalone-sveltekit/src/lib/tools/command-catalog.ts",
  promptStartup: "apps/standalone-sveltekit/src/lib/server/tool-manifest.ts",
  config: "apps/standalone-sveltekit/src/lib/components/workflow-builder/AgentConfigPanel.svelte",
  preview: "apps/standalone-sveltekit/src/lib/components/workflow-builder/DebugPreviewPane.svelte",
  publish: "apps/standalone-sveltekit/src/lib/server/workflow-definitions.ts",
  endpoint: "apps/standalone-sveltekit/src/routes/api/capability-readiness/+server.ts",
};
for (const [consumer, path] of Object.entries(wiredFiles)) {
  const source = await readFile(new URL(`../../${path}`, import.meta.url), "utf8");
  assert.match(source, /capabilityReadiness|resolveStandaloneCapabilityReadiness|requireCallableCapability/, `${consumer} consumes server readiness`);
}

const endpointSource = await readFile(new URL("../../apps/standalone-sveltekit/src/routes/api/capability-readiness/+server.ts", import.meta.url), "utf8");
assert.match(endpointSource, /agentDefinitionSchema\.shape\.toolPolicy\.safeParse/, "the readiness request validates the draft policy at the server trust boundary");
assert.match(endpointSource, /invalid_tool_policy[\s\S]*status: 400/, "missing or malformed policy input fails closed");
assert.match(endpointSource, /toolPermissionModes: parsed\.data/, "validated policy reaches the sole readiness resolver");
assert.match(endpointSource, /defaultToolPermissionMode: "off"/, "unspecified builder families default deny rather than implying allow");
assert.match(endpointSource, /policyChangeReadiness/, "the endpoint supplies separate policy-neutral evidence to avoid an Off edit deadlock");

console.log("authoritative capability readiness tests passed");

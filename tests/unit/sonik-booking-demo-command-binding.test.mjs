import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { executeHostCatalogCommand } from "../../packages/platform-adapters/src/index.ts";
import { createStandaloneHostRuntimeAdapters } from "../../apps/standalone-sveltekit/src/lib/server/host-command-runtime.ts";

const binding = JSON.parse(await readFile("tests/fixtures/sonik-booking/demo-command-binding.json", "utf8"));
const bookingArtifacts = JSON.parse(await readFile("tests/fixtures/generated/sonik-booking-command-artifacts.generated.json", "utf8"));
const globalRegistry = JSON.parse(await readFile("tests/fixtures/generated/sonik-global-command-registry.generated.json", "utf8"));

assert.equal(binding.version, "sonik-agent-ui.booking-demo-command-binding.v1");
assert.equal(binding.posture, "phase-1-mapping-only-no-runtime-write-mount");
assert.equal(binding.testConfigLocation, "tests/fixtures/sonik-booking/demo-command-binding.json");
assert.equal(binding.selectedRead.commandId, "booking.get.availability");
assert.equal(binding.selectedMutation.commandId, "booking.create.hold");
assert.equal(binding.confirmationRead.commandId, "booking.get.hold");
assert.equal(binding.cleanupMutation.commandId, "booking.release.hold");

const commands = new Map(bookingArtifacts.catalog.commands.map((command) => [command.id, command]));
const globalCommands = new Map(globalRegistry.catalog.commands.map((command) => [command.id, command]));

function assertBoundCommand(sectionName) {
  const bound = binding[sectionName];
  const command = commands.get(bound.commandId);
  assert.ok(command, `${sectionName} command exists in booking generated artifact: ${bound.commandId}`);
  const globalCommand = globalCommands.get(bound.commandId);
  assert.ok(globalCommand, `${sectionName} command exists in global registry: ${bound.commandId}`);
  assert.equal(globalCommand.metadata?.sourceOperationId, bound.sourceOperationId, `${bound.commandId} global source operation id`);
  assert.equal(globalCommand.effect, bound.effect, `${bound.commandId} global effect`);
  assert.equal(globalCommand.approval, bound.approval, `${bound.commandId} global approval`);
  assert.equal(globalCommand.transport?.runtimeStatus, bound.expectedDiscoveryRuntimeStatus, `${bound.commandId} global runtime status stays shadow`);
  assert.equal(command.metadata?.sourceOperationId, bound.sourceOperationId, `${bound.commandId} source operation id`);
  assert.equal(command.transport?.method, bound.method, `${bound.commandId} method`);
  assert.equal(command.transport?.path, bound.path, `${bound.commandId} path`);
  assert.equal(command.effect, bound.effect, `${bound.commandId} effect`);
  assert.equal(command.approval, bound.approval, `${bound.commandId} approval`);
  assert.equal(command.transport?.runtimeStatus, bound.expectedDiscoveryRuntimeStatus, `${bound.commandId} generated discovery runtime status stays shadow`);
  return command;
}

const readCommand = assertBoundCommand("selectedRead");
const mutationCommand = assertBoundCommand("selectedMutation");
const confirmationCommand = assertBoundCommand("confirmationRead");
const cleanupCommand = assertBoundCommand("cleanupMutation");

assert.equal(readCommand.effect, "read");
assert.equal(readCommand.approval, "none");
assert.equal(mutationCommand.effect, "write");
assert.equal(mutationCommand.approval, "required");
assert.equal(cleanupCommand.effect, "write");
assert.equal(cleanupCommand.approval, "required");
assert.equal(confirmationCommand.effect, "read");

for (const sectionName of ["selectedMutation", "cleanupMutation"]) {
  const command = commands.get(binding[sectionName].commandId);
  assert.equal(command.transport.runtimeStatus, "shadow", `${sectionName} remains generated shadow`);
  assert.equal(command.approval, "required", `${sectionName} requires approval`);
}

assert.deepEqual(binding.seedFixture.metadata, {
  createdBy: "sonik-agent-ui-v0.2-demo",
  purpose: "ultratest-booking-contract-binding",
});
assert.equal(binding.seedFixture.windowStrategy, "select-first-availability-slot-with-capacityRemaining-greater-than-zero");
assert.equal(binding.seedFixture.resourceTargetStrategy, "host-context-first-fail-closed");
assert.match(binding.seedFixture.resourceTargetRule, /missing-resource-target/);
assert.equal(binding.seedFixture.clientRequestIdPrefix, "agent-ui-v02-demo-hold");
assert.ok(binding.confirmationFields.includes("id"));
assert.ok(binding.confirmationFields.includes("status"));
assert.equal(binding.successCriteria.afterCreate.status, "active");
assert.equal(binding.successCriteria.afterCleanup.status, "released");

const rejectedIds = new Set(binding.rejectedForV02Demo.map((entry) => entry.commandId));
for (const rejectedId of ["booking.create.booking", "booking.cancel.booking", "booking.commit.hold", "booking.delete.schedule.rule"]) {
  assert.ok(rejectedIds.has(rejectedId), `documents rejection for ${rejectedId}`);
}
for (const selectedId of [binding.selectedRead.commandId, binding.selectedMutation.commandId, binding.confirmationRead.commandId, binding.cleanupMutation.commandId]) {
  assert.equal(rejectedIds.has(selectedId), false, `selected command is not rejected: ${selectedId}`);
}

const createBooking = commands.get("booking.create.booking");
assert.equal(createBooking?.transport?.runtimeStatus, "shadow", "direct booking creation remains shadow in generated discovery");
assert.equal(createBooking?.approval, "required", "direct booking creation remains approval-gated");

const trustedRuntimeAdapters = createStandaloneHostRuntimeAdapters({
  bookingServiceBaseUrl: "https://booking-runtime.example.test",
  bookingRuntimeAuth: { mode: "bearer", token: "redacted-demo-token" },
  fetcher: async () => {
    throw new Error("global registry shadow-negative test must not issue outbound fetches");
  },
});
for (const sectionName of ["selectedMutation", "cleanupMutation"]) {
  const receipt = await executeHostCatalogCommand({
    catalog: globalRegistry.catalog,
    commandId: binding[sectionName].commandId,
    commandInput: {},
    runtimeAdapters: trustedRuntimeAdapters,
    execution: {
      source: "agent-ui",
      requestId: `req_phase1_no_write_mount_${sectionName}`,
      authenticated: true,
      organizationId: "org_demo",
      scopes: ["booking:read", "booking:write"],
      action: "commit",
    },
  });
  assert.equal(receipt.ok, false, `${sectionName} is not mounted for runtime writes in phase 1`);
  assert.equal(receipt.policy.reasons.includes("runtime_not_mounted:shadow"), true, `${sectionName} remains denied from the generated shadow registry even when trusted adapters exist`);
}

console.log(JSON.stringify({
  ok: true,
  selectedRead: binding.selectedRead.commandId,
  selectedMutation: binding.selectedMutation.commandId,
  confirmationRead: binding.confirmationRead.commandId,
  cleanupMutation: binding.cleanupMutation.commandId,
  posture: binding.posture,
}));

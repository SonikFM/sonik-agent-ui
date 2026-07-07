import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const commandArtifacts = JSON.parse(await readFile("tests/fixtures/generated/sonik-booking-command-artifacts.generated.json", "utf8"));
const runtimeBindings = JSON.parse(await readFile("tests/fixtures/generated/sonik-booking-runtime-bindings.generated.json", "utf8"));

assert.equal(runtimeBindings.version, "sonik-agent-ui.booking-runtime-bindings.v1");
const mountedCommands = commandArtifacts.catalog.commands.filter((command) => command.metadata?.sourceMounted === true);
const shadowCommands = commandArtifacts.catalog.commands.filter((command) => command.metadata?.sourceMounted !== true);
assert.equal(runtimeBindings.summary.sourceCommandCount, commandArtifacts.summary.commandCount, "runtime bindings keep the full generated command surface count");
assert.equal(runtimeBindings.summary.commandCount, mountedCommands.length, "runtime bindings cover every source-mounted generated command descriptor");
assert.equal(runtimeBindings.summary.shadowCommandCount, shadowCommands.length, "runtime bindings retain the shadow command count as non-executable posture");
assert.deepEqual(runtimeBindings.summary.shadowCommandIds, shadowCommands.map((command) => command.id).sort(), "runtime bindings explicitly list generated shadow commands without mounting them");
assert.equal(runtimeBindings.bindings.length, mountedCommands.length, "one runtime binding is generated for every source-mounted generated command");

const commandById = new Map(commandArtifacts.catalog.commands.map((command) => [command.id, command]));
const seen = new Set();
for (const binding of runtimeBindings.bindings) {
  assert.equal(seen.has(binding.commandId), false, `duplicate runtime binding: ${binding.commandId}`);
  seen.add(binding.commandId);
  const command = commandById.get(binding.commandId);
  assert.ok(command, `runtime binding references generated command: ${binding.commandId}`);
  assert.equal(command.metadata.sourceMounted, true, `${binding.commandId} is mounted by the source service before runtime binding`);
  assert.equal(binding.method, command.transport.method, `${binding.commandId} method matches descriptor`);
  assert.equal(binding.path, command.transport.path, `${binding.commandId} path matches descriptor`);
  assert.equal(binding.effect, command.effect, `${binding.commandId} effect matches descriptor`);
  assert.equal(binding.status, command.effect === "read" ? "mounted-read" : "mounted-write", `${binding.commandId} runtime status is derived from effect`);
  assert.equal(binding.auth.required, true, `${binding.commandId} requires auth at runtime`);
  assert.equal(binding.auth.orgScoped, true, `${binding.commandId} requires organization scope at runtime`);
  assert.deepEqual(binding.auth.scopes, command.effect === "read" ? ["booking:read"] : ["booking:write"], `${binding.commandId} derives booking scope from effect`);
  for (const pathParam of binding.pathParams) {
    assert.match(binding.path, new RegExp(`\\{${pathParam.name}\\}`), `${binding.commandId} path param ${pathParam.name} appears in path`);
    assert.equal(pathParam.required, true, `${binding.commandId} path param ${pathParam.name} is required`);
  }
}

assert.equal(runtimeBindings.summary.readCount, runtimeBindings.bindings.filter((binding) => binding.effect === "read").length);
assert.equal(runtimeBindings.summary.writeCount, runtimeBindings.bindings.filter((binding) => binding.effect === "write").length);
assert.equal(runtimeBindings.summary.destructiveCount, runtimeBindings.bindings.filter((binding) => binding.effect === "destructive").length);
assert.equal(runtimeBindings.summary.mountedReadCount, runtimeBindings.bindings.filter((binding) => binding.status === "mounted-read").length);
assert.equal(runtimeBindings.summary.mountedWriteCount, runtimeBindings.bindings.filter((binding) => binding.status === "mounted-write").length);
assert.equal(runtimeBindings.summary.sourceCommandCount, 72, "Sonik booking generator still owns the full 72-command contract surface");
assert.equal(runtimeBindings.summary.commandCount, 53, "Sonik booking generated runtime exposes exactly the 53 source-mounted commands");
assert.equal(runtimeBindings.summary.shadowCommandCount, 19, "19 generated commands remain discoverable shadow contract descriptors, not executable runtime bindings");
assert.equal(runtimeBindings.summary.mountedWriteCount, 29, "mounted writes plus mounted destructive commands are commit-mounted, not execute-mounted");

console.log(JSON.stringify({ ok: true, ...runtimeBindings.summary }));

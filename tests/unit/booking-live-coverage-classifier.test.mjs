import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const runtimeBindings = JSON.parse(await readFile("tests/fixtures/generated/sonik-booking-runtime-bindings.generated.json", "utf8"));
const coverage = JSON.parse(await readFile("tests/fixtures/sonik-booking/pipeb-live-all72-coverage.fixture.json", "utf8"));

const bindingIds = runtimeBindings.bindings.map((binding) => binding.commandId).sort();
const generatedContractIds = [...bindingIds, ...runtimeBindings.summary.shadowCommandIds].sort();
const coveredIds = [...coverage.successCommandIds, ...coverage.failedCommandIds].sort();
const failed = new Set(coverage.failedCommandIds);
const knownBlocked = new Set(coverage.knownBlockers.flatMap((blocker) => blocker.commands));
const knownSourceShadow = coverage.knownBlockers.filter((blocker) => blocker.kind === "source-shadow-route-group").flatMap((blocker) => blocker.commands);

assert.equal(coverage.schemaVersion, "sonik.agent_ui.test.booking_live_coverage_fixture.v2");
assert.equal(coverage.environment, "deterministic_host_runtime");
assert.match(coverage.sourceEvidenceFile, /^\.omx\/logs\/mounted53-runtime-coverage-20260630\.json$/, "fixture names the exact mounted-53 source evidence artifact");
assert.match(coverage.sourceEvidenceSha256, /^[a-f0-9]{64}$/, "fixture records a stable SHA-256 of the mounted-53 source evidence artifact");
assert.equal(runtimeBindings.summary.sourceCommandCount, 72, "generated runtime preserves the full 72-command contract surface count");
assert.equal(runtimeBindings.summary.commandCount, 53, "generated runtime mounts exactly the 53 source-mounted commands");
assert.equal(runtimeBindings.summary.shadowCommandCount, 19, "generated runtime keeps exactly 19 source-shadow commands non-executable");
assert.deepEqual(coveredIds, generatedContractIds, "live coverage fixture must classify every generated contract command exactly once");
assert.equal(coverage.commandCount, runtimeBindings.summary.sourceCommandCount, "coverage count matches full generated command count");
assert.equal(coverage.successCommandIds.length, 53, "mounted-53 proof has every source-mounted generated command successful");
assert.equal(coverage.failedCommandIds.length, 19, "mounted-53 proof only leaves source-shadow commands non-successful");
assert.deepEqual(coverage.successCommandIds.sort(), runtimeBindings.bindings.map((binding) => binding.commandId).sort(), "successes exactly match generated runtime-mounted bindings");
assert.deepEqual(coverage.failedCommandIds.sort(), runtimeBindings.summary.shadowCommandIds, "failures exactly match source-shadow command ids");
assert.equal(coverage.failedCommandIds.every((commandId) => knownBlocked.has(commandId)), true, "every non-success command must have an explicit source-shadow classification");
assert.equal(knownSourceShadow.every((commandId) => failed.has(commandId)), true, "source-shadow route groups remain non-executable until mounted by the service");
assert.equal(failed.has("booking.create.hold"), false, "create-hold principal injection regression is fixed in the live coverage baseline");
assert.equal(failed.has("booking.get.hold"), false, "hold read remains live-proven");
assert.equal(failed.has("booking.extend.hold"), false, "hold extension remains live-proven");
assert.equal(failed.has("booking.release.hold"), false, "hold release remains live-proven");
for (const closedCommandId of [
  "booking.create.booking",
  "booking.get.booking",
  "booking.confirm.booking",
  "booking.reschedule.booking",
  "booking.list.party.members",
  "booking.add.party.member",
  "booking.list.resource.assignments",
  "booking.assign.resource",
  "booking.cancel.booking",
  "booking.remove.party.member",
  "booking.unassign.resource",
  "booking.commit.hold",
  "booking.upload.media.asset",
  "booking.get.media.asset",
  "booking.get.media.asset.variant",
  "booking.delete.media.asset",
]) {
  assert.equal(failed.has(closedCommandId), false, `${closedCommandId} is closed as live-proven in mounted-53 coverage`);
}

console.log(JSON.stringify({
  ok: true,
  commandCount: coverage.commandCount,
  successes: coverage.successCommandIds.length,
  failures: coverage.failedCommandIds.length,
  blockerCount: coverage.knownBlockers.length,
}));

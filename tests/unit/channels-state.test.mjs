import assert from "node:assert/strict";
import {
  createChannelsProjection,
  createChannelsSnapshotRecordInput,
  createDefaultChannelsEnvelope,
  createScopedFixtureTriggerBinding,
  mergeTriggerBindingIntoEnvelope,
  readLatestChannelsEnvelope,
} from "../../apps/standalone-sveltekit/src/lib/server/channels-state.ts";
import {
  createAsyncWorkspacePersistenceAdapter,
  createInMemoryWorkspacePersistence,
} from "../../packages/workspace-session/src/index.ts";

const scope = {
  organizationId: "org-server-authority",
  userId: "user-server-authority",
  workspaceId: "workspace-session-channels",
  sessionId: "workspace-session-channels",
};

const defaultEnvelope = createDefaultChannelsEnvelope();
assert.equal(defaultEnvelope.fixtureOnly, true);
assert.equal(defaultEnvelope.triggerBindings.length, 2);
assert.equal("organizationId" in defaultEnvelope.triggerBindings[0], false, "persisted fixture bindings must not retain tenant authority");
assert.equal("workspaceId" in defaultEnvelope.triggerBindings[0], false, "persisted fixture bindings must not retain client-owned workspace authority");

const projection = createChannelsProjection({ scope, envelope: defaultEnvelope });
assert.equal(projection.sessionId, scope.sessionId);
assert.equal(projection.status, "ready");
assert.equal(projection.channels.length, 8);
assert.deepEqual(
  [...new Set(projection.channels.map((channel) => channel.kind))].sort(),
  ["slack", "whatsapp"],
);
for (const kind of ["slack", "whatsapp"]) {
  assert.deepEqual(
    projection.channels.filter((channel) => channel.kind === kind).map((channel) => channel.provisioningState).sort(),
    ["connected", "error", "pending", "unconfigured"],
  );
}
assert.equal(projection.channels.every((channel) => channel.integrationAction.enabled === false), true);
assert.equal(projection.channels.every((channel) => channel.integrationAction.disabledReason === "integration_not_yet_available"), true);
assert.equal(projection.triggerBindings.every((binding) => binding.runtimeMode === "fixture_only" && binding.enabled === false), true);
assert.equal(Object.isFrozen(projection), true, "one immutable server projection must feed every consumer");
assert.equal(Object.isFrozen(projection.channels[0]), true);

const invalidReference = createScopedFixtureTriggerBinding({
  channelId: "fixture.slack.connected",
  event: "message.received",
  workflowId: "not.a.fixture.workflow",
  sourcePath: "/event/message",
  targetPath: "/input/request",
}, scope);
assert.equal(invalidReference.ok, false);
assert.equal(invalidReference.disabledReason, "workflow_not_found");

const invalidPointer = createScopedFixtureTriggerBinding({
  channelId: "fixture.slack.connected",
  event: "message.received",
  workflowId: "amplify.campaign.create",
  sourcePath: "event/message",
  targetPath: "/input/request",
}, scope);
assert.equal(invalidPointer.ok, false);
assert.equal(invalidPointer.disabledReason, "unsafe_json_pointer");

const created = createScopedFixtureTriggerBinding({
  channelId: "fixture.slack.connected",
  event: "reaction.added",
  workflowId: "amplify.campaign.create",
  sourcePath: "/event/reaction",
  targetPath: "/input/request",
}, scope);
assert.equal(created.ok, true);
assert.equal(created.binding.organizationId, scope.organizationId, "organization authority is injected by the server");
assert.equal(created.binding.workspaceId, scope.workspaceId, "workspace authority is injected by the server");
assert.equal(created.binding.runtimeMode, "fixture_only");
assert.equal(created.binding.enabled, false);

const mergedEnvelope = mergeTriggerBindingIntoEnvelope(defaultEnvelope, created.binding);
assert.equal(mergedEnvelope.triggerBindings.length, 3);
assert.equal(mergedEnvelope.triggerBindings.some((binding) => binding.event === "reaction.added"), true);
assert.equal("organizationId" in mergedEnvelope.triggerBindings.at(-1), false);

const snapshotInput = createChannelsSnapshotRecordInput(scope, mergedEnvelope);
assert.deepEqual(
  {
    source: snapshotInput.source,
    authority: snapshotInput.authority,
    route: snapshotInput.route,
    surface: snapshotInput.surface,
    pageType: snapshotInput.page_type,
  },
  {
    source: "browser-page-context",
    authority: "display-only",
    route: "/",
    surface: "channels",
    pageType: "standalone-agent-workspace",
  },
);

const memory = createInMemoryWorkspacePersistence();
memory.createSession({ id: scope.sessionId });
const older = memory.recordPageContextSnapshot(createChannelsSnapshotRecordInput(scope, defaultEnvelope));
const unrelatedNewer = memory.recordPageContextSnapshot({
  ...createChannelsSnapshotRecordInput(scope, mergedEnvelope),
  surface: "chat",
});
const newest = memory.recordPageContextSnapshot(createChannelsSnapshotRecordInput(scope, mergedEnvelope));
const listed = memory.listPageContextSnapshots(scope.sessionId);
assert.deepEqual(listed.map((entry) => entry.id), [newest.id, unrelatedNewer.id, older.id]);
assert.deepEqual(readLatestChannelsEnvelope(listed), mergedEnvelope, "latest exact channels snapshot wins");
assert.deepEqual(readLatestChannelsEnvelope([unrelatedNewer]), defaultEnvelope, "unrelated page context cannot become channel state");
assert.throws(
  () => memory.recordPageContextSnapshot({ ...snapshotInput, authority: "trusted-server-derived" }),
  /Browser page context snapshots must remain display-only/,
);

const asyncMemory = createAsyncWorkspacePersistenceAdapter(createInMemoryWorkspacePersistence());
await asyncMemory.createSession({ id: "async-channels-session" });
const asyncSnapshot = await asyncMemory.recordPageContextSnapshot({
  ...snapshotInput,
  session_id: "async-channels-session",
  context: { generic: true, nested: { count: 1 } },
});
const asyncListed = await asyncMemory.listPageContextSnapshots("async-channels-session");
assert.deepEqual(asyncListed[0].context, { generic: true, nested: { count: 1 } }, "generic context type survives async wrapper persistence");
assert.equal(asyncListed[0].id, asyncSnapshot.id);

console.log("channels-state tests passed");

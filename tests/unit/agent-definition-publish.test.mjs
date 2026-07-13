import assert from "node:assert/strict";
import { createInMemoryAgentDefinitionStore } from "../../apps/standalone-sveltekit/src/lib/server/agent-definition-store.ts";
import { definitionToRuntimeSettings } from "../../apps/standalone-sveltekit/src/lib/agent-runtime-adapter.ts";
import { sanitizeAgentRuntimeSettings } from "../../apps/standalone-sveltekit/src/lib/agent-settings.ts";
import { agentDefinitionSchema, marketplacePackageVersionSchema } from "../../packages/tool-contracts/dist/marketplace.js";

// Phase 4 (agent-creation-tool-plan-2026-07-13.md): definitions-as-data end to
// end -- persist a DRAFT, publish it into MarketplacePackageVersion{kind:"agent"}
// (immutable packageVersionId, D002), and prove a "next conversation" resolves
// the published version through the Task-3 adapter with zero code deploy.

// 1. Publish round trip: draft -> package version -> adapter -> settings.
const store = createInMemoryAgentDefinitionStore();
const draftDefinition = agentDefinitionSchema.parse({
  agentId: "sonik.agent.campaign-drafter",
  title: "Campaign Drafter",
  toolPolicy: { "booking-resources": "allow" },
  promptModules: { moduleIds: ["core"], overrides: { core: "Always confirm the audience segment." } },
  modelPolicy: { modelId: "anthropic/claude-haiku-4.5", requireZdr: true },
});

assert.equal(store.getDraft(draftDefinition.agentId), null, "no draft exists before saveDraft");
const savedDraft = store.saveDraft(draftDefinition);
assert.equal(savedDraft.agentId, draftDefinition.agentId, "saveDraft returns the persisted record");
assert.deepEqual(store.getDraft(draftDefinition.agentId)?.definition, draftDefinition, "getDraft round-trips the saved definition");

assert.throws(
  () => store.publish({ agentId: "sonik.agent.no-such-draft", packageSemver: "0.1.0" }),
  /No draft agent definition found/,
  "publish requires an existing draft",
);

const version = store.publish({ agentId: draftDefinition.agentId, packageSemver: "0.1.0" });
const parsedVersion = marketplacePackageVersionSchema.parse(version);
assert.equal(parsedVersion.packageVersionId, "sonik.agent.campaign-drafter@0.1.0", "publish mints packageId@semver");
assert.equal(parsedVersion.manifest.kind, "agent", "published version wraps kind:agent");
assert.deepEqual(parsedVersion.manifest.payload.agent, draftDefinition, "published manifest carries the draft definition byte-for-byte");
assert.equal("status" in parsedVersion.manifest, false, "no mutable draft/publish state field leaks onto the manifest (D002/D020)");

// D002: packageVersionId is immutable -- publishing the same version again is rejected.
assert.throws(
  () => store.publish({ agentId: draftDefinition.agentId, packageSemver: "0.1.0" }),
  /already published/,
  "re-publishing the same packageSemver is rejected (immutable packageVersionId)",
);

// A version bump publishes cleanly and becomes the new "current" resolution.
const editedDraft = agentDefinitionSchema.parse({ ...draftDefinition, title: "Campaign Drafter v2", toolPolicy: { "booking-resources": "allow", booking: "off" } });
store.saveDraft(editedDraft);

// P1: publish rejects any packageSemver that doesn't advance past the latest published version,
// not just an exact duplicate (D002 above only catches the identical-version case).
assert.throws(
  () => store.publish({ agentId: draftDefinition.agentId, packageSemver: "0.0.9" }),
  /monotonic increase required/,
  "publishing a semver lower than the latest published version is rejected",
);
assert.throws(
  () => store.publish({ agentId: draftDefinition.agentId, packageSemver: "0.1.0" }),
  /already published/,
  "publishing the exact latest-published semver again still hits the D002 duplicate check",
);

const versionTwo = store.publish({ agentId: draftDefinition.agentId, packageSemver: "0.2.0" });
assert.equal(store.listPublishedVersions(draftDefinition.agentId).length, 2, "both published versions are retained (append-only)");
assert.deepEqual(store.resolvePublished(draftDefinition.agentId), editedDraft, "resolvePublished resolves the MOST RECENT published version");
assert.notDeepEqual(versionTwo.manifest.payload.agent, version.manifest.payload.agent, "each published version is an immutable snapshot of the draft at publish time");

// Adapter consumes the resolved published definition exactly like any other definition.
const settingsFromPublished = definitionToRuntimeSettings(store.resolvePublished(draftDefinition.agentId));
assert.equal(settingsFromPublished.toolPermissionModes.booking, "off", "adapter maps the newly published definition's toolPolicy");
assert.equal(settingsFromPublished.modelId, "anthropic/claude-haiku-4.5", "adapter maps the newly published definition's modelPolicy");

// 2. "Next conversation runs the newly published definition" integration test
// (mock the store, real adapter) -- simulates exactly what the generate
// route's optional/fallback-safe resolution does. Session tweaks must be the
// RAW client-submitted settings (possibly undefined/sparse), never something
// already run through sanitizeAgentRuntimeSettings -- that always fully
// materializes every family with a default, which would mask every grant the
// published definition sets. definitionToRuntimeSettings sanitizes once, at
// the end, after merging.
function resolveAgentRuntimeSettingsForRequest(mockStore, requestBody) {
  const publishedAgentId = typeof requestBody?.publishedAgentId === "string" ? requestBody.publishedAgentId : null;
  const publishedDefinition = publishedAgentId ? mockStore.resolvePublished(publishedAgentId) : null;
  return publishedDefinition
    ? definitionToRuntimeSettings(publishedDefinition, requestBody?.agentSettings)
    : sanitizeAgentRuntimeSettings(requestBody?.agentSettings);
}

const mockStore = { resolvePublished: (agentId) => (agentId === "sonik.agent.mocked" ? editedDraft : null) };
const noPublishFallback = sanitizeAgentRuntimeSettings(undefined);

assert.deepEqual(
  resolveAgentRuntimeSettingsForRequest(mockStore, {}),
  noPublishFallback,
  "no publishedAgentId in the request -> byte-identical fallback to today's behavior",
);
assert.deepEqual(
  resolveAgentRuntimeSettingsForRequest(mockStore, { publishedAgentId: "sonik.agent.never-published" }),
  noPublishFallback,
  "a publishedAgentId with nothing published resolves null -> same fallback-safe behavior",
);
const nextConversationSettings = resolveAgentRuntimeSettingsForRequest(mockStore, { publishedAgentId: "sonik.agent.mocked" });
assert.equal(nextConversationSettings.toolPermissionModes.booking, "off", "next conversation resolves the newly published edit with zero code deploy");
assert.equal(nextConversationSettings.modelId, "anthropic/claude-haiku-4.5", "next conversation picks up the published definition's model policy too");

// A client-supplied sparse session tweak still wins for the one key it names,
// while every other grant from the published definition survives untouched.
const withSessionTweak = resolveAgentRuntimeSettingsForRequest(mockStore, {
  publishedAgentId: "sonik.agent.mocked",
  agentSettings: { toolPermissionModes: { "booking-resources": "ask" } },
});
assert.equal(withSessionTweak.toolPermissionModes["booking-resources"], "ask", "sparse session tweak overrides the one family it names");
assert.equal(withSessionTweak.toolPermissionModes.booking, "off", "the published definition's other grants survive a sparse session tweak untouched");

console.log("agent-definition-publish.test.mjs passed");

import assert from "node:assert/strict";
import {
  createInMemoryAgentDefinitionStore,
  wrapAgentDefinitionStoreAsync,
  createNeonAgentDefinitionStore,
} from "../../apps/standalone-sveltekit/src/lib/server/agent-definition-store.ts";
import { agentDefinitionSchema } from "../../packages/tool-contracts/dist/marketplace.js";

// Lane A (production-readiness-agent-creation-2026-07-13.md P0 #1): the same
// contract runs against every AsyncAgentDefinitionStore backing so a Neon swap
// can't silently change publish semantics -- D002 immutability (republishing
// a packageVersionId is rejected) + append-only published-version history.
// The Neon backing only runs when a DB is actually reachable (SONIK_AGENT_UI_
// DATABASE_URL / DATABASE_URL); it is skipped, not failed, otherwise, so this
// stays green with no DB configured (in-memory backing always runs).

async function assertAgentDefinitionStoreContract(store, label) {
  const draftDefinition = agentDefinitionSchema.parse({
    agentId: `sonik.agent.contract-test.${label}`,
    title: "Contract Test Agent",
    toolPolicy: { "booking-resources": "allow" },
  });

  assert.equal(await store.getDraft(draftDefinition.agentId), null, `${label}: no draft exists before saveDraft`);
  await store.saveDraft(draftDefinition);
  assert.deepEqual((await store.getDraft(draftDefinition.agentId))?.definition, draftDefinition, `${label}: getDraft round-trips the saved definition`);

  const versionOne = await store.publish({ agentId: draftDefinition.agentId, packageSemver: "0.1.0" });
  assert.equal(versionOne.packageVersionId, `${draftDefinition.agentId}@0.1.0`, `${label}: publish mints packageId@semver`);

  await assert.rejects(
    () => store.publish({ agentId: draftDefinition.agentId, packageSemver: "0.1.0" }),
    /already published/,
    `${label}: re-publishing the same packageVersionId is rejected (D002 immutability)`,
  );

  const editedDraft = agentDefinitionSchema.parse({ ...draftDefinition, title: "Contract Test Agent v2" });
  await store.saveDraft(editedDraft);
  const versionTwo = await store.publish({ agentId: draftDefinition.agentId, packageSemver: "0.2.0" });
  assert.notEqual(versionTwo.packageVersionId, versionOne.packageVersionId, `${label}: version bump publishes a distinct packageVersionId`);

  const allVersions = await store.listPublishedVersions(draftDefinition.agentId);
  assert.equal(allVersions.length, 2, `${label}: both published versions are retained (append-only)`);
  assert.deepEqual(await store.resolvePublished(draftDefinition.agentId), editedDraft, `${label}: resolvePublished resolves the MOST RECENT published version`);

  console.log(`agent-definition-store-contract: ${label} backing passed`);
}

await assertAgentDefinitionStoreContract(wrapAgentDefinitionStoreAsync(createInMemoryAgentDefinitionStore()), "in-memory");

const databaseUrl = process.env.SONIK_AGENT_UI_DATABASE_URL || process.env.DATABASE_URL;
if (databaseUrl) {
  await assertAgentDefinitionStoreContract(createNeonAgentDefinitionStore(databaseUrl), "neon");
} else {
  console.log("agent-definition-store-contract: skipping neon backing (no SONIK_AGENT_UI_DATABASE_URL/DATABASE_URL configured)");
}

console.log("agent-definition-store-contract.test.mjs passed");

import assert from "node:assert/strict";
import {
  AGENT_DEFINITION_ACTIONS,
  agentDefinitionScope,
  assertAgentDefinitionAuthorized,
  createInMemoryAgentDefinitionStore,
  wrapAgentDefinitionStoreAsync,
  createNeonAgentDefinitionStore,
  createNeonAgentDefinitionStoreFromSql,
  parseStoredAgentDefinition,
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
  const authority = { organizationId: `org-${label}`, userId: `user-${label}`, scopes: ["agent-definitions:*"] };
  const draftDefinition = agentDefinitionSchema.parse({
    agentId: `sonik.agent.contract-test.${label}`,
    title: "Contract Test Agent",
    toolPolicy: { "booking-resources": "allow" },
  });

  assert.equal(await store.getDraft(authority, draftDefinition.agentId), null, `${label}: no draft exists before saveDraft`);
  await store.saveDraft(authority, draftDefinition);
  assert.deepEqual((await store.getDraft(authority, draftDefinition.agentId))?.definition, draftDefinition, `${label}: getDraft round-trips the saved definition`);
  assert.equal(await store.deleteDraft(authority, draftDefinition.agentId), true, `${label}: deleteDraft reports a persisted deletion`);
  assert.equal(await store.getDraft(authority, draftDefinition.agentId), null, `${label}: deleteDraft removes the stored draft`);
  assert.equal(await store.deleteDraft(authority, draftDefinition.agentId), false, `${label}: deleting a missing draft reports false`);
  await store.saveDraft(authority, draftDefinition);

  const versionOne = await store.publish(authority, { agentId: draftDefinition.agentId, packageSemver: "0.1.0" });
  assert.equal(versionOne.packageVersionId, `${draftDefinition.agentId}@0.1.0`, `${label}: publish mints packageId@semver`);

  await assert.rejects(
    () => store.publish(authority, { agentId: draftDefinition.agentId, packageSemver: "0.1.0" }),
    /already published/,
    `${label}: re-publishing the same packageVersionId is rejected (D002 immutability)`,
  );

  const editedDraft = agentDefinitionSchema.parse({ ...draftDefinition, title: "Contract Test Agent v2" });
  await store.saveDraft(authority, editedDraft);

  await assert.rejects(
    () => store.publish(authority, { agentId: draftDefinition.agentId, packageSemver: "0.0.9" }),
    /monotonic increase required/,
    `${label}: publishing a semver lower than the latest published version is rejected`,
  );

  const versionTwo = await store.publish(authority, { agentId: draftDefinition.agentId, packageSemver: "0.2.0" });
  assert.notEqual(versionTwo.packageVersionId, versionOne.packageVersionId, `${label}: version bump publishes a distinct packageVersionId`);

  const allVersions = await store.listPublishedVersions(authority, draftDefinition.agentId);
  assert.equal(allVersions.length, 2, `${label}: both published versions are retained (append-only)`);
  assert.deepEqual(await store.resolvePublished(authority, draftDefinition.agentId), editedDraft, `${label}: resolvePublished resolves the MOST RECENT published version`);

  const foreignAuthority = { ...authority, organizationId: `${authority.organizationId}-foreign` };
  assert.equal(await store.getDraft(foreignAuthority, draftDefinition.agentId), null, `${label}: a second organization cannot read the draft`);
  assert.equal((await store.listPublishedVersions(foreignAuthority, draftDefinition.agentId)).length, 0, `${label}: a second organization cannot read published history`);
  await store.saveDraft(foreignAuthority, draftDefinition);
  const foreignVersion = await store.publish(foreignAuthority, { agentId: draftDefinition.agentId, packageSemver: "0.1.0" });
  assert.equal(foreignVersion.packageVersionId, versionOne.packageVersionId, `${label}: tenants may independently publish the same agentId and semver`);

  const publishOnlyDefinition = agentDefinitionSchema.parse({ agentId: `${draftDefinition.agentId}.publish-only`, title: "Publish Only" });
  await store.saveDraft(authority, publishOnlyDefinition);
  const publishOnlyAuthority = { ...authority, scopes: ["agent-definitions:publish"] };
  assert.equal(
    (await store.publish(publishOnlyAuthority, { agentId: publishOnlyDefinition.agentId, packageSemver: "0.1.0" })).packageVersionId,
    `${publishOnlyDefinition.agentId}@0.1.0`,
    `${label}: publish scope does not implicitly require view scope`,
  );
  await assert.rejects(
    () => store.listPublishedVersions(publishOnlyAuthority, publishOnlyDefinition.agentId),
    /agent_definition_view_forbidden/,
    `${label}: publish-only authority still cannot view published history`,
  );

  console.log(`agent-definition-store-contract: ${label} backing passed`);
}

function createDeterministicNeonSqlClient() {
  const drafts = new Map();
  const published = [];
  const key = (organizationId, agentId) => JSON.stringify([organizationId, agentId]);
  const queryText = (query) => query.strings.join(" ? ").replace(/\s+/g, " ").trim().toLowerCase();

  function sql(strings, ...params) {
    return { strings: [...strings], params };
  }

  sql.transactionTexts = [];

  sql.transaction = async (queries, options) => {
    sql.transactionTexts.push(queries.map(queryText));
    assert.equal(queries.length, 2, "Neon store operations establish context and execute one statement atomically");
    const [contextQuery, operation] = queries;
    assert.match(queryText(contextQuery), /set_request_context/);
    const [organizationId, userId] = contextQuery.params;
    const text = queryText(operation);
    const params = operation.params;

    if (text.startsWith("with locked_draft")) {
      assert.equal(options?.isolationLevel, "Serializable");
      assert.match(text, /for update/);
      const draft = drafts.get(key(params[0], params[1]));
      if (!draft) return [[], []];
      const duplicate = published.some((version) => version.organization_id === params[4] && version.package_version_id === params[5]);
      const latest = published.filter((version) => version.organization_id === params[2] && version.agent_id === params[3]).at(-1);
      const latestSemver = latest?.version.packageSemver ?? null;
      const nextParts = params[11].split(".").slice(0, 3).map(Number);
      const latestParts = latestSemver?.split(".").slice(0, 3).map(Number);
      const differingIndex = latestParts?.findIndex((part, index) => part !== nextParts[index]) ?? -1;
      const advances = latestParts == null || (differingIndex >= 0 && nextParts[differingIndex] > latestParts[differingIndex]);
      const draftChanged = JSON.stringify(draft.definition) !== JSON.stringify(JSON.parse(params[10]));
      const inserted = !duplicate && advances && !draftChanged;
      if (inserted) {
        published.push({
          organization_id: params[6],
          package_version_id: params[7],
          agent_id: draft.agent_id,
          version: JSON.parse(params[8]),
          created_by_user_id: params[9],
          seq: published.length + 1,
        });
      }
      return [[], [{
        agent_id: draft.agent_id,
        definition: structuredClone(draft.definition),
        duplicate,
        package_semver: latestSemver,
        draft_changed: draftChanged,
        package_version_id: inserted ? params[7] : null,
      }]];
    }

    if (text.includes("insert into sonik_agent_ui.agent_definition_drafts")) {
      const draftKey = key(params[0], params[1]);
      const existing = drafts.get(draftKey);
      const record = {
        organization_id: params[0],
        agent_id: params[1],
        definition: JSON.parse(params[2]),
        created_by_user_id: existing?.created_by_user_id ?? params[3],
        updated_by_user_id: params[4],
        updated_at: params[5],
      };
      drafts.set(draftKey, record);
      return [[], [structuredClone(record)]];
    }

    if (text.startsWith("delete from sonik_agent_ui.agent_definition_drafts")) {
      const draftKey = key(params[0], params[1]);
      const deleted = drafts.get(draftKey);
      drafts.delete(draftKey);
      return [[], deleted ? [{ agent_id: deleted.agent_id }] : []];
    }

    if (text.includes("from sonik_agent_ui.agent_definition_drafts")) {
      assert.equal(params[0], organizationId);
      if (params.length === 1) {
        return [[], [...drafts.values()].filter((record) => record.organization_id === params[0]).map((record) => structuredClone(record))];
      }
      const record = drafts.get(key(params[0], params[1]));
      if (!record) return [[], []];
      if (text.startsWith("select agent_id, definition")) {
        return [[], [{ agent_id: record.agent_id, definition: structuredClone(record.definition) }]];
      }
      return [[], [structuredClone(record)]];
    }

    if (text.startsWith("select 1 from sonik_agent_ui.agent_definition_published_versions")) {
      return [[], published.some((version) => version.organization_id === params[0] && version.package_version_id === params[1]) ? [{ "?column?": 1 }] : []];
    }

    if (text.includes("select version ->> 'packagesemver'")) {
      const latest = published.filter((version) => version.organization_id === params[0] && version.agent_id === params[1]).at(-1);
      return [[], latest ? [{ package_semver: latest.version.packageSemver }] : []];
    }

    if (text.includes("insert into sonik_agent_ui.agent_definition_published_versions")) {
      assert.equal(params[0], organizationId);
      assert.equal(params[4], userId);
      published.push({
        organization_id: params[0],
        package_version_id: params[1],
        agent_id: params[2],
        version: JSON.parse(params[3]),
        created_by_user_id: params[4],
        seq: published.length + 1,
      });
      return [[], [{ package_version_id: params[1] }]];
    }

    if (text.startsWith("select version from sonik_agent_ui.agent_definition_published_versions")) {
      const versions = published.filter((version) => version.organization_id === params[0] && version.agent_id === params[1]);
      if (text.includes("order by seq desc")) {
        const latest = versions.at(-1);
        return [[], latest ? [{ version: structuredClone(latest.version) }] : []];
      }
      return [[], versions.map((version) => ({ version: structuredClone(version.version) }))];
    }

    throw new Error(`Unhandled deterministic Neon SQL query: ${text}`);
  };

  sql.corruptDraftDefinition = (organizationId, agentId, definition) => {
    drafts.get(key(organizationId, agentId)).definition = structuredClone(definition);
  };

  return sql;
}

await assertAgentDefinitionStoreContract(wrapAgentDefinitionStoreAsync(createInMemoryAgentDefinitionStore()), "in-memory");
const contractSql = createDeterministicNeonSqlClient();
await assertAgentDefinitionStoreContract(createNeonAgentDefinitionStoreFromSql(contractSql), "neon-sql-client");
assert.ok(
  contractSql.transactionTexts.some(
    (queries) => queries.length === 2
      && queries[1].includes("for update")
      && queries[1].includes("agent_definition_published_versions")
      && queries[1].includes("insert into"),
  ),
  "Neon publish locks the draft and checks/inserts the published version in one transaction",
);

const corruptSql = createDeterministicNeonSqlClient();
const corruptStore = createNeonAgentDefinitionStoreFromSql(corruptSql);
const corruptAuthority = { organizationId: "org-corrupt", userId: "user-corrupt", scopes: ["agent-definitions:*"] };
const corruptDefinition = agentDefinitionSchema.parse({ agentId: "sonik.agent.corrupt", title: "Corrupt Stored Agent" });
await corruptStore.saveDraft(corruptAuthority, corruptDefinition);
corruptSql.corruptDraftDefinition(corruptAuthority.organizationId, corruptDefinition.agentId, { title: "Missing agent id" });
await assert.rejects(() => corruptStore.getDraft(corruptAuthority, corruptDefinition.agentId), /agentId/, "getDraft rejects an invalid stored definition");
await assert.rejects(() => corruptStore.listDrafts(corruptAuthority), /agentId/, "listDrafts rejects an invalid stored definition");
await assert.rejects(
  () => corruptStore.publish(corruptAuthority, { agentId: corruptDefinition.agentId, packageSemver: "0.1.0" }),
  /agentId/,
  "publish rejects an invalid stored definition",
);

const storedDefinition = { agentId: "sonik.agent.stored", title: "Stored Agent" };
const parsedObjectDefinition = parseStoredAgentDefinition(storedDefinition);
storedDefinition.title = "Mutated";
assert.equal(parsedObjectDefinition.title, "Stored Agent", "stored JSON objects are validated and cloned");
assert.equal(parseStoredAgentDefinition(JSON.stringify(storedDefinition)).title, "Mutated", "stored JSON strings are parsed and validated");
assert.throws(() => parseStoredAgentDefinition('{"title":"Missing agent id"}'), /agentId/, "invalid stored definitions fail validation");

const isolatedStore = createInMemoryAgentDefinitionStore();
const isolatedAuthority = { organizationId: "org-isolation", userId: "user-isolation", scopes: ["agent-definitions:*"] };
const mutableInput = agentDefinitionSchema.parse({
  agentId: "sonik.agent.mutation-isolation",
  title: "Mutation Isolation",
  toolPolicy: { booking: "allow" },
  promptModules: { moduleIds: ["core"], overrides: { core: "Original" } },
  modelPolicy: { modelId: "anthropic/claude-haiku-4.5", requireZdr: true },
});
const savedReturn = isolatedStore.saveDraft(isolatedAuthority, mutableInput);
mutableInput.promptModules.overrides.core = "mutated input";
savedReturn.definition.promptModules.moduleIds.push("mutated-save-return");
assert.deepEqual(isolatedStore.getDraft(isolatedAuthority, mutableInput.agentId)?.definition.promptModules, { moduleIds: ["core"], overrides: { core: "Original" } });

const getReturn = isolatedStore.getDraft(isolatedAuthority, mutableInput.agentId);
getReturn.definition.toolPolicy.booking = "off";
const listReturn = isolatedStore.listDrafts(isolatedAuthority);
listReturn[0].definition.modelPolicy.modelId = "mutated-list-return";
assert.equal(isolatedStore.getDraft(isolatedAuthority, mutableInput.agentId)?.definition.toolPolicy.booking, "allow");
assert.equal(isolatedStore.getDraft(isolatedAuthority, mutableInput.agentId)?.definition.modelPolicy.modelId, "anthropic/claude-haiku-4.5");

const publishReturn = isolatedStore.publish(isolatedAuthority, { agentId: mutableInput.agentId, packageSemver: "0.1.0" });
publishReturn.manifest.payload.agent.promptModules.overrides.core = "mutated-publish-return";
const publishedListReturn = isolatedStore.listPublishedVersions(isolatedAuthority, mutableInput.agentId);
publishedListReturn[0].manifest.payload.agent.promptModules.moduleIds.push("mutated-published-list-return");
const resolvedReturn = isolatedStore.resolvePublished(isolatedAuthority, mutableInput.agentId);
resolvedReturn.modelPolicy.modelId = "mutated-resolve-return";
isolatedStore.saveDraft(isolatedAuthority, agentDefinitionSchema.parse({ ...mutableInput, title: "Later Draft Edit" }));
const immutablePublished = isolatedStore.resolvePublished(isolatedAuthority, mutableInput.agentId);
assert.equal(immutablePublished.title, "Mutation Isolation");
assert.deepEqual(immutablePublished.promptModules, { moduleIds: ["core"], overrides: { core: "Original" } });
assert.equal(immutablePublished.modelPolicy.modelId, "anthropic/claude-haiku-4.5");

assert.throws(
  () => assertAgentDefinitionAuthorized(null, "view"),
  /owner_context_required/,
  "missing trusted owner context fails closed",
);
for (const action of AGENT_DEFINITION_ACTIONS) {
  assert.doesNotThrow(
    () => assertAgentDefinitionAuthorized({ organizationId: "org-actions", userId: "user-actions", scopes: [agentDefinitionScope(action)] }, action),
    `${action} has an explicit standalone authorization scope`,
  );
  assert.throws(
    () => assertAgentDefinitionAuthorized({ organizationId: "org-actions", userId: "user-actions", scopes: [] }, action),
    new RegExp(`${action}_forbidden`),
    `${action} fails closed without its explicit authorization scope`,
  );
}

const databaseUrl = process.env.SONIK_AGENT_UI_DATABASE_URL || process.env.DATABASE_URL;
if (databaseUrl) {
  await assertAgentDefinitionStoreContract(createNeonAgentDefinitionStore(databaseUrl), "neon");
} else {
  console.log("agent-definition-store-contract: skipping neon backing (no SONIK_AGENT_UI_DATABASE_URL/DATABASE_URL configured)");
}

console.log("agent-definition-store-contract.test.mjs passed");

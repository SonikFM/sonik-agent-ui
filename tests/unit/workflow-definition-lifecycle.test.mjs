import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { train0WorkflowFixtures } from "../../packages/tool-contracts/dist/workflow-vnext-fixtures.js";
import { createInMemoryWorkflowDefinitionRepository, workflowDefinitionDigest } from "../../apps/standalone-sveltekit/src/lib/server/workflow-definition-repository.ts";
import { handleWorkflowDefinitionsAction } from "../../apps/standalone-sveltekit/src/lib/server/workflow-definitions.ts";

const host = { source: "amplify-embedded", sessionId: "session-a", userId: "user-a", principalId: "user-a", organizationId: "org-a", authenticated: true, scopes: [] };
const otherUser = { ...host, sessionId: "session-b", userId: "user-b", principalId: "user-b" };
const repository = createInMemoryWorkflowDefinitionRepository();
const call = (action, hostSession = host) => handleWorkflowDefinitionsAction(action, { hostSession, repository });
const digest = (character) => `sha256:${character.repeat(64)}`;

const definition = structuredClone(train0WorkflowFixtures.linear);
const reorderedDefinition = Object.fromEntries(Object.entries(definition).reverse());
assert.equal(workflowDefinitionDigest(definition), workflowDefinitionDigest(reorderedDefinition), "digest is independent of object key insertion order");
const created = await call({ action: "create", definition });
assert.equal(created.ok, true);
assert.equal(created.draft.draftRevision, 0);
assert.equal(created.draft.definitionDigest, workflowDefinitionDigest(definition));
assert.deepEqual(await call({ action: "get", workflowId: definition.workflowId }, otherUser), { ok: true, draft: null }, "drafts are owner scoped");

const edited = { ...definition, title: "Linear edited", definitionVersion: 2 };
const [winner, loser] = await Promise.all([
  call({ action: "update", workflowId: definition.workflowId, expectedRevision: 0, definition: edited }),
  call({ action: "update", workflowId: definition.workflowId, expectedRevision: 0, definition: { ...edited, title: "stale writer" } }),
]);
assert.equal([winner, loser].filter((result) => result.ok).length, 1, "expectedRevision admits exactly one concurrent writer");
assert.equal([winner, loser].find((result) => !result.ok).reason, "revision_conflict_or_archived");
const draft = (await call({ action: "get", workflowId: definition.workflowId })).draft;
assert.equal(draft.draftRevision, 1);

const workflowVersionId = `${definition.workflowId}@1`;
const pins = {
  organizationId: host.organizationId,
  workflowVersionId,
  definitionDigest: draft.definitionDigest,
  agentPublishedVersionId: "agent@1",
  nodeDescriptorsDigest: digest("a"),
  capabilityVersionsDigest: digest("b"),
  toolPackVersionsDigest: digest("c"),
  skillVersionsDigest: digest("d"),
  runtimePolicyDigest: digest("e"),
};
const published = await call({ action: "publish", workflowId: definition.workflowId, expectedRevision: 1, workflowVersionId, dependencyPins: pins });
assert.equal(published.ok, true);
assert.deepEqual(published.version.dependencyPins, pins, "publication stores the full dependency pin set");
assert.equal((await call({ action: "publish", workflowId: definition.workflowId, expectedRevision: 1, workflowVersionId, dependencyPins: pins })).ok, false, "published ids are immutable");
assert.equal((await call({ action: "resolve", pin: { kind: "published", workflowVersionId, definitionDigest: draft.definitionDigest } })).definition.workflowVersionId, workflowVersionId);
assert.equal((await call({ action: "resolve", pin: { kind: "published", workflowVersionId, definitionDigest: digest("f") } })).definition, null, "digest is part of the exact published pin");

const next = await call({ action: "update", workflowId: definition.workflowId, expectedRevision: 1, definition: { ...edited, title: "post-publish edit", definitionVersion: 3 } });
assert.equal(next.ok, true);
assert.equal((await call({ action: "resolve", pin: { kind: "draft", workflowId: definition.workflowId, draftRevision: 1, definitionDigest: draft.definitionDigest } })).definition, null, "a stale draft pin never floats to a newer revision");
assert.equal((await call({ action: "resolve", pin: { kind: "published", workflowVersionId, definitionDigest: draft.definitionDigest } })).definition.definition.title, draft.definition.title, "published content remains immutable after draft edits");

const cloned = await call({ action: "clone", source: { kind: "published", workflowVersionId, definitionDigest: draft.definitionDigest }, targetWorkflowId: "train0.linear-copy" });
assert.equal(cloned.ok, true);
assert.equal(cloned.draft.draftRevision, 0);
assert.equal(cloned.draft.definition.workflowId, "train0.linear-copy");
assert.notEqual(cloned.draft.definitionDigest, draft.definitionDigest, "clone gets a digest for its new identity");

const archived = await call({ action: "archive", workflowId: definition.workflowId, expectedRevision: 2 });
assert.equal(archived.ok, true);
assert.ok(archived.draft.archivedAt);
assert.equal((await call({ action: "list" })).drafts.some((row) => row.workflowId === definition.workflowId), false);
assert.equal((await call({ action: "list", includeArchived: true })).drafts.some((row) => row.workflowId === definition.workflowId), true);
assert.equal((await call({ action: "update", workflowId: definition.workflowId, expectedRevision: 3, definition: edited })).ok, false, "archived drafts reject writes");
assert.deepEqual(await call({ action: "list" }, null), { ok: false, reason: "authenticated_workspace_owner_required" });

const [migration, route, repositorySource] = await Promise.all([
  readFile(new URL("../../packages/workspace-session/migrations/postgres/0016_workflow_definitions.sql", import.meta.url), "utf8"),
  readFile(new URL("../../apps/standalone-sveltekit/src/routes/api/workflow-definitions/+server.ts", import.meta.url), "utf8"),
  readFile(new URL("../../apps/standalone-sveltekit/src/lib/server/workflow-definition-repository.ts", import.meta.url), "utf8"),
]);
for (const table of ["workflow_definition_drafts", "workflow_definition_published_versions"]) {
  assert.match(migration, new RegExp(`alter table sonik_agent_ui\\.${table} force row level security`, "i"));
  assert.match(migration, new RegExp(`create policy ${table === "workflow_definition_published_versions" ? "workflow_definition_versions_scope" : `${table}_scope`}`));
}
assert.match(migration, /before update or delete[\s\S]*reject_published_workflow_mutation/i, "database rejects published mutation");
assert.match(migration, /jsonb_typeof\(dependency_pins\) = 'object'/i);
assert.match(repositorySource, /draft_revision = draft_revision \+ 1[\s\S]*draft_revision = \$4[\s\S]*returning/i, "cloud draft writes use one CAS statement");
assert.match(repositorySource, /insert into sonik_agent_ui\.workflow_definition_published_versions[\s\S]*select[\s\S]*draft_revision = \$4[\s\S]*definition_digest = \$6/i, "cloud publish atomically snapshots the expected draft");
assert.match(route, /createAgentHostSessionEnvelope\(event\)/);
assert.match(route, /status: 401/);

console.log("workflow-definition-lifecycle.test.mjs passed");

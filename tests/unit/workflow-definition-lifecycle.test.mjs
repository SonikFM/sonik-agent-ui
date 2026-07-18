import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { train0InvalidWorkflowFixtures, train0WorkflowFixtures } from "../../packages/tool-contracts/dist/workflow-vnext-fixtures.js";
import { createInMemoryWorkflowDefinitionRepository, workflowDefinitionDigest } from "../../apps/standalone-sveltekit/src/lib/server/workflow-definition-repository.ts";
import { handleWorkflowDefinitionsAction } from "../../apps/standalone-sveltekit/src/lib/server/workflow-definitions.ts";

const host = { source: "amplify-embedded", sessionId: "session-a", userId: "user-a", principalId: "user-a", organizationId: "org-a", authenticated: true, scopes: [] };
const otherUser = { ...host, sessionId: "session-b", userId: "user-b", principalId: "user-b" };
const otherOrganization = { ...host, sessionId: "session-c", organizationId: "org-b" };
const repository = createInMemoryWorkflowDefinitionRepository();
const call = (action, hostSession = host) => handleWorkflowDefinitionsAction(action, { hostSession, repository });
const digest = (character) => `sha256:${character.repeat(64)}`;

async function assertPublishRejected(definition, expectedIssue) {
  const rejectedRepository = createInMemoryWorkflowDefinitionRepository();
  const rejectedCall = (action) => handleWorkflowDefinitionsAction(action, { hostSession: host, repository: rejectedRepository });
  assert.equal((await rejectedCall({ action: "create", definition })).ok, true);
  const draft = (await rejectedCall({ action: "get", workflowId: definition.workflowId })).draft;
  const workflowVersionId = `${definition.workflowId}@1`;
  const result = await rejectedCall({
    action: "publish",
    workflowId: definition.workflowId,
    expectedRevision: 0,
    workflowVersionId,
    dependencyPins: {
      organizationId: host.organizationId,
      workflowVersionId,
      definitionDigest: draft.definitionDigest,
      agentPublishedVersionId: "agent@1",
      nodeDescriptorsDigest: digest("a"),
      capabilityVersionsDigest: digest("b"),
      toolPackVersionsDigest: digest("c"),
      skillVersionsDigest: digest("d"),
      runtimePolicyDigest: digest("e"),
    },
  });
  assert.equal(result.ok, false, `${expectedIssue} must block publication`);
  assert.ok(result.issues.some(({ code }) => code === expectedIssue), `canonical validation must report ${expectedIssue}`);
  assert.deepEqual(await rejectedRepository.listPublished({ organizationId: host.organizationId, userId: host.userId }, definition.workflowId), []);
}

const definition = structuredClone(train0WorkflowFixtures.linear);
const reorderedDefinition = Object.fromEntries(Object.entries(definition).reverse());
assert.equal(workflowDefinitionDigest(definition), workflowDefinitionDigest(reorderedDefinition), "digest is independent of object key insertion order");
const created = await call({ action: "create", definition });
assert.equal(created.ok, true);
assert.equal(created.draft.draftRevision, 0);
assert.equal(created.draft.definitionDigest, workflowDefinitionDigest(definition));
assert.deepEqual(await call({ action: "get", workflowId: definition.workflowId }, otherUser), { ok: true, draft: null }, "drafts are owner scoped");

const organizerRepository = createInMemoryWorkflowDefinitionRepository();
const organizerCall = (action) => handleWorkflowDefinitionsAction(action, { hostSession: host, repository: organizerRepository });
const organizerDefinition = structuredClone(definition);
organizerDefinition.nodes[0].config = { label: "Start", parameters: { timezone: "UTC" }, executor: { handler: "hidden" } };
assert.equal((await organizerCall({ action: "create", definition: organizerDefinition })).ok, true);
const organizerPatched = await organizerCall({
  action: "organizer_patch",
  workflowId: organizerDefinition.workflowId,
  patch: {
    expectedDraftRevision: 0,
    edits: [
      { kind: "parameter_edit", path: `parameters.${organizerDefinition.nodes[0].nodeId}.timezone`, value: "America/New_York" },
      { kind: "safe_patch", path: `nodes.${organizerDefinition.nodes[0].nodeId}.config.label`, value: "Begin" },
    ],
  },
});
assert.equal(organizerPatched.ok, true);
assert.equal(organizerPatched.draft.draftRevision, 1);
assert.deepEqual(organizerPatched.appliedPaths, [`parameters.${organizerDefinition.nodes[0].nodeId}.timezone`, `nodes.${organizerDefinition.nodes[0].nodeId}.config.label`]);
assert.equal(organizerPatched.draft.definition.nodes[0].config.parameters.timezone, "America/New_York");
assert.equal(organizerPatched.draft.definition.nodes[0].config.label, "Begin");
assert.deepEqual(organizerPatched.draft.definition.nodes[0].config.executor, { handler: "hidden" }, "hidden config is preserved, not exposed to organizer edits");
assert.equal((await organizerCall({ action: "organizer_patch", workflowId: organizerDefinition.workflowId, patch: { expectedDraftRevision: 0, edits: [{ kind: "safe_patch", path: `nodes.${organizerDefinition.nodes[0].nodeId}.config.label`, value: "stale" }] } })).reason, "revision_conflict_or_archived");
for (const [path, reason] of [
  [`parameters.${organizerDefinition.nodes[0].nodeId}.undeclared`, "organizer_parameter_not_declared"],
  [`nodes.${organizerDefinition.nodes[0].nodeId}.config.executor.handler`, "organizer_patch_path_not_allowlisted"],
  [`nodes.${organizerDefinition.nodes[0].nodeId}.config.bindings.hidden`, "organizer_patch_path_not_allowlisted"],
]) {
  const rejected = await organizerCall({ action: "organizer_patch", workflowId: organizerDefinition.workflowId, patch: { expectedDraftRevision: 1, edits: [{ kind: path.startsWith("parameters.") ? "parameter_edit" : "safe_patch", path, value: "mutated" }] } });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, reason);
}
const organizerAfterRejections = await organizerCall({ action: "get", workflowId: organizerDefinition.workflowId });
assert.equal(organizerAfterRejections.draft.draftRevision, 1, "rejected organizer patches never advance the draft");
assert.equal(organizerAfterRejections.draft.definition.entryNodeId, organizerDefinition.entryNodeId);
assert.deepEqual(organizerAfterRejections.draft.definition.edges, organizerDefinition.edges);

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
assert.equal(published.version.userId, host.userId, "published rows retain publisher provenance");
assert.equal((await call({ action: "publish", workflowId: definition.workflowId, expectedRevision: 1, workflowVersionId, dependencyPins: pins })).ok, false, "published ids are immutable");
assert.equal((await call({ action: "resolve", pin: { kind: "published", workflowVersionId, definitionDigest: draft.definitionDigest } })).definition.workflowVersionId, workflowVersionId);
assert.equal((await call({ action: "resolve", pin: { kind: "published", workflowVersionId, definitionDigest: draft.definitionDigest } }, otherUser)).definition.workflowVersionId, workflowVersionId, "same-organization users resolve published versions");
assert.deepEqual((await call({ action: "versions", workflowId: definition.workflowId }, otherUser)).versions.map(({ workflowVersionId: id }) => id), [workflowVersionId], "same-organization users list published versions");
assert.equal((await call({ action: "resolve", pin: { kind: "published", workflowVersionId, definitionDigest: draft.definitionDigest } }, otherOrganization)).definition, null, "published versions remain cross-organization isolated");
assert.equal((await call({ action: "create", definition }, otherUser)).ok, true);
const otherUserDraft = (await call({ action: "get", workflowId: definition.workflowId }, otherUser)).draft;
assert.equal((await call({ action: "publish", workflowId: definition.workflowId, expectedRevision: 0, workflowVersionId, dependencyPins: { ...pins, definitionDigest: otherUserDraft.definitionDigest } }, otherUser)).reason, "revision_conflict_or_version_exists", "published IDs are unique across an organization, not per publisher");
assert.equal((await call({ action: "resolve", pin: { kind: "published", workflowVersionId, definitionDigest: digest("f") } })).definition, null, "digest is part of the exact published pin");

const unsupportedVersion = structuredClone(train0WorkflowFixtures.linear);
unsupportedVersion.workflowId = "train0.unsupported-version";
unsupportedVersion.nodes[0].typeVersion = 2;
const cycle = structuredClone(train0WorkflowFixtures.linear);
cycle.workflowId = "train0.cycle";
cycle.edges.push({ edgeId: "cycle", from: "work", to: "start", default: false });
const missingApprovalBinding = structuredClone(train0WorkflowFixtures.approval);
missingApprovalBinding.workflowId = "train0.missing-approval-binding";
delete missingApprovalBinding.nodes.find(({ nodeType }) => nodeType === "tool_commit").effectBinding;
const invalidDescriptorConfig = structuredClone(train0WorkflowFixtures.linear);
invalidDescriptorConfig.workflowId = "train0.invalid-descriptor-config";
invalidDescriptorConfig.nodes[0].config = [];
await assertPublishRejected(train0InvalidWorkflowFixtures.unsupportedNode, "node_not_publishable");
await assertPublishRejected(unsupportedVersion, "unsupported_node_version");
await assertPublishRejected(cycle, "cycle");
await assertPublishRejected(missingApprovalBinding, "effect_binding_required");
await assertPublishRejected(invalidDescriptorConfig, "config_schema_invalid");

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

const [migration, organizationScopeMigration, route, repositorySource] = await Promise.all([
  readFile(new URL("../../packages/workspace-session/migrations/postgres/0016_workflow_definitions.sql", import.meta.url), "utf8"),
  readFile(new URL("../../packages/workspace-session/migrations/postgres/0019_organization_scoped_workflow_versions.sql", import.meta.url), "utf8"),
  readFile(new URL("../../apps/standalone-sveltekit/src/routes/api/workflow-definitions/+server.ts", import.meta.url), "utf8"),
  readFile(new URL("../../apps/standalone-sveltekit/src/lib/server/workflow-definition-repository.ts", import.meta.url), "utf8"),
]);
for (const table of ["workflow_definition_drafts", "workflow_definition_published_versions"]) {
  assert.match(migration, new RegExp(`alter table sonik_agent_ui\\.${table} force row level security`, "i"));
  assert.match(migration, new RegExp(`create policy ${table === "workflow_definition_published_versions" ? "workflow_definition_versions_scope" : `${table}_scope`}`));
}
assert.match(migration, /before update or delete[\s\S]*reject_published_workflow_mutation/i, "database rejects published mutation");
assert.match(migration, /jsonb_typeof\(dependency_pins\) = 'object'/i);
assert.match(organizationScopeMigration, /create unique index concurrently[\s\S]*\(organization_id, workflow_version_id\)[\s\S]*primary key using index/i, "published identity is organization scoped without a blocking index build");
assert.match(organizationScopeMigration, /using \(organization_id = sonik_agent_ui\.current_organization_id\(\)\)[\s\S]*with check \(organization_id = sonik_agent_ui\.current_organization_id\(\) and user_id = sonik_agent_ui\.current_user_id\(\)\)/i, "same-org reads retain publisher-scoped inserts");
assert.match(repositorySource, /draft_revision = draft_revision \+ 1[\s\S]*draft_revision = \$4[\s\S]*returning/i, "cloud draft writes use one CAS statement");
assert.match(repositorySource, /insert into sonik_agent_ui\.workflow_definition_published_versions[\s\S]*select[\s\S]*draft_revision = \$4[\s\S]*definition_digest = \$6/i, "cloud publish atomically snapshots the expected draft");
assert.match(route, /createAgentHostSessionEnvelope\(event\)/);
assert.match(route, /status: 401/);
assert.match(route, /organizer_patch/);

console.log("workflow-definition-lifecycle.test.mjs passed");

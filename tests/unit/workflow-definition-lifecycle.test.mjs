import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { train0InvalidWorkflowFixtures, train0WorkflowFixtures } from "../../packages/tool-contracts/dist/workflow-vnext-fixtures.js";
import { createInMemoryWorkflowDefinitionRepository, workflowDefinitionDigest } from "../../apps/standalone-sveltekit/src/lib/server/workflow-definition-repository.ts";
import { handleWorkflowDefinitionsAction } from "../../apps/standalone-sveltekit/src/lib/server/workflow-definitions.ts";

const host = { source: "amplify-embedded", sessionId: "session-a", userId: "user-a", principalId: "user-a", organizationId: "org-a", authenticated: true, scopes: [] };
const otherUser = { ...host, sessionId: "session-b", userId: "user-b", principalId: "user-b" };
const otherOrganization = { ...host, sessionId: "session-c", organizationId: "org-b" };
const repository = createInMemoryWorkflowDefinitionRepository();
const call = (action, hostSession = host) => handleWorkflowDefinitionsAction(action, { hostSession, repository, capabilityReadiness: readinessFor(definition) });
const digest = (character) => `sha256:${character.repeat(64)}`;

function readinessFor(workflow) {
  return [...new Set([...workflow.facadeToolIds, ...workflow.nodes.flatMap((node) => node.capabilityPins)])].map((capabilityId) => ({
    capabilityId, effectMode: "read", registered: true, implemented: true, authorable: true, definitionCompatible: true,
    mounted: true, contextReady: true, grantReady: true, previewable: true, committable: true, killSwitched: false,
    versionPinned: true, callable: true, reasonCodes: [], nextAction: null,
  }));
}

{
  const failClosedRepository = createInMemoryWorkflowDefinitionRepository();
  const failClosedDefinition = structuredClone(train0WorkflowFixtures.linear);
  assert.equal((await handleWorkflowDefinitionsAction({ action: "create", definition: failClosedDefinition }, { hostSession: host, repository: failClosedRepository })).ok, true);
  const failClosedDraft = await failClosedRepository.getDraft({ organizationId: host.organizationId, userId: host.userId }, failClosedDefinition.workflowId);
  const failClosedVersionId = `${failClosedDefinition.workflowId}@missing-readiness`;
  const missingReadiness = await handleWorkflowDefinitionsAction({
    action: "publish",
    workflowId: failClosedDefinition.workflowId,
    expectedRevision: 0,
    dependencyPins: {
      agentPublishedVersionId: "agent@1",
      nodeDescriptorsDigest: digest("a"),
      capabilityVersionsDigest: digest("b"),
      toolPackVersionsDigest: digest("c"),
      skillVersionsDigest: digest("d"),
      runtimePolicyDigest: digest("e"),
    },
  }, { hostSession: host, repository: failClosedRepository });
  assert.equal(missingReadiness.reason, "capability_readiness_required", "publish defaults deny when current readiness authority is absent");
}

async function assertPublishRejected(definition, expectedIssue) {
  const rejectedRepository = createInMemoryWorkflowDefinitionRepository();
  const rejectedCall = (action) => handleWorkflowDefinitionsAction(action, { hostSession: host, repository: rejectedRepository, capabilityReadiness: readinessFor(definition) });
  assert.equal((await rejectedCall({ action: "create", definition })).ok, true);
  const draft = (await rejectedCall({ action: "get", workflowId: definition.workflowId })).draft;
  const workflowVersionId = `${definition.workflowId}@1`;
  const result = await rejectedCall({
    action: "publish",
    workflowId: definition.workflowId,
    expectedRevision: 0,
    dependencyPins: {
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
organizerDefinition.nodes[0].config = {
  title: "Start",
  instructions: "Greet the guest",
  knowledge: ["venue-hours"],
  capabilities: ["booking.read.availability"],
  parameters: { timezone: "UTC" },
  settings: { handler: "hidden" },
  executor: { handler: "hidden" },
};
assert.equal((await organizerCall({ action: "create", definition: organizerDefinition })).ok, true);
const organizerFields = await organizerCall({ action: "organizer_fields", workflowId: organizerDefinition.workflowId });
assert.equal(organizerFields.ok, true);
assert.deepEqual(organizerFields.parameters.map(({ path, type }) => [path, type]), [
  [`nodes.${organizerDefinition.nodes[0].nodeId}.config.title`, "text"],
  [`nodes.${organizerDefinition.nodes[0].nodeId}.config.instructions`, "textarea"],
  [`nodes.${organizerDefinition.nodes[0].nodeId}.config.knowledge`, "string_list"],
  [`nodes.${organizerDefinition.nodes[0].nodeId}.config.capabilities`, "string_list"],
]);
assert.deepEqual(organizerFields.safePatchPaths, organizerFields.parameters.map(({ path }) => path), "the server is the single authority for organizer-safe fields");
assert.ok(organizerFields.safePatchPaths.every((path) => !/settings|executor|nodes\.[^.]+\.(?:nodeType|bindings)/.test(path)), "hidden config and topology are never declared");
const organizerPatched = await organizerCall({
  action: "organizer_patch",
  workflowId: organizerDefinition.workflowId,
  patch: {
    expectedDraftRevision: 0,
    edits: [
      { kind: "parameter_edit", path: `parameters.${organizerDefinition.nodes[0].nodeId}.timezone`, value: "America/New_York" },
      { kind: "safe_patch", path: `nodes.${organizerDefinition.nodes[0].nodeId}.config.title`, value: "Begin" },
      { kind: "safe_patch", path: `nodes.${organizerDefinition.nodes[0].nodeId}.config.instructions`, value: "Confirm the guest request" },
      { kind: "safe_patch", path: `nodes.${organizerDefinition.nodes[0].nodeId}.config.knowledge`, value: ["venue-hours", "booking-policy"] },
      { kind: "safe_patch", path: `nodes.${organizerDefinition.nodes[0].nodeId}.config.capabilities`, value: ["booking.read.availability", "booking.read.reservations"] },
    ],
  },
});
assert.equal(organizerPatched.ok, true);
assert.equal(organizerPatched.draft.draftRevision, 1);
assert.deepEqual(organizerPatched.appliedPaths, [
  `parameters.${organizerDefinition.nodes[0].nodeId}.timezone`,
  `nodes.${organizerDefinition.nodes[0].nodeId}.config.title`,
  `nodes.${organizerDefinition.nodes[0].nodeId}.config.instructions`,
  `nodes.${organizerDefinition.nodes[0].nodeId}.config.knowledge`,
  `nodes.${organizerDefinition.nodes[0].nodeId}.config.capabilities`,
]);
assert.equal(organizerPatched.draft.definition.nodes[0].config.parameters.timezone, "America/New_York");
assert.equal(organizerPatched.draft.definition.nodes[0].config.title, "Begin");
assert.equal(organizerPatched.draft.definition.nodes[0].config.instructions, "Confirm the guest request");
assert.deepEqual(organizerPatched.draft.definition.nodes[0].config.knowledge, ["venue-hours", "booking-policy"]);
assert.deepEqual(organizerPatched.draft.definition.nodes[0].config.capabilities, ["booking.read.availability", "booking.read.reservations"]);
assert.deepEqual(organizerPatched.draft.definition.nodes[0].config.executor, { handler: "hidden" }, "hidden config is preserved, not exposed to organizer edits");
assert.equal((await organizerCall({ action: "organizer_patch", workflowId: organizerDefinition.workflowId, patch: { expectedDraftRevision: 0, edits: [{ kind: "safe_patch", path: `nodes.${organizerDefinition.nodes[0].nodeId}.config.title`, value: "stale" }] } })).reason, "revision_conflict_or_archived");
for (const [path, reason] of [
  [`parameters.${organizerDefinition.nodes[0].nodeId}.undeclared`, "organizer_parameter_not_declared"],
  [`nodes.${organizerDefinition.nodes[0].nodeId}.config.parameters`, "organizer_patch_path_not_allowlisted"],
  [`nodes.${organizerDefinition.nodes[0].nodeId}.config.settings.handler`, "organizer_patch_path_not_allowlisted"],
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

const workflowVersionId = `${definition.workflowId}@0.0.2`;
const publishPins = {
  agentPublishedVersionId: "agent@1",
  nodeDescriptorsDigest: digest("a"),
  capabilityVersionsDigest: digest("b"),
  toolPackVersionsDigest: digest("c"),
  skillVersionsDigest: digest("d"),
  runtimePolicyDigest: digest("e"),
};
const pins = { organizationId: host.organizationId, ...publishPins, workflowVersionId, definitionDigest: draft.definitionDigest };
const published = await call({ action: "publish", workflowId: definition.workflowId, expectedRevision: 1, dependencyPins: publishPins });
assert.equal(published.ok, true);
assert.equal(published.version.workflowVersionId, workflowVersionId, "the server allocates version identity from persisted workflow/revision authority");
assert.deepEqual(published.version.dependencyPins, pins, "publication stores the full dependency pin set");
assert.equal(published.version.userId, host.userId, "published rows retain publisher provenance");
assert.equal((await call({ action: "publish", workflowId: definition.workflowId, expectedRevision: 1, dependencyPins: publishPins })).ok, false, "published ids are immutable");
for (const forged of [
  { organizationId: "org-forged" },
  { workflowVersionId: "other.workflow@9" },
  { definitionDigest: digest("f") },
]) {
  assert.equal((await call({ action: "publish", workflowId: definition.workflowId, expectedRevision: 1, dependencyPins: { ...publishPins, ...forged } })).ok, false, "client workflow identity and digest are rejected instead of trusted");
}
assert.equal((await call({ action: "publish", workflowId: definition.workflowId, expectedRevision: 1, workflowVersionId: "other.workflow@9.9.9", dependencyPins: publishPins })).reason, "client_workflow_identity_forbidden", "legacy top-level client version identity fails closed");
assert.equal((await call({ action: "resolve", pin: { kind: "published", workflowVersionId, definitionDigest: draft.definitionDigest } })).definition.workflowVersionId, workflowVersionId);
assert.equal((await call({ action: "resolve", pin: { kind: "published", workflowVersionId, definitionDigest: draft.definitionDigest } }, otherUser)).definition.workflowVersionId, workflowVersionId, "same-organization users resolve published versions");
assert.deepEqual((await call({ action: "versions", workflowId: definition.workflowId }, otherUser)).versions.map(({ workflowVersionId: id }) => id), [workflowVersionId], "same-organization users list published versions");
assert.equal((await call({ action: "resolve", pin: { kind: "published", workflowVersionId, definitionDigest: draft.definitionDigest } }, otherOrganization)).definition, null, "published versions remain cross-organization isolated");
assert.equal((await call({ action: "create", definition }, otherUser)).ok, true);
const otherUserDraft = (await call({ action: "get", workflowId: definition.workflowId }, otherUser)).draft;
await call({ action: "update", workflowId: definition.workflowId, expectedRevision: 0, definition: { ...otherUserDraft.definition, title: "same organization revision" } }, otherUser);
assert.equal((await call({ action: "publish", workflowId: definition.workflowId, expectedRevision: 1, dependencyPins: publishPins }, otherUser)).reason, "revision_conflict_or_version_exists", "server-allocated published IDs are unique across an organization, not per publisher");
assert.equal((await call({ action: "create", definition }, otherOrganization)).ok, true);
const otherOrganizationDraft = (await call({ action: "get", workflowId: definition.workflowId }, otherOrganization)).draft;
const otherOrganizationPins = { organizationId: otherOrganization.organizationId, ...publishPins, workflowVersionId: `${definition.workflowId}@0.0.1`, definitionDigest: otherOrganizationDraft.definitionDigest };
const otherOrganizationPublished = await call({ action: "publish", workflowId: definition.workflowId, expectedRevision: 0, dependencyPins: publishPins }, otherOrganization);
assert.equal(otherOrganizationPublished.ok, true, "published IDs may be reused by another organization with its own valid draft and dependency pins");
assert.deepEqual(otherOrganizationPublished.version.dependencyPins, otherOrganizationPins);
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
assert.equal((await call({ action: "publish", workflowId: definition.workflowId, expectedRevision: 1, dependencyPins: publishPins })).reason, "revision_conflict_or_archived", "a stale draft revision cannot allocate a version");
const publishedNext = await call({ action: "publish", workflowId: definition.workflowId, expectedRevision: 2, dependencyPins: publishPins });
assert.equal(publishedNext.version.workflowVersionId, `${definition.workflowId}@0.0.3`, "successive draft revisions allocate distinct immutable versions");
assert.equal(publishedNext.version.definition.title, "post-publish edit", "published runtime definition is the persisted explicit VNext draft projection");
assert.equal((await call({ action: "resolve", pin: { kind: "draft", workflowId: definition.workflowId, draftRevision: 1, definitionDigest: draft.definitionDigest } })).definition, null, "a stale draft pin never floats to a newer revision");
assert.equal((await call({ action: "resolve", pin: { kind: "published", workflowVersionId, definitionDigest: draft.definitionDigest } })).definition.definition.title, draft.definition.title, "published content remains immutable after draft edits");

const cloned = await call({ action: "clone", source: { kind: "published", workflowVersionId, definitionDigest: draft.definitionDigest }, targetWorkflowId: "train0.linear-copy" });
assert.equal(cloned.ok, true);
assert.equal(cloned.draft.draftRevision, 0);
assert.equal(cloned.draft.definition.workflowId, "train0.linear-copy");
assert.notEqual(cloned.draft.definitionDigest, draft.definitionDigest, "clone gets a digest for its new identity");
const publishedClone = await call({ action: "publish", workflowId: cloned.draft.workflowId, expectedRevision: 0, dependencyPins: publishPins });
assert.equal(publishedClone.version.workflowVersionId, `${cloned.draft.workflowId}@0.0.1`, "a clone receives its own server-allocated version identity");
assert.deepEqual(publishedClone.version.definition, cloned.draft.definition, "clone publication snapshots the explicit persisted VNext definition");

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
const organizationVersionIndex = organizationScopeMigration.match(/create unique index concurrently\s+([a-z0-9_]+)\s+on\s+sonik_agent_ui\.workflow_definition_published_versions\s*\(organization_id,\s*workflow_version_id\)\s*;/i);
assert.ok(organizationVersionIndex, "published identity is organization scoped without a blocking index build");
assert.match(organizationScopeMigration, new RegExp(`alter table\\s+sonik_agent_ui\\.workflow_definition_published_versions\\s+drop constraint if exists workflow_definition_published_versions_pkey,\\s+add constraint workflow_definition_published_versions_pkey\\s+primary key using index\\s+${organizationVersionIndex[1]}`, "i"), "the guarded primary-key swap reuses the concurrent organization/version index");
const organizationPolicy = organizationScopeMigration.match(/create policy\s+workflow_definition_versions_scope\s+on\s+sonik_agent_ui\.workflow_definition_published_versions[^;]*;/i);
assert.ok(organizationPolicy, "the exact published-version organization policy exists on the exact published-version table");
assert.match(organizationPolicy[0], /using \(organization_id = sonik_agent_ui\.current_organization_id\(\)\)\s+with check \(organization_id = sonik_agent_ui\.current_organization_id\(\) and user_id = sonik_agent_ui\.current_user_id\(\)\)/i, "same-org reads retain publisher-scoped inserts within the same policy statement");
assert.match(repositorySource, /draft_revision = draft_revision \+ 1[\s\S]*draft_revision = \$4[\s\S]*returning/i, "cloud draft writes use one CAS statement");
assert.match(repositorySource, /insert into sonik_agent_ui\.workflow_definition_published_versions[\s\S]*workflow_id \|\| '@0\.0\.' \|\| \(draft_revision \+ 1\)::text[\s\S]*jsonb_build_object\('organizationId'[\s\S]*draft_revision = \$4/i, "cloud publish atomically allocates semver identity, digest, and trusted organization from the expected draft");
assert.match(route, /createAgentHostSessionEnvelope\(event\)/);
assert.match(route, /status: 401/);
assert.match(route, /organizer_patch/);

console.log("workflow-definition-lifecycle.test.mjs passed");

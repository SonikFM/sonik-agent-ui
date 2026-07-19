import assert from "node:assert/strict";
import {
  AGENT_DEFINITION_ACTIONS,
  agentDefinitionScope,
  assertAgentDefinitionAuthorized,
  createInMemoryAgentDefinitionStore,
} from "../../apps/standalone-sveltekit/src/lib/server/agent-definition-store.ts";
import { agentDefinitionSchema } from "../../packages/tool-contracts/dist/marketplace.js";

const store = createInMemoryAgentDefinitionStore();
const allScopes = ["agent-definitions:*"];
const a1 = { organizationId: "org-a", userId: "user-a1", scopes: allScopes };
const a2 = { organizationId: "org-a", userId: "user-a2", scopes: allScopes };
const b1 = { organizationId: "org-b", userId: "user-b1", scopes: allScopes };
const definition = agentDefinitionSchema.parse({ agentId: "sonik.agent.matrix", title: "Matrix Agent" });

const saved = store.saveDraft(a1, definition);
assert.equal(saved.createdByUserId, a1.userId);
assert.equal(store.getDraft(a2, definition.agentId)?.agentId, definition.agentId, "same-org A2 can view the shared org draft");
const edited = store.saveDraft(a2, { ...definition, title: "Matrix Agent A2" });
assert.equal(edited.createdByUserId, a1.userId, "same-org edit preserves creator provenance");
assert.equal(edited.updatedByUserId, a2.userId, "same-org edit records acting-user provenance");

const foreignList = store.listDrafts(b1);
assert.deepEqual(foreignList, [], "foreign list has the same successful array shape without leaking counts");
assert.equal(store.getDraft(b1, definition.agentId), null, "foreign guessed IDs are non-disclosing not-found results");
assert.equal(store.deleteDraft(b1, definition.agentId), false, "foreign deletes do not reveal whether the ID exists");
assert.equal(store.getDraft(a1, definition.agentId)?.definition.title, "Matrix Agent A2");

assert.throws(() => assertAgentDefinitionAuthorized(null, "view"), /owner_context_required/, "missing request context fails closed");
assert.throws(() => assertAgentDefinitionAuthorized({ organizationId: "", userId: "maintenance", scopes: ["agent-definitions:*"] }, "view"), /owner_context_required/);
for (const action of AGENT_DEFINITION_ACTIONS) {
  assert.doesNotThrow(() => assertAgentDefinitionAuthorized({ organizationId: "org-a", userId: "user-a2", scopes: [agentDefinitionScope(action)] }, action), `${action} has an explicit allow path`);
  assert.throws(() => assertAgentDefinitionAuthorized({ organizationId: "org-a", userId: "user-a2", scopes: [] }, action), new RegExp(`${action}_forbidden`), `${action} is default-deny`);
  assert.throws(() => assertAgentDefinitionAuthorized({ organizationId: "org-maintenance", userId: "service", scopes: ["agent-definitions:maintenance"] }, action), new RegExp(`${action}_forbidden`), "maintenance identity cannot use user actions without an explicitly mapped scope");
}
assert.doesNotThrow(() => assertAgentDefinitionAuthorized({ organizationId: "org-maintenance", userId: "service", scopes: ["agent-definitions:*"] }, "inspect_org_history"), "the only maintenance bypass is the explicit wildcard grant");

console.log("workflow-authorization-matrix.test.mjs passed");

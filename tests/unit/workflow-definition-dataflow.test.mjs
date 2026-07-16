import assert from "node:assert/strict";
import { validateWorkflowForPublish } from "../../packages/tool-contracts/dist/workflow-vnext.js";
import {
  train0WorkflowFixtures,
  train0WorkflowRuntimeRegistry,
} from "../../packages/tool-contracts/dist/workflow-vnext-fixtures.js";

function expectIssue(name, fixture, code) {
  const result = validateWorkflowForPublish(fixture, train0WorkflowRuntimeRegistry);
  assert.equal(result.ok, false, `${name} must fail publish validation`);
  assert.ok(result.issues.some((issue) => issue.code === code), `${name} must report ${code}: ${JSON.stringify(result.issues)}`);
}

const unreachable = structuredClone(train0WorkflowFixtures.linear);
unreachable.nodes.push({ ...structuredClone(unreachable.nodes[1]), nodeId: "orphan" });
expectIssue("unreachable required node", unreachable, "unreachable_node");

const stringPredicate = structuredClone(train0WorkflowFixtures.conditional);
stringPredicate.edges.find((edge) => edge.edgeId === "yes").predicate = "input.available === true";
expectIssue("string predicate", stringPredicate, "schema_invalid");

const multipleDefaults = structuredClone(train0WorkflowFixtures.conditional);
const yesDefault = multipleDefaults.edges.find((edge) => edge.edgeId === "yes");
delete yesDefault.predicate;
yesDefault.default = true;
expectIssue("multiple defaults", multipleDefaults, "multiple_default_edges");

const duplicateMatch = structuredClone(train0WorkflowFixtures.conditional);
duplicateMatch.nodes.push({ ...structuredClone(duplicateMatch.nodes.find((node) => node.nodeId === "yes")), nodeId: "also-yes" });
duplicateMatch.edges.push({
  edgeId: "also-yes",
  from: "choose",
  to: "also-yes",
  default: false,
  predicate: structuredClone(duplicateMatch.edges.find((edge) => edge.edgeId === "yes").predicate),
});
expectIssue("duplicate branch match", duplicateMatch, "ambiguous_branch_match");

const unauthorizedContext = structuredClone(train0WorkflowFixtures.linear);
unauthorizedContext.nodes[1].bindings = { tenant: { source: "host_context", key: "organizationId" } };
expectIssue("unauthorized context binding", unauthorizedContext, "unauthorized_context_binding");

const unauthorizedPredicateContext = structuredClone(train0WorkflowFixtures.conditional);
unauthorizedPredicateContext.edges.find((edge) => edge.edgeId === "yes").predicate.left = { source: "host_context", key: "organizationId" };
expectIssue("unauthorized context predicate", unauthorizedPredicateContext, "unauthorized_context_binding");

console.log(JSON.stringify({ ok: true, checked: "workflow-definition-dataflow" }));

import assert from "node:assert/strict";
import {
  agentDefinitionSchema,
  marketplaceManifestSchema,
} from "../../packages/tool-contracts/dist/marketplace.js";
import { knowledgeRefSchema } from "../../packages/tool-contracts/dist/knowledge-ref.js";

// Phase 1 (agent-creation-tool-plan-2026-07-13.md §4 Phase 1): additive
// agentDefinitionSchema extensions — promptModules, knowledgeRefs, inline
// modelPolicy. Every new field must default so pre-existing fixtures parse
// unchanged (no mutable draft/publish state added — see D002/D020).

const minimalAgent = {
  agentId: "sonik.agent.minimal",
  title: "Minimal Agent",
};

const minimalParsed = agentDefinitionSchema.parse(minimalAgent);
assert.deepEqual(minimalParsed.promptModules, { moduleIds: [], overrides: {} }, "promptModules defaults preserve pre-existing minimal fixtures");
assert.deepEqual(minimalParsed.knowledgeRefs, [], "knowledgeRefs defaults to empty array");
assert.equal(minimalParsed.modelPolicy, undefined, "inline modelPolicy stays optional");

const knowledgeRef = knowledgeRefSchema.parse({
  storeId: "sonik.knowledge.campaign-briefs",
  title: "Campaign briefs",
  fileRefs: [{ fileId: "brief-1", title: "Q3 brief", path: "knowledge/campaign-briefs/q3.md" }],
});
assert.equal(knowledgeRef.readable, true, "knowledge refs are readable-only in v1");
assert.throws(() => knowledgeRefSchema.parse({ ...knowledgeRef, readable: false }), "readable must be the literal true");
assert.throws(() => knowledgeRefSchema.parse({ ...knowledgeRef, vectorStoreId: "pinecone-index" }), /Unrecognized key/, "knowledge refs reject vector fields in v1");

const extendedAgent = agentDefinitionSchema.parse({
  agentId: "sonik.agent.campaign-drafter",
  title: "Campaign Drafter",
  requiredSkills: ["sonik.skill.campaign-brief"],
  toolPolicy: { "amplify.campaign.preview": "allow" },
  promptModules: {
    moduleIds: ["core", "sonik.skill.campaign-brief"],
    overrides: { core: "", "sonik.skill.campaign-brief": "Always confirm the audience segment before drafting." },
  },
  knowledgeRefs: [knowledgeRef],
  modelPolicy: { modelId: "anthropic/claude-haiku-4.5", requireZdr: true },
});
assert.deepEqual(extendedAgent.promptModules.moduleIds, ["core", "sonik.skill.campaign-brief"], "promptModules preserves declared module order");
assert.equal(extendedAgent.promptModules.overrides.core, "", "an empty-string override suppresses a module, matching promptModuleOverrides semantics");
assert.equal(extendedAgent.knowledgeRefs[0].storeId, "sonik.knowledge.campaign-briefs", "extended definition carries its knowledge ref");
assert.equal(extendedAgent.modelPolicy?.modelId, "anthropic/claude-haiku-4.5", "inline modelPolicy parses alongside modelPolicyRef");

// A kind:"agent" package version wraps the extended definition and validates
// end to end via the manifest schema (exercises payloadKeyForKind internally).
const agentPackageManifest = marketplaceManifestSchema.parse({
  marketplaceSchemaVersion: "1",
  packageId: "sonik.agent.campaign-drafter",
  packageVersionId: "sonik.agent.campaign-drafter@0.1.0",
  packageSemver: "0.1.0",
  kind: "agent",
  title: "Campaign Drafter",
  publisher: { publisherId: "sonik.first_party", displayName: "Sonik", type: "sonik" },
  manifestHash: "sha256:7777777777777777777777777777777777777777777777777777777777777777",
  payload: { agent: extendedAgent },
});
assert.equal(agentPackageManifest.payload.agent?.knowledgeRefs.length, 1, "agent package version wraps the extended agent definition");
assert.equal(agentPackageManifest.payload.agent?.promptModules.moduleIds.length, 2, "wrapped agent definition keeps its promptModules");

// Draft/publish stays the envelope's packageVersionId immutability (D002) —
// no mutable state enum belongs on the definition itself.
assert.equal("status" in agentDefinitionSchema.shape, false, "agentDefinitionSchema carries no draft/publish state field");

console.log("agent-definition-extension: all assertions passed");

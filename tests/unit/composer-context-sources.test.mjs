import assert from "node:assert/strict";
import { deriveAgentContextCandidates } from "../../apps/standalone-sveltekit/src/lib/agent-context/context-sources.ts";
import { resolveAgentContextSelection } from "../../packages/tool-contracts/src/run-context.ts";

// Auto-seeds: current page + active document + active entity.
const derived = deriveAgentContextCandidates({
  pageContext: {
    route: "/events/42",
    title: "Summer Fest",
    pageType: "event-detail",
    commandFamilies: ["booking", "artifact"],
    skillFamilies: ["booking-intake"],
    activeEntity: { type: "event", id: "evt-42", label: "Summer Fest" },
  },
  activeDocument: { id: "doc-1", title: "Run of show", language: "markdown" },
  activeArtifact: { id: "art-9", title: "Seating chart" },
});

const seedIds = derived.seeds.map((item) => item.id).sort();
assert.deepEqual(seedIds, ["booking-context:event:evt-42", "document:doc-1", "page:current"], "current page, active document, and active entity are auto-seeded");
for (const seed of derived.seeds) assert.equal(seed.source, "auto", "seeds are auto-sourced");

const doc = derived.seeds.find((item) => item.id === "document:doc-1");
assert.equal(doc.kind, "document");
assert.equal(doc.ref, "doc-1");
assert.equal(doc.label, "Run of show");

const page = derived.seeds.find((item) => item.id === "page:current");
assert.equal(page.kind, "page");
assert.equal(page.route, "/events/42");
assert.equal(page.label, "Summer Fest");

const event = derived.seeds.find((item) => item.id === "booking-context:event:evt-42");
assert.equal(event.kind, "booking-context");
assert.equal(event.ref, "evt-42", "event chip carries the entity id for injection");
assert.equal(event.label, "Summer Fest", "event chip carries the entity label");
assert.equal(event.detail, "event evt-42", "event chip carries a concrete detail line");
assert.deepEqual(event.metadata, { entityType: "event" }, "event chip preserves the original entity kind");

// Catalog includes seeds plus manual-attachable sources for every Sonik kind.
const sourceKinds = new Set(derived.sources.map((item) => item.kind));
for (const kind of ["page", "document", "artifact", "booking-context", "command-family", "runtime-skill"]) {
  assert.ok(sourceKinds.has(kind), `catalog should offer ${kind}`);
}
assert.ok(derived.sources.some((item) => item.id === "artifact:art-9"));
assert.ok(derived.sources.some((item) => item.id === "booking-context:event:evt-42"));
assert.ok(derived.sources.some((item) => item.id === "command-family:booking"));
assert.ok(derived.sources.some((item) => item.id === "runtime-skill:booking-intake"));
// Manual sources are attachable, not auto-seeded.
for (const item of derived.sources.filter((source) => !seedIds.includes(source.id))) {
  assert.equal(item.source, "manual", `${item.id} should be manual`);
}

const resolvedEntity = resolveAgentContextSelection({ items: [event], dismissedAutoSeedIds: [] });
assert.deepEqual(
  resolvedEntity.activeEntity,
  { type: "event", id: "evt-42", label: "Summer Fest" },
  "selected event chip resolves back into active entity context",
);

// Empty context → no seeds, no sources (stable, no throw).
const empty = deriveAgentContextCandidates({ pageContext: null, activeDocument: null, activeArtifact: null });
assert.deepEqual(empty.seeds, []);
assert.deepEqual(empty.sources, []);

// Ids are stable across calls (reconcile + reload idempotency depends on this).
const again = deriveAgentContextCandidates({
  pageContext: { route: "/events/42", title: "Summer Fest" },
  activeDocument: { id: "doc-1", title: "Run of show" },
});
assert.deepEqual(again.seeds.map((item) => item.id).sort(), ["document:doc-1", "page:current"]);

console.log("composer-context-sources.test.mjs: all assertions passed");

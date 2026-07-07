import assert from "node:assert/strict";
import {
  AGENT_CONTEXT_KINDS,
  isAgentContextKind,
  agentContextKindLabel,
  agentContextDetailLine,
  createEmptyAgentRunContextSelection,
  parseAgentRunContextSelection,
  reconcileAgentContextSelection,
  addAgentContextItem,
  removeAgentContextItem,
  resolveAgentContextSelection,
} from "../../packages/tool-contracts/src/run-context.ts";

// --- kinds + labels ------------------------------------------------------
assert.deepEqual([...AGENT_CONTEXT_KINDS], [
  "document",
  "artifact",
  "booking-context",
  "page",
  "command-family",
  "runtime-skill",
]);
assert.equal(isAgentContextKind("document"), true);
assert.equal(isAgentContextKind("folder"), false); // donor kind Sonik does not have
assert.equal(agentContextKindLabel("booking-context"), "Booking context");
assert.equal(agentContextKindLabel("runtime-skill"), "Runtime skill");

// detail line falls back detail -> route -> ref, else empty (donor discipline)
assert.equal(agentContextDetailLine({ id: "a", kind: "page", label: "L", source: "auto", detail: "  /events/42  " }), "/events/42");
assert.equal(agentContextDetailLine({ id: "a", kind: "page", label: "L", source: "auto", route: "/events" }), "/events");
assert.equal(agentContextDetailLine({ id: "a", kind: "document", label: "L", source: "auto", ref: "doc-1" }), "doc-1");
assert.equal(agentContextDetailLine({ id: "a", kind: "document", label: "L", source: "auto" }), "");

const seedPage = { id: "page:current", kind: "page", label: "Events", source: "auto", route: "/events/42" };
const seedDoc = { id: "document:doc-1", kind: "document", label: "Brief", source: "auto", ref: "doc-1" };

// --- reconcile seeds a fresh selection ----------------------------------
let selection = reconcileAgentContextSelection({ previous: createEmptyAgentRunContextSelection(), seeds: [seedPage, seedDoc] });
assert.equal(selection.items.length, 2);

// --- authoritative removal: removed auto chip stays removed on reseed ----
selection = removeAgentContextItem(selection, "document:doc-1");
assert.equal(selection.items.some((item) => item.id === "document:doc-1"), false);
assert.deepEqual(selection.dismissedAutoSeedIds, ["document:doc-1"]);
// Reseeding (as happens on the next send / on reload) must NOT bring it back.
selection = reconcileAgentContextSelection({ previous: selection, seeds: [seedPage, seedDoc] });
assert.equal(selection.items.some((item) => item.id === "document:doc-1"), false, "dismissed auto seed must not reappear after reseed");
assert.equal(selection.items.some((item) => item.id === "page:current"), true, "non-dismissed seed survives reseed");
// Idempotent across a second reseed (reload-safe).
const afterReload = reconcileAgentContextSelection({ previous: selection, seeds: [seedPage, seedDoc] });
assert.deepEqual(afterReload.items.map((item) => item.id).sort(), ["page:current"]);
assert.deepEqual(afterReload.dismissedAutoSeedIds, ["document:doc-1"]);

// --- manual attach survives reseed + can override a dismissal ------------
let withManual = addAgentContextItem(selection, { id: "artifact:art-9", kind: "artifact", label: "Dashboard", source: "manual", ref: "art-9" });
assert.equal(withManual.items.some((item) => item.id === "artifact:art-9"), true);
withManual = reconcileAgentContextSelection({ previous: withManual, seeds: [seedPage, seedDoc] });
assert.equal(withManual.items.some((item) => item.id === "artifact:art-9"), true, "manual item survives reseed");
// Re-adding the dismissed doc clears its dismissal so a reseed keeps it.
let readded = addAgentContextItem(withManual, seedDoc);
assert.equal(readded.dismissedAutoSeedIds.includes("document:doc-1"), false);
readded = reconcileAgentContextSelection({ previous: readded, seeds: [seedPage, seedDoc] });
assert.equal(readded.items.some((item) => item.id === "document:doc-1"), true, "re-added item is no longer dismissed");

// --- removing a manual item does NOT create a dismissal ------------------
const manualRemoved = removeAgentContextItem(withManual, "artifact:art-9");
assert.equal(manualRemoved.items.some((item) => item.id === "artifact:art-9"), false);
assert.equal(manualRemoved.dismissedAutoSeedIds.includes("artifact:art-9"), false);

// --- parse bounds + drops malformed items --------------------------------
assert.equal(parseAgentRunContextSelection(null), undefined);
assert.equal(parseAgentRunContextSelection({ items: [], dismissedAutoSeedIds: [] }), undefined);
const parsed = parseAgentRunContextSelection({
  items: [
    { id: "document:doc-1", kind: "document", label: "Brief", source: "manual", ref: "doc-1" },
    { id: "bad", kind: "not-a-kind", label: "x", source: "auto" },
    { kind: "page", label: "no id", source: "auto" },
  ],
  dismissedAutoSeedIds: ["document:doc-2", "document:doc-2", 7],
});
assert.equal(parsed.items.length, 1, "malformed items dropped");
assert.equal(parsed.items[0].id, "document:doc-1");
assert.deepEqual(parsed.dismissedAutoSeedIds, ["document:doc-2"], "dedupes + drops non-strings");

// --- server resolution: explicit selection wins over implicit ------------
// Absent selection → implicit fallback (still inject active document).
const implicit = resolveAgentContextSelection(undefined);
assert.equal(implicit.explicit, false);
assert.equal(implicit.includeActiveDocument, true);

// Explicit selection WITHOUT a document chip → do not re-attach the document.
const explicitNoDoc = resolveAgentContextSelection({
  items: [{ id: "page:current", kind: "page", label: "Events", source: "auto", route: "/events/42" }],
  dismissedAutoSeedIds: ["document:doc-1"],
});
assert.equal(explicitNoDoc.explicit, true);
assert.equal(explicitNoDoc.includeActiveDocument, false, "deselected document must not be silently re-attached server-side");
assert.deepEqual(explicitNoDoc.page, { route: "/events/42", title: "Events" });

// Dismissals-only selection (user removed the sole document seed) is still
// explicit, so the server must NOT re-inject the removed document.
const dismissalsOnly = resolveAgentContextSelection({ items: [], dismissedAutoSeedIds: ["document:doc-1"] });
assert.equal(dismissalsOnly.explicit, true, "a dismissal is explicit intent");
assert.equal(dismissalsOnly.includeActiveDocument, false, "removed document must not be re-injected even with an empty item list");

// Explicit selection WITH document/command/skill chips surfaces refs.
const explicitFull = resolveAgentContextSelection({
  items: [
    { id: "document:doc-1", kind: "document", label: "Brief", source: "manual", ref: "doc-1" },
    { id: "artifact:art-9", kind: "artifact", label: "Dashboard", source: "manual", ref: "art-9" },
    { id: "cf:booking", kind: "command-family", label: "Booking", source: "manual", ref: "booking" },
    { id: "skill:intake", kind: "runtime-skill", label: "Intake", source: "manual", ref: "booking-intake" },
  ],
  dismissedAutoSeedIds: [],
});
assert.equal(explicitFull.includeActiveDocument, true);
assert.deepEqual(explicitFull.documentIds, ["doc-1"]);
assert.deepEqual(explicitFull.artifactIds, ["art-9"]);
assert.deepEqual(explicitFull.commandFamilies, ["booking"]);
assert.deepEqual(explicitFull.skillFamilies, ["booking-intake"]);

console.log("run-context-selection.test.mjs: all assertions passed");

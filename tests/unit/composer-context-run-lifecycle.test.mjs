import assert from "node:assert/strict";
import {
  createWorkspaceSession,
  createWorkspaceRun,
  getWorkspaceRun,
  listWorkspaceRuns,
  deleteWorkspaceSession,
} from "../../apps/standalone-sveltekit/src/lib/server/workspace-store.ts";
import {
  createEmptyAgentRunContextSelection,
  reconcileAgentContextSelection,
  addAgentContextItem,
  removeAgentContextItem,
  parseAgentRunContextSelection,
  resolveAgentContextSelection,
} from "../../packages/tool-contracts/src/run-context.ts";
import { deriveAgentContextCandidates } from "../../apps/standalone-sveltekit/src/lib/agent-context/context-sources.ts";

// End-to-end verification for the manifest scope:
//  (1) attach a document chip -> send -> selection is recorded on the run and
//      consumed by the server resolution (document included);
//  (2) remove the auto-seeded document chip -> it stays removed after the next
//      send AND after a simulated reload (rehydrate from the persisted run).
// Exercised at the contract + persistence seam the composer relies on (a browser
// Playwright path is impractical for this package; this mirrors the same flow).

const pageContext = { route: "/events/42", title: "Summer Fest", pageType: "event-detail" };
const activeDocument = { id: "doc-1", title: "Run of show", language: "markdown" };
const { seeds } = deriveAgentContextCandidates({ pageContext, activeDocument, activeArtifact: null });

const session = createWorkspaceSession({ id: "ctx-session", name: "Context Session", mode: "chat" });

// --- Turn 1: seed chips, attach a manual artifact, send -------------------
let selection = reconcileAgentContextSelection({ previous: createEmptyAgentRunContextSelection(), seeds });
assert.ok(selection.items.some((item) => item.id === "document:doc-1"), "active document is auto-seeded");
selection = addAgentContextItem(selection, { id: "artifact:art-9", kind: "artifact", label: "Seating chart", source: "manual", ref: "art-9" });

// "send" turn 1: the composer selection is persisted on the run.
const run1 = createWorkspaceRun({ session_id: session.id, message_id: "assistant-1", context_selection: selection });
const persisted1 = getWorkspaceRun(run1.id);
assert.ok(persisted1?.context_selection, "selection is recorded on the run");
const persistedIds1 = persisted1.context_selection.items.map((item) => item.id).sort();
assert.deepEqual(persistedIds1, ["artifact:art-9", "document:doc-1", "page:current"], "recorded selection round-trips the sent chips");

// server consumes it: an explicit selection WITH the document chip keeps the document.
const resolved1 = resolveAgentContextSelection(persisted1.context_selection);
assert.equal(resolved1.explicit, true);
assert.equal(resolved1.includeActiveDocument, true, "attached document is consumed server-side");
assert.deepEqual(resolved1.documentIds, ["doc-1"]);

// --- Remove the auto-seeded document chip ---------------------------------
selection = removeAgentContextItem(selection, "document:doc-1");
assert.equal(selection.items.some((item) => item.id === "document:doc-1"), false);
assert.ok(selection.dismissedAutoSeedIds.includes("document:doc-1"), "removal is recorded as an authoritative dismissal");

// Reseeding for the next send (host/page context re-derives the same seeds)
// must NOT bring the removed document back.
selection = reconcileAgentContextSelection({ previous: selection, seeds });
assert.equal(selection.items.some((item) => item.id === "document:doc-1"), false, "removed chip stays removed on the next send");

// --- Turn 2: send without the document ------------------------------------
const run2 = createWorkspaceRun({ session_id: session.id, message_id: "assistant-2", context_selection: selection });
const persisted2 = getWorkspaceRun(run2.id);
const resolved2 = resolveAgentContextSelection(persisted2.context_selection);
assert.equal(resolved2.includeActiveDocument, false, "removed document is NOT re-injected server-side");
assert.deepEqual(resolved2.documentIds, [], "no document ref is consumed after removal");

// --- Simulated reload: rehydrate the composer from the latest persisted run.
// This mirrors +page.svelte's rehydrateRunContextState: take the most recent
// run's persisted selection, then reconcile fresh seeds — dismissals survive.
const runs = listWorkspaceRuns(session.id);
const latest = [...runs].reverse().find((run) => run.context_selection);
let reloaded = parseAgentRunContextSelection(latest.context_selection) ?? createEmptyAgentRunContextSelection();
assert.ok(reloaded.dismissedAutoSeedIds.includes("document:doc-1"), "dismissal is restored from the persisted run");
reloaded = reconcileAgentContextSelection({ previous: reloaded, seeds });
assert.equal(reloaded.items.some((item) => item.id === "document:doc-1"), false, "removed chip stays removed after reload");
assert.ok(reloaded.items.some((item) => item.id === "page:current"), "non-dismissed seeds still hydrate after reload");

deleteWorkspaceSession(session.id);
console.log("composer-context-run-lifecycle.test.mjs: all assertions passed");

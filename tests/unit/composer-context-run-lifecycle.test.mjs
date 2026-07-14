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
import {
  contextItemsByUserMessageId,
  createNextTurnContextSelection,
  createTurnContextSelection,
} from "../../apps/standalone-sveltekit/src/lib/agent-context/context-sources.ts";
import {
  createAsyncWorkspacePersistenceAdapter,
  createInMemoryWorkspacePersistence,
} from "../../packages/workspace-session/src/index.ts";

const linked = contextItemsByUserMessageId([
  { user_message_id: "user-second", context_selection: { items: [{ id: "file:f", kind: "file", label: "f.pdf", source: "manual", ref: "f" }], dismissedAutoSeedIds: [] } },
  { user_message_id: null, context_selection: { items: [{ id: "page:legacy", kind: "page", label: "Legacy", source: "auto" }], dismissedAutoSeedIds: [] } },
  { user_message_id: "missing-user", context_selection: { items: [{ id: "page:no-fallback", kind: "page", label: "No fallback", source: "auto" }], dismissedAutoSeedIds: [] } },
], ["user-first", "user-legacy", "user-third"]);
assert.equal(linked.get("user-second")?.[0].kind, "file", "explicit user id wins over positional order");
assert.equal(linked.get("user-legacy")?.[0].id, "page:legacy", "null legacy rows retain positional fallback");
assert.equal(linked.has("user-third"), false, "non-null missing ids never fall back positionally");

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

// Runtime skills and pinned tools are captured on the sent turn, then removed
// from the next-turn composer state without losing persistent context.
const staged = addAgentContextItem(selection, { id: "runtime-skill:intake", kind: "runtime-skill", label: "Intake", source: "manual", ref: "booking.intake" });
const sent = createTurnContextSelection(staged, [
  { id: "booking.list", label: "List bookings", familyId: "booking" },
  { id: "booking.create", label: "Create booking", familyId: "booking" },
]);
assert.ok(sent.items.some((item) => item.kind === "runtime-skill"), "sent provenance preserves the runtime skill");
assert.deepEqual(sent.items.filter((item) => item.metadata?.pinnedToolId).map((item) => item.metadata.pinnedToolId), ["booking.list", "booking.create"], "all pinned tools are preserved as separate provenance hints");
assert.ok(sent.items.filter((item) => item.metadata?.pinnedToolId).every((item) => item.kind === "command-family" && item.metadata.contextOnly === true && !("permission" in item.metadata)), "pins are non-grant command-family hints");
const nextTurn = createNextTurnContextSelection(sent);
assert.equal(nextTurn.items.some((item) => item.kind === "runtime-skill"), false, "runtime skill is consumed after one turn");
assert.equal(nextTurn.items.some((item) => item.metadata?.pinnedToolId), false, "derived pinned hints do not become next-turn chips");
assert.ok(nextTurn.items.some((item) => item.id === "page:current"), "persistent context survives transient cleanup");
assert.deepEqual(nextTurn.dismissedAutoSeedIds, sent.dismissedAutoSeedIds, "authoritative dismissals survive transient cleanup");

// File chips are public-id context, not workspace documents or delete actions.
// Detaching one changes only next-turn selection; the durable catalog row stays.
{
  const files = createInMemoryWorkspacePersistence();
  files.createSession({ id: "file-session" });
  const persistence = createAsyncWorkspacePersistenceAdapter(files);
  await persistence.createFile({
    id: "file-1",
    session_id: "file-session",
    storage_key: "agent-ui/file-1",
    original_filename: "brief.pdf",
    media_type: "application/pdf",
    byte_size: 42,
    status: "ready",
  });
  const document = { id: "document:doc-1", kind: "document", label: "Workspace brief", source: "manual", ref: "doc-1" };
  const attachment = { id: "file:file-1", kind: "file", label: "brief.pdf", source: "manual", ref: "file-1", detail: "application/pdf · 42 bytes" };
  const attached = addAgentContextItem(addAgentContextItem(createEmptyAgentRunContextSelection(), document), attachment);
  const detached = removeAgentContextItem(attached, attachment.id);

  assert.equal(detached.items.some((item) => item.kind === "file"), false, "detach removes the attachment chip");
  assert.deepEqual(detached.items.map(({ id, kind, ref }) => ({ id, kind, ref })), [{ id: document.id, kind: document.kind, ref: document.ref }], "workspace documents remain semantically separate from file attachments");
  assert.equal(detached.dismissedAutoSeedIds.includes(attachment.id), false, "manual attachment detach is not an auto-seed dismissal");
  assert.equal((await persistence.getFile("file-1"))?.status, "ready", "detach does not delete the durable private file");
}

console.log("composer-context-run-lifecycle.test.mjs: all assertions passed");

import assert from "node:assert/strict";
import { resolveEffectiveContextDocument } from "../../apps/standalone-sveltekit/src/lib/server/run-context-document.ts";

const activeDocument = { id: "doc-active", session_id: "session-1", current_content: "active content" };
const selectedInScope = { id: "doc-selected", session_id: "session-1", current_content: "selected content" };
const otherSessionDocument = { id: "doc-other", session_id: "session-2", current_content: "other session content" };

function loaderFor(documents) {
  const byId = new Map(documents.map((doc) => [doc.id, doc]));
  const calls = [];
  return {
    calls,
    load: async (id) => {
      calls.push(id);
      return byId.get(id) ?? null;
    },
  };
}

// --- a different, in-scope selected document is loaded and fed ---------------
{
  const loader = loaderFor([activeDocument, selectedInScope]);
  const result = await resolveEffectiveContextDocument({
    includeActiveDocument: true,
    selectedDocumentId: "doc-selected",
    requestActiveDocument: activeDocument,
    sessionId: "session-1",
    loadDocument: loader.load,
  });
  assert.equal(result?.id, "doc-selected", "the selected document is substituted");
  assert.equal(result?.current_content, "selected content", "the selected document's content is fed");
  assert.deepEqual(loader.calls, ["doc-selected"], "the selected document is loaded once from persistence");
}

// --- an out-of-scope (different session) selection is ignored ----------------
{
  const loader = loaderFor([activeDocument, otherSessionDocument]);
  const result = await resolveEffectiveContextDocument({
    includeActiveDocument: true,
    selectedDocumentId: "doc-other",
    requestActiveDocument: activeDocument,
    sessionId: "session-1",
    loadDocument: loader.load,
  });
  assert.equal(result?.id, "doc-active", "a document from another session is not substituted");
  assert.equal(result?.current_content, "active content", "out-of-scope content never reaches the agent");
}

// --- a missing selected document falls back to the active document -----------
{
  const loader = loaderFor([activeDocument]);
  const result = await resolveEffectiveContextDocument({
    includeActiveDocument: true,
    selectedDocumentId: "doc-missing",
    requestActiveDocument: activeDocument,
    sessionId: "session-1",
    loadDocument: loader.load,
  });
  assert.equal(result?.id, "doc-active", "a missing selection leaves the request's active document");
}

// --- selecting the already-active document does not re-load -----------------
{
  const loader = loaderFor([activeDocument]);
  const result = await resolveEffectiveContextDocument({
    includeActiveDocument: true,
    selectedDocumentId: "doc-active",
    requestActiveDocument: activeDocument,
    sessionId: "session-1",
    loadDocument: loader.load,
  });
  assert.equal(result?.id, "doc-active");
  assert.deepEqual(loader.calls, [], "no persistence read when the selection is the active document");
}

// --- deselecting the active document feeds no document ----------------------
{
  const loader = loaderFor([activeDocument, selectedInScope]);
  const result = await resolveEffectiveContextDocument({
    includeActiveDocument: false,
    selectedDocumentId: "doc-selected",
    requestActiveDocument: activeDocument,
    sessionId: "session-1",
    loadDocument: loader.load,
  });
  assert.equal(result, null, "when the active document is deselected, nothing is injected");
  assert.deepEqual(loader.calls, [], "no read when the document context is removed");
}

// --- no session id: the selection cannot be scoped, so it is ignored ---------
{
  const loader = loaderFor([activeDocument, selectedInScope]);
  const result = await resolveEffectiveContextDocument({
    includeActiveDocument: true,
    selectedDocumentId: "doc-selected",
    requestActiveDocument: activeDocument,
    sessionId: null,
    loadDocument: loader.load,
  });
  assert.equal(result?.id, "doc-active", "without a session the selection cannot be scoped and is ignored");
  assert.deepEqual(loader.calls, [], "no unscoped read is performed");
}

console.log("run-context-document.test.mjs OK");

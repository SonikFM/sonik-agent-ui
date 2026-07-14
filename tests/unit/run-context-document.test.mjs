import assert from "node:assert/strict";
import { resolveEffectiveContextDocument, syncSessionContextDocument } from "../../apps/standalone-sveltekit/src/lib/server/run-context-document.ts";

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

// --- selected context rejects a foreign active document before sync ----------
{
  const calls = [];
  await assert.rejects(
    () => syncSessionContextDocument({
      document: otherSessionDocument,
      sessionId: "session-1",
      loadDocument: async (id) => {
        calls.push(["load", id]);
        return otherSessionDocument;
      },
      syncDocument: async (document) => {
        calls.push(["sync", document.id]);
        return document;
      },
    }),
    /active document.*session/i,
  );
  assert.deepEqual(calls, [], "a declared cross-session document is rejected before persistence");
}

// --- stored ownership wins over an omitted/untrusted snapshot session --------
{
  const calls = [];
  await assert.rejects(
    () => syncSessionContextDocument({
      document: { ...activeDocument, session_id: null },
      sessionId: "session-1",
      loadDocument: async (id) => {
        calls.push(["load", id]);
        return otherSessionDocument;
      },
      syncDocument: async (document) => {
        calls.push(["sync", document.id]);
        return document;
      },
    }),
    /active document.*session/i,
  );
  assert.deepEqual(calls, [["load", "doc-active"]], "authoritative ownership is checked before persistence");
}

// --- ownership lookup failures abort before sync -----------------------------
{
  const calls = [];
  await assert.rejects(
    () => syncSessionContextDocument({
      document: { ...activeDocument, session_id: null },
      sessionId: "session-1",
      loadDocument: async (id) => {
        calls.push(["load", id]);
        throw new Error("ownership lookup failed");
      },
      syncDocument: async (document) => {
        calls.push(["sync", document.id]);
        return document;
      },
    }),
    /ownership lookup failed/,
  );
  assert.deepEqual(calls, [["load", "doc-active"]], "an ownership read failure must abort before persistence");
}

// --- matching selected context is bound to the authoritative session ---------
{
  const calls = [];
  const result = await syncSessionContextDocument({
    document: { ...activeDocument, session_id: null },
    sessionId: "session-1",
    loadDocument: async (id) => {
      calls.push(["load", id]);
      return null;
    },
    syncDocument: async (document) => {
      calls.push(["sync", document.session_id]);
      return document;
    },
  });
  assert.equal(result?.session_id, "session-1");
  assert.deepEqual(calls, [["load", "doc-active"], ["sync", "session-1"]]);
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

// --- an out-of-scope (different session) selection fails closed --------------
{
  const loader = loaderFor([activeDocument, otherSessionDocument]);
  await assert.rejects(
    () => resolveEffectiveContextDocument({
      includeActiveDocument: true,
      selectedDocumentId: "doc-other",
      requestActiveDocument: activeDocument,
      sessionId: "session-1",
      loadDocument: loader.load,
    }),
    /selected document.*session/i,
  );
  assert.deepEqual(loader.calls, ["doc-other"]);
}

// --- a missing selected document fails closed --------------------------------
{
  const loader = loaderFor([activeDocument]);
  await assert.rejects(
    () => resolveEffectiveContextDocument({
      includeActiveDocument: true,
      selectedDocumentId: "doc-missing",
      requestActiveDocument: activeDocument,
      sessionId: "session-1",
      loadDocument: loader.load,
    }),
    /selected document.*unavailable/i,
  );
  assert.deepEqual(loader.calls, ["doc-missing"]);
}

// --- selecting the already-active document still verifies canonical storage -
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
  assert.deepEqual(loader.calls, ["doc-active"]);
}

// --- ownership lookup failures propagate before downstream side effects ------
{
  const calls = [];
  await assert.rejects(
    () => resolveEffectiveContextDocument({
      includeActiveDocument: true,
      selectedDocumentId: "doc-selected",
      requestActiveDocument: activeDocument,
      sessionId: "session-1",
      loadDocument: async (id) => {
        calls.push(["load", id]);
        throw new Error("ownership lookup failed");
      },
    }),
    /ownership lookup failed/,
  );
  assert.deepEqual(calls, [["load", "doc-selected"]]);
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

// --- no session id: an explicit selection fails closed -----------------------
{
  const loader = loaderFor([activeDocument, selectedInScope]);
  await assert.rejects(
    () => resolveEffectiveContextDocument({
      includeActiveDocument: true,
      selectedDocumentId: "doc-selected",
      requestActiveDocument: activeDocument,
      sessionId: null,
      loadDocument: loader.load,
    }),
    /workspace session/i,
  );
  assert.deepEqual(loader.calls, [], "no unscoped read is performed");
}

console.log("run-context-document.test.mjs OK");

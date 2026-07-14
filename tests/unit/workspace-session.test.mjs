import assert from "node:assert/strict";
import {
  createInMemoryWorkspacePersistence,
  createLocalAuthAdapter,
  createMemoryWorkspaceRuntime,
  extractWorkspaceSessionTitleMarker,
} from "../../packages/workspace-session/src/index.ts";

const boundedTelemetryStore = createInMemoryWorkspacePersistence({ maxTelemetryEvents: 2, maxTelemetryPayloadChars: 256 });
boundedTelemetryStore.recordTelemetryEvent({ source: "server", event: "one", payload: { body: "1" } });
boundedTelemetryStore.recordTelemetryEvent({ source: "server", event: "two", payload: { body: "2" } });
boundedTelemetryStore.recordTelemetryEvent({ source: "server", event: "three", payload: { body: "3" } });
assert.deepEqual(boundedTelemetryStore.listTelemetryEvents().map((event) => event.event), ["two", "three"], "in-memory telemetry mirror should be bounded");
const hugeEvent = boundedTelemetryStore.recordTelemetryEvent({ source: "server", event: "huge", payload: { body: "x".repeat(2_000) } });
assert.equal(hugeEvent.payload.truncated, true, "large telemetry payloads should be capped before mirroring");

const store = createInMemoryWorkspacePersistence();
const auth = createLocalAuthAdapter().resolveContext({
  organizationId: "org-host-attempt",
  authenticated: true,
  mode: "embedded-host",
  authority: "host-asserted",
});
assert.equal(auth.mode, "standalone-local");
assert.equal(auth.authority, "local-only");
assert.equal(auth.authenticated, false, "local auth adapter must not claim authenticated host identity");
assert.equal(auth.organizationId, null, "local auth adapter must not claim Amplify org authority");
assert.equal(auth.scopes.includes("workspace:read"), true);
assert.equal(auth.scopes.includes("workspace:write"), true);

const generatedTitle = extractWorkspaceSessionTitleMarker(
  "[[titleGeneration: Campaign Launch Plan]]\nHere is the plan.",
  "Please help me plan our launch campaign for the fall menu.",
);
assert.equal(generatedTitle.title, "Campaign Launch Plan", "titleGeneration marker should provide the persisted session title");
assert.equal(generatedTitle.visibleText, "Here is the plan.", "titleGeneration marker should be stripped from visible assistant text");
assert.equal(generatedTitle.source, "marker", "valid titleGeneration markers should be reported as marker-sourced");

const missingTitle = extractWorkspaceSessionTitleMarker(
  "Here is the plan without a marker.",
  "Please help me plan our launch campaign for the fall menu.",
);
assert.equal(missingTitle.title, "Help me plan our launch campaign for", "missing titleGeneration marker should fall back to the first user message");
assert.equal(missingTitle.visibleText, "Here is the plan without a marker.", "fallback should not alter visible assistant text when no marker exists");
assert.equal(missingTitle.source, "fallback", "missing marker should be reported as fallback-sourced");

const malformedTitle = extractWorkspaceSessionTitleMarker(
  "[[titleGeneration:   ]]\nHere is the plan.",
  "Summarize the quarterly revenue dashboard for leadership.",
);
assert.equal(malformedTitle.title, "Summarize the quarterly revenue dashboard for leadership", "malformed titleGeneration marker should fall back to the first user message");
assert.equal(malformedTitle.visibleText, "Here is the plan.", "malformed titleGeneration marker should still be stripped from visible assistant text");
assert.equal(malformedTitle.markerMalformed, true, "empty titleGeneration marker should be reported as malformed");

const session = store.createSession({ id: "local-session-a", name: "Local Session", mode: "chat" });
assert.equal(session.id, "local-session-a");
assert.equal(store.ensureSession(session.id).id, session.id);

const userMessage = store.appendMessage({ session_id: session.id, role: "user", content: "Create an artifact" });
const assistantMessage = store.appendMessage({ session_id: session.id, role: "assistant", content: "Created." });
assert.deepEqual(store.listMessages(session.id).map((message) => message.id), [userMessage.id, assistantMessage.id]);
assert.equal(store.getSession(session.id)?.message_count, 2, "message appends should update session history counters");

const document = store.createDocument({
  session_id: session.id,
  title: "Project Echo",
  content: "Initial stability: 42%",
  language: "markdown",
  source: "ai",
});
const updatedDocument = store.updateDocument(document.id, {
  content: "Initial stability: 42%\nFinal stability: 15%",
  source: "ai",
  summary: "Added power surge result",
});
assert.equal(updatedDocument?.version_count, 2);
assert.equal(store.listDocumentVersions(document.id).length, 2);
assert.equal(store.getSession(session.id)?.active_document_id, document.id);
assert.equal(store.getSession(session.id)?.mode, "document");

const statelessPatch = store.patchDocument("workspace-doc-from-browser-snapshot", {
  session_id: session.id,
  title: "Browser Snapshot",
  content: "<h1>Loaded from parent payload</h1>",
  language: "html",
});
assert.equal(statelessPatch?.id, "workspace-doc-from-browser-snapshot", "document PATCH should upsert a missing browser-owned snapshot by id");
assert.equal(statelessPatch?.current_content, "<h1>Loaded from parent payload</h1>");
assert.equal(store.getDocument("workspace-doc-from-browser-snapshot")?.language, "html");

const syncedMissing = store.syncActiveDocumentSnapshot({
  id: "workspace-doc-synced-active",
  session_id: session.id,
  title: "Synced Active",
  language: "markdown",
  current_content: "# Active document",
  version_count: 3,
  is_active: true,
  archived: false,
  created_at: "2026-06-22T00:00:00.000Z",
  updated_at: "2026-06-22T00:00:01.000Z",
});
assert.equal(syncedMissing.id, "workspace-doc-synced-active", "active document sync should persist missing snapshots for later server-side tool reads");
assert.equal(store.getDocument("workspace-doc-synced-active")?.current_content, "# Active document");

const artifact = store.createArtifact({
  session_id: session.id,
  kind: "json-render",
  title: "Weather Dashboard",
  content: { root: "main", elements: { main: { type: "Text", props: { content: "NYC" }, children: [] } }, state: {} },
});
const tokyo = store.updateArtifact(artifact.id, {
  title: "Tokyo Weather Dashboard",
  content: { root: "main", elements: { main: { type: "Text", props: { content: "Tokyo" }, children: [] } }, state: {} },
  summary: "Switch city to Tokyo",
});
assert.equal(tokyo?.id, artifact.id, "artifact update must preserve identity");
assert.equal(tokyo?.version, 2, "artifact content update should create a new version");
assert.equal(store.listArtifactVersions(artifact.id).length, 2);
assert.equal(store.getSession(session.id)?.active_artifact_id, artifact.id);

const layout = store.recordLayoutSnapshot({
  session_id: session.id,
  active_pane_id: "pane-canvas",
  active_artifact_id: artifact.id,
  layout: { type: "split", direction: "horizontal" },
  source: "user",
});
assert.equal(store.listLayoutSnapshots(session.id).at(-1)?.id, layout.id);

const toolCall = store.recordToolCall({
  session_id: session.id,
  message_id: assistantMessage.id,
  tool_name: "createJsonArtifact",
  source: "local-ui",
  effect: "write",
  status: "success",
  input: { title: "Tokyo Weather Dashboard" },
  output: { artifactId: artifact.id, version: 2 },
  error: null,
  artifact_id: artifact.id,
  document_id: null,
  request_id: "req-tool-1",
});
assert.equal(store.listToolCalls(session.id)[0]?.id, toolCall.id);

const event = store.recordTelemetryEvent({
  session_id: session.id,
  request_id: "req-tool-1",
  source: "server",
  event: "artifact.updated",
  payload: { artifactId: artifact.id, version: 2 },
  ok: true,
});
assert.equal(store.listTelemetryEvents(session.id)[0]?.id, event.id);

const library = store.listDocumentLibrary({ search: "echo" });
assert.equal(library.total, 1);
assert.equal(library.documents[0]?.session_name, "Local Session");

const idempotentSession = store.createSession({ id: "message-idempotency", name: "Message Idempotency" });
const firstMessage = store.appendMessage({ session_id: idempotentSession.id, id: "same-message-id", role: "user", content: "first write", parts: [{ type: "text", text: "first write", metadata: { b: 2, a: 1 } }] });
const replayedMessage = store.appendMessage({ session_id: idempotentSession.id, id: "same-message-id", role: "user", content: "first write", parts: [{ metadata: { a: 1, b: 2 }, text: "first write", type: "text" }] });
const idempotentMessages = store.listMessages(idempotentSession.id).filter((message) => message.id === "same-message-id");
assert.equal(replayedMessage.id, firstMessage.id, "replayed message append should return the existing message");
assert.deepEqual(replayedMessage, firstMessage, "replayed message append should preserve the exact first write");
assert.equal(idempotentMessages.length, 1, "message append should be idempotent by session/id");
assert.equal(store.getSession(idempotentSession.id)?.message_count, 1, "idempotent replay should not increment message_count");
assert.throws(
  () => store.appendMessage({ session_id: idempotentSession.id, id: "same-message-id", role: "user", content: "changed write", parts: firstMessage.parts }),
  /different payload/,
  "reusing a message id with changed content must fail",
);
assert.throws(
  () => store.appendMessage({ session_id: idempotentSession.id, id: "same-message-id", role: "assistant", content: "first write", parts: firstMessage.parts }),
  /different payload/,
  "reusing a message id with a changed role must fail",
);
const otherIdempotentSession = store.createSession({ id: "message-idempotency-other", name: "Other Message Idempotency" });
assert.throws(
  () => store.appendMessage({ session_id: otherIdempotentSession.id, id: "same-message-id", role: "user", content: "first write", parts: firstMessage.parts }),
  /different payload/,
  "reusing a message id in another session must fail",
);

const fileSessionA = store.createSession({ id: "file-session-a", name: "Files A" });
const fileSessionB = store.createSession({ id: "file-session-b", name: "Files B" });
const file = store.createFile({
  id: "file-memory",
  session_id: fileSessionA.id,
  storage_key: "opaque/a",
  original_filename: "brief.pdf",
  media_type: "application/pdf",
  byte_size: 4096,
  checksum: "sha256:abc",
});
assert.equal(store.getFile(file.id)?.storage_key, "opaque/a");
assert.deepEqual(store.listFiles(fileSessionA.id).map((row) => row.id), [file.id]);
assert.equal(store.listFiles(fileSessionB.id).length, 0, "memory file lists must remain session scoped");
const readyFile = store.updateFile(file.id, {
  status: "ready",
  provider_references: { google: "provider-file-1" },
  provider_references_expires_at: "2026-07-14T00:00:00.000Z",
});
assert.equal(readyFile?.status, "ready");
assert.deepEqual(readyFile?.provider_references, { google: "provider-file-1" });
assert.equal(Boolean(readyFile?.ready_at), true);
assert.equal(store.deleteFile(file.id), true);
assert.equal(store.getFile(file.id), null);
assert.equal(store.deleteFile(file.id), false);

const cascadeFile = store.createFile({ session_id: fileSessionA.id, storage_key: "opaque/cascade", original_filename: "a.txt", media_type: "text/plain", byte_size: 1 });
const survivorFile = store.createFile({ session_id: fileSessionB.id, storage_key: "opaque/survivor", original_filename: "b.txt", media_type: "text/plain", byte_size: 1 });
assert.equal(store.beginSessionDeletion(fileSessionA.id), true);
assert.throws(
  () => store.createFile({ session_id: fileSessionA.id, storage_key: "opaque/late", original_filename: "late.txt", media_type: "text/plain", byte_size: 1 }),
  /Session not found/,
  "memory file creation must stop once deletion begins",
);
assert.equal(store.deleteSession(fileSessionA.id), true);
assert.equal(store.getFile(cascadeFile.id), null, "session deletion should remove its in-memory file catalog rows");
assert.equal(store.getFile(survivorFile.id)?.id, survivorFile.id, "session deletion must not remove another session's file rows");

const asyncFiles = createMemoryWorkspaceRuntime().persistence;
await asyncFiles.createSession({ id: "async-file-session" });
const asyncFile = await asyncFiles.createFile({ id: "file-async", session_id: "async-file-session", storage_key: "opaque/async", original_filename: "async.txt", media_type: "text/plain", byte_size: 2 });
assert.equal((await asyncFiles.getFile(asyncFile.id))?.id, asyncFile.id);
assert.equal((await asyncFiles.listFiles(asyncFile.session_id)).length, 1);
assert.equal((await asyncFiles.updateFile(asyncFile.id, { status: "failed" }))?.status, "failed");
assert.equal(await asyncFiles.deleteFile(asyncFile.id), true, "async persistence wrapper should forward file deletion");

console.log("workspace-session tests passed");

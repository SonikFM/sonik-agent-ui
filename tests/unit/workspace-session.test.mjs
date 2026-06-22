import assert from "node:assert/strict";
import {
  createInMemoryWorkspacePersistence,
  createLocalAuthAdapter,
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
const firstMessage = store.appendMessage({ session_id: idempotentSession.id, id: "same-message-id", role: "user", content: "first write" });
const replayedMessage = store.appendMessage({ session_id: idempotentSession.id, id: "same-message-id", role: "user", content: "replayed write" });
const idempotentMessages = store.listMessages(idempotentSession.id).filter((message) => message.id === "same-message-id");
assert.equal(replayedMessage.id, firstMessage.id, "replayed message append should return the existing message");
assert.equal(idempotentMessages.length, 1, "message append should be idempotent by session/id");
assert.equal(store.getSession(idempotentSession.id)?.message_count, 1, "idempotent replay should not increment message_count");

console.log("workspace-session tests passed");

import assert from "node:assert/strict";
import {
  archiveWorkspaceDocument,
  archiveWorkspaceSession,
  deleteWorkspaceSession,
  createWorkspaceArtifact,
  createWorkspaceDocument,
  createWorkspaceSession,
  getWorkspaceDocument,
  getWorkspaceSession,
  getWorkspaceArtifact,
  getWorkspaceDocumentVersion,
  listDocumentLibrary,
  listWorkspaceDocumentVersions,
  listWorkspaceDocuments,
  listWorkspaceLayoutSnapshots,
  listWorkspaceSessions,
  patchWorkspaceSession,
  restoreWorkspaceDocumentVersion,
  summarizeWorkspaceContext,
  updateWorkspaceDocument,
  appendWorkspaceMessage,
  listWorkspaceMessages,
  listWorkspaceToolCalls,
  listWorkspaceTelemetryEvents,
  localWorkspaceAuthAdapter,
  recordWorkspaceTelemetryEvent,
  recordWorkspaceLayoutSnapshot,
  recordWorkspaceToolCall,
  updateWorkspaceArtifact,
  workspaceProcedures,
} from "../../apps/standalone-sveltekit/src/lib/server/workspace-store.ts";
import {
  findDocumentArtifactToolCandidate,
  isDocumentArtifactToolOutput,
} from "../../apps/standalone-sveltekit/src/lib/artifacts/tool-artifact-extraction.ts";

const session = createWorkspaceSession({ id: "test-session", name: "Test Session", mode: "document" });
assert.equal(session.id, "test-session");
assert.equal(listWorkspaceSessions({ archived: false }).some((entry) => entry.id === "test-session"), true);

const document = createWorkspaceDocument({
  session_id: session.id,
  title: "Run Sheet",
  language: "markdown",
  content: "# Run Sheet\n\nInitial",
  source: "ai",
});
assert.equal(document.session_id, session.id);
assert.equal(document.version_count, 1);
assert.equal(getWorkspaceDocument(document.id)?.current_content, "# Run Sheet\n\nInitial");
assert.equal(listWorkspaceDocuments(session.id).length, 1);

const updated = updateWorkspaceDocument(document.id, {
  content: "# Run Sheet\n\nUpdated",
  summary: "Agent edit",
  source: "ai",
});
assert.equal(updated?.version_count, 2);
assert.equal(listWorkspaceDocumentVersions(document.id).length, 2);
assert.equal(getWorkspaceDocumentVersion(document.id, 1)?.content, "# Run Sheet\n\nInitial");

const restored = restoreWorkspaceDocumentVersion(document.id, 1);
assert.equal(restored?.current_content, "# Run Sheet\n\nInitial");
assert.equal(restored?.version_count, 3);

const library = listDocumentLibrary({ search: "sheet", limit: 10 });
assert.equal(library.total >= 1, true);
assert.equal(library.languages.markdown >= 1, true);
assert.equal(library.session_count >= 1, true);

const artifact = createWorkspaceArtifact({
  session_id: session.id,
  kind: "document",
  title: restored.title,
  content: restored,
});
assert.equal(artifact.kind, "document");
assert.equal(getWorkspaceArtifact(artifact.id)?.id, artifact.id);
const artifactUpdate = updateWorkspaceArtifact(artifact.id, {
  title: "Run Sheet Artifact v2",
  content: { ...restored, title: "Run Sheet Artifact v2" },
  source: "ai",
  summary: "Update artifact metadata",
});
assert.equal(artifactUpdate?.id, artifact.id, "workspace artifact update should preserve identity");
assert.equal(artifactUpdate?.version, 2, "workspace artifact update should version changed content");

const localAuth = localWorkspaceAuthAdapter.resolveContext();
assert.equal(localAuth.authority, "local-only", "standalone auth context should not claim host org authority");
assert.equal(localAuth.organizationId, null, "standalone auth context should not invent an organization");
const persistedMessage = appendWorkspaceMessage({ session_id: session.id, id: "message-test-1", role: "user", content: "persist me" });
const replayedPersistedMessage = appendWorkspaceMessage({ session_id: session.id, id: "message-test-1", role: "user", content: "persist me again" });
assert.equal(replayedPersistedMessage.id, persistedMessage.id, "message persistence should be idempotent across repeated client sends");
assert.equal(listWorkspaceMessages(session.id).filter((message) => message.id === persistedMessage.id).length, 1, "message history should not duplicate replayed message ids");
assert.equal(listWorkspaceMessages(session.id).some((message) => message.id === persistedMessage.id), true, "message history should be available through the workspace persistence seam");
const persistedToolCall = recordWorkspaceToolCall({
  session_id: session.id,
  message_id: persistedMessage.id,
  tool_name: "createDocumentArtifact",
  source: "local-ui",
  effect: "write",
  status: "success",
  input: { title: "Run Sheet" },
  output: { documentId: restored.id },
  error: null,
  artifact_id: artifact.id,
  document_id: restored.id,
  request_id: "req-workspace-store-test",
});
assert.equal(listWorkspaceToolCalls(session.id).some((call) => call.id === persistedToolCall.id), true, "tool call receipts should be persisted through the workspace seam");
const persistedTelemetry = recordWorkspaceTelemetryEvent({
  session_id: session.id,
  request_id: "req-workspace-store-test",
  source: "server",
  event: "workspace-store.test",
  payload: { artifactId: artifact.id },
  ok: true,
});
assert.equal(listWorkspaceTelemetryEvents(session.id).some((event) => event.id === persistedTelemetry.id), true, "telemetry events should be queryable by session");

const { writeAgentTelemetry } = await import("../../apps/standalone-sveltekit/src/lib/server/agent-telemetry.ts");
await writeAgentTelemetry({
  source: "server",
  event: "workspace-store.behavioral-telemetry-test",
  requestId: "req-behavioral-telemetry",
  sessionId: session.id,
  ok: true,
});
const mirroredTelemetry = listWorkspaceTelemetryEvents(session.id).find((event) => event.request_id === "req-behavioral-telemetry");
assert.equal(mirroredTelemetry?.event, "workspace-store.behavioral-telemetry-test", "server telemetry should mirror into session-filtered workspace events");
assert.equal(mirroredTelemetry?.ok, true);

const toolOutput = {
  kind: "document-artifact",
  action: "create",
  document: restored,
  artifactId: artifact.id,
};
assert.equal(isDocumentArtifactToolOutput(toolOutput), true);
const candidate = findDocumentArtifactToolCandidate("assistant-message", [
  { type: "tool-createDocumentArtifact", toolCallId: "call_doc", output: toolOutput },
]);
assert.equal(candidate?.id, "document-tool:assistant-message:call_doc");
assert.equal(candidate?.document.id, restored.id);

assert.equal(typeof workspaceProcedures["workspace.document.create"], "function");
assert.equal(typeof workspaceProcedures["workspace.document.library"], "function");
assert.equal(typeof workspaceProcedures["workspace.artifact.create"], "function");
assert.equal(typeof workspaceProcedures["workspace.message.append"], "function");
assert.equal(typeof workspaceProcedures["workspace.toolCall.record"], "function");
assert.equal(typeof workspaceProcedures["workspace.telemetry.record"], "function");
assert.equal(summarizeWorkspaceContext({ activeDocument: restored }).includes("available actions:"), false, "document context should not duplicate tool capability prose; tool manifest is the capability source");

assert.equal(archiveWorkspaceDocument(document.id, true)?.archived, true);
assert.equal(listDocumentLibrary({ search: "sheet" }).documents.some((entry) => entry.id === document.id), false);
assert.equal(listDocumentLibrary({ search: "sheet", archived: true }).documents.some((entry) => entry.id === document.id), true);

assert.equal(patchWorkspaceSession(session.id, { is_important: true })?.is_important, true);
assert.equal(archiveWorkspaceSession(session.id, true)?.archived, true);
assert.equal(listWorkspaceSessions({ archived: true }).some((entry) => entry.id === session.id), true);

const disposableSession = createWorkspaceSession({ id: "delete-session", name: "Delete Me", mode: "chat" });
const disposableDocument = createWorkspaceDocument({ session_id: disposableSession.id, title: "Delete Doc", content: "remove doc" });
const disposableArtifact = createWorkspaceArtifact({ session_id: disposableSession.id, kind: "json-render", title: "Delete Artifact", content: { root: "main", elements: { main: { type: "Text", props: { content: "remove" }, children: [] } }, state: {} } });
appendWorkspaceMessage({ session_id: disposableSession.id, id: "delete-message", role: "user", content: "remove me" });
recordWorkspaceToolCall({ session_id: disposableSession.id, tool_name: "delete-test", status: "completed", input: {}, output: {} });
recordWorkspaceLayoutSnapshot({ session_id: disposableSession.id, layout: { root: "delete" }, source: "user" });
recordWorkspaceTelemetryEvent({ session_id: disposableSession.id, source: "client", event: "delete-test", ok: true });
assert.equal(deleteWorkspaceSession(disposableSession.id), true, "session deletion should report a removed session");
assert.equal(getWorkspaceSession(disposableSession.id), null, "deleted sessions should no longer resolve");
assert.equal(getWorkspaceDocument(disposableDocument.id), null, "deleted sessions should delete local documents");
assert.equal(getWorkspaceArtifact(disposableArtifact.id), null, "deleted sessions should delete local artifacts");
assert.equal(listWorkspaceMessages(disposableSession.id).length, 0, "deleted sessions should drop local message history");
assert.equal(listWorkspaceToolCalls(disposableSession.id).length, 0, "deleted sessions should drop local tool-call receipts");
assert.equal(listWorkspaceLayoutSnapshots(disposableSession.id).length, 0, "deleted sessions should drop local layout snapshots");
assert.equal(listWorkspaceTelemetryEvents(disposableSession.id).length, 0, "deleted sessions should drop local telemetry events");

console.log("workspace-store tests passed");

const stale = createWorkspaceDocument({
  session_id: "fresh-session",
  title: "Fresh Context",
  language: "markdown",
  content: "old content",
  source: "user",
});
const fresh = (await import("../../apps/standalone-sveltekit/src/lib/server/workspace-store.ts")).syncActiveWorkspaceDocumentSnapshot({
  ...stale,
  current_content: "fresh iframe content",
});
assert.equal(fresh.current_content, "fresh iframe content", "active iframe snapshot should win over stale store content");
assert.equal(getWorkspaceDocument(stale.id)?.current_content, "fresh iframe content", "fresh snapshot should be persisted before agent tools run");

const { routeString, WORKSPACE_CONTENT_MAX_CHARS } = await import(
  "../../apps/standalone-sveltekit/src/lib/server/workspace-route-limits.ts"
);
assert.equal(routeString(undefined, "content", 10, "default"), "default");
assert.throws(() => routeString("x".repeat(WORKSPACE_CONTENT_MAX_CHARS + 1), "content", WORKSPACE_CONTENT_MAX_CHARS), /exceeds/);

const hostHtml = await import("node:fs/promises").then((fs) => fs.readFile("apps/standalone-sveltekit/static/workspace-document-host.html", "utf8"));
assert.equal(hostHtml.includes("creating a new local copy"), false, "host must not fork identity when documentId load fails");
assert.equal(hostHtml.includes("message.source !== 'sonik-agent-ui-parent'"), true, "host should reject non-parent bridge messages");

assert.equal(hostHtml.includes("hasReceivedParentOpenRequest"), true, "host should track parent open requests");
assert.equal(hostHtml.includes("!hasReceivedParentOpenRequest && !document.getElementById('doc-editor-pane')"), true, "default open should not race requested document opens");

const generateRoute = await import("node:fs/promises").then((fs) => fs.readFile("apps/standalone-sveltekit/src/routes/api/generate/+server.ts", "utf8"));
assert.equal(generateRoute.includes("WORKSPACE_CONTENT_MAX_CHARS"), true, "generate active-document sync should use route content limits");
assert.equal(generateRoute.includes("workspace.activeDocument.current_content"), true, "generate active-document sync should validate active content field");

const preferredToolOutput = {
  kind: "document-artifact",
  action: "create",
  document: restored,
  artifactId: artifact.id,
  preferredView: "preview",
};
assert.equal(isDocumentArtifactToolOutput(preferredToolOutput), true, "document artifact output should accept preferredView");
const preferredCandidate = findDocumentArtifactToolCandidate("assistant-message", [
  { type: "tool-createDocumentArtifact", toolCallId: "call_doc_view", output: preferredToolOutput },
]);
assert.equal(preferredCandidate?.preferredView, "preview", "preferredView should pass through document tool extraction");

const documentToolSource = await import("node:fs/promises").then((fs) => fs.readFile("apps/standalone-sveltekit/src/lib/tools/document.ts", "utf8"));
assert.equal(documentToolSource.includes("const runtime: DocumentToolRuntime"), true, "document tools should keep same-turn runtime state");
assert.equal(documentToolSource.includes("runtime.activeDocument = document"), true, "document create/update/read should refresh same-turn active document");
assert.equal(documentToolSource.includes("readDocumentArtifact"), true, "specific document read tool should be available for verification loops");
assert.equal(documentToolSource.includes("preferredDocumentViewSchema"), true, "document tools should expose preferred view schema");

const frameSource = await import("node:fs/promises").then((fs) => fs.readFile("packages/workspace-core/src/components/WorkspaceDocumentFrame.svelte", "utf8"));
assert.equal(frameSource.includes("preferredView?: PreferredDocumentView"), true, "Svelte wrapper should expose preferredView prop");
assert.equal(frameSource.includes("content, preferredView"), true, "Svelte wrapper should post preferredView to host payload");

assert.equal(hostHtml.includes("function applyPreferredView"), true, "host should apply preferred view without editing copied workspace source");
assert.equal(hostHtml.includes("#doc-render-view-toggle [data-renderview="), true, "host should use workspace HTML/SVG/XML view toggle");
assert.equal(hostHtml.includes("#doc-md-view-toggle [data-mdview="), true, "host should use workspace markdown preview toggle");
assert.equal(hostHtml.includes("document_host.preferred_view_applied"), true, "host should log preferred view telemetry");

const telemetryRoute = await import("node:fs/promises").then((fs) => fs.readFile("apps/standalone-sveltekit/src/routes/api/telemetry/+server.ts", "utf8"));
assert.equal(telemetryRoute.includes("writeAgentTelemetry"), true, "telemetry API should persist accepted events");
const telemetryServer = await import("node:fs/promises").then((fs) => fs.readFile("apps/standalone-sveltekit/src/lib/server/agent-telemetry.ts", "utf8"));
assert.equal(telemetryServer.includes("agent-ui-telemetry.jsonl"), true, "server telemetry should write local JSONL logs");
assert.equal(telemetryServer.includes("Intentional fail-safe: workspace telemetry is only a bounded mirror"), true, "server telemetry mirror should be explicitly non-fatal");
assert.equal(generateRoute.includes("api.generate.stream_attached"), true, "generate route should log stream attachment");
assert.equal(generateRoute.includes("sessionId: telemetrySessionId"), true, "generate route should associate agent telemetry with workspace sessions when available");

assert.equal(hostHtml.includes("function stabilizeOpenedDocument"), true, "host should stabilize the editor after copied-editor deferred switchToDoc");
assert.equal(hostHtml.includes("writeEditorDomFromRecord(documentRecord)"), true, "host stabilization should rewrite DOM from the just-opened document record");
assert.equal(hostHtml.includes("refreshRenderedPreview(documentRecord)"), true, "host stabilization should refresh rendered HTML/SVG/XML preview from updated content");
assert.equal(hostHtml.includes("function shouldSuppressStaleOpenSnapshot"), true, "host should suppress stale changed snapshots during open stabilization");
assert.equal(hostHtml.includes("document_host.stale_snapshot_suppressed"), true, "host should trace stale snapshot suppression");
assert.equal(hostHtml.includes("queueSnapshot('active', { force: true, clearStabilization: true })"), true, "host should emit a fresh active snapshot after stabilization");

const vm = await import("node:vm");
const contentHashSource = hostHtml.match(/      function contentHash\(value\) \{[\s\S]*?\n      \}\n/)?.[0];
const suppressSource = hostHtml.match(/      function shouldSuppressStaleOpenSnapshot\(type, snapshot\) \{[\s\S]*?\n      \}\n\n      function queueSnapshot/)?.[0]?.replace(/\n\n      function queueSnapshot[\s\S]*$/, "\n");
assert.equal(Boolean(contentHashSource && suppressSource), true, "host stale snapshot guard should be extractable for behavior tests");
const guardHarness = `
let openStabilization = null;
const telemetry = [];
function logHostTelemetry(event) { telemetry.push(event); }
${contentHashSource}
${suppressSource}
const expectedContent = '<html><body>Tokyo</body></html>';
openStabilization = {
  documentId: 'doc-weather',
  title: 'Tokyo Weather Dashboard',
  language: 'html',
  version_count: 4,
  contentHash: contentHash(expectedContent),
  until: Date.now() + 500
};
const staleSuppressed = shouldSuppressStaleOpenSnapshot('changed', {
  id: 'doc-weather',
  title: 'NYC Weather Dashboard',
  language: 'html',
  version_count: 4,
  current_content: '<html><body>NYC</body></html>'
});
const matchingSuppressed = shouldSuppressStaleOpenSnapshot('changed', {
  id: 'doc-weather',
  title: 'Tokyo Weather Dashboard',
  language: 'html',
  version_count: 4,
  current_content: expectedContent
});
openStabilization = null;
const realEditSuppressedAfterClear = shouldSuppressStaleOpenSnapshot('changed', {
  id: 'doc-weather',
  title: 'Tokyo Weather Dashboard',
  language: 'html',
  version_count: 4,
  current_content: '<html><body>Tokyo edited</body></html>'
});
({ staleSuppressed, matchingSuppressed, realEditSuppressedAfterClear, telemetry });
`;
const guardResult = vm.runInNewContext(guardHarness);
assert.equal(guardResult.staleSuppressed, true, "stale same-id NYC snapshot should be suppressed during stabilization");
assert.equal(guardResult.matchingSuppressed, false, "matching Tokyo snapshot should not be suppressed");
assert.equal(guardResult.realEditSuppressedAfterClear, false, "real edit after stabilization clear should not be suppressed");
assert.equal(guardResult.telemetry.some((event) => event.event === "document_host.stale_snapshot_suppressed"), true, "stale suppression should be traced");
assert.equal(hostHtml.includes("clearStabilization: true"), true, "host should clear stabilization after the forced active snapshot");

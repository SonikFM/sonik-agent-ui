import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pageSource = await readFile("apps/standalone-sveltekit/src/routes/+page.svelte", "utf8");
const rootSource = await readFile("packages/workspace-core/src/components/WorkspaceRoot.svelte", "utf8");
const generateRoute = await readFile("apps/standalone-sveltekit/src/routes/api/generate/+server.ts", "utf8");
const sessionRailSource = await readFile("apps/standalone-sveltekit/src/lib/session/SessionRail.svelte", "utf8");
const sessionDetailRoute = await readFile("apps/standalone-sveltekit/src/routes/api/session/[id]/+server.ts", "utf8");
const sessionMessagesRoute = await readFile("apps/standalone-sveltekit/src/routes/api/session/[id]/messages/+server.ts", "utf8");
const documentToolsSource = await readFile("apps/standalone-sveltekit/src/lib/tools/document.ts", "utf8");
const workspaceSessionSource = await readFile("packages/workspace-session/src/index.ts", "utf8");
const sessionsRoute = await readFile("apps/standalone-sveltekit/src/routes/api/sessions/+server.ts", "utf8");
const appCss = await readFile("apps/standalone-sveltekit/src/app.css", "utf8");
const layoutSource = await readFile("apps/standalone-sveltekit/src/routes/+layout.svelte", "utf8");
const odysseusFrameSource = await readFile("packages/workspace-core/src/components/OdysseusDocumentFrame.svelte", "utf8");
const odysseusHostSource = await readFile("apps/standalone-sveltekit/static/odysseus-document-host.html", "utf8");

assert.equal(rootSource.includes("rail?: Snippet"), true, "WorkspaceRoot should expose an optional rail snippet");
assert.equal(rootSource.includes("{@render rail()}"), true, "WorkspaceRoot should render the session rail beside chat/artifacts");
assert.equal(rootSource.includes('data-has-rail={Boolean(rail)}'), true, "WorkspaceRoot should keep no-rail integrations compatible");

assert.equal(pageSource.includes("let sessions = $state<WorkspaceSessionSummary[]>([])"), true, "app shell should keep a visible session list state");
assert.equal(pageSource.includes("let archivedSessionCount = $state(0)"), true, "app shell should make archived chat behavior visible");
assert.equal(pageSource.includes("let activeSessionId = $state<string | null>(null)"), true, "app shell should track active session id");
assert.equal(pageSource.includes("/api/sessions"), true, "app shell should load session summaries from the session API");
assert.equal(pageSource.includes("/api/session/${encodeURIComponent(sessionId)}/messages"), true, "app shell should persist chat history by session");
assert.equal(pageSource.includes("{#snippet rail()}"), true, "top-level app should provide the WorkspaceRoot rail slot");
assert.equal(pageSource.includes("sessionId: activeSessionId"), true, "generate requests should carry active session id");
assert.equal(pageSource.includes("function deriveChatTitle"), true, "app shell should derive deterministic first-message chat titles locally");
assert.equal(pageSource.includes("maybeNameNewChat(trimmed)"), true, "app shell should name new chats before sending the first message");
assert.equal(pageSource.includes('method: "PATCH"'), true, "app shell should call the session rename route");
assert.equal(pageSource.includes('method: "DELETE"'), true, "app shell should call the session delete route");
assert.equal(pageSource.includes("logSessionTelemetry"), true, "session rail actions should emit telemetry for debugging manual tests");
assert.equal(pageSource.includes("void loadArchivedSessionCount()"), true, "archived chat count should be best-effort and not block active session bootstrap");
assert.equal(pageSource.includes("session.archive_count.error"), true, "archived count failures should be observable without breaking active sessions");
assert.equal(pageSource.includes("session.archive.success"), true, "archiving a chat should be observable in telemetry");
assert.equal(pageSource.includes("normalizePersistedParts"), true, "session switching should hydrate persisted message parts back into chat");
assert.equal(pageSource.includes("archivedCount={archivedSessionCount}"), true, "rail should receive archived session count");
assert.equal(pageSource.includes("<SessionRail"), true, "top-level app should delegate rail presentation to a bounded shell component");
assert.equal(sessionRailSource.includes("onclick={() => onSwitch(session.id)}"), true, "session rail should expose session switching control");
assert.equal(sessionRailSource.includes("disabled={busy || session.id === activeSessionId}"), true, "session rail should disable switches during busy/streaming transitions");
assert.equal(sessionRailSource.includes("oncontextmenu={(event) => openContextMenu(event, session)}"), true, "session rail should expose right-click session actions");
assert.equal(sessionRailSource.includes("onclick={archiveContextSession}"), true, "session rail should expose archive through the context menu");
assert.equal(sessionRailSource.includes("onclick={deleteContextSession}"), true, "session rail should expose delete through the context menu");
assert.equal(sessionRailSource.includes("disabled={busy}"), true, "session rail should disable context menu actions during busy/streaming transitions");
assert.equal(sessionRailSource.includes("session-meta"), false, "session rail rows should stay slim and avoid card-style metadata clutter");
assert.equal(sessionRailSource.includes("{archivedCount} archived"), true, "session rail should show archived chat count instead of silently losing archived records");
assert.equal(sessionRailSource.includes("formatSessionTime"), true, "session rail should own session timestamp formatting");
assert.equal(pageSource.includes("Stop the current stream before switching sessions."), true, "session switches should be guarded while a stream is active");
assert.equal(pageSource.includes("tryFlushPendingDocumentPersistence"), true, "session transitions should hard-gate on document snapshot flushes");
assert.equal(pageSource.includes("sessionRailBusy = true;\n    sessionRailError = null;\n    try {\n      await flushPendingDocumentPersistence()"), true, "session transitions should acquire the rail lock before flushing document snapshots");
assert.equal(pageSource.includes("throw new Error(message || \"Document changes could not be saved; session transition was blocked.\")"), true, "failed document PATCH should throw instead of fail-open");
assert.equal(pageSource.includes("startDocumentPersistenceWorker"), true, "document snapshots should persist through a serialized worker");
assert.equal(pageSource.includes("void documentPersistPromise.catch(() => undefined)"), true, "background document persistence errors should be captured without unhandled rejections");
assert.equal(pageSource.includes("if (!failed && pendingDocumentSnapshot) startDocumentPersistenceWorker()"), true, "new snapshots arriving during a successful flush should be persisted next");
assert.equal(pageSource.includes("if (pendingDocumentSnapshot && createDocumentSnapshotSignature(pendingDocumentSnapshot) === signature)"), true, "in-flight document PATCHes should only clear the same snapshot they persisted");
assert.equal(pageSource.includes("scheduleDocumentPersistence(event.document)"), true, "document frame events should persist snapshots outside generate turns");

assert.equal(sessionDetailRoute.includes("getOdysseusSession(params.id)"), true, "session detail route should resolve one session by id");
assert.equal(sessionDetailRoute.includes("listWorkspaceMessages(session.id)"), true, "session detail route should return message history");
assert.equal(sessionDetailRoute.includes("activeDocument"), true, "session detail route should hydrate the active document");
assert.equal(sessionDetailRoute.includes("listWorkspaceTelemetryEvents(session.id).slice(-50)"), true, "session detail route should expose bounded telemetry for debugging");
assert.equal(sessionDetailRoute.includes("export async function PATCH"), true, "session detail route should support renaming chats");
assert.equal(sessionDetailRoute.includes("patchOdysseusSession(session.id, { name })"), true, "session rename route should patch only the validated session name");
assert.equal(sessionDetailRoute.includes("export function DELETE"), true, "session detail route should support deleting local chats");
assert.equal(sessionDetailRoute.includes("deleteOdysseusSession(session.id)"), true, "session delete route should use the persistence seam");
assert.equal(sessionDetailRoute.includes('persistence: "ephemeral-v0"'), true, "session detail route should make v0 JSON artifact ephemerality explicit");
assert.equal(sessionDetailRoute.includes("listWorkspaceToolCalls"), false, "session detail route should not advertise unhydrated tool-call state in v0");
assert.equal(sessionDetailRoute.includes("listWorkspaceLayoutSnapshots"), false, "session detail route should not advertise unhydrated layout state in v0");

assert.equal(sessionMessagesRoute.includes("appendWorkspaceMessage"), true, "message route should persist chat messages through workspace adapter");
assert.equal(sessionMessagesRoute.includes("listWorkspaceMessages(session.id)"), true, "message route should read chat messages through workspace adapter");
assert.equal(sessionMessagesRoute.includes("WORKSPACE_CONTENT_MAX_CHARS"), true, "message persistence should apply route limits to content");
assert.equal(sessionMessagesRoute.includes("Invalid JSON message payload"), true, "message route should reject malformed JSON instead of appending blank messages");
assert.equal(sessionMessagesRoute.includes("role must be system, user, assistant, or tool"), true, "message route should reject invalid roles instead of defaulting to assistant");

assert.equal(generateRoute.includes("workspace.sessionId"), true, "generate route should validate workspace session id");
assert.equal(generateRoute.includes("activeDocument?.session_id ?? workspaceSessionId"), true, "generate telemetry should prefer active document session and fall back to shell session");
assert.equal(generateRoute.includes("createAgent({ activeDocument, sessionId: telemetrySessionId })"), true, "agent tools should receive the active workspace session id");

assert.equal(documentToolsSource.includes("sessionId?: string | null"), true, "document tool context should accept a workspace session id");
assert.equal(documentToolsSource.includes("session_id: runtime.sessionId"), true, "new document artifacts should be created inside the active workspace session");
assert.equal(workspaceSessionSource.includes("deleteSession(id: string): boolean"), true, "workspace session adapter should expose explicit session deletion");
assert.equal(workspaceSessionSource.includes("this.#messages.delete(id)"), true, "session deletion should remove local message history");

assert.equal(sessionsRoute.includes('url.searchParams.get("archived") === "true"'), true, "session list API should expose archived session records for future archive views");
assert.equal(appCss.includes('@source "../../../packages/chat-surface/dist"'), true, "Tailwind should scan packaged chat surface Svelte output");
assert.equal(appCss.includes('html[data-theme="gunmetal-light"]'), true, "standalone app should expose a token-backed default theme");
assert.equal(layoutSource.includes('root.dataset.theme = "gunmetal-light"'), true, "layout should initialize the standalone app theme");
assert.equal(odysseusFrameSource.includes("sonik:odysseus-document:theme"), true, "document iframe wrapper should send theme tokens to the Odysseus island");
assert.equal(odysseusFrameSource.includes("targetOrigin?: string"), true, "document iframe theme bridge should make its postMessage target origin explicit for host adapters");
assert.equal(odysseusFrameSource.includes("allowedOrigin?: string"), true, "document iframe wrapper should make inbound message origin explicit for host adapters");
assert.equal(odysseusHostSource.includes("parentTargetOrigin = event.origin"), true, "Odysseus document host should reply to the parent origin it received");
assert.equal(odysseusHostSource.includes("const allowedParentOrigin = window.location.origin"), true, "bundled Odysseus document host should reject arbitrary cross-origin embedding parents");
assert.equal(odysseusHostSource.includes("if (event.origin !== allowedParentOrigin) return"), true, "Odysseus document host should validate parent origin before processing commands");
assert.equal(odysseusHostSource.includes("document_host.theme_applied"), true, "Odysseus document host should apply and log theme bridge events");

console.log("app-shell-session-rail tests passed");

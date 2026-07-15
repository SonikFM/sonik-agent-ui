import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import {
  AGENT_UI_FILE_MAX_BYTES,
  AgentUiFileError,
  deleteAgentUiFile,
  readAgentUiFile,
  resolveAgentUiWorkspaceSession,
  resolveGoogleAgentUiFileParts,
  resolveAgentUiFileContextSelection,
  toPublicAgentUiFile,
  uploadAgentUiFile,
} from "../../apps/standalone-sveltekit/src/lib/server/agent-ui-files.ts";
import { createAsyncWorkspacePersistenceAdapter, createInMemoryWorkspacePersistence } from "../../packages/workspace-session/src/index.ts";
import { getRequestWorkspacePersistence } from "../../apps/standalone-sveltekit/src/lib/server/workspace-request-store.ts";
import {
  AGENT_UI_WORKSPACE_SESSION_CONTEXT_HEADER,
  createSignedTrustedHostContextHeader,
  createSignedWorkspaceSessionContextHeader,
  resolveSignedWorkspaceSessionId,
  resolveTrustedHostSessionSnapshot,
} from "../../apps/standalone-sveltekit/src/lib/server/workspace-services.ts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("$lib/")) {
      return { url: new URL(`../../apps/standalone-sveltekit/src/lib/${specifier.slice(5)}.ts`, import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { GET: getFileRoute, DELETE: deleteFileRoute } = await import("../../apps/standalone-sveltekit/src/routes/api/files/[id]/+server.ts");
const { POST: postFileRoute } = await import("../../apps/standalone-sveltekit/src/routes/api/files/+server.ts");

const auth = {
  authenticated: true,
  organizationId: "org-a",
  userId: "user-a",
  principalId: "user-a",
  sessionId: "host-session",
  source: "test",
  scopes: [],
  expiresAt: null,
  metadata: {},
};

class FakeBucket {
  objects = new Map();
  puts = [];
  gets = [];
  deletes = [];
  getError = null;
  deleteError = null;

  async put(key, value) {
    this.puts.push(key);
    this.objects.set(key, value.slice(0));
  }

  async get(key) {
    this.gets.push(key);
    if (this.getError) throw this.getError;
    const value = this.objects.get(key);
    return value ? { body: value.slice(0) } : null;
  }

  async delete(key) {
    this.deletes.push(key);
    if (this.deleteError) throw this.deleteError;
    this.objects.delete(key);
  }
}

{
  const bucket = new FakeBucket();
  const form = new FormData();
  form.append("file", new File(["private"], "private.txt", { type: "text/plain" }));
  form.append("session_id", "missing-auth-session");
  const requestId = "req-file-auth-zero-write";
  const traceId = "0123456789abcdef0123456789abcdef";
  const response = await postFileRoute({
    request: new Request("http://localhost/api/files", {
      method: "POST",
      headers: { "x-sonik-request-id": requestId, "x-sonik-trace-id": traceId },
      body: form,
    }),
    platform: { env: { SONIK_AGENT_UI_PERSISTENCE_MODE: "memory", AGENT_UI_FILES_BUCKET: bucket } },
    locals: {},
  });
  assert.equal(response.status, 401);
  const failureBody = await response.json();
  assert.deepEqual(failureBody, {
    ok: false,
    error: "Authenticated host session required",
    code: "host_auth_required",
    phase: "pre_write",
    safeToRetry: true,
    requestId,
    traceId,
  });
  assert.equal(response.headers.get("x-sonik-request-id"), requestId);
  assert.equal(response.headers.get("x-sonik-trace-id"), traceId);
  assert.equal(bucket.puts.length, 0, "typed auth failure performs zero private-storage writes");
  assert.equal(JSON.stringify(failureBody).includes("private.txt"), false, "typed public failure never leaks the private filename or bytes");
}

{
  const privateFilename = "private-upload-sentinel.txt";
  const privateProviderDetail = "private-storage-key=agent-ui/credential-sentinel";
  const bucket = new FakeBucket();
  bucket.put = async () => {
    throw new Error(`${privateProviderDetail}; filename=${privateFilename}`);
  };
  const platform = { env: { SONIK_AGENT_UI_PERSISTENCE_MODE: "memory", AGENT_UI_FILES_BUCKET: bucket } };
  const locals = { agentUiHostSession: auth };
  const setupEvent = { request: new Request("http://localhost/api/files"), platform, locals };
  await getRequestWorkspacePersistence(setupEvent).createSession({ id: "unexpected-upload-session" });
  const form = new FormData();
  form.append("file", new File(["private upload body sentinel"], privateFilename, { type: "text/plain" }));
  form.append("session_id", "unexpected-upload-session");
  const requestId = "req-file-unexpected-log";
  const traceId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const logs = [];
  const originalConsoleError = console.error;
  console.error = (...args) => logs.push(args);
  let response;
  try {
    response = await postFileRoute({
      request: new Request("http://localhost/api/files", {
        method: "POST",
        headers: { "x-sonik-request-id": requestId, "x-sonik-trace-id": traceId },
        body: form,
      }),
      platform,
      locals,
    });
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(response.status, 500);
  const failureBody = await response.json();
  assert.deepEqual(failureBody, {
    ok: false,
    error: "File upload failed",
    code: "file_upload_failed",
    phase: "post_write",
    safeToRetry: false,
    requestId,
    traceId,
  });
  assert.deepEqual(logs, [["Agent UI file upload failed", { category: "upload_unexpected" }]], "unexpected upload logging is category-only");
  const publicAndLoggedText = JSON.stringify({ failureBody, logs });
  for (const sentinel of [privateFilename, privateProviderDetail, "private upload body sentinel", "credential-sentinel"]) {
    assert.equal(publicAndLoggedText.includes(sentinel), false, `unexpected upload failure must not log or return private sentinel: ${sentinel}`);
  }
}

{
  const bucket = new FakeBucket();
  const secret = "route-workspace-context-secret";
  const eventFor = (workspaceSessionContext, agentUiHostSession = auth, requestHeaders = {}) => ({
    params: { id: "route-file" },
    request: new Request("http://localhost/api/files/route-file?session_id=session-a", {
      headers: { ...(workspaceSessionContext ? { [AGENT_UI_WORKSPACE_SESSION_CONTEXT_HEADER]: workspaceSessionContext } : {}), ...requestHeaders },
    }),
    platform: { env: { SONIK_AGENT_UI_PERSISTENCE_MODE: "memory", SONIK_AGENT_UI_HOST_CONTEXT_SECRET: secret, AGENT_UI_FILES_BUCKET: bucket } },
    locals: { agentUiHostSession },
  });
  const persistence = getRequestWorkspacePersistence(eventFor(null));
  await persistence.createSession({ id: "session-a" });
  await persistence.createSession({ id: "session-b" });
  await persistence.createFile({
    id: "route-file",
    session_id: "session-a",
    storage_key: "agent-ui/route-file",
    original_filename: "route.txt",
    media_type: "text/plain",
    byte_size: 5,
    status: "ready",
  });
  bucket.objects.set("agent-ui/route-file", new TextEncoder().encode("route").buffer);
  const sessionAContext = createSignedWorkspaceSessionContextHeader(eventFor(null), "session-a");
  const sessionBContext = createSignedWorkspaceSessionContextHeader(eventFor(null), "session-b");
  assert.ok(sessionAContext && sessionBContext);

  const hostContextWithWorkspaceMetadata = createSignedTrustedHostContextHeader({
    secret,
    context: {
      authenticated: true,
      organizationId: auth.organizationId,
      hostSession: { ...auth, metadata: { workspaceSessionId: "session-a" } },
    },
  });
  assert.equal(
    resolveSignedWorkspaceSessionId(eventFor(hostContextWithWorkspaceMetadata)),
    null,
    "ordinary signed host contexts cannot be replayed as workspace-session tokens",
  );

  const mismatchedGet = await getFileRoute(eventFor(sessionBContext));
  assert.equal(mismatchedGet.status, 404, "direct GET rejects a same-user file from another active workspace session");
  assert.equal((await mismatchedGet.json()).code, "file_not_found");
  assert.equal(bucket.gets.length, 0, "cross-session route GET never reaches R2");

  const mismatchedDelete = await deleteFileRoute(eventFor(sessionBContext));
  assert.equal(mismatchedDelete.status, 404, "direct DELETE rejects a same-user file from another active workspace session");
  assert.equal((await mismatchedDelete.json()).code, "file_not_found");
  assert.equal(bucket.deletes.length, 0, "cross-session route DELETE never reaches R2");
  assert.equal((await persistence.getFile("route-file"))?.status, "ready", "rejected route DELETE does not mutate lifecycle state");

  assert.equal((await getFileRoute(eventFor(null))).status, 404, "direct file access fails closed without a caller workspace session");
  assert.equal((await getFileRoute(eventFor(`${sessionAContext}tampered`))).status, 404, "direct file access fails closed for an invalid caller workspace context");
  assert.equal((await getFileRoute(eventFor(sessionAContext, { ...auth, organizationId: "org-b" }))).status, 404, "workspace context cannot cross tenants");
  assert.equal((await getFileRoute(eventFor(sessionAContext, { ...auth, userId: "user-b" }))).status, 404, "workspace context cannot cross users");
  assert.equal((await getFileRoute(eventFor(sessionAContext, { ...auth, sessionId: "host-session-b" }))).status, 404, "workspace context cannot cross host sessions");

  const requestId = "req-file-route-failure";
  const traceId = "fedcba9876543210fedcba9876543210";
  const correlatedEvent = () => eventFor(sessionAContext, auth, { "x-sonik-request-id": requestId, "x-sonik-trace-id": traceId });
  bucket.getError = new Error("private read provider detail for route.txt");
  const failedGet = await getFileRoute(correlatedEvent());
  assert.equal(failedGet.status, 500);
  const failedGetBody = await failedGet.json();
  assert.deepEqual(failedGetBody, { ok: false, error: "File read failed", code: "file_read_failed", phase: "read", safeToRetry: false, requestId, traceId });
  assert.equal(failedGet.headers.get("cache-control"), "private, no-store");
  assert.equal(failedGet.headers.get("x-content-type-options"), "nosniff");
  assert.equal(failedGet.headers.get("x-sonik-request-id"), requestId);
  assert.equal(failedGet.headers.get("x-sonik-trace-id"), traceId);
  assert.equal(JSON.stringify(failedGetBody).includes("route.txt"), false, "unexpected read failures do not leak private filenames or provider errors");
  bucket.getError = null;

  const authorizedGet = await getFileRoute(eventFor(sessionAContext));
  assert.equal(await authorizedGet.text(), "route");
  assert.equal(authorizedGet.headers.get("cache-control"), "private, no-store");
  assert.equal(authorizedGet.headers.get("x-content-type-options"), "nosniff");

  bucket.deleteError = new Error("private delete provider detail for route.txt");
  const failedDelete = await deleteFileRoute(correlatedEvent());
  assert.equal(failedDelete.status, 500);
  const failedDeleteBody = await failedDelete.json();
  assert.deepEqual(failedDeleteBody, { ok: false, error: "File deletion failed", code: "file_delete_failed", phase: "post_write", safeToRetry: false, requestId, traceId });
  assert.equal(failedDelete.headers.get("cache-control"), "private, no-store");
  assert.equal(failedDelete.headers.get("x-content-type-options"), "nosniff");
  assert.equal(failedDelete.headers.get("x-sonik-request-id"), requestId);
  assert.equal(failedDelete.headers.get("x-sonik-trace-id"), traceId);
  assert.equal(JSON.stringify(failedDeleteBody).includes("route.txt"), false, "unexpected delete failures do not leak private filenames or provider errors");
  bucket.deleteError = null;

  const authorizedDelete = await deleteFileRoute(eventFor(sessionAContext));
  assert.equal(authorizedDelete.status, 200);
  assert.deepEqual(await authorizedDelete.json(), { id: "route-file", deleted: true });
  assert.equal(await persistence.getFile("route-file"), null);
  assert.equal(bucket.objects.has("agent-ui/route-file"), false);
}

{
  const eventFor = (sessionId) => ({
    request: new Request("http://localhost/api/files"),
    platform: { env: { SONIK_AGENT_UI_PERSISTENCE_MODE: "memory" } },
    locals: { agentUiHostSession: { ...auth, sessionId } },
  });
  const event = eventFor("host-a");
  const persistence = getRequestWorkspacePersistence(event);
  await persistence.createSession({ id: "trusted-workspace" });
  assert.equal((await resolveAgentUiWorkspaceSession(event, { sessionId: "trusted-workspace" })).sessionId, "trusted-workspace", "request ids become trusted only after host-scoped lookup");
  assert.equal(
    (await resolveAgentUiWorkspaceSession(eventFor("host-b"), { sessionId: "trusted-workspace" })).sessionId,
    "trusted-workspace",
    "the same org/user retains workspace ownership when the host session rotates",
  );
}

{
  const eventFor = (organizationId, userId, persistenceMode) => ({
    request: new Request("http://localhost/api/files"),
    platform: { env: { SONIK_AGENT_UI_PERSISTENCE_MODE: persistenceMode } },
    locals: { agentUiHostSession: { ...auth, organizationId, userId, principalId: userId } },
  });
  for (const persistenceMode of ["memory", "auto"]) {
    const bucket = new FakeBucket();
    const tenantAEvent = eventFor("org-a", "user-a", persistenceMode);
    const tenantAPersistence = getRequestWorkspacePersistence(tenantAEvent);
    const sessionId = `tenant-a-${persistenceMode}-session`;
    await tenantAPersistence.createSession({ id: sessionId });
    const uploaded = await uploadAgentUiFile({
      file: new File(["private tenant bytes"], "tenant-a.txt", { type: "text/plain" }),
      sessionId,
      auth: resolveTrustedHostSessionSnapshot(tenantAEvent),
      persistence: tenantAPersistence,
      bucket,
    });

    for (const [organizationId, userId] of [["org-a", "user-b"], ["org-b", "user-a"], ["org-b", "user-b"]]) {
      const foreignEvent = eventFor(organizationId, userId, persistenceMode);
      const foreignPersistence = getRequestWorkspacePersistence(foreignEvent);
      const foreignAuth = resolveTrustedHostSessionSnapshot(foreignEvent);
      await assert.rejects(() => uploadAgentUiFile({
        file: new File(["foreign upload"], "foreign.txt", { type: "text/plain" }),
        sessionId,
        auth: foreignAuth,
        persistence: foreignPersistence,
        bucket,
      }), /Session not found/);
      assert.deepEqual(await foreignPersistence.listFiles(sessionId), [], `cross-tenant ${persistenceMode} file list stays empty`);
      await assert.rejects(() => readAgentUiFile({ id: uploaded.id, sessionId, auth: foreignAuth, persistence: foreignPersistence, bucket }), /File not found/);
      await assert.rejects(() => deleteAgentUiFile({ id: uploaded.id, sessionId, auth: foreignAuth, persistence: foreignPersistence, bucket }), /File not found/);
    }
    assert.equal(bucket.gets.length, 0, `cross-tenant ${persistenceMode} reads never reach private object storage`);
    assert.equal(bucket.deletes.length, 0, `cross-tenant ${persistenceMode} deletes never reach private object storage`);
    assert.deepEqual((await tenantAPersistence.listFiles(sessionId)).map((file) => file.id), [uploaded.id]);
    assert.equal(await (await readAgentUiFile({ id: uploaded.id, sessionId, auth: resolveTrustedHostSessionSnapshot(tenantAEvent), persistence: tenantAPersistence, bucket })).text(), "private tenant bytes");
  }
}

{
  const { persistence, bucket } = setup();
  await persistence.createFile({ id: "cached-file", session_id: "session-a", storage_key: "agent-ui/cached-file", original_filename: "cached.pdf", media_type: "application/pdf", byte_size: 4, status: "ready", provider_references: { google: "files/cached" }, provider_references_expires_at: "2026-07-15T00:00:00.000Z" });
  let uploads = 0;
  const parts = await resolveGoogleAgentUiFileParts({ fileIds: ["cached-file"], sessionId: "session-a", auth, persistence, bucket, filesApi: {}, now: new Date("2026-07-14T00:00:00.000Z"), upload: async () => { uploads += 1; } });
  assert.deepEqual(parts, [{ type: "file", data: { google: "files/cached" }, mediaType: "application/pdf", filename: "cached.pdf" }]);
  assert.equal(uploads, 0);
  assert.equal(bucket.gets.length, 0);
}

{
  const { persistence, bucket } = setup();
  await persistence.createFile({ id: "fresh-file", session_id: "session-a", storage_key: "agent-ui/fresh-file", original_filename: "fresh.pdf", media_type: "application/pdf", byte_size: 4, status: "ready", provider_references: { google: "files/expired" }, provider_references_expires_at: "2026-07-13T00:00:00.000Z" });
  bucket.objects.set("agent-ui/fresh-file", new TextEncoder().encode("data").buffer);
  const parts = await resolveGoogleAgentUiFileParts({ fileIds: ["fresh-file"], sessionId: "session-a", auth, persistence, bucket, filesApi: {}, now: new Date("2026-07-14T00:00:00.000Z"), upload: async ({ data, mediaType }) => {
    assert.equal(data.byteLength, 4);
    assert.equal(mediaType, "application/pdf");
    return { providerReference: { google: "files/fresh" }, warnings: [] };
  } });
  assert.equal(parts[0].data.google, "files/fresh");
  assert.equal((await persistence.getFile("fresh-file")).provider_references.google, "files/fresh");
  assert.equal((await persistence.getFile("fresh-file")).provider_references_expires_at, "2026-07-15T23:00:00.000Z");
}

{
  const { persistence, bucket } = setup();
  await persistence.createFile({ id: "missing-object", session_id: "session-a", storage_key: "agent-ui/missing-object", original_filename: "missing.pdf", media_type: "application/pdf", byte_size: 4, status: "ready" });
  await assert.rejects(() => resolveGoogleAgentUiFileParts({ fileIds: ["missing-object"], sessionId: "session-a", auth, persistence, bucket, filesApi: {}, upload: async () => assert.fail("must not upload") }), /File not found/);
}

{
  const { persistence, bucket } = setup();
  await persistence.createFile({ id: "provider-failure", session_id: "session-a", storage_key: "agent-ui/provider-failure", original_filename: "failure.pdf", media_type: "application/pdf", byte_size: 4, status: "ready" });
  bucket.objects.set("agent-ui/provider-failure", new TextEncoder().encode("data").buffer);
  await assert.rejects(() => resolveGoogleAgentUiFileParts({ fileIds: ["provider-failure"], sessionId: "session-a", auth, persistence, bucket, filesApi: {}, upload: async () => { throw new Error("secret provider response"); } }), (error) => error.message === "File processing failed");
  const failedPersistence = { ...persistence, updateFile: async () => null };
  await assert.rejects(() => resolveGoogleAgentUiFileParts({ fileIds: ["provider-failure"], sessionId: "session-a", auth, persistence: failedPersistence, bucket, filesApi: {}, upload: async () => ({ providerReference: { google: "files/orphan" }, warnings: [] }) }), (error) => error.message === "File processing failed");
}

function setup() {
  const sync = createInMemoryWorkspacePersistence();
  sync.createSession({ id: "session-a" });
  return { persistence: createAsyncWorkspacePersistenceAdapter(sync), bucket: new FakeBucket() };
}

for (const [type, name] of [
  ["application/pdf", "brief.pdf"],
  ["text/plain", "notes.txt"],
  ["text/markdown", "notes.md"],
  ["text/csv", "data.csv"],
  ["text/html", "page.html"],
  ["text/xml", "feed.xml"],
  ["text/css", "styles.css"],
  ["text/javascript", "script.js"],
  ["application/json", "data.json"],
  ["image/bmp", "scan.bmp"],
  ["image/jpeg", "photo.jpg"],
  ["image/png", "diagram.png"],
  ["image/webp", "photo.webp"],
]) {
  const { persistence, bucket } = setup();
  const file = new File(["content"], name, { type });
  const record = await uploadAgentUiFile({ file, sessionId: "session-a", auth, persistence, bucket });
  assert.equal(record.media_type, type);
  assert.equal(record.byte_size, 7);
  assert.match(record.checksum, /^sha256:[0-9a-f]{64}$/);
  assert.match(record.storage_key, /^agent-ui\/[0-9a-f-]+$/);
  assert.equal(record.storage_key.includes("org-a"), false);
  assert.equal(bucket.puts.length, 1);
}

for (const [file, guidance] of [
  [new File(["binary"], "report.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), /convert.*PDF|text|Markdown/i],
  [new File(["binary"], "report.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), /convert.*CSV/i],
  [new File(["binary"], "slides.pptx", { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }), /convert.*PDF/i],
]) {
  const { persistence, bucket } = setup();
  await assert.rejects(() => uploadAgentUiFile({ file, sessionId: "session-a", auth, persistence, bucket }), guidance);
  assert.equal(bucket.puts.length, 0);
}

for (const [file, error] of [
  [new File(["binary"], "report.pdf", { type: "image/png" }), /extension does not match/i],
  [new File([new Uint8Array(AGENT_UI_FILE_MAX_BYTES + 1)], "large.pdf", { type: "application/pdf" }), /10 MiB|10485760-byte/i],
]) {
  const { persistence, bucket } = setup();
  await assert.rejects(() => uploadAgentUiFile({ file, sessionId: "session-a", auth, persistence, bucket }), error);
  assert.equal(bucket.puts.length, 0);
}

{
  const { persistence } = setup();
  const file = new File(["content"], "brief.pdf", { type: "application/pdf" });
  await assert.rejects(() => uploadAgentUiFile({ file, sessionId: "session-a", auth, persistence }), /storage is unavailable/);
  await assert.rejects(() => uploadAgentUiFile({ file, sessionId: "foreign-session", auth, persistence, bucket: new FakeBucket() }), /Session not found/);
  await assert.rejects(() => uploadAgentUiFile({ file, sessionId: "session-a", auth: { ...auth, authenticated: false }, persistence, bucket: new FakeBucket() }), /Authenticated host session required/);
}

{
  const { persistence, bucket } = setup();
  const uploaded = await uploadAgentUiFile({
    file: new File(["private"], 'unsafe\"/name.pdf', { type: "application/pdf" }),
    sessionId: "session-a",
    auth,
    persistence,
    bucket,
  });
  const publicFile = toPublicAgentUiFile({ ...uploaded, provider_references: { provider: "secret" } });
  assert.equal("storage_key" in publicFile, false);
  assert.equal("provider_references" in publicFile, false);
  assert.equal("provider_references_expires_at" in publicFile, false);
  const response = await readAgentUiFile({ id: uploaded.id, sessionId: "session-a", auth, persistence, bucket });
  assert.equal(await response.text(), "private");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.doesNotMatch(response.headers.get("content-disposition"), /[\r\n]/);
  assert.match(response.headers.get("content-disposition"), /^attachment;/);

  await deleteAgentUiFile({ id: uploaded.id, sessionId: "session-a", auth, persistence, bucket });
  assert.equal(bucket.deletes.at(-1), uploaded.storage_key);
  assert.equal(await persistence.getFile(uploaded.id), null);
}

{
  const { persistence, bucket } = setup();
  await persistence.createSession({ id: "session-b" });
  const uploaded = await uploadAgentUiFile({ file: new File(["private"], "brief.pdf", { type: "application/pdf" }), sessionId: "session-a", auth, persistence, bucket });
  const otherSessionAuth = { ...auth, sessionId: "session-b" };
  await assert.rejects(() => readAgentUiFile({ id: uploaded.id, sessionId: otherSessionAuth.sessionId, auth: otherSessionAuth, persistence, bucket }), /File not found/);
  await assert.rejects(() => deleteAgentUiFile({ id: uploaded.id, sessionId: otherSessionAuth.sessionId, auth: otherSessionAuth, persistence, bucket }), /File not found/);
  assert.equal(bucket.gets.length, 0, "same-user cross-session reads never reach object storage");
  assert.equal(bucket.deletes.length, 0, "same-user cross-session deletes never reach object storage");
  assert.equal(await (await readAgentUiFile({ id: uploaded.id, sessionId: "session-a", auth, persistence, bucket })).text(), "private");
}

{
  const { persistence, bucket } = setup();
  const uploaded = await uploadAgentUiFile({ file: new File(["private"], "brief.pdf", { type: "application/pdf" }), sessionId: "session-a", auth, persistence, bucket });
  const wrongHostPersistence = { ...persistence, getSession: async () => null };
  await assert.rejects(() => readAgentUiFile({ id: uploaded.id, sessionId: "session-a", auth, persistence: wrongHostPersistence, bucket }), /File not found/);
  await assert.rejects(() => deleteAgentUiFile({ id: uploaded.id, sessionId: "session-a", auth, persistence: wrongHostPersistence, bucket }), /File not found/);
  await assert.rejects(() => resolveAgentUiFileContextSelection({ selection: { items: [{ id: "file", kind: "file", label: "brief", source: "manual", ref: uploaded.id }], dismissedAutoSeedIds: [] }, sessionId: "session-a", auth, persistence: wrongHostPersistence }), /File not found/);
  await assert.rejects(() => resolveGoogleAgentUiFileParts({ fileIds: [uploaded.id], sessionId: "session-a", auth, persistence: wrongHostPersistence, bucket, filesApi: {}, upload: async () => assert.fail("must not upload") }), /File not found/);
  assert.equal(bucket.gets.length, 0, "library helpers reject an untrusted host workspace before R2 access");
  assert.equal(bucket.deletes.length, 0, "library helpers reject an untrusted host workspace before R2 deletion");
}

{
  const { persistence, bucket } = setup();
  const foreignScopedPersistence = { ...persistence, getFile: async () => null };
  await assert.rejects(() => readAgentUiFile({ id: "foreign-scope", sessionId: "session-a", auth, persistence: foreignScopedPersistence, bucket }), /File not found/);
  await assert.rejects(() => deleteAgentUiFile({ id: "foreign-scope", sessionId: "session-a", auth, persistence: foreignScopedPersistence, bucket }), /File not found/);

  await persistence.createFile({
    id: "foreign",
    session_id: "session-a",
    storage_key: "foreign-provider/key",
    original_filename: "foreign.pdf",
    media_type: "application/pdf",
    byte_size: 1,
    status: "ready",
  });
  await assert.rejects(() => readAgentUiFile({ id: "foreign", sessionId: "session-a", auth, persistence, bucket }), /File not found/);
  await assert.rejects(() => deleteAgentUiFile({ id: "foreign", sessionId: "session-a", auth, persistence, bucket }), /File not found/);
  assert.equal(bucket.gets.length, 0);
  assert.equal(bucket.deletes.length, 0);
}

{
  const { persistence, bucket } = setup();
  let createdId;
  const retryablePersistence = {
    ...persistence,
    createFile: async (input) => {
      assert.equal(input.status, "pending", "catalog reserves the retry handle before the R2 write");
      createdId = input.id;
      return persistence.createFile(input);
    },
    updateFile: async (id, input) => {
      if (input.status === "ready") throw new Error("catalog transition failed");
      return persistence.updateFile(id, input);
    },
  };
  bucket.deleteError = new Error("rollback delete failed");
  await assert.rejects(
    () => uploadAgentUiFile({ file: new File(["private"], "brief.pdf", { type: "application/pdf" }), sessionId: "session-a", auth, persistence: retryablePersistence, bucket }),
    (error) => error instanceof AgentUiFileError && error.status === 500 && error.message === "File upload failed" && error.retryFileId === createdId,
  );
  const failed = await persistence.getFile(createdId);
  assert.equal(failed?.status, "failed", "double failure retains a non-readable catalog retry handle");
  assert.equal(failed?.storage_key, `agent-ui/${encodeURIComponent(createdId)}`);
  assert.equal(bucket.puts.length, 1);
  assert.deepEqual(bucket.deletes, bucket.puts, "failed ready transition attempts R2 rollback");
  assert.equal(bucket.objects.has(failed.storage_key), true, "failed rollback leaves canonical bytes for DELETE retry");
  await assert.rejects(() => readAgentUiFile({ id: createdId, sessionId: "session-a", auth, persistence, bucket }), /File not found/);

  bucket.deleteError = null;
  await deleteAgentUiFile({ id: createdId, sessionId: "session-a", auth, persistence, bucket });
  assert.equal(await persistence.getFile(createdId), null, "retry removes the retained handle after R2 cleanup");
}

{
  const { persistence, bucket } = setup();
  const uploaded = await uploadAgentUiFile({ file: new File(["private"], "brief.pdf", { type: "application/pdf" }), sessionId: "session-a", auth, persistence, bucket });
  bucket.deleteError = new Error("R2 unavailable");
  await assert.rejects(
    () => deleteAgentUiFile({ id: uploaded.id, sessionId: "session-a", auth, persistence, bucket }),
    /R2 unavailable|File deletion failed/,
  );
  assert.equal((await persistence.getFile(uploaded.id))?.status, "failed", "R2 delete failure preserves a retryable non-readable row");
  await assert.rejects(() => readAgentUiFile({ id: uploaded.id, sessionId: "session-a", auth, persistence, bucket }), /File not found/);

  bucket.deleteError = null;
  await deleteAgentUiFile({ id: uploaded.id, sessionId: "session-a", auth, persistence, bucket });
  assert.equal(await persistence.getFile(uploaded.id), null, "DELETE retries failed rows");
  assert.equal(bucket.objects.has(uploaded.storage_key), false);
}

{
  const { persistence, bucket } = setup();
  const uploaded = await uploadAgentUiFile({ file: new File(["private"], "brief.pdf", { type: "application/pdf" }), sessionId: "session-a", auth, persistence, bucket });
  let tombstoneAttempts = 0;
  await assert.rejects(
    () => deleteAgentUiFile({ id: uploaded.id, sessionId: "session-a", auth, persistence: {
      ...persistence,
      deleteFile: async () => {
        tombstoneAttempts += 1;
        throw new Error("tombstone failed");
      },
    }, bucket }),
    /tombstone failed/,
  );
  assert.equal(tombstoneAttempts, 1);
  assert.equal(bucket.objects.has(uploaded.storage_key), false, "R2 is deleted before the final tombstone");
  assert.equal((await persistence.getFile(uploaded.id))?.status, "failed", "tombstone failure preserves the retry handle");

  await deleteAgentUiFile({ id: uploaded.id, sessionId: "session-a", auth, persistence, bucket });
  assert.equal(await persistence.getFile(uploaded.id), null, "retry tolerates an already-missing R2 object");
  assert.equal(bucket.deletes.filter((key) => key === uploaded.storage_key).length, 2);
}

const postRoute = await readFile(new URL("../../apps/standalone-sveltekit/src/routes/api/files/+server.ts", import.meta.url), "utf8");
assert.match(postRoute, /multipart\/form-data/);
assert.match(postRoute, /toPublicAgentUiFile\(record\)/);
assert.match(postRoute, /PRIVATE_FILE_HEADERS/);
assert.match(postRoute, /resolveAgentUiWorkspaceSession\(event, \{ sessionId/, "upload resolves the multipart selector through trusted host-scoped persistence");
assert.match(postRoute, /retry_file_id/, "upload failures may expose only the opaque public retry id");
assert.doesNotMatch(postRoute, /storage_key|provider_references/, "upload failure responses never expose storage or provider metadata");

const generateRoute = await readFile(new URL("../../apps/standalone-sveltekit/src/routes/api/generate/+server.ts", import.meta.url), "utf8");
assert.match(generateRoute, /requestedWorkspaceSessionId && hasSelectedWorkspaceContext[\s\S]*resolveAgentUiWorkspaceSession\(event, \{ sessionId: requestedWorkspaceSessionId, phase: "pre_stream", safeToRetry: true \}\)/, "generate resolves selected workspace context once through typed pre-stream trusted host scope");
assert.match(generateRoute, /trustedWorkspace\?\.sessionId \?\? requestedWorkspaceSessionId/, "ordinary session-backed turns preserve existing persistence without requiring file-context authentication");
assert.match(generateRoute, /resolveAgentUiFileContextSelection\(\{ selection: parsedRunContextSelection, sessionId: workspaceSessionId/, "generate file selection uses the canonical trusted workspace");

const sessionRoute = await readFile(new URL("../../apps/standalone-sveltekit/src/routes/api/session/[id]/+server.ts", import.meta.url), "utf8");
const sessionDelete = sessionRoute.match(/export const DELETE[\s\S]*?\n};/)?.[0] ?? "";
assert.match(sessionDelete, /beginSessionDeletion\(session\.id\)[\s\S]*listFiles\(session\.id\)/, "session DELETE durably fences uploads before snapshotting files");
assert.match(sessionDelete, /listFiles\(session\.id\)/, "session DELETE lists every attached file before deleting the session");
assert.match(sessionDelete, /for \(const file of files\)[\s\S]*await deleteAgentUiFile/, "session DELETE drains files sequentially through the retryable lifecycle");
assert.match(sessionDelete, /deleteAgentUiFile\(\{[^}]*sessionId: session\.id/, "session DELETE preserves workspace-session scope during file cleanup");
assert.match(sessionDelete, /deleteAgentUiFile[\s\S]*deleteSession\(session\.id\)/, "session DELETE cannot remove the session before all file cleanup succeeds");

for (const persistenceMode of ["memory", "auto"]) {
  const event = {
    request: new Request("http://localhost/api/files"),
    platform: { env: { SONIK_AGENT_UI_PERSISTENCE_MODE: persistenceMode } },
    locals: { agentUiHostSession: auth },
  };
  const persistence = getRequestWorkspacePersistence(event);
  const sessionId = `delete-race-${persistenceMode}`;
  await persistence.createSession({ id: sessionId });
  assert.equal(await persistence.beginSessionDeletion(sessionId), true);
  assert.deepEqual(await persistence.listFiles(sessionId), [], "deletion snapshots zero files after establishing its fence");
  const bucket = new FakeBucket();
  await assert.rejects(
    () => uploadAgentUiFile({ file: new File(["late"], "late.txt", { type: "text/plain" }), sessionId, auth, persistence, bucket }),
    /Session not found/,
    `${persistenceMode} upload cannot create an untracked object after deletion begins`,
  );
  assert.equal(bucket.puts.length, 0);
  assert.equal(bucket.objects.size, 0);
}

{
  const { persistence, bucket } = setup();
  let releasePut;
  const putGate = new Promise((resolve) => { releasePut = resolve; });
  bucket.put = async function(key, value) {
    this.puts.push(key);
    await putGate;
    this.objects.set(key, value.slice(0));
  };
  bucket.delete = async function(key) {
    this.deletes.push(key);
    if (this.deletes.length === 2) throw new Error("compensation delete failed");
    this.objects.delete(key);
  };
  const upload = uploadAgentUiFile({ file: new File(["late bytes"], "late.txt", { type: "text/plain" }), sessionId: "session-a", auth, persistence, bucket });
  while ((await persistence.listFiles("session-a")).length === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  await persistence.beginSessionDeletion("session-a");
  const [pending] = await persistence.listFiles("session-a");
  await assert.rejects(
    () => deleteAgentUiFile({ id: pending.id, sessionId: "session-a", auth, persistence, bucket }),
    (error) => error instanceof AgentUiFileError && error.status === 409 && error.retryFileId === pending.id,
  );
  releasePut();
  await assert.rejects(
    upload,
    (error) => error instanceof AgentUiFileError && error.status === 500 && error.retryFileId === pending.id,
  );
  assert.equal((await persistence.getFile(pending.id))?.status, "failed", "late put compensation failure retains durable cleanup authority");
  assert.equal(bucket.objects.has(pending.storage_key), true, "late private bytes remain tracked by the retry id");
  bucket.delete = FakeBucket.prototype.delete;
  await deleteAgentUiFile({ id: pending.id, sessionId: "session-a", auth, persistence, bucket });
  assert.equal(await persistence.getFile(pending.id), null);
  assert.equal(bucket.objects.has(pending.storage_key), false);
}

{
  const sync = createInMemoryWorkspacePersistence();
  sync.createSession({ id: "selected-session" });
  sync.createSession({ id: "other-session" });
  const persistence = createAsyncWorkspacePersistenceAdapter(sync);
  await persistence.createFile({ id: "selected-file", session_id: "selected-session", storage_key: "agent-ui/selected-file", original_filename: "brief.pdf", media_type: "application/pdf", byte_size: 42, status: "ready", provider_references: { google: "secret" } });
  await persistence.createFile({ id: "other-file", session_id: "other-session", storage_key: "agent-ui/other-file", original_filename: "other.pdf", media_type: "application/pdf", byte_size: 7, status: "ready" });
  const selection = { items: [{ id: "untrusted", kind: "file", label: "spoofed", source: "manual", ref: "selected-file", metadata: { storage_key: "leak" } }], dismissedAutoSeedIds: [] };
  const resolved = await resolveAgentUiFileContextSelection({ selection, sessionId: "selected-session", auth, persistence });
  assert.deepEqual(resolved.items[0], { id: "file:selected-file", kind: "file", label: "brief.pdf", source: "manual", ref: "selected-file", detail: "application/pdf · 42 bytes", metadata: { filename: "brief.pdf", mediaType: "application/pdf", byteSize: 42 } });
  await assert.rejects(() => resolveAgentUiFileContextSelection({ selection: { ...selection, items: [{ ...selection.items[0], ref: "other-file" }] }, sessionId: "selected-session", auth, persistence }), /File not found/);
  await assert.rejects(() => resolveAgentUiFileContextSelection({ selection: { ...selection, items: [{ ...selection.items[0], ref: "missing" }] }, sessionId: "selected-session", auth, persistence }), /File not found/);
}

console.log("agent-ui-files tests passed");

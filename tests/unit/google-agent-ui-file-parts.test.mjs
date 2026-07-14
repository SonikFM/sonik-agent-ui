import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  AGENT_UI_SELECTED_FILE_MAX_BYTES,
  AGENT_UI_SELECTED_FILE_MAX_COUNT,
  resolveGoogleAgentUiFileParts,
} from "../../apps/standalone-sveltekit/src/lib/server/agent-ui-files.ts";
import { createAsyncWorkspacePersistenceAdapter, createInMemoryWorkspacePersistence } from "../../packages/workspace-session/src/index.ts";

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
const now = new Date("2026-07-13T12:00:00.000Z");
const filesApi = { provider: "google", modelId: "files" };

class FakeBucket {
  objects = new Map();
  gets = [];

  async get(key) {
    this.gets.push(key);
    const value = this.objects.get(key);
    return value ? { body: value.slice(0) } : null;
  }
}

// Duplicate ids are one selected file and therefore one R2 read/upload.
{
  const { persistence, bucket } = setup();
  await createFile(persistence);
  bucket.objects.set("agent-ui/file-1", new TextEncoder().encode("private").buffer);
  let uploads = 0;
  const parts = await resolveGoogleAgentUiFileParts({
    fileIds: Array(AGENT_UI_SELECTED_FILE_MAX_COUNT + 1).fill("file-1"), sessionId: "session-a", auth, persistence, bucket, filesApi, now,
    upload: async () => { uploads += 1; return { providerReference: { google: "files/once" } }; },
  });
  assert.equal(parts.length, 1);
  assert.equal(bucket.gets.length, 1);
  assert.equal(uploads, 1);
}

// Count and aggregate budgets reject before any private object read.
{
  const { persistence, bucket } = setup();
  const ids = [];
  for (let index = 0; index <= AGENT_UI_SELECTED_FILE_MAX_COUNT; index += 1) {
    const id = `file-${index}`;
    ids.push(id);
    await createFile(persistence, { id, provider_references: { google: `files/${id}` }, provider_references_expires_at: "2026-07-13T13:00:00.000Z" });
  }
  assert.equal((await resolveGoogleAgentUiFileParts({ fileIds: ids.slice(0, AGENT_UI_SELECTED_FILE_MAX_COUNT), sessionId: "session-a", auth, persistence, bucket, filesApi, now })).length, AGENT_UI_SELECTED_FILE_MAX_COUNT);
  await assert.rejects(
    () => resolveGoogleAgentUiFileParts({ fileIds: ids, sessionId: "session-a", auth, persistence, bucket, filesApi, now }),
    /at most/,
  );
  assert.deepEqual(bucket.gets, []);
}

{
  const { persistence, bucket } = setup();
  await createFile(persistence, { id: "large-1", byte_size: AGENT_UI_SELECTED_FILE_MAX_BYTES, provider_references: { google: "files/large-1" }, provider_references_expires_at: "2026-07-13T13:00:00.000Z" });
  await createFile(persistence, { id: "large-2", byte_size: 1 });
  assert.equal((await resolveGoogleAgentUiFileParts({ fileIds: ["large-1"], sessionId: "session-a", auth, persistence, bucket, filesApi, now })).length, 1);
  await assert.rejects(
    () => resolveGoogleAgentUiFileParts({ fileIds: ["large-1", "large-2"], sessionId: "session-a", auth, persistence, bucket, filesApi, now }),
    /20 MiB/,
  );
  assert.deepEqual(bucket.gets, []);
}

// Uploads are sequential, bounding live buffers/provider calls to one.
{
  const { persistence, bucket } = setup();
  for (const id of ["sequential-1", "sequential-2"]) {
    await createFile(persistence, { id });
    bucket.objects.set(`agent-ui/${id}`, new TextEncoder().encode(id).buffer);
  }
  let active = 0;
  let maxActive = 0;
  const parts = await resolveGoogleAgentUiFileParts({
    fileIds: ["sequential-1", "sequential-2"], sessionId: "session-a", auth, persistence, bucket, filesApi, now,
    upload: async ({ filename }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return { providerReference: { google: `files/${filename}` } };
    },
  });
  assert.equal(maxActive, 1);
  assert.equal(parts.length, 2);
}

// One caller-owned deadline covers the whole sequential batch and stops later uploads.
{
  const { persistence, bucket } = setup();
  for (const id of ["deadline-1", "deadline-2"]) {
    await createFile(persistence, { id });
    bucket.objects.set(`agent-ui/${id}`, new TextEncoder().encode(id).buffer);
  }
  const controller = new AbortController();
  const uploadInputs = [];
  await assert.rejects(
    () => resolveGoogleAgentUiFileParts({
      fileIds: ["deadline-1", "deadline-2"], sessionId: "session-a", auth, persistence, bucket, filesApi, now,
      deadlineAt: Date.now() + 120_000,
      abortSignal: controller.signal,
      upload: async (input) => {
        uploadInputs.push(input);
        controller.abort(new DOMException("run budget exhausted", "AbortError"));
        return { providerReference: { google: "files/too-late" } };
      },
    }),
    (error) => error.status === 502 && error.message === "File processing failed",
  );
  assert.equal(uploadInputs.length, 1, "an expired total deadline prevents later sequential uploads");
  assert.equal(uploadInputs[0].providerOptions.google.pollIntervalMs > 0, true);
  assert.equal(uploadInputs[0].providerOptions.google.pollTimeoutMs > 0, true);
  assert.equal(uploadInputs[0].providerOptions.google.pollTimeoutMs <= 120_000, true, "Google polling cannot outlive the run budget");
}

function setup() {
  const sync = createInMemoryWorkspacePersistence();
  sync.createSession({ id: "session-a" });
  return { persistence: createAsyncWorkspacePersistenceAdapter(sync), bucket: new FakeBucket() };
}

async function createFile(persistence, patch = {}) {
  return persistence.createFile({
    id: patch.id ?? "file-1",
    session_id: "session-a",
    storage_key: `agent-ui/${patch.id ?? "file-1"}`,
    original_filename: "brief.pdf",
    media_type: "application/pdf",
    byte_size: 7,
    status: "ready",
    ...patch,
  });
}

// A fresh server-only Google reference is reused without reading R2 or uploading.
{
  const { persistence, bucket } = setup();
  await createFile(persistence, {
    provider_references: { google: "files/cached" },
    provider_references_expires_at: "2026-07-13T13:00:00.000Z",
  });
  let uploads = 0;
  const parts = await resolveGoogleAgentUiFileParts({
    fileIds: ["file-1"], sessionId: "session-a", auth, persistence, bucket, filesApi, now,
    upload: async () => { uploads += 1; throw new Error("must not upload"); },
  });
  assert.deepEqual(parts, [{ type: "file", data: { google: "files/cached" }, mediaType: "application/pdf", filename: "brief.pdf" }]);
  assert.equal(uploads, 0);
  assert.deepEqual(bucket.gets, []);
}

// An expired reference is refreshed lazily from canonical R2 bytes and persisted.
{
  const { persistence, bucket } = setup();
  await createFile(persistence, {
    provider_references: { google: "files/expired" },
    provider_references_expires_at: "2026-07-13T11:59:59.000Z",
  });
  bucket.objects.set("agent-ui/file-1", new TextEncoder().encode("private").buffer);
  let uploadInput;
  const parts = await resolveGoogleAgentUiFileParts({
    fileIds: ["file-1"], sessionId: "session-a", auth, persistence, bucket, filesApi, now,
    upload: async (input) => {
      uploadInput = input;
      return { providerReference: { google: "files/refreshed" } };
    },
  });
  assert.equal(uploadInput.api, filesApi, "the direct google.files() API is passed through");
  assert.equal(new TextDecoder().decode(uploadInput.data), "private");
  assert.equal(uploadInput.mediaType, "application/pdf");
  assert.equal(uploadInput.filename, "brief.pdf");
  assert.deepEqual(parts[0], { type: "file", data: { google: "files/refreshed" }, mediaType: "application/pdf", filename: "brief.pdf" });
  const updated = await persistence.getFile("file-1");
  assert.deepEqual(updated?.provider_references, { google: "files/refreshed" });
  assert.ok(Date.parse(updated?.provider_references_expires_at) > now.getTime(), "refreshed references receive a conservative future expiry");
}

// Catalog authorization precedes private object access, and missing objects fail closed.
{
  const { persistence, bucket } = setup();
  await assert.rejects(
    () => resolveGoogleAgentUiFileParts({ fileIds: ["missing"], sessionId: "session-a", auth, persistence, bucket, filesApi, now, upload: async () => assert.fail("must not upload") }),
    /File not found/,
  );
  assert.deepEqual(bucket.gets, [], "unknown public ids never become R2 reads");

  await createFile(persistence);
  await assert.rejects(
    () => resolveGoogleAgentUiFileParts({ fileIds: ["file-1"], sessionId: "session-a", auth, persistence, bucket, filesApi, now, upload: async () => assert.fail("must not upload") }),
    /File not found/,
  );
  assert.deepEqual(bucket.gets, ["agent-ui/file-1"]);
}

// Provider and catalog-update failures are explicit but do not leak internals.
{
  const { persistence, bucket } = setup();
  await createFile(persistence);
  bucket.objects.set("agent-ui/file-1", new TextEncoder().encode("private").buffer);
  const originalError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args);
  try {
    await assert.rejects(
      () => resolveGoogleAgentUiFileParts({ fileIds: ["file-1"], sessionId: "session-a", auth, persistence, bucket, filesApi, now, upload: async () => { throw new Error("credential-secret", { cause: { credential: "nested-secret" } }); } }),
      (error) => error.status === 502 && error.message === "File processing failed",
    );
    await assert.rejects(
      () => resolveGoogleAgentUiFileParts({ fileIds: ["file-1"], sessionId: "session-a", auth, persistence: { ...persistence, updateFile: async () => { throw new Error("database-secret"); } }, bucket, filesApi, now, upload: async () => ({ providerReference: { google: "files/new" } }) }),
      (error) => error.status === 500 && error.message === "File processing failed",
    );
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(logs, [
    ["Agent UI provider operation failed", { category: "provider_upload" }],
    ["Agent UI provider operation failed", { category: "reference_persistence" }],
  ]);
  assert.doesNotMatch(JSON.stringify(logs), /credential-secret|nested-secret|database-secret|files\/new/);
}

const generateSource = await readFile("apps/standalone-sveltekit/src/routes/api/generate/+server.ts", "utf8");
const preprocessing = generateSource.match(/const modelMessages[\s\S]*?const messagesWithFiles/)?.[0] ?? "";
assert.match(preprocessing, /const googleDeadlineAt/, "generate creates one total preprocessing deadline inside the existing run budget");
assert.match(preprocessing, /!env\.GOOGLE_GENERATIVE_AI_API_KEY[\s\S]*setTimeout/, "missing Google credentials fail before allocating the preprocessing timer");
assert.match(preprocessing, /new AbortController\(\)[\s\S]*setTimeout\([^\n]*\.abort\(\)/, "the total deadline aborts in-flight provider work");
assert.match(preprocessing, /abortSignal:/, "generate passes the shared deadline to Google file preprocessing");
assert.equal(preprocessing.indexOf("googleDeadlineAt") < preprocessing.indexOf("resolveGoogleAgentUiFileParts"), true, "the total deadline exists before any provider upload starts");

console.log("google-agent-ui-file-parts.test.mjs: all assertions passed");

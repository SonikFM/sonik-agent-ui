import type {
  AsyncWorkspacePersistenceAdapter,
  WorkspaceFileRecord,
  WorkspaceHostSessionSnapshot,
} from "@sonik-agent-ui/workspace-session";
import type { AgentRunContextSelection } from "@sonik-agent-ui/tool-contracts/run-context";
import { uploadFile, type ProviderReference } from "ai";
import { getRequestWorkspacePersistence, type RequestWorkspaceEvent } from "./workspace-request-store.ts";
import { resolveTrustedHostSessionSnapshot } from "./workspace-services.ts";

// Keep uploads small enough for direct model context and Worker memory limits.
export const AGENT_UI_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const AGENT_UI_SELECTED_FILE_MAX_COUNT = 4;
export const AGENT_UI_SELECTED_FILE_MAX_BYTES = 20 * 1024 * 1024;

export const AGENT_UI_FILE_POLICY = new Map<string, readonly string[]>([
  ["application/pdf", ["pdf"]],
  ["text/plain", ["txt"]],
  ["text/markdown", ["md", "markdown"]],
  ["text/csv", ["csv"]],
  ["text/html", ["html", "htm"]],
  ["text/xml", ["xml"]],
  ["application/xml", ["xml"]],
  ["text/css", ["css"]],
  ["text/javascript", ["js", "mjs", "cjs"]],
  ["application/javascript", ["js", "mjs", "cjs"]],
  ["application/json", ["json"]],
  ["image/bmp", ["bmp"]],
  ["image/jpeg", ["jpg", "jpeg"]],
  ["image/png", ["png"]],
  ["image/webp", ["webp"]],
]);

export const PRIVATE_FILE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

export interface AgentUiFileBucket {
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ body: BodyInit } | null>;
  delete(key: string): Promise<unknown>;
}

export type PublicAgentUiFile = Pick<
  WorkspaceFileRecord,
  "id" | "session_id" | "original_filename" | "media_type" | "byte_size" | "checksum" | "status" | "ready_at" | "failed_at" | "deleted_at" | "created_at" | "updated_at"
>;

export class AgentUiFileError extends Error {
  readonly status: number;
  readonly code: AgentUiFileErrorCode;
  readonly phase: AgentUiFileErrorPhase;
  readonly safeToRetry: boolean;
  readonly retryFileId?: string;

  constructor(status: number, message: string, options?: string | {
    code?: AgentUiFileErrorCode;
    phase?: AgentUiFileErrorPhase;
    safeToRetry?: boolean;
    retryFileId?: string;
  }) {
    super(message);
    this.name = "AgentUiFileError";
    this.status = status;
    this.code = typeof options === "object" && options.code ? options.code : defaultAgentUiFileErrorCode(status, message);
    this.phase = typeof options === "object" && options.phase ? options.phase : "post_write";
    this.safeToRetry = typeof options === "object" && options.safeToRetry === true;
    this.retryFileId = typeof options === "string" ? options : options?.retryFileId;
  }
}

export type AgentUiFileErrorPhase = "read" | "pre_write" | "pre_stream" | "post_write";
export type AgentUiFileErrorCode =
  | "host_auth_required"
  | "session_not_found"
  | "file_not_found"
  | "file_storage_unavailable"
  | "file_type_unsupported"
  | "file_extension_mismatch"
  | "file_too_large"
  | "file_upload_failed"
  | "file_read_failed"
  | "file_delete_failed"
  | "file_processing_failed"
  | "selected_files_require_google"
  | "selected_files_zdr_incompatible"
  | "rate_limit_exceeded"
  | "invalid_request";

export type AgentUiModelFilePart = {
  type: "file";
  data: ProviderReference;
  mediaType: string;
  filename: string;
};

const GOOGLE_REFERENCE_TTL_MS = 47 * 60 * 60 * 1000;
export const AGENT_UI_GOOGLE_PREPROCESSING_BUDGET_MS = 120_000;

export function requireAgentUiFileAuth(
  session: WorkspaceHostSessionSnapshot,
  input: { phase?: AgentUiFileErrorPhase; safeToRetry?: boolean } = {},
): { organizationId: string; userId: string } {
  if (!session.authenticated || !session.organizationId || !session.userId || !session.sessionId) {
    throw new AgentUiFileError(401, "Authenticated host session required", {
      code: "host_auth_required",
      phase: input.phase ?? "pre_write",
      safeToRetry: input.safeToRetry ?? false,
    });
  }
  return { organizationId: session.organizationId, userId: session.userId };
}

export async function resolveAgentUiWorkspaceSession(
  event: RequestWorkspaceEvent,
  input: { sessionId?: string | null; phase?: AgentUiFileErrorPhase; safeToRetry?: boolean },
): Promise<{ sessionId: string; auth: WorkspaceHostSessionSnapshot; persistence: AsyncWorkspacePersistenceAdapter }> {
  const auth = resolveTrustedHostSessionSnapshot(event);
  requireAgentUiFileAuth(auth, input);
  const persistence = getRequestWorkspacePersistence(event);
  const sessionId = input.sessionId?.trim();
  const session = sessionId ? await persistence.getSession(sessionId) : null;
  if (!session) {
    throw new AgentUiFileError(404, "Session not found", {
      code: "session_not_found",
      phase: input.phase ?? "read",
      safeToRetry: input.safeToRetry ?? false,
    });
  }
  return { sessionId: session.id, auth, persistence };
}

export function requireAgentUiFileBucket(bucket: AgentUiFileBucket | null | undefined): AgentUiFileBucket {
  if (!bucket) throw new AgentUiFileError(503, "Private file storage is unavailable", { code: "file_storage_unavailable", phase: "pre_write" });
  return bucket;
}

export function validateAgentUiFile(file: File): void {
  const mediaType = file.type.toLowerCase();
  const extensions = AGENT_UI_FILE_POLICY.get(mediaType);
  if (!extensions) {
    throw new AgentUiFileError(415, unsupportedAgentUiFileMessage(file.name), { code: "file_type_unsupported", phase: "pre_write" });
  }
  const extension = file.name.toLowerCase().match(/\.([^.]+)$/)?.[1];
  if (!extension || !extensions.includes(extension)) throw new AgentUiFileError(415, "File extension does not match its media type", { code: "file_extension_mismatch", phase: "pre_write" });
  if (file.size > AGENT_UI_FILE_MAX_BYTES) {
    throw new AgentUiFileError(413, "File exceeds the 10 MiB limit", { code: "file_too_large", phase: "pre_write" });
  }
}

export function unsupportedAgentUiFileMessage(filename: string): string {
  const extension = filename.toLowerCase().match(/\.([^.]+)$/)?.[1];
  if (extension === "docx") return "DOCX is unsupported. Convert it to PDF, text, or Markdown.";
  if (extension === "xlsx") return "XLSX is unsupported. Convert it to CSV.";
  if (extension === "pptx") return "PPTX is unsupported. Convert it to PDF.";
  return "Unsupported file type. Use PDF, plain text, Markdown, CSV, HTML, XML, CSS, JavaScript, JSON, BMP, JPEG, PNG, or WebP.";
}

export async function uploadAgentUiFile(input: {
  file: File;
  sessionId: string;
  auth: WorkspaceHostSessionSnapshot;
  persistence: AsyncWorkspacePersistenceAdapter;
  bucket?: AgentUiFileBucket | null;
}): Promise<WorkspaceFileRecord> {
  requireAgentUiFileAuth(input.auth, { phase: "pre_write", safeToRetry: true });
  const bucket = requireAgentUiFileBucket(input.bucket);
  validateAgentUiFile(input.file);

  const session = await input.persistence.getSession(input.sessionId);
  if (!session) throw new AgentUiFileError(404, "Session not found");

  const id = crypto.randomUUID();
  const storageKey = storageKeyFor(id);
  const bytes = await input.file.arrayBuffer();
  const checksum = `sha256:${toHex(await crypto.subtle.digest("SHA-256", bytes))}`;
  const record = await input.persistence.createFile({
    id,
    session_id: session.id,
    storage_key: storageKey,
    original_filename: safeFilename(input.file.name),
    media_type: input.file.type.toLowerCase(),
    byte_size: input.file.size,
    checksum,
    status: "pending",
  });
  try {
    await bucket.put(storageKey, bytes, { httpMetadata: { contentType: input.file.type } });
    const ready = await input.persistence.updateFile(record.id, { status: "ready" });
    if (!ready) throw new Error("File catalog transition failed");
    return ready;
  } catch (cause) {
    let cleanupFailed = false;
    await bucket.delete(storageKey).catch(() => {
      cleanupFailed = true;
      console.error("Agent UI file cleanup failed", { category: "storage_delete" });
    });
    await markAgentUiFileFailed(input.persistence, record.id);
    if (cleanupFailed) throw new AgentUiFileError(500, "File upload failed", record.id);
    throw cause;
  }
}

export async function readAgentUiFile(input: {
  id: string;
  sessionId: string;
  auth: WorkspaceHostSessionSnapshot;
  persistence: AsyncWorkspacePersistenceAdapter;
  bucket?: AgentUiFileBucket | null;
}): Promise<Response> {
  const scope = requireAgentUiFileAuth(input.auth);
  const bucket = requireAgentUiFileBucket(input.bucket);
  const file = await resolveScopedFile(input.id, input.sessionId, scope, input.persistence);
  const object = await bucket.get(file.storage_key);
  if (!object) throw new AgentUiFileError(404, "File not found");

  return new Response(object.body, {
    headers: {
      ...PRIVATE_FILE_HEADERS,
      "Content-Type": file.media_type,
      "Content-Length": String(file.byte_size),
      "Content-Disposition": contentDisposition(file.original_filename),
    },
  });
}

export async function deleteAgentUiFile(input: {
  id: string;
  sessionId: string;
  auth: WorkspaceHostSessionSnapshot;
  persistence: AsyncWorkspacePersistenceAdapter;
  bucket?: AgentUiFileBucket | null;
}): Promise<WorkspaceFileRecord> {
  const scope = requireAgentUiFileAuth(input.auth);
  const bucket = requireAgentUiFileBucket(input.bucket);
  const file = await resolveScopedFile(input.id, input.sessionId, scope, input.persistence, false);
  const uploadPending = file.status === "pending";
  if (file.status !== "failed") {
    const failed = await input.persistence.updateFile(file.id, { status: "failed" });
    if (!failed) throw new AgentUiFileError(404, "File not found");
  }
  await bucket.delete(file.storage_key);
  if (uploadPending) throw new AgentUiFileError(409, "File upload is still settling", file.id);
  if (!(await input.persistence.deleteFile(file.id)) && await input.persistence.getFile(file.id)) {
    throw new Error("File catalog tombstone failed");
  }
  return file;
}

async function resolveScopedFile(
  id: string,
  sessionId: string,
  scope: { organizationId: string; userId: string },
  persistence: AsyncWorkspacePersistenceAdapter,
  readyOnly = true,
): Promise<WorkspaceFileRecord> {
  const session = sessionId ? await persistence.getSession(sessionId) : null;
  const file = await persistence.getFile(id);
  if (!scope.organizationId || !scope.userId || !session || !file || file.session_id !== session.id || (readyOnly && file.status !== "ready") || file.status === "deleted" || file.storage_key !== storageKeyFor(file.id)) {
    throw new AgentUiFileError(404, "File not found");
  }
  return file;
}

async function markAgentUiFileFailed(persistence: AsyncWorkspacePersistenceAdapter, id: string): Promise<void> {
  await persistence.updateFile(id, { status: "failed" }).catch(() => console.error("Agent UI file failure state persistence failed", { category: "catalog_update" }));
}

export function toPublicAgentUiFile(file: WorkspaceFileRecord): PublicAgentUiFile {
  const {
    id,
    session_id,
    original_filename,
    media_type,
    byte_size,
    checksum,
    status,
    ready_at,
    failed_at,
    deleted_at,
    created_at,
    updated_at,
  } = file;
  return { id, session_id, original_filename, media_type, byte_size, checksum, status, ready_at, failed_at, deleted_at, created_at, updated_at };
}

export async function resolveAgentUiFileContextSelection(input: {
  selection: AgentRunContextSelection;
  sessionId: string | null | undefined;
  auth: WorkspaceHostSessionSnapshot | null;
  persistence: AsyncWorkspacePersistenceAdapter;
}): Promise<AgentRunContextSelection> {
  const selected = input.selection.items.filter((item) => item.kind === "file");
  if (selected.length === 0) return input.selection;
  if (!input.auth) throw new AgentUiFileError(401, "Authenticated host session required");
  requireAgentUiFileAuth(input.auth);
  if (!input.sessionId) throw new AgentUiFileError(404, "File not found");
  if (!(await input.persistence.getSession(input.sessionId))) throw new AgentUiFileError(404, "File not found");
  const files = new Map((await input.persistence.listFiles(input.sessionId)).map((file) => [file.id, file]));
  return {
    ...input.selection,
    items: input.selection.items.map((item) => {
      if (item.kind !== "file") return item;
      const file = item.ref ? files.get(item.ref) : undefined;
      if (!file || file.session_id !== input.sessionId || file.status !== "ready" || file.deleted_at) {
        throw new AgentUiFileError(404, "File not found");
      }
      return {
        id: `file:${file.id}`,
        kind: "file" as const,
        label: file.original_filename,
        source: item.source,
        ref: file.id,
        detail: `${file.media_type} · ${file.byte_size} bytes`,
        metadata: { filename: file.original_filename, mediaType: file.media_type, byteSize: file.byte_size },
      };
    }),
  };
}

export async function resolveGoogleAgentUiFileParts(input: {
  fileIds: string[];
  sessionId: string;
  auth: WorkspaceHostSessionSnapshot;
  persistence: AsyncWorkspacePersistenceAdapter;
  bucket?: AgentUiFileBucket | null;
  filesApi: Parameters<typeof uploadFile>[0]["api"];
  now?: Date;
  upload?: typeof uploadFile;
  deadlineAt?: number;
  abortSignal?: AbortSignal;
}): Promise<AgentUiModelFilePart[]> {
  requireAgentUiFileAuth(input.auth);
  const bucket = requireAgentUiFileBucket(input.bucket);
  if (!(await input.persistence.getSession(input.sessionId))) throw new AgentUiFileError(404, "File not found");
  const now = input.now ?? new Date();
  const files = new Map((await input.persistence.listFiles(input.sessionId)).map((file) => [file.id, file]));
  const fileIds = [...new Set(input.fileIds)];
  if (fileIds.length > AGENT_UI_SELECTED_FILE_MAX_COUNT) throw new AgentUiFileError(413, `Select at most ${AGENT_UI_SELECTED_FILE_MAX_COUNT} files`);
  const selectedFiles = fileIds.map((id) => {
    const file = files.get(id);
    if (!file || file.session_id !== input.sessionId || file.status !== "ready" || file.deleted_at || file.storage_key !== storageKeyFor(file.id) || !AGENT_UI_FILE_POLICY.has(file.media_type)) {
      throw new AgentUiFileError(404, "File not found");
    }
    return file;
  });
  if (selectedFiles.reduce((total, file) => total + file.byte_size, 0) > AGENT_UI_SELECTED_FILE_MAX_BYTES) {
    throw new AgentUiFileError(413, "Selected files exceed the 20 MiB total limit");
  }

  const parts: AgentUiModelFilePart[] = [];
  for (const file of selectedFiles) {
    let providerReference: ProviderReference | null = hasFreshGoogleReference(file.provider_references, file.provider_references_expires_at, now)
      ? file.provider_references
      : null;
    if (!providerReference) {
      const remainingMs = input.deadlineAt === undefined ? undefined : input.deadlineAt - Date.now();
      if (remainingMs !== undefined && remainingMs <= 0) throw new AgentUiFileError(502, "File processing failed");
      const object = await bucket.get(file.storage_key);
      if (!object) throw new AgentUiFileError(404, "File not found");
      try {
        const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
        const uploadPromise = (input.upload ?? uploadFile)({
          api: input.filesApi,
          data: bytes,
          mediaType: file.media_type,
          filename: file.original_filename,
          ...(remainingMs !== undefined ? { providerOptions: { google: { pollIntervalMs: Math.min(2000, remainingMs), pollTimeoutMs: remainingMs } } } : {}),
        });
        const result = input.abortSignal || remainingMs !== undefined
          ? await withAgentUiFileDeadline(uploadPromise, input.abortSignal, remainingMs)
          : await uploadPromise;
        providerReference = result.providerReference;
      } catch (cause) {
        console.error("Agent UI provider operation failed", { category: "provider_upload" });
        throw new AgentUiFileError(502, "File processing failed");
      }
      const updated = await input.persistence.updateFile(file.id, {
        provider_references: providerReference,
        provider_references_expires_at: new Date(now.getTime() + GOOGLE_REFERENCE_TTL_MS).toISOString(),
      }).catch(() => {
        console.error("Agent UI provider operation failed", { category: "reference_persistence" });
        return null;
      });
      if (!updated) throw new AgentUiFileError(500, "File processing failed");
    }

    parts.push({ type: "file", data: providerReference, mediaType: file.media_type, filename: file.original_filename });
  }
  return parts;
}

async function withAgentUiFileDeadline<T>(promise: Promise<T>, signal?: AbortSignal, timeoutMs?: number): Promise<T> {
  if (signal?.aborted) throw new AgentUiFileError(502, "File processing failed");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = timeoutMs === undefined ? undefined : new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AgentUiFileError(502, "File processing failed")), timeoutMs);
  });
  const aborted = signal
    ? new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new AgentUiFileError(502, "File processing failed")), { once: true }))
    : undefined;
  try {
    return await Promise.race([promise, timeout, aborted].filter(Boolean) as Promise<T>[]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function hasFreshGoogleReference(references: Record<string, string> | null, expiresAt: string | null, now: Date): references is ProviderReference {
  const expires = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  return Boolean(references?.google && Number.isFinite(expires) && expires > now.getTime());
}

function storageKeyFor(id: string): string {
  return `agent-ui/${encodeURIComponent(id)}`;
}

function safeFilename(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f/\\]/g, "_").trim().slice(0, 255) || "download";
}

function contentDisposition(filename: string): string {
  const safe = safeFilename(filename);
  const ascii = safe.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

function toHex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function defaultAgentUiFileErrorCode(status: number, message: string): AgentUiFileErrorCode {
  if (status === 401) return "host_auth_required";
  if (status === 404) return /session/i.test(message) ? "session_not_found" : "file_not_found";
  if (status === 413) return "file_too_large";
  if (status === 415) return /extension/i.test(message) ? "file_extension_mismatch" : "file_type_unsupported";
  if (status === 502) return "file_processing_failed";
  if (status === 503) return "file_storage_unavailable";
  if (status >= 500) return "file_upload_failed";
  return "invalid_request";
}

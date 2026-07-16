import type { AgentHostAuthorityDonation } from "@sonik-agent-ui/agent-embed";

export type AgentUiPublicErrorPhase = "read" | "pre_write" | "pre_stream" | "post_write";

export interface AgentUiPublicErrorEnvelope {
  ok: false;
  error: string;
  code: string;
  phase?: AgentUiPublicErrorPhase;
  safeToRetry?: boolean;
  requestId?: string;
  traceId?: string;
  retry_file_id?: string;
}

export function isHostAuthorityExpired(
  authority: AgentHostAuthorityDonation | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!authority) return true;
  const expiryMs = Date.parse(authority.expiresAt);
  return !Number.isFinite(expiryMs) || expiryMs <= nowMs;
}

export function selectOpaqueHostAuthority(input: {
  current: AgentHostAuthorityDonation | null | undefined;
  cached: AgentHostAuthorityDonation | null | undefined;
  nowMs?: number;
}): AgentHostAuthorityDonation | null {
  const nowMs = input.nowMs ?? Date.now();
  const candidates = [input.current, input.cached]
    .filter((candidate): candidate is AgentHostAuthorityDonation => Boolean(candidate) && !isHostAuthorityExpired(candidate, nowMs))
    .sort((left, right) => right.revision - left.revision);
  return candidates[0] ?? null;
}

export function acceptNewerOpaqueHostAuthority(input: {
  current: AgentHostAuthorityDonation | null | undefined;
  next: AgentHostAuthorityDonation | null | undefined;
  nowMs?: number;
}): AgentHostAuthorityDonation | null {
  const nowMs = input.nowMs ?? Date.now();
  const currentRevision = input.current?.revision ?? -1;
  if (!input.next || isHostAuthorityExpired(input.next, nowMs)) {
    return selectOpaqueHostAuthority({ current: input.current, cached: null, nowMs });
  }
  // Revision monotonicity outlives header freshness. An expired header is not
  // usable for a request, but it still prevents a later stale donation from
  // rolling the cache back to an older authority epoch.
  if (input.next.revision <= currentRevision) {
    return selectOpaqueHostAuthority({ current: input.current, cached: null, nowMs });
  }
  return input.next;
}

export function parseAgentUiPublicErrorEnvelope(value: unknown): AgentUiPublicErrorEnvelope | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.ok !== false || typeof record.error !== "string" || typeof record.code !== "string") return null;
  if (record.phase !== undefined && !["read", "pre_write", "pre_stream", "post_write"].includes(String(record.phase))) return null;
  if (record.safeToRetry !== undefined && typeof record.safeToRetry !== "boolean") return null;
  return {
    ok: false,
    error: record.error.slice(0, 240),
    code: record.code.slice(0, 80),
    ...(record.phase ? { phase: record.phase as AgentUiPublicErrorPhase } : {}),
    ...(typeof record.safeToRetry === "boolean" ? { safeToRetry: record.safeToRetry } : {}),
    ...(typeof record.requestId === "string" ? { requestId: record.requestId.slice(0, 160) } : {}),
    ...(typeof record.traceId === "string" ? { traceId: record.traceId.slice(0, 64) } : {}),
    ...(typeof record.retry_file_id === "string" ? { retry_file_id: record.retry_file_id.slice(0, 160) } : {}),
  };
}

export async function readAgentUiPublicError(response: Response): Promise<AgentUiPublicErrorEnvelope | null> {
  if (response.ok || !response.headers.get("content-type")?.toLowerCase().includes("application/json")) return null;
  return parseAgentUiPublicErrorEnvelope(await response.clone().json().catch(() => null));
}

export function shouldReplayForNewerHostAuthority(input: {
  method: string | undefined;
  url: string;
  responseStatus: number;
  failure: AgentUiPublicErrorEnvelope | null;
}): boolean {
  const method = (input.method ?? "GET").toUpperCase();
  const path = safePathname(input.url);
  const failure = input.failure;
  if (input.responseStatus !== 401 || failure?.code !== "host_auth_required") return false;
  if (method === "GET") return true;
  if (method !== "POST" || failure.safeToRetry !== true) return false;
  if (path === "/api/files") return failure.phase === "pre_write";
  if (path === "/api/generate") return failure.phase === "pre_stream";
  return false;
}

export function humanMessageForAgentUiFailure(failure: AgentUiPublicErrorEnvelope | null): string {
  switch (failure?.code) {
    case "host_auth_required":
      return "Your secure workspace session expired. Reconnect and try again.";
    case "file_too_large":
      return "File exceeds the 10 MiB limit.";
    case "file_type_unsupported":
      return "Unsupported file type. Use PDF, plain text, Markdown, CSV, HTML, XML, CSS, JavaScript, JSON, BMP, JPEG, PNG, or WebP.";
    case "file_extension_mismatch":
      return "The file extension does not match its media type.";
    case "file_storage_unavailable":
      return "Private file storage is temporarily unavailable. Try again later.";
    case "file_upload_failed":
      return "The file could not be uploaded. Try again.";
    case "file_processing_failed":
      return "The selected file could not be prepared for the model. Try again.";
    case "selected_files_require_google":
      return "Selected files require a direct Google model.";
    case "selected_files_zdr_incompatible":
      return "Selected files are unavailable while zero-data-retention mode is required.";
    case "session_not_found":
    case "file_not_found":
      return "The selected workspace item is no longer available.";
    case "rate_limit_exceeded":
      return "Too many requests. Please wait a moment and try again.";
    case "invalid_request":
      return "That request could not be processed. Review it and try again.";
    case "generation_failed":
    default:
      return "Generation failed. Please try again.";
  }
}

function safePathname(value: string): string {
  try {
    return new URL(value, "http://agent-ui.local").pathname;
  } catch {
    return "";
  }
}

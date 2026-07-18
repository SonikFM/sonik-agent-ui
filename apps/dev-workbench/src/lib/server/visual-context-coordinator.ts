import { createHash, randomUUID } from "node:crypto";
import { basename } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { createTelemetryEvent, type AgentTelemetryEvent } from "@sonik-agent-ui/agent-observability";
import {
  assertVisualContextResultMatchesRequest,
  maxVisualContextImageBytes,
  visualContextRequestSchema,
  visualContextResultSchema,
  visualContextSnapshotSchema,
  visualContextSourceSchema,
  type VisualContextRequest,
  type VisualContextResult,
  type VisualContextSnapshot,
} from "@sonik-agent-ui/tool-contracts/visual-context";
import { DEV_WORKBENCH_STATE_ROOT } from "../contracts/workbench";

export const VISUAL_CONTEXT_PATH = `${DEV_WORKBENCH_STATE_ROOT}/visual-context.json` as const;
export const VISUAL_CONTEXT_LEASE_PATH = `${DEV_WORKBENCH_STATE_ROOT}/locks/visual-context` as const;
export const VISUAL_CONTEXT_STAGE_ROOT = `${DEV_WORKBENCH_STATE_ROOT}/tmp/visual-context` as const;
export const VISUAL_CONTEXT_REQUESTS_PATH = `${DEV_WORKBENCH_STATE_ROOT}/visual-context-requests.json` as const;

const workspaceSessionIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

export const visualContextSubmissionSchema = z.strictObject({
  workspaceSessionId: workspaceSessionIdSchema,
  request: visualContextRequestSchema,
  result: visualContextResultSchema,
});

export const visualContextInvalidationSchema = z.strictObject({
  workspaceSessionId: workspaceSessionIdSchema,
  sourceContextRevision: z.number().int().nonnegative(),
  routeRevision: z.number().int().nonnegative(),
  source: visualContextSourceSchema,
  staleReason: z.enum(["source-changed", "route-changed", "navigation", "cancelled", "provider-lost"]),
});

export type VisualContextSubmission = z.infer<typeof visualContextSubmissionSchema>;
export type VisualContextInvalidation = z.infer<typeof visualContextInvalidationSchema>;

export const visualContextRequestRegistrySchema = z.strictObject({
  nextSequence: z.number().int().positive(),
  pending: z.record(z.string(), z.union([
    z.number().int().nonnegative(),
    z.strictObject({
      sequence: z.number().int().nonnegative(),
      request: visualContextRequestSchema,
    }),
  ])),
});
export type VisualContextRequestRegistry = z.infer<typeof visualContextRequestRegistrySchema>;

export function issueVisualContextRequest(registry: VisualContextRequestRegistry, request: VisualContextRequest): { registry: VisualContextRequestRegistry; sequence: number } {
  if (registry.pending[request.requestId] !== undefined) throw new Error("Visual context request is already registered.");
  if (Object.keys(registry.pending).length >= 256) throw new Error("Too many visual context requests are pending.");
  const sequence = registry.nextSequence;
  return { sequence, registry: visualContextRequestRegistrySchema.parse({ nextSequence: sequence + 1, pending: { ...registry.pending, [request.requestId]: { sequence, request } } }) };
}

export function consumeVisualContextRequest(registry: VisualContextRequestRegistry, request: VisualContextRequest): { registry: VisualContextRequestRegistry; sequence: number } | null {
  const issued = registry.pending[request.requestId];
  if (issued === undefined) throw new Error("Visual context request is unregistered or already consumed.");
  if (typeof issued === "number" || !isDeepStrictEqual(issued.request, request)) return null;
  const pending = { ...registry.pending };
  delete pending[request.requestId];
  return { sequence: issued.sequence, registry: visualContextRequestRegistrySchema.parse({ ...registry, pending }) };
}

export type VisualContextTelemetryEventName =
  | "visual_context.picker.started"
  | "visual_context.picker.cancelled"
  | "visual_context.target.selected"
  | "visual_context.capture.started"
  | "visual_context.capture.completed"
  | "visual_context.capture.failed"
  | "visual_context.extension_pairing.changed"
  | "visual_context.result.discarded"
  | "visual_context.browser_setup.changed";

export function emitVisualContextTelemetry(
  input: {
    event: VisualContextTelemetryEventName;
    workspaceSessionId: string;
    requestId?: string;
    operation?: string;
    provider?: string;
    status?: string;
    accepted?: boolean;
    sourceContextRevision?: number;
    routeRevision?: number;
  },
  write: (line: string) => void = console.info,
): AgentTelemetryEvent {
  const emitted = createTelemetryEvent({
    source: "server",
    event: input.event,
    sessionId: input.workspaceSessionId,
    requestId: input.requestId,
    runtimeProvider: input.provider,
    runtimeStatus: input.status,
    payload: {
      operation: input.operation,
      accepted: input.accepted,
      sourceContextRevision: input.sourceContextRevision,
      routeRevision: input.routeRevision,
    },
  });
  write(JSON.stringify(emitted));
  return emitted;
}

export function emitVisualBrowserTelemetry(
  input: {
    workspaceSessionId: string;
    request: VisualContextRequest;
    phase: "started" | "completed" | "failed";
    status: string;
    accepted?: boolean;
  },
  write?: (line: string) => void,
): AgentTelemetryEvent | null {
  const event = input.request.operation === "capture"
    ? `visual_context.capture.${input.phase}` as VisualContextTelemetryEventName
    : input.phase === "started" ? null : "visual_context.browser_setup.changed";
  if (!event) return null;
  return emitVisualContextTelemetry({
    event,
    workspaceSessionId: input.workspaceSessionId,
    requestId: input.request.requestId,
    operation: input.request.operation,
    provider: input.request.provider,
    status: input.status,
    accepted: input.accepted,
    sourceContextRevision: input.request.sourceContextRevision,
    routeRevision: input.request.routeRevision,
  }, write);
}

export function validateVisualContextSubmission(input: VisualContextSubmission): void {
  validateVisualContextRequestAuthority(input.request);
  validateVisualContextRequestAuthority(input.result);
  assertVisualContextResultMatchesRequest(input.request, input.result);
  if (JSON.stringify(input.request.source) !== JSON.stringify(input.result.source)) {
    throw new Error("Visual context result source does not match the pending request.");
  }
  if (input.request.targetId !== input.result.selection?.targetId && input.request.targetId !== undefined) {
    throw new Error("Visual context result target does not match the pending request.");
  }
  if (input.request.targetInstanceId !== input.result.selection?.targetInstanceId && input.request.targetInstanceId !== undefined) {
    throw new Error("Visual context result target instance does not match the pending request.");
  }
}

export function validateVisualContextRequestAuthority(request: Pick<VisualContextRequest, "provider">): void {
  if (request.provider === "chrome-active-tab") {
    throw new Error("Exact active-tab capture requires server-verifiable extension attestation.");
  }
}

export function requestTemporaryPath(result: VisualContextResult): string | null {
  const path = result.screenshot?.temporaryPath ?? null;
  if (!path) return null;
  if (basename(path) !== `${result.requestId}.png`) {
    throw new Error("Visual context temporary PNG must be bound to its request id.");
  }
  return path;
}

export function validateVisualContextPng(bytes: Buffer, result: VisualContextResult): void {
  const screenshot = result.screenshot;
  if (!screenshot) throw new Error("Visual context capture did not include screenshot metadata.");
  if (bytes.length === 0 || bytes.length > maxVisualContextImageBytes || bytes.length !== screenshot.bytes) {
    throw new Error("Visual context PNG byte length does not match its metadata.");
  }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature) || bytes.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("Visual context screenshot is not a PNG image.");
  }
  if (bytes.readUInt32BE(16) !== screenshot.width || bytes.readUInt32BE(20) !== screenshot.height) {
    throw new Error("Visual context PNG dimensions do not match its metadata.");
  }
  if (createHash("sha256").update(bytes).digest("hex") !== screenshot.sha256) {
    throw new Error("Visual context PNG hash does not match its metadata.");
  }
}

export function validateVisualContextSnapshotPng(bytes: Buffer, snapshot: VisualContextSnapshot): void {
  const screenshot = snapshot.screenshot;
  if (!screenshot) throw new Error("Visual context snapshot has no screenshot.");
  if (bytes.length !== screenshot.bytes || bytes.length > maxVisualContextImageBytes) throw new Error("Visual context PNG byte length is invalid.");
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature) || bytes.toString("ascii", 12, 16) !== "IHDR") throw new Error("Visual context screenshot is not a PNG image.");
  if (bytes.readUInt32BE(16) !== screenshot.width || bytes.readUInt32BE(20) !== screenshot.height) throw new Error("Visual context PNG dimensions are invalid.");
  if (createHash("sha256").update(bytes).digest("hex") !== screenshot.sha256) throw new Error("Visual context PNG hash is invalid.");
}

export function visualContextSnapshotFromResult(result: VisualContextResult, requestSequence = 0): VisualContextSnapshot {
  return visualContextSnapshotSchema.parse({
    schemaVersion: result.version,
    status: "current",
    generation: randomUUID(),
    requestId: result.requestId,
    requestSequence,
    sourceContextRevision: result.sourceContextRevision,
    routeRevision: result.routeRevision,
    source: result.source,
    selection: result.selection ?? null,
    ariaSnapshot: result.ariaSnapshot ?? null,
    selectionResolution: result.selectionResolution ?? "not-requested",
    screenshot: result.screenshot ? {
      path: `${DEV_WORKBENCH_STATE_ROOT}/screenshots/latest.png`,
      mime: result.screenshot.mime,
      width: result.screenshot.width,
      height: result.screenshot.height,
      bytes: result.screenshot.bytes,
      sha256: result.screenshot.sha256,
      provider: result.screenshot.provider,
      fidelity: result.screenshot.fidelity,
      captureBasis: result.screenshot.captureBasis,
      viewport: result.screenshot.viewport,
      redactionsApplied: result.screenshot.redactionsApplied,
      capturedAt: result.screenshot.capturedAt,
    } : null,
    invalidatedAt: null,
    staleReason: null,
  });
}

export function invalidatedVisualContextSnapshot(input: VisualContextInvalidation, requestId: string | null = null, requestSequence = 0): VisualContextSnapshot {
  return visualContextSnapshotSchema.parse({
    schemaVersion: "sonik.visual-context.v1",
    status: "invalidated",
    generation: randomUUID(),
    requestId,
    requestSequence,
    sourceContextRevision: input.sourceContextRevision,
    routeRevision: input.routeRevision,
    source: input.source,
    selection: null,
    ariaSnapshot: null,
    selectionResolution: "not-requested",
    screenshot: null,
    invalidatedAt: new Date().toISOString(),
    staleReason: input.staleReason,
  });
}

export function isStaleVisualContextSequence(current: VisualContextSnapshot | null, requestSequence: number): boolean {
  return current !== null && requestSequence <= current.requestSequence;
}

export function isStaleVisualContextResult(current: VisualContextSnapshot | null, result: VisualContextResult): boolean {
  if (!current) return false;
  return result.sourceContextRevision < current.sourceContextRevision
    || result.routeRevision < current.routeRevision
    || (current.status === "invalidated" && current.requestId === result.requestId);
}

export function isStaleVisualContextInvalidation(
  current: VisualContextSnapshot | null,
  invalidation: Pick<VisualContextInvalidation, "sourceContextRevision" | "routeRevision">,
): boolean {
  if (!current) return false;
  return invalidation.sourceContextRevision < current.sourceContextRevision || invalidation.routeRevision < current.routeRevision;
}

export function decodeCanonicalBase64(value: string): Buffer {
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) throw new Error("Visual context PNG data must be canonical base64.");
  return bytes;
}

export function createVisualContextLeaseAcquireScript(attempts = 50, sleepSeconds = 0.1): string {
  if (!Number.isInteger(attempts) || attempts < 1 || sleepSeconds < 0) throw new TypeError("Invalid visual context lease retry policy.");
  return `set -eu
lease="$1"; owner="$2"; expires="$3"; candidate="$lease.$owner.tmp"
mkdir -p "$(dirname "$lease")"
trap 'rm -f "$candidate"' EXIT
printf '%s\n%s\n' "$owner" "$expires" > "$candidate"
for attempt in $(seq 1 ${attempts}); do
  if ln "$candidate" "$lease" 2>/dev/null; then exit 0; fi
  current_expires=$(sed -n '2p' "$lease" 2>/dev/null || true)
  case "$current_expires" in
    ''|*[!0-9]*)
      modified=$(stat -c %Y "$lease" 2>/dev/null || printf '0')
      if [ "$modified" -ge "$(($(date +%s) - 60))" ]; then sleep ${sleepSeconds}; continue; fi
      current_expires=0
      ;;
  esac
  now_ms=$(( $(date +%s) * 1000 ))
  if [ "$current_expires" -lt "$now_ms" ]; then rm -f "$lease"; continue; fi
  sleep ${sleepSeconds}
done
exit 75`;
}

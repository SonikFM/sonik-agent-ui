import { createHash, randomUUID } from "node:crypto";
import { basename } from "node:path";
import { z } from "zod";
import {
  assertVisualContextResultMatchesRequest,
  maxVisualContextImageBytes,
  visualContextRequestSchema,
  visualContextResultSchema,
  visualContextSnapshotSchema,
  visualContextSourceSchema,
  type VisualContextResult,
  type VisualContextSnapshot,
} from "@sonik-agent-ui/tool-contracts/visual-context";
import { DEV_WORKBENCH_STATE_ROOT } from "../contracts/workbench";

export const VISUAL_CONTEXT_PATH = `${DEV_WORKBENCH_STATE_ROOT}/visual-context.json` as const;
export const VISUAL_CONTEXT_LEASE_PATH = `${DEV_WORKBENCH_STATE_ROOT}/locks/visual-context` as const;
export const VISUAL_CONTEXT_STAGE_ROOT = `${DEV_WORKBENCH_STATE_ROOT}/tmp/visual-context` as const;

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

export function validateVisualContextSubmission(input: VisualContextSubmission): void {
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

export function visualContextSnapshotFromResult(result: VisualContextResult): VisualContextSnapshot {
  return visualContextSnapshotSchema.parse({
    schemaVersion: result.version,
    status: "current",
    generation: randomUUID(),
    requestId: result.requestId,
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

export function invalidatedVisualContextSnapshot(input: VisualContextInvalidation): VisualContextSnapshot {
  return visualContextSnapshotSchema.parse({
    schemaVersion: "sonik.visual-context.v1",
    status: "invalidated",
    generation: randomUUID(),
    requestId: null,
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

export function isStaleVisualContextResult(current: VisualContextSnapshot | null, result: VisualContextResult): boolean {
  if (!current) return false;
  if (result.sourceContextRevision < current.sourceContextRevision || result.routeRevision < current.routeRevision) return true;
  return result.sourceContextRevision === current.sourceContextRevision
    && result.routeRevision === current.routeRevision
    && current.requestId !== null
    && current.requestId !== result.requestId;
}

export function decodeCanonicalBase64(value: string): Buffer {
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) throw new Error("Visual context PNG data must be canonical base64.");
  return bytes;
}

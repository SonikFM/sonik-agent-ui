import { createStateStore, type Spec, type StateModel, type StateStore } from "@json-render/core";
import { immutableSetByPath } from "@json-render/core/store-utils";

export interface JsonRenderStateChange {
  path: string;
  value: unknown;
}

export interface JsonRenderStatePatchPayload {
  artifactId: string;
  baseVersion: number;
  changes: JsonRenderStateChange[];
  requestId: string;
  summary: string;
}

const MAX_PATCH_CHANGES = 100;
const MAX_PATCH_PATH_LENGTH = 512;
const INVALID_POINTER_ERROR = "State update path must be a non-root JSON Pointer.";

export function createJsonRenderStateStore(spec: Spec): StateStore {
  return createStateStore(cloneState(spec.state));
}

export function applyJsonRenderStateChanges(spec: Spec, changes: JsonRenderStateChange[]): Spec {
  const normalized = normalizeJsonRenderStateChanges(changes);
  if (normalized.length === 0) return spec;

  let nextState: StateModel = cloneState(spec.state);
  for (const change of normalized) {
    nextState = immutableSetByPath(nextState, change.path, cloneJsonValue(change.value));
  }

  return {
    ...spec,
    state: nextState,
  };
}

export function normalizeJsonRenderStateChanges(changes: JsonRenderStateChange[]): JsonRenderStateChange[] {
  if (!Array.isArray(changes)) throw new Error("State changes must be an array.");
  if (changes.length > MAX_PATCH_CHANGES) throw new Error(`State patch cannot contain more than ${MAX_PATCH_CHANGES} changes.`);

  const normalized: JsonRenderStateChange[] = [];
  for (const change of changes) {
    if (!change || typeof change !== "object") throw new Error("Each state change must be an object.");
    const path = (change as JsonRenderStateChange).path;
    if (!isValidStatePatchPath(path)) throw new Error(INVALID_POINTER_ERROR);
    if (path.length > MAX_PATCH_PATH_LENGTH) throw new Error(`State update path cannot exceed ${MAX_PATCH_PATH_LENGTH} characters.`);
    normalized.push({ path, value: cloneJsonValue((change as JsonRenderStateChange).value) });
  }
  return normalized;
}

export function createJsonRenderStateSignature(spec: Spec): string {
  return stableStringify(cloneState(spec.state));
}

export function buildJsonRenderStatePatchPayload(input: {
  artifactId: string;
  baseVersion: number;
  changes: JsonRenderStateChange[];
  requestId?: string;
  summary?: string;
}): JsonRenderStatePatchPayload {
  if (!input.artifactId.trim()) throw new Error("artifactId is required for state patch persistence.");
  if (!Number.isFinite(input.baseVersion) || input.baseVersion < 1) throw new Error("baseVersion must be a positive artifact version.");
  return {
    artifactId: input.artifactId,
    baseVersion: input.baseVersion,
    changes: normalizeJsonRenderStateChanges(input.changes),
    requestId: input.requestId ?? createStatePatchRequestId(input.artifactId),
    summary: input.summary ?? "JSON-render state patch",
  };
}

export function createStatePatchRequestId(artifactId: string): string {
  const suffix = Math.random().toString(36).slice(2, 10);
  return `json-render-state:${artifactId}:${Date.now().toString(36)}:${suffix}`;
}

export function isValidStatePatchPath(path: unknown): path is string {
  if (typeof path !== "string") return false;
  if (path === "" || path === "/") return false;
  if (!path.startsWith("/")) return false;
  try {
    // immutableSetByPath owns the canonical JSON Pointer decode behavior. Run a harmless
    // validation write on a throwaway object so malformed escape sequences fail consistently.
    immutableSetByPath({}, path, null);
    return true;
  } catch {
    return false;
  }
}

function cloneState(value: Spec["state"]): StateModel {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return cloneJsonValue(value) as StateModel;
}

function cloneJsonValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      // Fall through to JSON cloning for plain serialized state values.
    }
  }
  return JSON.parse(JSON.stringify(value));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

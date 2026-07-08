// Minimal RFC 6902 JSON-Patch applier for json-render `Spec` objects, so the
// persona harness can reconstruct "what did the agent render" from the
// `data-spec` chunks a /api/generate turn emits (see lib/sse-stream.mjs),
// without a build-step dependency on the @json-render/core workspace
// package's compiled dist (mirrors packages/core/src/types.ts's
// applySpecPatch/applySpecStreamPatch semantics for the "add"/"replace"/
// "remove" ops actually observed on the wire; "move"/"copy"/"test" are not
// used by this server's artifact stream today and are treated as no-ops
// rather than guessed at).

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parsePointer(path) {
  if (path === "" || path === "/") return [];
  if (!path.startsWith("/")) throw new Error(`Invalid JSON Pointer: ${path}`);
  return path
    .slice(1)
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function addByPath(root, path, value) {
  const segments = parsePointer(path);
  if (segments.length === 0) {
    if (isRecord(root) && isRecord(value)) {
      for (const key of Object.keys(root)) delete root[key];
      Object.assign(root, value);
    }
    return;
  }
  let cursor = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    if (Array.isArray(cursor)) {
      const index = segment === "-" ? cursor.length : Number(segment);
      if (!isRecord(cursor[index]) && !Array.isArray(cursor[index])) cursor[index] = {};
      cursor = cursor[index];
    } else {
      if (!isRecord(cursor[segment]) && !Array.isArray(cursor[segment])) cursor[segment] = {};
      cursor = cursor[segment];
    }
  }
  const last = segments.at(-1);
  if (Array.isArray(cursor)) {
    const index = last === "-" ? cursor.length : Number(last);
    cursor.splice(index, 0, value);
  } else {
    cursor[last] = value;
  }
}

function setByPath(root, path, value) {
  const segments = parsePointer(path);
  if (segments.length === 0) return;
  let cursor = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    if (Array.isArray(cursor)) {
      const index = Number(segment);
      if (!isRecord(cursor[index]) && !Array.isArray(cursor[index])) cursor[index] = {};
      cursor = cursor[index];
    } else {
      if (!isRecord(cursor[segment]) && !Array.isArray(cursor[segment])) cursor[segment] = {};
      cursor = cursor[segment];
    }
  }
  const last = segments.at(-1);
  if (Array.isArray(cursor) && last === "-") cursor.push(value);
  else cursor[last] = value;
}

function removeByPath(root, path) {
  const segments = parsePointer(path);
  if (segments.length === 0) return;
  let cursor = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    cursor = Array.isArray(cursor) ? cursor[Number(segment)] : cursor[segment];
    if (cursor === undefined) return;
  }
  const last = segments.at(-1);
  if (Array.isArray(cursor)) cursor.splice(Number(last), 1);
  else delete cursor[last];
}

/** Apply one json-render JsonPatch operation to a spec object (mutates + returns it). */
export function applyJsonPatch(spec, patch) {
  switch (patch.op) {
    case "add":
      addByPath(spec, patch.path, patch.value);
      break;
    case "replace":
      setByPath(spec, patch.path, patch.value);
      break;
    case "remove":
      removeByPath(spec, patch.path);
      break;
    default:
      // move/copy/test not observed on this server's artifact stream.
      break;
  }
  return spec;
}

/**
 * Apply a full turn's `specPatches` (from sse-stream.mjs's reduceUiMessageChunks)
 * to a running spec snapshot. Handles both `{type:"patch",patch}` and
 * `{type:"flat",spec}` SpecDataPart shapes. Returns a new spec object (does
 * not mutate the input), so callers can keep a per-turn history.
 */
export function applySpecDataParts(currentSpec, specDataParts) {
  let spec = currentSpec ? structuredClone(currentSpec) : { root: "", elements: {} };
  for (const part of specDataParts ?? []) {
    if (!part || typeof part !== "object") continue;
    if (part.type === "flat" && part.spec) {
      spec = structuredClone(part.spec);
    } else if (part.type === "patch" && part.patch) {
      applyJsonPatch(spec, part.patch);
    }
  }
  return spec;
}

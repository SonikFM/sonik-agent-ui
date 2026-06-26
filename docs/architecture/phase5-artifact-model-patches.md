# Phase 5 artifact-model patch/version seam

## Scope

Phase 5 expands `@sonik-agent-ui/artifact-model` without touching ORPC, platform adapters, sandboxing, memory, catalog migration, or chat/workspace layout behavior.

## Source reuse rule

JSON patch semantics are delegated to the copied `@json-render/core` RFC 6902 utilities (`applySpecStreamPatch` and `JsonPatch`). The artifact package wraps those mutable patch helpers in immutable artifact helpers so upstream JSON-render behavior is preserved and Sonik-specific version lineage is added outside the donor code.

## Added seams

- `model/html-artifact.ts` — typed HTML artifact content wrapper.
- `model/document-artifact.ts` — typed markdown/plain document artifact content wrapper.
- `model/json-render-artifact.ts` — JSON artifact creation plus `upsertJsonRenderArtifact` identity/signature helper. The helper derives previous signatures internally with stable key ordering so callers do not maintain sidecar signature state.
- `patches/json-patch.ts` — immutable JSON patch wrappers around `@json-render/core` patch execution. Empty, test-only, and no-effective-change patch batches preserve the current artifact object/version.
- `patches/find-replace-patch.ts` — text/document find-replace patch result reporting with changed ranges.
- `versions/version-store.ts` — immutable in-memory version history snapshots with monotonic append validation.

## Behavior contracts

- Artifact identity (`id`) and creation timestamp remain stable across content replacement and patch helpers.
- Content-changing helpers increment `version` and update `updatedAt`.
- Metadata-only JSON artifact title updates do not create content versions.
- JSON patch helpers clone artifact content before applying donor patch utilities; failed patch batches return/throw without corrupting the original artifact, including failures after earlier draft mutations.
- Find/replace returns count and range metadata; no-match updates preserve the current artifact object and version.
- Version store appends are immutable, frozen, monotonic snapshots and clone content instead of retaining live object references.
- `artifact-model` depends on `@json-render/core` only for JSON-render types/patch utilities; Svelte renderer dependencies stay outside the model package.

## Deferred to later phases

- ORPC/tool contract availability.
- Amplify/Sonik platform adapter binding.
- Sandbox/CLI execution.
- Memory vault/background sync.
- JSON component catalog migration or UI redesign.

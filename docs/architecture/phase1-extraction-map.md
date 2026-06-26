# Phase 1 extraction map

Phase 1 starts only after the Phase 0 provenance-preserving copy signoff. This pass extracts thin seams from the copied scaffold without redesigning or replacing the copied chat UX.

## Extraction rules applied

- Preserve the copied `apps/standalone-sveltekit` stream loop and message-thread structure.
- Wrap or move stable helpers into packages; do not recreate the UI from memory.
- Keep platform-specific Amplify, Sonik booking, ORPC, sandbox, and memory work out of this slice.
- Cite every copied source file that was replaced or wrapped.

## New package seams

| Package | Current Phase 1 role | Long-term role |
| --- | --- | --- |
| `@sonik-agent-ui/workspace-core` | Defines platform-free workspace pane/artifact tree types and helpers. | Own pane tree, artifact identity, layout patches, runtime sidecars, and workspace operations. |
| `@sonik-agent-ui/json-ui-runtime` | Wraps the copied JSON renderer call site as `JsonArtifactRenderer` / `JsonInlineRenderer`. | Own JSON-render catalogs, registry adapters, artifact renderers, and renderer state adapters. |
| `@sonik-agent-ui/chat-surface` | Moves copied message part segmentation helpers out of the page. | Own Amplify-compatible chat wrappers, message state, tool call blocks, composer, and reasoning blocks. |

## Copied source files wrapped or extracted

| Copied scaffold source | Phase 1 destination / treatment | Transfer-loss guard |
| --- | --- | --- |
| `apps/standalone-sveltekit/src/lib/render/Renderer.svelte` | Wrapped by `packages/json-ui-runtime/src/renderer/JsonArtifactRenderer.svelte` with the same `JsonUIProvider initialState={spec.state}` + `<Renderer {spec} {registry} {loading} />` call shape. | Existing local component remains in place as a donor reference; app now imports the package wrapper. |
| `apps/standalone-sveltekit/src/routes/+page.svelte` helper block (`getSpec`, `getText`, `hasSpec`, `getSegments`) | Extracted into `packages/chat-surface/src/message-parts.ts`. | Page keeps the same chat setup, suggestions, labels, scroll handling, and message markup; only helper imports changed. |
| Planned workspace/canvas tree from PRD | Seeded as pure TS in `packages/workspace-core/src/layout/workspace-tree.ts`. | Not wired into the copied app yet; this avoids premature layout redesign while establishing the boundary. |

## Deferred by design

- No Amplify component replacement yet.
- No Sonik booking widget catalog yet.
- No ORPC manifest discovery implementation yet.
- No tmux-style canvas splitter yet.
- No sandbox terminal integration yet.

Those features belong to later phases after the JSON-render stream loop remains verified through these seams.

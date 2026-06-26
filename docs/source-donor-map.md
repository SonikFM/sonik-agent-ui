# Source Donor Map - Phase 0

Phase 0 used provenance-preserving filesystem copy commands. Donor files were copied first, with only mechanical root workspace setup added around them.

## Donor repositories

| Donor | Local path | Commit | License | Use |
| --- | --- | --- | --- | --- |
| json-render | `json-render` | `e2d00faeaabe2871ca18a4594a9ec39a245f9b6c` | Apache-2.0 | Primary SvelteKit JSON-render chat scaffold and required renderer packages |
| amplify-svelte | `amplify-svelte` | `0c6d41c4e014c21176b99f0bfcb5200373cd5c53` | MIT | Future chat-surface donor only; not copied in Phase 0 |
| ui-dojo | `ui-dojo` | `9ab98e8fe826609d6413b43c4ee6bf0305bd4415` | Package has no license field; source requires license confirmation before copying | Future backend reference only; not copied in Phase 0 |

## Phase 0 copied sources

| Source | Destination | Copy command class | Notes |
| --- | --- | --- | --- |
| `json-render/examples/svelte-chat/` | `apps/standalone-sveltekit/` | `rsync -a` | Preserved donor SvelteKit chat app structure |
| `json-render/packages/core/` | `packages/core/` | `rsync -a` | Preserved `@json-render/core` package |
| `json-render/packages/svelte/` | `packages/svelte/` | `rsync -a` | Preserved `@json-render/svelte` package |
| `json-render/packages/typescript-config/` | `packages/typescript-config/` | `rsync -a` | Preserved internal TypeScript config package required by copied packages |
| `json-render/pnpm-workspace.yaml` | `pnpm-workspace.yaml` | `cp` | Copied workspace shape; may be narrowed mechanically later |
| `json-render/pnpm-lock.yaml` | `pnpm-lock.yaml` | `cp` | Copied lockfile for dependency provenance; install may update mechanically for narrowed workspace |
| `json-render/LICENSE` | `docs/LICENSE-json-render-Apache-2.0.txt` | `cp` | Preserved donor license text |

## Phase 0 non-copy additions

| File | Reason |
| --- | --- |
| `package.json` | Mechanical repo-local workspace root so copied app/packages can be installed and verified inside `sonik-agent-ui` |
| `docs/source-donor-map.md` | Required provenance documentation |

## Phase 0 guardrail

No extraction, broad rename, redesign, retheme, or component rewrite is allowed in Phase 0. Any later re-architecture must cite the copied source it replaces and why.

## Mechanical local-run adjustments after review

The final gate found two repo-local mechanical issues that were corrected without rewriting scaffold behavior:

| File | Adjustment | Reason |
| --- | --- | --- |
| `pnpm-workspace.yaml` | Narrowed workspace globs to `apps/*` and `packages/*` and removed donor-wide install policy copied from the source monorepo | Make the new repo root the workspace authority and avoid surprising donor policy inheritance |
| `package.json` | Removed duplicate `workspaces` field | Avoid split workspace authority; pnpm workspace file is canonical |
| `packages/core/tsconfig.json` | Excluded `./**/*.test.ts` from package `typecheck`, matching the copied Svelte package pattern | Keep package diagnostics focused on package source/runtime declarations; copied donor tests remain preserved but are not part of Phase 0 package typecheck |

These are mechanical local-run adjustments. The copied stream/render source files remain unchanged.

## Root script reproducibility fix

The final review found that clean-checkout root `build` and `check-types` commands must build copied package dependencies before checking or building the copied app, because package `dist/` outputs are ignored. Root scripts were updated mechanically so `pnpm build`, `pnpm check-types`, and `pnpm phase0:verify` work from a clean generated-output state.

Root script order was corrected so `@json-render/core` builds before `@json-render/svelte` typecheck, because the copied Svelte package consumes core through package exports backed by ignored `dist/` output.

## Phase 1 extraction notes

Phase 1 begins after the signed-off Phase 0 copy. It introduces package seams by wrapping/extracting copied scaffold code instead of recreating the UI:

- `packages/json-ui-runtime/src/renderer/JsonArtifactRenderer.svelte` preserves the copied renderer call shape from `apps/standalone-sveltekit/src/lib/render/Renderer.svelte`.
- `packages/json-ui-runtime/src/renderer/JsonInlineRenderer.svelte` reuses the artifact wrapper for inline artifact placement.
- `packages/chat-surface/src/message-parts.ts` extracts the helper block from `apps/standalone-sveltekit/src/routes/+page.svelte`.
- `packages/workspace-core/src/layout/workspace-tree.ts` seeds platform-free workspace tree types only; it is intentionally not wired into the app yet to avoid redesigning the copied scaffold during the first extraction slice.

See `docs/architecture/phase1-extraction-map.md` for the file-by-file seam map.

## Phase 2 workspace shell notes

Phase 2 keeps the copied chat surface recognizable and wires a right-side artifact workspace around it:

- `packages/artifact-model/src/model/artifact.ts` and `packages/artifact-model/src/model/json-render-artifact.ts` introduce minimal artifact identity for the latest JSON-render spec.
- `packages/workspace-core/src/components/WorkspaceRoot.svelte` and `packages/workspace-core/src/components/ArtifactFrame.svelte` provide the first chat-plus-artifact workspace shell.
- `apps/standalone-sveltekit/src/routes/+page.svelte` still owns copied chat chrome and inline rendering, but now derives the latest assistant JSON-render spec into a `JsonRenderArtifact` and renders that same spec in the artifact pane.

See `docs/architecture/phase2-workspace-artifact-shell.md` for the detailed Phase 2 map and deferrals.

## Phase 3 workspace operation notes

Phase 3 adds package-level workspace operations and tests without modifying copied chat chrome:

- `packages/workspace-core/src/layout/workspace-patches.ts` adds `splitWorkspace`, `focusArtifact`, and `closePane`.
- `tests/unit/workspace-core.test.mjs` verifies active artifact identity through focus, split, and close repair.
- `tests/unit/artifact-model.test.mjs` verifies minimal artifact identity and version increment semantics.
- Root `pnpm test` is now part of `pnpm phase0:verify` so future phases keep these workspace identity guarantees.

See `docs/architecture/phase3-workspace-operations.md` for the detailed Phase 3 map and deferrals.

## Phase 4 chat-surface Amplify wrapper notes

Phase 4 replaces the page-owned chat chrome by copying and wrapping selected Amplify Svelte chat primitives rather than recreating them from memory:

| Source | Destination | Copy command class | Notes |
| --- | --- | --- | --- |
| `amplify-svelte/src/design-system/constants.ts` | `packages/chat-surface/src/vendor/amplify-chat/constants.ts` | `cp` | Shared design-system constants required by copied types. |
| `amplify-svelte/src/design-system/types.ts` | `packages/chat-surface/src/vendor/amplify-chat/types.ts` | `cp` | Shared component base props required by copied primitives. |
| `amplify-svelte/src/design-system/utils.ts` | `packages/chat-surface/src/vendor/amplify-chat/utils.ts` | `cp` | Provides copied `cn()` helper, backed by `clsx` and `tailwind-merge`. |
| `amplify-svelte/src/design-system/chat/Conversation/` | `packages/chat-surface/src/vendor/amplify-chat/Conversation/` | `rsync -a` | Copied conversation root/content/empty/scroll primitives. |
| `amplify-svelte/src/design-system/chat/Message/` | `packages/chat-surface/src/vendor/amplify-chat/Message/` | `rsync -a` | Copied message root/content/actions primitives. |
| `amplify-svelte/src/design-system/chat/PromptInput/` | `packages/chat-surface/src/vendor/amplify-chat/PromptInput/` | `rsync -a` | Copied prompt input root/body/textarea/toolbar/submit primitives. |

Mechanical adaptation in this phase was limited to making the copied primitive files compile in the standalone package: `$ds` imports now point at the copied local helpers, and index exports for uncopied schema/Puck/A2UI adapter files were removed until those surfaces are intentionally copied or replaced in a later phase.

See `docs/architecture/phase4-chat-surface-amplify-wrapper.md` for the wrapper map and deferrals.


## Slice 8 canvas viewport shell notes

Slice 8 adds `CanvasViewport` and `CanvasToolbar` as local Sonik Agent UI platform seams around the already-copied JSON-render runtime. No Odysseus source files were copied in this slice. JSON-render behavior still flows through the copied donor renderer path documented above; the new canvas shell is adapter/chrome code outside the donor island.

See `docs/architecture/phase8-canvas-viewport-shell.md` for the file map and manual test expectations.

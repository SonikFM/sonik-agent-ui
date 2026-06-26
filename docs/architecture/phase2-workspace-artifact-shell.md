# Phase 2 workspace artifact shell

Phase 2 wires the smallest canvas/workspace milestone after the Phase 1 seam extraction. It keeps the copied chat behavior recognizable while adding a right-side artifact pane that renders the latest streamed JSON-render spec through the same renderer seam used inline in chat.

## Scope delivered

| Area | Files | Treatment |
| --- | --- | --- |
| Artifact identity | `packages/artifact-model/src/model/artifact.ts`, `packages/artifact-model/src/model/json-render-artifact.ts` | Adds minimal `Artifact` and `JsonRenderArtifact` identity with `id`, `kind`, `version`, timestamps, title, and content. |
| Workspace shell | `packages/workspace-core/src/components/WorkspaceRoot.svelte`, `packages/workspace-core/src/components/ArtifactFrame.svelte` | Adds a two-pane chat/artifact shell and artifact frame without replacing chat chrome. |
| Workspace state seam | `packages/workspace-core/src/state/workspace-state.ts` | Adds minimal runtime snapshot helpers connecting workspace snapshots to active artifact identity. |
| Standalone app wiring | `apps/standalone-sveltekit/src/routes/+page.svelte` | Keeps copied chat markup and inline artifact rendering; derives the latest assistant JSON-render spec into a `JsonRenderArtifact` and renders it in the workspace pane. |
| Workspace scripts | root/app package manifests and lockfile | Adds `@sonik-agent-ui/artifact-model` and updates build/typecheck order. |

## Transfer-loss guard

- The copied chat header, message loop, suggestions, tool status rendering, inline `JsonArtifactRenderer`, scroll behavior, input composer, and error display remain in the app page.
- The workspace pane uses `JsonArtifactRenderer` from `@sonik-agent-ui/json-ui-runtime`, preserving the Phase 1 wrapper around the donor renderer call shape.
- The app still uses the app-local copied registry for now; catalog/registry promotion remains a later slice to avoid changing generated component behavior in the same pass.

## What is intentionally deferred

- No Amplify chat primitive replacement.
- No ORPC/tool-contract implementation.
- No Sonik booking widgets.
- No sandbox terminal.
- No full split/resize/tmux tree operations beyond the initial two-pane shell.
- No JSON patch/version history beyond minimal artifact identity.

## Verification

- Svelte autofixer was run against the new workspace components and edited page.
- `pnpm phase0:verify` passes with the new artifact/workspace packages included in root build and typecheck order.

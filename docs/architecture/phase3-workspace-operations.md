# Phase 3 workspace operations and identity tests

Phase 3 hardens the workspace core after the Phase 2 two-pane shell. The goal is to make pane operations testable and identity-preserving before adding catalog migration, Amplify chat replacement, ORPC tools, or sandbox panes.

## Scope delivered

| Area | Files | Treatment |
| --- | --- | --- |
| Workspace operations | `packages/workspace-core/src/layout/workspace-patches.ts` | Adds immutable `splitWorkspace`, `focusArtifact`, and `closePane` helpers. |
| Workspace exports | `packages/workspace-core/src/index.ts` | Exposes operation types and helpers from the package boundary. |
| Artifact identity tests | `tests/unit/artifact-model.test.mjs` | Verifies artifact creation, full replace version increment, timestamp preservation, and JSON-render artifact shape. |
| Workspace identity tests | `tests/unit/workspace-core.test.mjs` | Verifies focus, split with/without focus transfer, close repair, unknown close no-op, and active artifact preservation. |
| Root verification | `package.json` | Adds `pnpm test` and includes it in `pnpm phase0:verify`. |

## Transfer-loss guard

- Phase 3 does not alter the copied chat UI or app renderer behavior.
- Tests import pure built layout modules directly so Svelte component exports do not require a Node Svelte loader.
- The fixed Phase 2 workspace shell remains a shell; split/close helpers are package-level operations prepared for future UI wiring.

## Bug caught by tests

The first `splitWorkspace` implementation recursively re-visited the newly inserted split node because the mapper transformed the target pane before recursing. The focused unit test exposed this as a stack overflow. The mapper now recurses through existing children first and applies replacements after child traversal.

## Deferred by design

- No visual split/resize UI yet.
- No catalog/registry migration from the app into `json-ui-runtime`.
- No Amplify chat replacement.
- No ORPC/tool-contract/platform adapter implementation.
- No sandbox terminal pane.
- No full JSON patch/version-store implementation beyond existing identity/full-replace tests.

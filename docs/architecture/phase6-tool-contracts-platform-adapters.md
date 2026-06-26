# Phase 6 — Tool contracts and platform adapters

This slice starts the original RALPLAN Phase 6 seam without binding the working canvas UI to live Sonik mutations.

## Discovery findings

- Sonik MCP already has the strongest command pattern: command descriptors, policy decisions, receipts, host profiles, and MCP projection are separated.
- Sonik booking service is the cleanest ORPC source. It exposes oRPC contracts through generated OpenAPI 3.1.1 with machine-readable `x-sonik-status` and `x-sonik-adapter` metadata. The generated SDK JSON is the right first adoption source for booking tools.
- Legacy Sonik node API in the inspected checkout is primarily Express/TSOA/OpenAPI, not a direct ORPC metadata surface.
- Amplify SDK has ORPC router references, but many are host-coupled migration/reference surfaces. They should feed adapter metadata only after org-scope/effect metadata is explicit.

## Adopted seam

- `packages/tool-contracts` is pure policy and manifest logic. It defines tool sources, effects, approval gates, UI targets, auth/org scope, and transport metadata. It does not import platform clients.
- `packages/platform-adapters` converts standalone/local and OpenAPI-like metadata into tool manifests. It owns adapter shape, not live execution.
- The standalone SvelteKit app now exposes `/api/tool-manifest` and injects a manifest summary into each agent turn. The agent also has a `listAvailableTools` tool that reads the manifest rather than inventing platform capability prose.

## Policy rules locked by tests

- ORPC tool ids must be procedure ids, not arbitrary URLs or REST endpoint strings.
- Sandbox/environment tools are excluded from ORPC app-state manifests.
- Auth/org-scoped tools are hidden until host context injects authenticated org scope.
- Write/destructive operations are approval-gated or denied by default.
- Shadow OpenAPI operations are excluded by default until intentionally included.

## Next adoption step

The next production slice should add a Sonik host adapter that reads the real booking OpenAPI JSON or ORPC metadata from the Sonik environment and injects authenticated `organizationId`, scopes, and client execution callbacks. Actual tool execution should still pass through explicit approval policy before mutations are enabled.

# Phase 10 — Command Manifest Generator v0

## Purpose

The v0 generator turns a host OpenAPI document plus a small product-owned config into the existing Sonik Agent UI command primitives:

```
OpenAPI + generator config
  -> ToolManifest
  -> CommandCatalog + CommandFamilyRegistry
  -> CLI/MCP projection manifests
```

It intentionally does **not** create a competing permanent intermediate representation. The command descriptor remains the app-facing contract, and runtime execution remains adapter-mounted through the existing `executeCommand`, `commitCommand`, and `learnCommand` pathway.

## Package

Implementation lives in `packages/command-generator` so it can be embedded in Sonik, Amplify, or another host without importing the standalone Svelte app.

Primary exports:

- `generateCommandArtifactsFromOpenApi({ document, config })`
- `createProjectionManifests(catalog, config)`
- `createCliDescriptorSourceManifest({ provider, commands, families })`

## Generator config responsibilities

The OpenAPI document describes operations, paths, methods, request/response refs, auth scopes, and summaries. The config describes the host policy:

- command families and the valid family registry
- tag-to-family mapping
- load policy (`eager-summary`, `surface-eager`, `lazy`, `hidden`)
- page/surface context hints
- accessibility labels and action labels
- explicit CLI/MCP projection metadata when a host wants non-default command names
- neutral projection defaults for catalog-backed CLI/MCP wrappers

The generator rejects unknown family ids and duplicate families so host integrations stay type-safe and searchable.

## Runtime stance

Generated commands are metadata by default. They are non-executable until a host runtime adapter mounts them:

- OpenAPI commands default to `runtimeStatus: "shadow"`, and the generator refuses mounted-status shortcuts.
- `executeCatalogCommand` denies shadow OpenAPI/ORPC commands.
- HTTP mutation/destructive methods are the safe effect floor; operation ids cannot downgrade a POST/PUT/PATCH/DELETE into a read command.
- `executeHostCatalogCommand` can mount a read or write binding without changing the descriptor.
- Mutation commands must use `commit` and explicit approval.

This keeps generation safe for large API surfaces while still enabling dynamic discovery, learning, and tool projection.

## Projection stance

CLI and MCP outputs are declarative projection manifests. They do not shell out or execute business logic. Each projection points back to catalog command tools:

- `executeCommand`
- `commitCommand`
- `learnCommand`

CLI command strings are only copied from explicit descriptor metadata or host-provided projection defaults. If omitted, the safe neutral default is the generic catalog executor: `agent-command execute --command-id <id>`. Hosts can configure their own command name, argument template, and MCP tool name without changing generated descriptors.

## Test coverage

`tests/unit/command-generator.test.mjs` covers:

- OpenAPI to manifest/catalog/registry generation
- product-neutral family/capability mapping
- inherited and public OpenAPI security behavior
- schema-free startup/surface indexes
- `learnCommand` descriptor retrieval
- generated command denial until runtime-mounted
- host runtime read and approved write execution
- CLI/MCP projection parity
- CLI descriptor source projection without arbitrary shell execution
- duplicate/unknown family and unsupported adapter guardrails

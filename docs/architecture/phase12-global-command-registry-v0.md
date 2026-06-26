# Phase 12 — Global command registry v0

## Decision

Sonik Agent UI now treats provider command catalogs as deterministic inputs to a product-neutral global command registry. The global registry is **not** an Amplify-specific manifest. Amplify, booking, MCP, CLI, and future hosts should consume the same command registry contract and then layer host-specific availability, grants, session, and approval envelopes on top.

## Source of truth

```text
ORPC contracts / OpenAPI document
  -> provider command artifacts
  -> global command registry artifact
  -> host grant/runtime adapters
  -> search / learn / execute / commit
```

Current provider promoted into the global registry:

- `sonik-booking-openapi-fixture`
- Source artifact: `tests/fixtures/generated/sonik-booking-command-artifacts.generated.json`
- SDK promoted artifact: `packages/sonik-sdk/docs/sonik-command-registry.generated.json` in the Sonik booking service worktree

## Generated artifacts

Agent UI writes the same deterministic global registry to:

- `tests/fixtures/generated/sonik-global-command-registry.generated.json`
- `apps/standalone-sveltekit/src/lib/server/generated/sonik-global-command-registry.generated.json`

When `SONIK_COMMAND_REGISTRY_SDK_OUTPUT` or `--sdk-output` is provided, the generator also writes the same artifact into a downstream SDK docs path.

## Safety invariants

The global registry composer enforces:

- unique command ids across providers;
- unique tool ids across providers;
- no projection entry can target an unknown command id;
- duplicate family ids are allowed only when their definitions are structurally identical;
- provider OpenAPI/ORPC commands remain `runtimeStatus: "shadow"` until a host runtime adapter mounts them;
- mutation/destructive commands remain commit/approval gated;
- indexes remain schema-free until `learnCommand` is called.

## Commands

```bash
pnpm generate:commands:sonik-booking
pnpm generate:commands:sonik-global
pnpm check:commands
```

To promote into the Sonik SDK docs artifact:

```bash
SONIK_COMMAND_REGISTRY_SDK_OUTPUT=/absolute/path/to/packages/sonik-sdk/docs/sonik-command-registry.generated.json \
  pnpm generate:commands:sonik-global
```

CI should run `pnpm check:commands` after any OpenAPI/ORPC contract changes. SDK promotion CI can additionally run the same global command registry check with `SONIK_COMMAND_REGISTRY_SDK_OUTPUT` set.

Inside the Sonik SDK package, `bun run verify` includes `bun run check-command-registry`, which parses the promoted JSON artifact, checks the package export seam, proves the booking provider/counts, rejects absolute local workstation paths, and asserts generated booking commands remain OpenAPI shadow descriptors.

# Phase 11 — Sonik Booking Generator Fixture

## Purpose

This slice proves the command manifest generator can ingest a real Sonik booking OpenAPI surface without hand-writing per-operation tools.

Source fixture:

- repo: `/Users/danielletterio/Documents/GitHub/sonik-booking-service`
- ref: `emdash/major-schools-raise-3zsc2`
- source file: `packages/sonik-sdk/docs/booking-openapi.generated.json`
- source SHA-256: `5baf5b0a9588fea0c0349ca3fe1f25342b29c342d0cb749607acfd913ae8060f`
- operation count: `71`

The checked OpenAPI fixture intentionally keeps operation metadata only. Request/response bodies are replaced with fixture refs because generator v0 only needs path, method, operation id, security, tags, request presence, and response presence.

## Generated artifacts

Run:

```bash
pnpm generate:commands:sonik-booking
```

Check for CI/drift without writing:

```bash
pnpm check:commands:sonik-booking
```

Output:

- `tests/fixtures/generated/sonik-booking-command-artifacts.generated.json`

The generated artifact includes:

- `ToolManifest`
- `CommandFamilyRegistry`
- `CommandCatalog`
- CLI projection metadata
- MCP projection metadata

## Safety stance

The fixture is discovery/projection only:

- all generated booking commands use `source: "openapi"`
- all generated booking commands use `runtimeStatus: "shadow"`
- reads are searchable/learnable but non-executable until a host runtime adapter mounts them
- writes/destructive commands are approval/commit-gated and still non-executable while shadowed
- Sonik-specific family names and CLI/MCP names live in host config, not generator core

## Test coverage

`tests/unit/sonik-booking-command-fixture.test.mjs` regenerates the fixture and deep-compares it to the checked artifact. It also verifies operation parity, host family provenance, public/authenticated security posture, schema-free indexes, descriptor learning, shadow execution denial, and CLI/MCP projection metadata.


## CI/CD deterministic gate

Use this fixture as the first ORPC/OpenAPI command drift gate:

```bash
pnpm check:commands:sonik-booking
pnpm test
pnpm check-types
pnpm build
```

For a live Sonik service pipeline, run service-side OpenAPI generation first, then regenerate/check command artifacts in this repo or host package:

```bash
# sonik-booking-service
bun run generate:openapi
bun run check:openapi

# sonik-agent-ui / host integration
pnpm generate:commands:sonik-booking
pnpm check:commands:sonik-booking
```

The intended ORPC gate remains:

```text
ORPC contracts -> OpenAPI document -> command generator -> CommandCatalog/FamilyRegistry/projections -> host runtime adapter mount
```

A PR that changes ORPC/OpenAPI behavior should include the generated command artifact diff. CI should fail when `pnpm check:commands:sonik-booking` detects drift.

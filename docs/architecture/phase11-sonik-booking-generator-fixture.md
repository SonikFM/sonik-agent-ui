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

- `tests/fixtures/generated/sonik-booking-command-artifacts.generated.json` — deterministic fixture/gate copy
- `apps/standalone-sveltekit/src/lib/server/generated/sonik-booking-command-artifacts.generated.json` — runtime copy consumed by the standalone app host adapter

The generated artifact includes:

- `ToolManifest`
- `CommandFamilyRegistry`
- `CommandCatalog`
- CLI projection metadata
- MCP projection metadata

## Safety stance

The fixture is discovery/projection only:

- all generated booking commands use `source: "openapi"`
- all generated booking commands keep descriptor `runtimeStatus: "shadow"`
- source service posture is preserved separately as `metadata.sourceRuntimeStatus`, `metadata.sourceRuntimeAdapter`, and `metadata.sourceMounted`
- reads are searchable/learnable but non-executable until a host runtime adapter mounts them
- writes/destructive commands are approval/commit-gated and still non-executable while shadowed
- Sonik-specific family names and CLI/MCP names live in host config, not generator core

## Test coverage

`tests/unit/sonik-booking-command-fixture.test.mjs` regenerates the fixture and deep-compares it to the checked artifact. It also verifies operation parity, host family provenance, public/authenticated security posture, preserved mounted/shadow source posture, schema-free indexes, descriptor learning, shadow execution denial, and CLI/MCP projection metadata.

`tests/unit/tool-contracts.test.mjs` verifies the app host-runtime seam: generated mounted read descriptors can be composed into the host catalog, unavailable runtime configuration returns a typed `runtime_unavailable` receipt, and a configured fetch-backed booking runtime executes `booking.ping` through `executeHostCatalogCommand` without changing the generated descriptor.


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
ORPC contracts -> OpenAPI document -> command generator -> CommandCatalog/FamilyRegistry/projections -> app runtime copy -> host runtime adapter mount
```

A PR that changes ORPC/OpenAPI behavior should include the generated command artifact diff. CI should fail when `pnpm check:commands:sonik-booking` detects drift.

## Runtime mount seam v0

The standalone app mounts only a small safe read subset from the generated catalog:

- `booking.ping`
- `booking.list.contexts`
- `booking.list.organizer.templates`
- `booking.get.organizer.template`

The runtime adapter is transport-driven from generated OpenAPI method/path metadata and is enabled by `SONIK_BOOKING_API_BASE_URL` / `BOOKING_SERVICE_BASE_URL`. If no base URL is configured, command execution returns a typed unavailable receipt instead of fixture data. The v0 live seam also uses explicit per-command input policies for the mounted read subset so unknown parameters, invalid `kind` values, and unsafe path/query values are rejected before outbound fetch.

Authentication is server/runtime-owned, not page-context-owned:

- `SONIK_BOOKING_AUTH_MODE=anonymous|bearer|service-token|cookie` declares the runtime posture.
- `SONIK_BOOKING_API_BEARER_TOKEN`, `SONIK_BOOKING_API_TOKEN`, or `BOOKING_SERVICE_API_TOKEN` are secrets and must not live in checked config.
- protected generated reads such as `booking.list.contexts` return a typed unavailable receipt unless a credentialed runtime mode is configured.
- `cookie` mode is reserved for a future explicit host cookie-forwarding adapter; it does not unlock protected generated reads in v0.
- public reads such as `booking.ping` and template reads can still execute anonymously.
- receipts expose `authMode` and `credentialed` only; they never echo tokens.

Writes and destructive commands remain descriptor-only until an explicit trusted commit adapter is added.

# Phase 3 — Trusted booking runtime write adapter

Phase 3 promotes the v0.2 demo booking workflow without changing the generated registry artifact.

## Boundary

Generated command artifacts stay deterministic discovery records:

- `booking.get.availability`
- `booking.create.hold`
- `booking.get.hold`
- `booking.release.hold`

In the global registry/search/learn APIs these commands remain `transport.runtimeStatus: "shadow"` and search summaries remain `execution.executable: false`. The generated JSON is not edited to grant execution authority.

Runtime authority is introduced only by composing a trusted host catalog in `apps/standalone-sveltekit/src/lib/server/host-command-runtime.ts`. That composition copies the selected generated descriptors into a host-owned catalog view with:

- `transport.runtimeStatus: "mounted"`
- `metadata.liveExecution: true`
- `metadata.runtimeAdapterProvider: "sonik-booking-openapi-demo-runtime"`
- adapter eligibility gated by authenticated host session, organization id, and `booking:read` / `booking:write` scopes

`packages/platform-adapters/src/index.ts` now refuses to let a runtime adapter execute a descriptor that is still shadow in the provided catalog, even if a binding exists. This proves registry discovery is not execution authority.

## Mounted commands

| Command | Action | Runtime binding | Purpose |
| --- | --- | --- | --- |
| `booking.get.availability` | `execute` | `mounted-read` | Read deterministic availability before mutation. |
| `booking.create.hold` | `commit` | `mounted-write` | Create a temporary, reversible inventory hold. |
| `booking.get.hold` | `execute` | `mounted-read` | Confirm the created hold state. |
| `booking.release.hold` | `commit` | `mounted-write` | Cleanup/release demo hold. |

## Safety semantics

Mutation commits require:

1. trusted host catalog descriptor mounted by the adapter;
2. trusted host/session/org context;
3. booking runtime credential (`bearer` or `service-token` auth context);
4. explicit approval (`approved: true` or host-approved command id before the agent calls `commitCommand`);
5. idempotency key via `clientRequestId` / `x-sonik-idempotency-key`;
6. resource target validation: `resourceUnitId` or `resourceCombinationId` is required, and both are mutually exclusive;
7. redacted receipts that include request/org/session/principal ids, confirmation fields, and never echo credentials.

## Agent tool path

The chat agent still uses the same context-efficient pathway:

1. `searchCommandCatalog` for compact discovery;
2. `learnCommand` for schema/policy/transport/auth;
3. `executeCommand` for mounted reads;
4. `commitCommand` for approval-gated mounted mutations.

In embedded hosts, `/api/generate` resolves the signed host context from `x-sonik-agent-ui-host-context` and passes the authenticated host session into command tools. Standalone mode continues to use the read-only demo session unless a trusted host session is present.

## Verification

Regression coverage lives in `tests/unit/booking-runtime-write-adapter.test.mjs` and proves:

- global search/learn remains shadow/non-executable;
- direct global catalog execution remains denied even when trusted runtime adapters are present;
- trusted host catalog mounts only the selected booking workflow commands;
- missing approval prevents outbound booking API calls;
- missing resource target fails closed before mutation;
- availability read, hold create, hold confirmation, and hold release call the expected booking REST paths;
- mutation receipts carry org/session/principal/idempotency evidence and redact secrets.

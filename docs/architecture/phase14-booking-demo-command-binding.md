# Phase 14 — Booking demo command binding v0

## Decision

The v0.2 app-aware contract-tool demo should bind to a **booking hold** workflow rather than direct booking creation.

A hold is the best first mutation because it is:

- a real booking/reservation inventory mutation;
- mounted in the Sonik booking OpenAPI surface;
- temporary and TTL-backed;
- reversible through `booking.release.hold`;
- not a payment/deposit/cancel/delete flow;
- aligned with the capability framework's universal `hold / commit / release` booking lifecycle primitive.

## Exact command binding

Source config:

```text
tests/fixtures/sonik-booking/demo-command-binding.json
```

Selected commands:

| Role | Command | Operation | Method/path | Runtime posture |
| --- | --- | --- | --- | --- |
| Read | `booking.get.availability` | `bookingGetAvailability` | `GET /api/v1/booking/contexts/{contextId}/availability` | generated shadow; adapter target in next slice |
| Mutation | `booking.create.hold` | `bookingCreateHold` | `POST /api/v1/booking/holds` | generated shadow; adapter target in next slice |
| Confirmation | `booking.get.hold` | `bookingGetHold` | `GET /api/v1/booking/holds/{holdId}` | generated shadow; adapter target in next slice |
| Cleanup | `booking.release.hold` | `bookingReleaseHold` | `POST /api/v1/booking/holds/{holdId}/release` | generated shadow; adapter target in next slice |

## Discovery/execution boundary

This slice intentionally does **not** mount the write runtime.

Generated command artifacts must stay discovery-only:

- selected write command remains `effect: write`;
- selected write command remains `approval: required`;
- selected write command remains `transport.runtimeStatus: shadow` in generated registry discovery;
- execution can only be added by a later trusted host runtime adapter.

Do not edit generated command artifacts to make broad writes mounted.

## Seed and rollback plan

The future UltraTest/demo runtime must provide:

- `SONIK_AGENT_UI_DEMO_ORGANIZATION_ID`
- `SONIK_AGENT_UI_DEMO_CONTEXT_ID`
- `SONIK_AGENT_UI_DEMO_USER_ID`

The test flow:

1. Read availability for the context.
2. Pick the first slot with `capacityRemaining > 0`.
3. Resolve the constrained resource target using `host-context-first-fail-closed`:
   - pass `resourceUnitId` or `resourceCombinationId` when the host page context or test env donates one;
   - proceed without one only when the selected context is explicitly context-capacity based and `createHold` accepts a context-only hold;
   - otherwise fail before mutation with `missing-resource-target`.
4. Create a hold with `clientRequestId` prefix `agent-ui-v02-demo-hold`.
5. Confirm returned hold fields: `id`, `organizationId`, `contextId`, `window`, `partySize`, `status`, `expiresAt`.
6. Release the hold with reason `agent-ui-v0.2-demo-cleanup`.
7. Confirm the hold status becomes `released`.

## Rejected for v0.2

- `booking.create.booking`: too durable for the first demo because cleanup requires cancel semantics.
- `booking.cancel.booking`: cancel-like workflow is out of scope.
- `booking.commit.hold`: creates a durable booking; defer until rollback policy is explicitly approved.
- Destructive operations such as schedule-rule delete or resource unassign.

## Verification

Run:

```bash
node --experimental-strip-types tests/unit/sonik-booking-demo-command-binding.test.mjs
pnpm check:commands
```

The test validates that the bound command ids exist in the generated booking and global registry artifacts, match expected source operation ids/methods/paths/effects/approval values, remain shadow in generated discovery, reject direct booking/cancel/commit/destructive alternatives, include a fail-closed resource target rule, and return `runtime_unavailable` when the selected write/cleanup commands are passed through the current standalone runtime adapter bundle. Future adapter mount posture is deliberately left to the next runtime-adapter slice.

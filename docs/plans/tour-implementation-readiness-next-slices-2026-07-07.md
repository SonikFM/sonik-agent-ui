# Tour Implementation Readiness — Next Slices

Date: 2026-07-07

## Slice 1 — Generic host action protocol

Repo: `sonik-agent-ui`

Deliverables:

- `sonik.agent_ui.host_action.v1` request/result schemas.
- Dispatcher/client helper for iframe-origin action requests.
- Policy mode types: `block | ask | allow | require`.
- Timeout/unavailable handling.
- Tests for schema, result matching, timeout, blocked mode.

Acceptance:

- A fake host can receive `canvas.open` and return `executed`.
- Unknown action returns `blocked`/`invalid_request`.
- Chat text does not authorize any action.

## Slice 2 — Booking-service/SDK host receiver

Repo: booking-service / SDK package

Deliverables:

- Inbound postMessage receiver beside existing page-context request handler.
- Origin/source/version/action/payload validation.
- Host action registry with `canvas.open`, `canvas.close`, `approval.requestPreview`.
- Capability/policy fields in page context.

Acceptance:

- Embedded Agent UI can open host canvas through action request.
- Blocked action returns receipt and does not mutate host.
- Approval preview renders but does not execute write.

## Slice 3 — Tour target registry and component primitives

Repos: booking-service first; Agent UI if sidecar targets are needed

Deliverables:

- Stable `data-tour-target` or semantic target registry.
- `TourSpotlight`, `TourCallout`, `TourProgressControls` component contracts.
- Target coverage generation/verification scripts.

Acceptance:

- Every route target in manifest resolves or returns disabled reason.
- Missing target is controlled, not `Internal Error`.
- Keyboard/reduced-motion/theme checks pass.

## Slice 4 — Driver.js adapter decision

Deliverables:

- Native GSAP/Sonik primitive spike OR Driver.js adapter spike behind `TourRuntimeAdapter`.
- Behavior parity checks against `docs/manifests/driverjs-tour-behavior-parity-2026-07-07.md`.

Acceptance:

- Decision is evidence-backed: native, Driver adapter, or defer.
- No donor CSS leaks into Sonik chrome without explicit isolated adapter.

## Slice 5 — JSON app integration

Deliverables:

- JSON apps can declare host action bindings without executable payloads.
- Renderer emits request only; trusted host executes.
- Receipts update app state.

Acceptance:

- A JSON mini-app can request `canvas.open` / `tour.highlight` and receive receipts.
- A write preview asks for trusted approval and cannot commit from renderer props.

# Driver.js / Product Tour Readiness — Analyze-Copy-Retrofit Report

Date: 2026-07-07
Status: readiness / donor-analysis only
Primary decision: **do not vendor Driver.js yet**; use Driver.js as a donor/reference for behavior parity while building Sonik-native host-action and tour primitives.

## Source inspected

| Source | Evidence |
| --- | --- |
| npm package | `driver.js@1.6.0` from npm pack in `/tmp/driverjs-readiness`; MIT license; repository `git+https://github.com/nilbuild/driver.js.git`; package tarball `https://registry.npmjs.org/driver.js/-/driver.js-1.6.0.tgz`; npm integrity `sha512-gryo9QS7AZhz8J0bmdf42dwaTzcd1BgSJLnaSM7cPJbu8bTW8wIEuiGDy4MoCvB4Sr8wA9g5o2G9EFNVYZGeVQ==`; shasum `958a8912b7fc9026e3d65e8e541bd10d1f6daa23`. |
| Driver.js docs | https://driverjs.com/ describes Driver.js as lightweight, no-dependency, TypeScript, MIT, framework-ready, product tours/highlights/contextual help. |
| GitHub repository | https://github.com/kamranahmedse/driver.js?ref=ossgallery notes no dependencies, TypeScript, MIT, and latest release 1.6.0 on 2026-06-25. |
| Local Sonik handoff | `docs/handoffs/agent-action-channel-demo-readiness-handoff-2026-07-07.md`. |
| Existing Sonik tour proposal | `docs/proposals/agent-tour-primitives-spec-2026-07-06.md`. |

## Driver.js donor behavior summary

Extracted from `dist/driver.js.d.ts`, `dist/driver.css`, package README, and docs.

| Donor behavior | Driver.js API / source evidence | Sonik relevance |
| --- | --- | --- |
| Single highlight | `driver().highlight(step)` | Maps to `tour.highlight`. |
| Multi-step tour | `driver({ steps }).drive(stepIndex?)` | Maps to a Sonik `tourSpec` or agent-generated action sequence. |
| Navigation controls | `moveNext`, `movePrevious`, `moveTo`, `showButtons`, `disableButtons` | Maps to `TourProgressControls` and user/agent lifecycle state. |
| Lifecycle hooks | `onHighlightStarted`, `onHighlighted`, `onDeselected`, `onDestroyStarted`, `onDestroyed`, button hooks | Maps to action receipts + telemetry. |
| Popover render hook | `onPopoverRender(popover, opts)` | Useful donor behavior, but Sonik should render through schema-backed components. |
| Overlay configuration | `overlayColor`, `overlayOpacity`, `stagePadding`, `stageRadius` | Maps to Sonik theme tokens and `TourSpotlight` props. |
| Close/skip behavior | `allowClose`, `overlayClickBehavior`, close/done hooks | Maps to `tour.clear`, `completed`, `skipped`, `cancelled`. |
| Keyboard control | `allowKeyboardControl`; README says controllable by keyboard | Must be included in accessibility gate. |
| Active interaction gating | `disableActiveInteraction`, pointer-event CSS | Must be policy-controlled; never block host UI without obvious escape. |
| CSS popover chrome | `.driver-popover`, buttons, arrow classes, z-index, font/color defaults | Do not leak into Sonik themes; use as behavior reference only unless vendored behind adapter. |

## Copy/retrofit decision

### Recommendation

**Do not direct-copy Driver.js production source in this pass.**

Use Driver.js as a donor for behavior parity and maybe as an optional future adapter behind a Sonik `TourRuntimeAdapter` interface.

### Why not vendor now

- The load-bearing architecture is cross-origin host actions, not the spotlight implementation.
- Driver.js targets direct same-document element selectors/elements. Sonik needs semantic target IDs and host-owned resolution across iframe boundaries.
- Driver.js CSS owns its chrome (`all: unset`, fixed z-index, hardcoded colors/fonts) and would need theme quarantine.
- Sonik requires receipts, policy modes, page context, and trusted-host execution; Driver.js does not solve those.
- Sonik has a GSAP/design-system preference; Driver.js animation/CSS should not become the system boundary.

### When to reconsider vendoring

Vendor or wrap Driver.js only if:

1. semantic host action channel is already working;
2. target registry exists;
3. Sonik-native overlay/popover positioning is slower/riskier than expected;
4. Driver.js can be wrapped behind a stable adapter without exposing selectors/DOM refs to the agent;
5. theme CSS can be isolated and tested.

## Target architecture

```text
Remote Agent UI iframe
  -> versioned postMessage action-request
  -> host validates origin/source/version/action/payload/policy
  -> host resolves semantic target IDs
  -> host executes action through normal controller/handler
  -> host returns action-result receipt
  -> Agent UI updates chat/canvas/JSON app state
```

Driver.js-like tours become one consumer of this architecture, not the architecture itself.

## Proposed v0 contract surfaces

### Message protocol

Use the `sonik.agent_ui.host_action.v1` action-request/action-result shapes in:

- `docs/handoffs/agent-action-channel-demo-readiness-handoff-2026-07-07.md`

### Policy modes

Use one vocabulary everywhere:

```text
block / ask / allow / require
```

| Mode | Meaning |
| --- | --- |
| `block` | Host/session does not expose or permit the action. |
| `ask` | Agent can request approval/preview, but not execute yet. |
| `allow` | Host may execute after validation. |
| `require` | A prerequisite is missing: selected context, org, preview, target, etc. |

### Initial action keys

- `canvas.open`
- `canvas.close`
- `tour.highlight`
- `tour.annotate`
- `tour.focusTarget`
- `tour.clear`
- `approval.requestPreview`
- `approval.confirmTrustedAction` only when trusted host approval UI exists and tests prove chat text does not grant approval.

## Component library implications

This readiness pass supports the “little JSON apps” direction:

```text
JSON app descriptor
  -> schema-backed Sonik components
  -> state bindings / JSON pointer patches
  -> host action bindings
  -> command bindings
  -> policy/approval/receipt loop
```

Tour primitives should be normal Sonik components/actions:

- `TourSpotlight`
- `TourCallout`
- `TourProgressControls`
- `AgentActivityReceipt`
- `ApprovalPreviewCard`
- `HostActionStatusBadge`

These should follow `$sonik-component-design`: schema, renderer, A2UI adapter, builder adapter, fixtures, capability/actions, stories, tests.

## Implementation split

### Agent UI repo owns

- Shared action protocol types/validators.
- Host action client/dispatcher with timeout and receipt handling.
- Agent tool/skill wrapper for requesting host actions.
- User-facing receipt / approval card UI.
- JSON app/action binding integration.
- Tests proving blocked/ask/allow/require UI and no chat-text approval bypass.

### Booking-service / Amplify host repos own

- Stable semantic tour target IDs.
- Page context fields: action capabilities, policy modes, tour targets, active tour state.
- Host action registry and policy resolver.
- postMessage inbound handler with origin/source/version/action/payload validation.
- Host execution of canvas, highlight, annotate, focus, navigation, and approval preview.
- Receipts and Pipe-B/telemetry evidence.

### Shared docs/contracts own

- Message schemas.
- Action policy vocabulary.
- Tour target naming rules.
- UltraTest expectations and deployment parity checklist.


## Deployment parity checklist

Use this checklist before any later implementation claims hosted or embedded tour readiness. This readiness pass does **not** satisfy these items; it defines the required proof.

| Item | Required evidence | Owner |
| --- | --- | --- |
| Source branch and copy decision | Branch name, commit SHA, and `docs/manifests/driverjs-copy-retrofit-decision-2026-07-07.json`. | Agent UI |
| Agent UI deployment | Deployed Worker URL, commit SHA, and proof the deployed build includes `sonik.agent_ui.host_action.v1`. | Agent UI |
| SDK/package version consumed by host | SDK package version or commit SHA consumed by booking-service/Amplify. | Host repo |
| Consuming host deployment | Booking-service/Amplify deployed URL and branch/commit. | Host repo |
| Required env/secrets | Wrangler vars/secrets for host action telemetry, model/runtime, and Pipe-B logging; no secrets in docs. | Host repo |
| Auth/org/session/page-context source | Evidence that page context is from trusted host/session, not localStorage or chat text. | Host repo |
| Smoke action | `canvas.open` action request from iframe with `requestId`. | Agent UI + host |
| Expected UI state | Host canvas opens or action returns a controlled disabled reason. | Host repo |
| Expected backend effect | None for tour UI actions; write-like actions must stop at `approval_required` until trusted approval. | Host repo |
| Expected telemetry/log event | Pipe-B or equivalent event with `requestId`, `actionKey`, `policyMode`, status, and trace/receipt. | Host repo |
| Negative proof | Unknown action, blocked action, and missing target return controlled receipts, not `Internal Error`. | Agent UI + host |

## Scripts to add in implementation phase

### `scripts/generate-tour-target-manifest.*`

Inputs:

- route manifest;
- component capability manifests;
- Svelte files with `data-tour-target` declarations.

Output:

```json
{
  "schemaVersion": "sonik-agent-ui.tour-target-manifest.v1",
  "routes": [
    {
      "route": "/course",
      "targets": [
        {
          "id": "booking.nav.my_spaces",
          "label": "My Spaces",
          "required": true,
          "source": "agent-ui-route-manifest"
        }
      ]
    }
  ]
}
```

### `scripts/verify-tour-target-coverage.*`

Gate:

- Every required target resolves in browser smoke.
- Missing optional targets return disabled reason, not crash.
- Every target has accessible name/role or documented exception.

### `scripts/generate-starter-tour.*`

Generates draft `sonik-agent-ui.tour.v1` specs from route target manifests.

### Drift gate

CI fails when a tour target referenced by a committed tour/template is removed without updating manifests/tests.

## Acceptance gates for implementation readiness

A later implementation should not claim completion until:

1. Driver.js donor behaviors are mapped to Sonik parity tests.
2. No production vendored Driver.js source exists unless a manifest and drift verification are added.
3. Host action channel can prove one allowed action (`canvas.open`) in browser smoke.
4. One blocked action returns a controlled `blocked` receipt.
5. One missing target returns `requires_prerequisite` or `blocked`, not an internal error.
6. Approval preview path cannot execute from chat text alone.
7. Page context exposes capabilities/policy modes/tour targets and UltraTest reads them before DOM scraping.
8. User-facing UI hides dev-speak while receipts retain trace data for logs/inspector.

## Deferred decisions

- Whether to vendor Driver.js behind `TourRuntimeAdapter` after v0 host action channel is proven.
- Exact tour visual system: GSAP-native vs Driver.js adapter.
- Whether marketplace packages can publish tour templates in v0 or only after action channel hardens.
- Whether `approval.confirmTrustedAction` ships in demo v0 or stays preview-only.
- Whether cross-route navigation/resume ships as `tour.navigateAndResume` after the base channel and target registry are proven. It is not part of the v0 initial action set.

## Contract update — Target Registry v0

The concrete contract lives in `docs/contracts/target-registry-and-action-channel-v0.md` and `packages/tool-contracts/src/target-registry.ts`. Driver.js remains a donor/reference for highlight and popover behavior; host actions must use semantic target IDs plus optional `entityRef`, never raw selectors from the agent.


# Driver.js Behavior Parity Manifest — Sonik Tour Readiness

Date: 2026-07-07
Donor: `driver.js@1.6.0`
Decision: donor behavior parity first; no production copy yet.

| donor_behavior_id | upstream evidence | Sonik adapter/contract | State owner / seam | Telemetry / receipt | Required test |
| --- | --- | --- | --- | --- | --- |
| `driver.highlight.single` | `Driver.highlight(step)` in `dist/driver.js.d.ts` | `tour.highlight` host action + `TourSpotlight` | Host action controller resolves target ID | `tour.highlight.requested/executed/failed` with requestId | Valid target highlights; invalid target returns controlled disabled reason. |
| `driver.tour.drive` | `Driver.drive(stepIndex?)`, `steps?: DriveStep[]` | `sonik-agent-ui.tour.v1` spec or action sequence | Agent UI requests; host executes primitives | `tour.started`, `tour.step`, `tour.completed/skipped` | Multi-step tour updates page context activeTour state. |
| `driver.navigation` | `moveNext`, `movePrevious`, `moveTo` | `TourProgressControls` | Host tour runtime or Agent UI renderer depending surface | step receipt with index/total | Next/previous/done are keyboard and pointer accessible. |
| `driver.lifecycle.hooks` | `onHighlightStarted`, `onHighlighted`, `onDeselected`, `onDestroyed` | Action result receipts + activity receipt UI | Host controller | `ok`, `status`, `traceId?` | Receipts render only after real host result. |
| `driver.popover.render` | `onPopoverRender(popover, opts)` | `TourCallout` component schema and A2UI adapter | Trusted renderer, not donor DOM mutation | callout render event | Popover text is sanitized and theme-compliant. |
| `driver.overlay.stage` | `overlayColor`, `overlayOpacity`, `stagePadding`, `stageRadius` | `TourSpotlight` props using theme tokens | Host visual primitive | spotlight render receipt | Reduced motion and theme matrix pass. |
| `driver.close.skip` | `allowClose`, close/done hooks, `destroy()` | `tour.clear`, `endTour` | Host/Agent UI action state | `tour.skipped` / `tour.completed` | Escape/close path clears state and reports receipt. |
| `driver.keyboard` | README says controllable by keyboard; `allowKeyboardControl` | Keyboard-accessible controls | Component/controller | accessibility event optional | Keyboard-only tour can advance and exit. |
| `driver.active-interaction` | `disableActiveInteraction`, pointer-events CSS | Policy-controlled active interaction | Host controller | `interactionDisabled` state | Never traps user without visible escape; disabled host action cannot silently no-op. |
| `driver.css.chrome` | `.driver-popover`, `.driver-overlay`, hardcoded styles | Sonik theme-safe components | Component design system | visual/theming test evidence | Donor CSS does not leak into product chrome unless vendored adapter explicitly isolated. |
| `driver.config.mutation` | `setConfig`, `setSteps`, `getConfig`, `refresh` in `dist/driver.js.d.ts` | Deferred `TourRuntimeAdapter` configuration API | Adapter boundary, not agent-authored JSON | config/update receipt if implemented | Defer until runtime adapter slice; do not expose mutable donor config directly to the agent. |
| `driver.state.introspection` | `isActive`, `getState`, `getActiveIndex`, `getActiveElement`, previous/next getters | Host-owned tour state projection | Host page context / receipt state | `tour.state` read receipt | Agent sees sanitized state only; no DOM elements cross iframe boundary. |
| `driver.scroll.overlayClick` | `smoothScroll`, `allowScroll`, `overlayClickBehavior` | Host policy for scroll and overlay behavior | Host controller | `tour.overlay_interaction` receipt | Defer until visual/runtime slice; must preserve escape path and avoid trapping focus. |
| `driver.copy.i18n` | `progressText`, `nextBtnText`, `prevBtnText`, `doneBtnText`, popover title/description | Sonik `TourCallout` copy schema | JSON app / tour spec descriptor | render receipt | Copy is sanitized, localizable, and not executable. |
| `driver.placement` | `side`, `align`, `popoverOffset`, `StageDefinition` | `TourCallout` placement hints resolved by host | Host visual primitive | placement receipt | Missing/invalid placement degrades to safe default with telemetry. |
| `driver.step.data` | `DriveStep.data?: Record<string, any>` | Explicit Sonik metadata schema only | Schema validator | invalid metadata receipt | Arbitrary donor `data` is not forwarded without schema validation. |

## Intentionally deferred donor surfaces

These Driver.js behaviors are acknowledged but not part of the v0 readiness target until the generic host action channel and target registry are proven: direct DOM element callbacks, cross-route navigation/resume, mutable runtime config, scroll management, overlay-click semantics, and donor CSS class extension.

## Production seam proof required later

- `canvas.open` action request from iframe opens host canvas and returns `ok:true`.
- `tour.highlight` with a known host target resolves without DOM scraping by the agent.
- Missing host target returns `requires_prerequisite` or `blocked` with disabled reason.
- Approval preview request renders a trusted approval UI and cannot execute from chat text alone.

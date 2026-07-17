# Visual context picker behavior parity

This record freezes the reviewed donor evidence. Only the Impeccable helper and its
test are copied; OpenDesign and Playwright behaviors are reimplemented behind Sonik's
product-neutral contracts.

## Impeccable picker interaction

- donor_behavior_id: `impeccable-picker-interaction-v1`
- borrowed behaviors: capture-phase hover/click targeting, text-selection escape,
  Escape cleanup, and a hydration-safe page cursor.
- donor revision/file/test evidence: Impeccable
  `8259c28209b92792005cec14dad573df39f68eaf`;
  `skill/scripts/live-browser.js` (`setPageInteractionCursor`, capture-phase
  `mousemove`/`click`, Escape and cleanup paths);
  `tests/live-browser-regression.test.mjs` (Escape teardown and hydration-safe cursor);
  `tests/live-browser-dom.test.mjs` (owned chrome, pickability, anchors, focus, and
  outside-handler isolation).
- copied destination: helper at
  `packages/agent-embed/src/vendor/impeccable/visual-context-picker/skill/scripts/live-browser-dom.js`
  and unchanged test at
  `packages/agent-embed/src/vendor/impeccable/visual-context-picker/tests/live-browser-dom.test.mjs`.
- Sonik adapter/contract: `packages/agent-embed/src/visual-context-picker.ts` uses
  `@sonik-agent-ui/tool-contracts/visual-context`; donor `desc()` and raw selectors
  remain private and never enter the public contract.
- state owner and persistence seam: the embedding host owns transient picker state;
  the authenticated Workbench visual-context endpoint owns the persisted
  `VisualContextSnapshot` and `.sonik/visual-context.json` promotion.
- telemetry event(s): `visual_context.picker.started`,
  `visual_context.picker.cancelled`, `visual_context.target.selected`.
- host test / ultratest / manual prompt: unchanged copied test command
  `(cd packages/agent-embed/src/vendor/impeccable/visual-context-picker && node --test tests/live-browser-dom.test.mjs)`;
  Sonik adapter coverage belongs in `tests/unit/agent-embed.test.mjs`.
- deployed host URL or local route: Agent Embed in the local Dev Workbench route `/`;
  Booking deployed/live-equivalent URL is recorded by the Booking adoption gate.
- known gaps or deferred scope: Impeccable variants, DOM editing, and donor `desc()`
  output are intentionally not copied; cross-origin frames and closed shadow roots
  are unpickable in the core train.

## OpenDesign overlay and capture lifecycle

- donor_behavior_id: `open-design-overlay-capture-v1`
- borrowed behaviors: isolated overlay chrome, click capture, Escape cancellation,
  scroll-aware target refresh, hide-before-capture, and exact active-window screenshot
  semantics.
- donor revision/file/test evidence: OpenDesign
  `4567a0d57557b29eb79ef1f7a40826f2b801d982`;
  `apps/web/src/components/DesignBrowserPanel.tsx` (picker request lifecycle,
  live target refresh, `captureChromeHidden`, and host snapshot wiring);
  `apps/web/src/components/PreviewDrawOverlay.tsx` (isolated overlay, Escape,
  capture-frame geometry, double-animation-frame hiding, and compositor capture);
  `e2e/ui/app-manual-edit.test.ts` (preview screenshot workflow).
- copied destination: none; this is behavioral evidence only.
- Sonik adapter/contract: Agent Embed emits only validated semantic target results;
  `apps/dev-workbench/src/lib/contracts/workbench.ts` owns the bounded snapshot and
  the optional extension remains a pixel provider, never the semantic-target authority.
- state owner and persistence seam: host picker/controller owns hover and selected
  target state; Workbench's authenticated
  `apps/dev-workbench/src/routes/api/workspaces/visual-context/+server.ts` coordinator
  serializes stable manifest/PNG promotion.
- telemetry event(s): `visual_context.picker.started`,
  `visual_context.target.selected`, `visual_context.capture.started`,
  `visual_context.capture.completed`, `visual_context.capture.failed`,
  `visual_context.extension_pairing.changed`.
- host test / ultratest / manual prompt: `tests/unit/agent-embed.test.mjs`,
  `tests/unit/dev-workbench-interactive-protocol.test.mjs`, and the planned
  `pnpm smoke:agent-ui:booking-visual-context` exercise click, Escape, source/route
  invalidation, and capture-chrome exclusion.
- deployed host URL or local route: local Dev Workbench route `/`; exact active-tab
  proof requires the separately gated extension and its recorded paired Booking URL.
- known gaps or deferred scope: OpenDesign's runtime, selectors, editing, annotation,
  and archive flows are not imported. Exact host-tab pixels are optional extension
  scope and must not be claimed by the core release.

## Playwright controlled-preview capture

- donor_behavior_id: `playwright-controlled-preview-v1`
- borrowed behaviors: AI-oriented ARIA snapshot, sensitive-region masking,
  disabled-animation screenshots, and selected-locator screenshots.
- donor revision/file/test evidence: repository-pinned Playwright `1.61.1` in
  `package.json` and `pnpm-lock.yaml`; the implementation contract uses
  `locator.ariaSnapshot()` plus `page.screenshot()`/`locator.screenshot()` options
  `mask`, `animations: "disabled"`, `type: "png"`, and `scale: "css"`.
- copied destination: none; the installed Playwright dependency is used directly.
- Sonik adapter/contract: `apps/dev-workbench/scripts/capture-visual-context.mjs`
  accepts only a sanitized route and stable `data-sonik-target`/instance identity;
  public request/result schemas live in
  `packages/tool-contracts/src/visual-context.ts`.
- state owner and persistence seam: the sandbox command owns request-scoped temporary
  output only; the authenticated Workbench coordinator validates and atomically
  promotes `.sonik/screenshots/latest.png` and `.sonik/visual-context.json`.
- telemetry event(s): `visual_context.capture.started`,
  `visual_context.capture.completed`, `visual_context.capture.failed`,
  `visual_context.result.discarded`, `visual_context.browser_setup.changed`.
- host test / ultratest / manual prompt: planned
  `pnpm smoke:agent-ui:visual-context:sandbox` plus
  `tests/unit/dev-workbench-server.test.mjs` verify fresh navigation, masks, PNG
  metadata/hash, stable-target resolution, and stale-result rejection.
- deployed host URL or local route: controlled Preview at the sanitized route under
  local Dev Workbench `/`; deployed/live-equivalent URL is a release-gate artifact.
- known gaps or deferred scope: controlled-preview fidelity is a fresh Playwright
  session, not the visible iframe's transient state; ephemeral targets fall back to
  viewport capture and arbitrary selector/locator input is forbidden.

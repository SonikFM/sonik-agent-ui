# Booking Agent UI Host Action Receiver v1 — Review + Ultratest Brief

Date: 2026-07-07  
Repos: `sonik-agent-ui`, `sonik-booking-service`  
Booking PR: https://github.com/SonikFM/sonik-booking-service/pull/79  
Environment: Pipe-B booking app + service

## Executive summary

PR #79 merged the booking-side receiver for the Agent UI host-action channel. This is the right architectural seam: Agent UI owns the iframe/runtime and request protocol; Booking owns the trusted host receiver, target registry anchors, and policy-gated execution of UI actions.

The merged booking app is now deployed to Pipe-B. CI is green. The remaining issue is not version skew or missing deployment; it is a small but important policy-hardening follow-up in the host-action receiver.

## What landed

### Booking service / booking app

PR #79 added or updated:

- `packages/sonik-sdk/src/agent-ui-host-action.ts`
  - shared host-action message/receipt contract.
- `packages/sonik-sdk/src/agent-ui.ts`
  - SDK surface for Agent UI embed integration.
- `packages/sonik-sdk/src/agent-ui.test.ts`
  - contract/runtime coverage for the SDK seam.
- `apps/booking/src/lib/booking-platform/agent-ui-host-action.ts`
  - booking host receiver for `sonik.agent_ui.host_action.v1`.
- `apps/booking/src/lib/booking-platform/BookingAgentUiEmbed.svelte`
  - embed wiring into booking shell.
- `apps/booking/src/design-system/templates/BookingPlatformApp.svelte`
  - first `data-sonik-target` anchors.
- `BOOKING-APP-CHANGES.md`
  - local implementation note.

### Capabilities now present

- Versioned postMessage receiver for `sonik.agent_ui.host_action.v1`.
- Origin/version validation before host actions are accepted.
- Typed action receipts instead of silent no-ops.
- Canvas open/close host actions.
- Tour highlight/focus target support via seeded target anchors.
- Approval-preview support without letting chat text mint approvals.
- Honest failure receipts for blocked/unavailable actions.

## Deployment and CI evidence

Collected from GitHub and Wrangler on 2026-07-07.

### PR state

- PR #79 state: `MERGED`
- Merge time: `2026-07-07T14:14:51Z`
- Merge commit: `76f0ae5f51a4a0eac57818b6ed1a751a3c3fea33`
- Booking `origin/main` observed at: `a759c6d`

### Checks

- CodeRabbit: pass / review approved
- Security malware scan: pass
- Demo e2e: pass
- Headless verification: pass

### Pipe-B deployments

`mcp__sonik_dev_testing.worker_deployment_status` reported:

- dev observability worker latest: `695bc5f2-213f-4049-a91f-f5c80d18ce7e`, created `2026-06-22T15:47:38.655Z`
- booking service latest: `52b5562c-45d1-4836-91fe-f25eabff2fd1`, created `2026-07-07T12:55:17.687Z`
- booking app latest: `bf4c52b6-7a0d-41c6-aed0-e14aabb72619`, created `2026-07-07T14:24:19.557Z`

The app deploy occurred after the PR merge time, so the deployed Pipe-B booking app should include the merged host-action receiver work.

## Review finding: policy guard needs one hardening patch

The merged booking receiver currently allows `policy.status === "approval_required"` to pass into the action switch for all host actions:

```ts
if (!policy.ok && policy.status !== "approval_required") {
  return policy;
}

switch (request.actionKey) {
  // canvas.open / canvas.close / tour.highlight / tour.focusTarget / approval.requestPreview
}
```

That makes sense for `approval.requestPreview`, because previewing an approval affordance is the action that should produce an `approval_required` receipt. It is less clean for other actions. A non-preview action that evaluates to `approval_required` can still reach its handler.

### Recommended patch

Only `approval.requestPreview` should proceed when `policy.status === "approval_required"`. Everything else should require `policy.ok === true`.

Target behavior:

```ts
const canPreviewApproval =
  request.actionKey === "approval.requestPreview" &&
  policy.status === "approval_required";

if (!policy.ok && !canPreviewApproval) {
  emit blocked/unavailable telemetry;
  return policy;
}
```

This preserves the intended approval-preview flow while making `ask`/`require` semantics strict for canvas and tour actions.

## What this means for demo readiness

### Good

- The embed channel is no longer stale conceptually.
- Booking now has a real host-owned receiver instead of expecting Agent UI to mutate the host directly.
- We have target anchors and typed receipts, which is the right base for Driver.js-style tours, canvas open/close, and approval preview.
- CI and Pipe-B deployment are green enough to test the user-facing flow now.

### Still needs follow-up

- Patch the `approval_required` passthrough described above.
- Expand the target registry beyond the first four anchors.
- Make approval-preview UX visible and understandable in the embedded chat/canvas flow.
- Keep host approval separate from model/user text approval.
- Use runtime smoke evidence, not deployment existence, before claiming the feature works end-to-end.

## Ultratest scope for this note

Bounded smoke target:

1. Confirm deployed booking Pipe-B app is reachable.
2. Confirm embedded Agent UI does not show missing host context.
3. Confirm page context and target/action descriptors are exposed where available.
4. Confirm fresh Pipe-B deployment evidence exists.
5. Classify result as PASS, FAIL, or INCONCLUSIVE based on browser + runtime evidence.

This write-up intentionally does not mutate booking data.

## Ultratest result — deployed Pipe-B smoke

Run time: 2026-07-07T14:34–14:41Z  
Base URL: `https://sonik-booking-app-pipe-b.liam-trampota.workers.dev`  
Account: `test69@gmail.com`  
Mutation policy: navigation/UI-only; no booking writes.

### Evidence files

Agent UI repo:

- `.omx/logs/booking-host-action-embed-smoke.json`
- `.omx/logs/booking-host-action-embed-smoke-1783435028092.png`
- `.omx/logs/booking-agent-ui-open-smoke.json`
- `.omx/logs/booking-agent-ui-open-smoke-1783435250304.png`

Booking service repo:

- `.omx/logs/mcp-worker-deployments-2026-07-07T14-34-56-066Z.json`
- `.omx/logs/mcp-pipeb-tail-query-2026-07-07T14-41-05-782Z.json`

### What passed

- Booking Pipe-B app was reachable.
- Login with the test account succeeded.
- Final route was `/dashboard` with title `Operations Home · Sonik Booking`.
- `window.__sonikAgentUI.getPageContext()` was present on the host page.
- Host page context reported:
  - `auth.signedIn: true`
  - `auth.hasOrg: true`
  - `theme.active: sonik-operator-dark`
  - selected booking context: `Main Course Tee Sheet`
  - organization id: `179b55fd-179b-77c3-aff1-8a53359b07bf`
- No visible `missing-host-context` message.
- No visible `Internal Error` message.
- No captured same-origin 4xx/5xx network errors during the smoke.
- Pipe-B deployment status could be read for dev-observability, service, and app.

### What failed / stayed inconclusive

#### 1. Agent UI open path failed in scripted smoke

The embedded booking DOM includes the expected controls:

- `#booking-agent-ui-launcher`
- `#booking-agent-ui-open-chat`
- `#booking-agent-ui-sidecar`
- `#booking-agent-ui-canvas`
- `#booking-agent-ui-frame`

But after clicking the launcher and then the explicit open-chat button, the host state still reported:

```json
{
  "mode": "closed",
  "iframeSrc": null,
  "sidecarText": "Sonik Chat Canvas Close  ",
  "canvasText": "Sonik Canvas Full workspace modal Dock chat Close "
}
```

That means the deployed host page has page context, but the browser smoke did not prove that the user-visible launcher opens the embedded Agent UI iframe.

Classification: **FAIL for open-chat UX path**.

#### 2. Host-action receiver execution was not proven

The SDK receiver is correctly guarded: it only accepts action requests from `event.source === iframe.contentWindow` and the mounted Agent UI origin. A top-window synthetic `postMessage` would not be a valid proof.

Because the iframe never opened in the scripted smoke, no Agent UI-originated host-action request was emitted, and the host-action receiver was not exercised live.

Classification: **INCONCLUSIVE for host-action execution**.

#### 3. Runtime introspection gap

The host API exposed these keys:

```json
["actions", "getAssertions", "getEmbedPageContext", "getPageContext"]
```

`getPageContext()` and `getAssertions()` work. However, `getActions()` and `getTargetRegistry()` are not callable methods on `window.__sonikAgentUI`; the action data is nested inside the page context instead.

That is not necessarily a product bug, but it makes route-sweep/test tooling less direct and should be normalized if we want deterministic agent-readability audits.

#### 4. Fresh Pipe-B host-action logs were unavailable

`pipeb_tail_query` searched local tail artifacts for `booking.agent-ui.host-action` and found zero matches. The artifacts it searched were from 2026-06-25, not a live tail from this run. Since no host action reached the receiver, this is expected, but it means runtime log proof is incomplete.

Classification: **INCONCLUSIVE for Pipe-B host-action telemetry**.

## Overall classification

**Result: FAIL / INCONCLUSIVE mix**

- **PASS**: deployed app, auth/org page context, missing-host-context regression check.
- **FAIL**: launcher/open-chat path did not open iframe in the scripted smoke.
- **INCONCLUSIVE**: host-action receiver execution and Pipe-B host-action telemetry, because no Agent UI iframe-originated action was produced.

## Recommended next safe action

1. Fix the booking open-chat wiring first:
   - Confirm `mountBookingAgentUI` attaches click handlers after the controls mount.
   - Confirm `matchingElements()` sees `#booking-agent-ui-open-chat` and `#booking-agent-ui-launcher`.
   - Add a regression test that clicking `#booking-agent-ui-open-chat` changes `.booking-agent-embed[data-mode]` to `chat` and assigns a non-null iframe `src`.
2. After the iframe opens, run a second host-action smoke from inside Agent UI to request:
   - `canvas.open`
   - `tour.highlight` for a mounted `data-sonik-target`
   - `approval.requestPreview` for an approval target
3. Apply the policy-hardening patch:
   - only `approval.requestPreview` should execute its handler when `policy.status === "approval_required"`.
4. Add a direct machine-readable method or explicit page-context field for `hostUiTargetRegistry`, so ultratest can verify available target ids without DOM scraping.


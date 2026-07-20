# Product Requirements

## 1. Product statement

Sonik Dev Workbench is a developer mode for Agent UI. It embeds a real, repository-aware Codex CLI session into the product while preserving Sonik's host context, evidence, security, and approval model.

It must work in two forms:

- **Embedded:** launched from the Agent UI speed dial on Booking first and Amplify later. It replaces the right-side chat when no canvas is active and occupies the side rail beside an active canvas.
- **Standalone:** a full Workbench application for setup, recovery, larger investigations, and direct sandbox operation.

Both forms attach to the same workspace/run rather than creating separate histories or sandboxes.

## 2. Primary user

A trusted Sonik developer or operator who needs to:

- reproduce a problem in the live host UI;
- give Codex the relevant page, element, screenshot, route, and repository context;
- inspect logs, network failures, source, diffs, tests, and preview state;
- edit the repository and observe hot reload;
- validate a fix; and
- explicitly approve a deployment or other consequential action.

This is developer tooling, not a general customer-facing terminal.

## 3. Core journeys

### 3.1 Open Dev mode from Booking

1. The authenticated user opens Agent UI in Booking.
2. The speed dial exposes Chat, Canvas, and Dev according to capability and authorization.
3. Choosing Dev opens or resumes the repository workspace without replacing the whole page unexpectedly.
4. A compact progress state explains repository checkout, dependency install, Codex authentication state, preview startup, host-context connection, and logs connection.
5. The terminal opens into the configured `tmux` session.
6. The surrounding shell shows the active repository/revision, host surface, context freshness, preview state, and current capabilities.

### 3.2 Send page context to Codex

1. The developer chooses a source: the controlled Preview or the connected host (Booking; Amplify later).
2. The developer can sync the sanitized page snapshot, pick an element, or capture an image.
3. The UI explains fidelity and any boundary: controlled preview, semantic host selection, or exact active-tab pixels.
4. The stable manifest is written under `.sonik` in the sandbox.
5. Codex is told that new context is available and can read the manifest/image on demand.
6. Source or route changes invalidate stale context visibly and atomically.

### 3.3 Diagnose and repair

1. The developer reproduces a failure in Booking or the preview.
2. Workbench correlates page/element context with console, failed requests, Pipe B/realtime events, source files, and recent changes.
3. Codex edits source in the sandbox repository.
4. The hot server reloads; the preview shows the change.
5. The developer captures updated context or repeats the host journey.
6. Codex runs targeted tests and reports evidence, not only prose.

### 3.4 Publish safely

1. Workbench shows the diff, branch/revision, verification status, and intended target.
2. Publishing is unavailable unless the workspace has an authorized, scoped provider capability.
3. The developer explicitly approves the consequential action.
4. Sonik records the command, result, provider request ID, and deployment URL/status.
5. A failed or expired capability produces a recoverable state and never silently falls back to broader credentials.

## 4. Functional requirements

### 4.1 Workspace and repository

| ID | Requirement | Priority |
|---|---|---|
| WS-01 | Run Codex, source code, build tools, `tmux`, and the development server in an isolated Vercel Sandbox—not in a Cloudflare Worker. | P0 |
| WS-02 | Clone only a server-configured repository/revision. Browser input must not select arbitrary Git URLs or commands. | P0 |
| WS-03 | Expose repository root, revision, branch, dirty state, sitemap, and bootstrap status to the operator and Codex. | P0 |
| WS-04 | Run the real Codex CLI inside `tmux`; do not recreate Codex as a chat imitation. | P0 |
| WS-05 | Provide at least `codex`, `dev`, `shell`, and `logs` tmux windows with discoverable names and startup state. | P0 |
| WS-06 | Start a hot development server and expose a signed/expiring preview URL. | P0 |
| WS-07 | Permit source edits, build, targeted tests, lint/typecheck, and repository inspection inside the sandbox. | P0 |
| WS-08 | Reconnect the browser to an existing live workspace/run after refresh or transport interruption. | P0 |
| WS-09 | Distinguish sandbox suspension/resume from deletion. Do not imply that a deleted sandbox preserves files, tmux, or CLI login. | P0 |
| WS-10 | Provide an explicit, secure credential persistence strategy if Codex authentication must survive teardown. | P1 |
| WS-11 | Support a backend-aware local stack when required; until then, label API calls as targeting a deployed backend. | P1 |

### 4.2 Embedded layout and navigation

| ID | Requirement | Priority |
|---|---|---|
| UI-01 | Booking exposes Dev as the third authorized speed-dial action alongside Chat and Canvas. | P0 |
| UI-02 | With no canvas, Dev replaces the right-side chat. With a canvas, Dev occupies a resizable side rail rather than covering the whole workspace. | P0 |
| UI-03 | Support right, bottom, and fullscreen terminal layouts plus width/height resizing. | P0 |
| UI-04 | Keep the terminal maximally usable while retaining a compact, reachable command strip for source, context, layout, status, and overflow actions. | P0 |
| UI-05 | Reduce tall headers, top margins, duplicate labels, and button sprawl. Secondary commands belong in a menu rather than disappearing. | P0 |
| UI-06 | Loading states explain the current step, elapsed time, likely next step, and actionable failure. | P0 |
| UI-07 | Standalone and embedded modes use the same capability model and workspace identity. | P1 |
| UI-08 | Keyboard navigation, focus restoration, status announcements, contrast, target size, and reduced-motion behavior meet Sonik accessibility standards. | P0 |

### 4.3 Host identity, authentication, and context

| ID | Requirement | Priority |
|---|---|---|
| HC-01 | Booking passes an authenticated, server-derived host-session attachment to Agent UI and Dev Workbench. | P0 |
| HC-02 | The Workbench displays independently: host connected, page context current, signed authority available, and tool/provider readiness. | P0 |
| HC-03 | Browser page context is sanitized evidence only; it cannot grant scopes or replace server-verified authority. | P0 |
| HC-04 | Startup writes sanitized page, sitemap, and OpenAPI/command context to documented sandbox paths. Current host authority is browser-relayed and server-consumed for the OpenAPI fetch; it never enters the guest sandbox or sanitized artifact namespace. | P0 |
| HC-05 | Context refreshes or invalidates on host navigation, workspace change, source change, and session expiry. | P0 |
| HC-06 | Errors explain the failing layer: embed origin, host relay, session attachment, provider/tool scope, or backend availability. | P0 |
| HC-07 | Amplify can adopt the same neutral host bridge without forking the Agent UI/Workbench contract. | P1 |

### 4.4 Visual page context

| ID | Requirement | Priority |
|---|---|---|
| VC-01 | Expose a capability-discovered source selector. Standalone shows Preview; embedded Booking defaults to the connected host while retaining Preview. | P0 |
| VC-02 | Provide an explicit read-only element picker with hover outline, semantic label, click to select, Escape to cancel, and guaranteed cleanup. | P0 |
| VC-03 | Stable `data-sonik-target` identities win; ephemeral targets remain bounded and never expose CSS/XPath, raw HTML, values, IDs/classes, or unrestricted text. | P0 |
| VC-04 | Provide one-click screenshot/context capture from the visible Workbench controls. | P0 |
| VC-05 | Preview capture uses Playwright against a deterministic fresh sandbox preview and is labeled `controlled-preview`. | P0 |
| VC-06 | Host semantic selection works without a browser extension. Exact host pixels are unavailable unless a secure active-tab provider is paired. | P0 |
| VC-07 | If exact active-tab capture ships, pairing is explicit and short-lived; origin/tab/revision/nonce checks and mandatory redaction or fail-closed behavior are enforced. | P1 |
| VC-08 | Persist one current or invalidated `.sonik/visual-context.json` and a hash-matched `.sonik/screenshots/latest.png`; stale results cannot become current. | P0 |
| VC-09 | Mask password, payment, token, configured sensitive, and cross-origin regions; sanitize route query/hash and ARIA/accessibility text independently. | P0 |
| VC-10 | Tell Codex when context changes and provide `SONIK_VISUAL_CONTEXT_PATH`; do not inject image bytes into every prompt. | P0 |
| VC-11 | Report unpickable cross-origin frames and closed shadow roots honestly rather than weakening isolation. | P0 |
| VC-12 | Add source-file mapping only after target/context reliability; mappings must carry confidence and allow correction. | P2 |

### 4.5 Evidence and observability

| ID | Requirement | Priority |
|---|---|---|
| OB-01 | Surface live process/run state as normalized events, separate from raw terminal bytes. | P0 |
| OB-02 | Show changed files and an inspectable diff. | P1 |
| OB-03 | Show application console entries and failed network requests with timestamps and source/correlation metadata. | P1 |
| OB-04 | Make Pipe B/realtime-egress events available automatically in the workspace, with a usable absent/unconfigured state. | P1 |
| OB-05 | Link verification claims to raw command/test evidence. | P0 |
| OB-06 | Provide preview health/restart controls and show whether the server is booting, healthy, failed, or stale. | P0 |
| OB-07 | Preserve a resumable event cursor so refresh/reconnect does not lose run state. | P1 |
| OB-08 | Chrome DevTools/CDP-style console, network, DOM, and performance access is an advanced integration, not implied by a screenshot feature. | P2 |

### 4.6 Tools, MCP, and deployment

| ID | Requirement | Priority |
|---|---|---|
| TL-01 | Show only tools currently executable for the active organization, host session, provider, environment, and scopes. | P0 |
| TL-02 | Explain unavailable tools with a concrete missing capability or scope. Selectable-looking dead commands are prohibited. | P0 |
| TL-03 | Make Booking's OpenAPI and command catalog discoverable to Codex at workspace startup. | P0 |
| TL-04 | Add an MCP surface for full typed tool calling after the basic terminal/context path is reliable. | P1 |
| TL-05 | Route tool execution through Sonik's authority gateway; model-native approval is not organizational authorization. | P0 |
| TL-06 | Support build/test immediately; support commit, push, migration, and deploy only through explicit scoped capability and approval. | P1 |
| TL-07 | Record provider request IDs, results, and deployment targets for consequential actions. | P1 |

## 5. Non-functional requirements

### Security and privacy

- Exact origin and message source checks on every cross-window exchange.
- Short-lived terminal connection tokens; no PTY byte proxy through a Worker.
- No cookies, bearer tokens, signed host authority, environment secrets, raw HTML, selectors, or screenshot bytes in telemetry.
- Workbench requires HTTPS authentication and remains disabled by default.
- Repository and command configuration is server-owned.
- Screenshot operations are explicit gestures and bounded by size, dimensions, revision, hash, provider, and workspace identity.
- Credential restoration, if implemented, uses a tenant-scoped encrypted secret provider—not a committed file, screenshot, or public `.sonik` context file.

### Reliability

- Every pending action has timeout, cancel, stale-result, reconnect, and cleanup behavior.
- Workspace creation is idempotent for a workspace identity.
- A transport reconnect cannot create a second conflicting terminal or run silently.
- Stable manifest/PNG promotion is atomic and serialized.
- A failed capture, tool call, or deploy leaves the previous valid state clearly current or explicitly invalidated.

### Performance

- Terminal input remains direct and low-latency.
- Heavy browser capture runs in the sandbox or companion extension, not the embedding product worker.
- Context payloads are bounded; screenshots and ARIA are not appended to every model turn.
- The embedded shell must remain usable at narrow sidebar widths.

### Accessibility

- All controls are keyboard operable and named.
- Escape cancels picker/capture modes and restores focus.
- Loading, connection, success, stale, and failure states are announced without excessive verbosity.
- Picker overlay is visible under high contrast and does not trap editing or text selection.
- Resizers expose semantics and keyboard alternatives.

## 6. Explicit boundaries

### Required for the first product-complete release

- Embedded Booking Dev entry and authenticated host context.
- Real Codex/tmux terminal with reconnect.
- Resizable embedded layouts with compact reachable controls.
- Preview and Booking source switching.
- Booking semantic element picker.
- Controlled-preview screenshot and context manifest.
- Automatic Codex notification/path for updated context.
- Honest capabilities, logs state, hot preview health, and verification evidence.

### Required eventually, but may follow the first release

- Exact active-tab browser extension.
- Realtime egress event feed, live console/network/changed-files panels.
- MCP and Booking tool execution.
- Credential-backed commit/push/deploy.
- Amplify adoption.
- Teardown-surviving Codex authentication.

### Not implied by the current implementation

- Chrome DevTools access.
- A full local production backend.
- Automatic deployment.
- Durable workflow-agent orchestration.
- Exact reconstruction of the user's live host page through remote Playwright.
- Reliable element-to-source mapping.

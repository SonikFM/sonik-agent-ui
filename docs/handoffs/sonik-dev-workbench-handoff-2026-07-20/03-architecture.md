# Architecture

## 1. Existing system

```mermaid
flowchart LR
  U[Developer] --> B[Booking host]
  B --> AE[Agent UI embed]
  AE -->|signed host context + sanitized page context| W[Dev Workbench iframe]
  W -->|authenticated server routes| WS[Workspace service]
  WS --> VS[Vercel Sandbox]
  W -->|short-lived interactive URL| PTY[Vercel PTY]
  PTY --> TM[tmux]
  TM --> CX[Codex CLI]
  TM --> DEV[hot dev server]
  TM --> LOG[logs shell]
  DEV --> PREVIEW[signed preview]
  WS --> SONIK[.sonik context artifacts]
  CX --> SONIK

  B -. semantic picker relay .-> W
  WS -. controlled Playwright capture .-> PREVIEW
  EXT[Optional Chrome extension] -. active-tab pixels; currently disabled .-> W
```

### Existing ownership

- **Booking host:** user/session authority, current route, host DOM, semantic target registry, and host action adapter.
- **Agent UI embed:** product-neutral cross-origin bridge, layout/launcher integration, and bounded context transport.
- **Dev Workbench browser:** operator controls, terminal presentation, capability/status view, and explicit context requests.
- **Workbench server:** Basic Auth, workspace identity, sandbox provider calls, artifact coordination, and server-owned configuration.
- **Vercel Sandbox:** repository, filesystem, tmux, Codex CLI, development server, commands, and private `.sonik` artifacts.
- **Optional extension:** exact active-tab pixels only. It must not become target authority or a broad browsing agent.

## 2. Target system

```mermaid
flowchart TB
  subgraph Host[Host product: Booking / Amplify]
    UI[Visible product UI]
    AUTH[Server-verified host session]
    REG[Semantic target registry]
    SNAP[Sanitized page snapshot]
  end

  subgraph AgentUI[Agent UI]
    LAUNCH[Chat / Canvas / Dev launcher]
    RELAY[Typed host-context and visual relay]
  end

  subgraph Workbench[Dev Workbench control plane]
    SHELL[Compact terminal + evidence shell]
    CAP[Capability readiness]
    ART[Artifact coordinator]
    EVENTS[Normalized event consumer]
    APPROVE[Approval UI]
  end

  subgraph Runtime[Vercel Sandbox execution plane]
    REPO[Repository + sitemap]
    TMUX[tmux + Codex CLI]
    SERVER[Hot development server]
    PLAY[Playwright controlled preview]
    CONTEXT[.sonik manifests]
    TOOLS[MCP / typed CLI adapters]
  end

  subgraph Sonik[Sonik service plane]
    GW[Authority gateway]
    JOURNAL[Run/event journal]
    RT[Realtime egress]
    DEPLOY[Scoped Git/deploy providers]
  end

  subgraph Browser[Optional browser privilege]
    EXT[Action-paired active-tab extension]
  end

  LAUNCH --> SHELL
  UI --> REG
  UI --> SNAP
  AUTH --> RELAY
  REG --> RELAY
  SNAP --> RELAY
  RELAY --> SHELL
  SHELL --> ART
  ART --> CONTEXT
  SHELL --> TMUX
  TMUX --> REPO
  TMUX --> SERVER
  PLAY --> SERVER
  PLAY --> ART
  CONTEXT --> TMUX
  TMUX --> TOOLS
  TOOLS --> GW
  GW --> DEPLOY
  GW --> JOURNAL
  JOURNAL --> RT
  RT --> EVENTS
  APPROVE --> GW
  EXT -. redacted pixels .-> ART
```

## 3. Required seams

### 3.1 Workspace attachment

```ts
type WorkspaceAttachment = {
  workspaceId: string;
  provider: "vercel-sandbox";
  repository: { slug: string; revision: string; root: string };
  tmuxSession: string;
  preview: { status: "booting" | "ready" | "failed"; url?: string };
  contextPaths: {
    page: string;
    visual: string;
    hostAuthority: string;
    sitemap: string;
    commandCatalog: string;
  };
  resumableCursor?: string;
};
```

This is data, not a live SDK object. Provider clients are reconstructed on the server.

### 3.2 Capability readiness

Availability must be computed at runtime rather than inferred from catalog membership.

```ts
type CapabilityReadiness = {
  id: string;
  state: "ready" | "unavailable" | "expired" | "approval-required" | "degraded";
  reason?: string;
  source: "host" | "sandbox" | "provider" | "organization-policy";
  scopes: string[];
  checkedAt: string;
};
```

The same structure should drive buttons, Codex context, tool discovery, and diagnostics.

### 3.3 Normalized runtime events

Terminal bytes remain on the direct PTY connection. Product state uses bounded events:

```ts
type WorkbenchEvent = {
  id: string;
  workspaceId: string;
  sequence: number;
  at: string;
  kind:
    | "workspace.phase"
    | "process.output"
    | "file.changed"
    | "preview.status"
    | "network.failed"
    | "verification.result"
    | "context.updated"
    | "tool.started"
    | "tool.finished"
    | "approval.requested"
    | "deployment.status";
  correlationId?: string;
  payload: unknown; // kind-specific, bounded schema
};
```

Realtime egress transports these events and cursors; it does not proxy the terminal.

## 4. Page-context flow

```mermaid
sequenceDiagram
  actor D as Developer
  participant W as Workbench
  participant H as Booking host bridge
  participant R as Host target registry
  participant A as Artifact coordinator
  participant S as Sandbox .sonik
  participant C as Codex/tmux

  D->>W: Choose Host and Pick element
  W->>H: signed-origin pick request + revisions
  H->>R: start read-only picker
  D->>R: click visible element
  R-->>H: semantic target + sanitized descriptor + bounds
  H-->>W: typed result + matching revisions
  W->>A: promote sanitized selection
  A->>S: atomically write visual-context.json
  A-->>W: current generation/hash
  W->>C: notify context.updated(path, generation)
  C->>S: read manifest/image on demand
```

### Rules

- Host owns DOM resolution and semantic identity.
- Public transport contains no raw selector, `outerHTML`, value, credential, or unrestricted text.
- A source/route revision change cancels pending work and invalidates the stable artifact.
- Codex receives a path and generation notification, not automatic image injection.

## 5. Screenshot providers

| Provider | Source | Fidelity | Trust boundary | Release state |
|---|---|---|---|---|
| Playwright | sandbox hot preview | `controlled-preview` | authenticated Workbench server + sandbox | Required P0 |
| Chrome extension | actual active host tab | `exact-active-tab` after declared redaction | explicit browser action + tab/origin/revision attestation | Optional P1; disabled until proven |
| Host iframe alone | embedding top-level tab | none | browser isolation prevents exact pixels | Must report unavailable |

Remote Playwright cannot truthfully reproduce transient cookie-backed host state. A DOM-to-image runtime is not approved for injection into every host.

## 6. Host authority and tools

```mermaid
sequenceDiagram
  participant C as Codex in sandbox
  participant M as MCP / typed CLI adapter
  participant G as Sonik authority gateway
  participant H as Host service
  participant J as Run journal
  participant W as Workbench

  C->>M: discover capability / request tool
  M->>G: workspace + host-session attachment + typed input
  G->>G: validate tenant, user, scope, effect, expiry
  alt read and authorized
    G->>H: execute
  else consequential action
    G-->>W: approval.requested
    W->>G: explicit approve/deny
    G->>H: execute only if approved
  end
  H-->>G: typed result + provider request ID
  G->>J: append outcome
  G-->>M: bounded result
  M-->>C: tool result
```

The guest receives no reusable production bearer credential. MCP is a discoverability/execution protocol, not the authority boundary.

## 7. Deployment topology

| Component | Appropriate runtime | Reason |
|---|---|---|
| Booking/Amplify host | existing app/Worker deployment | Owns authenticated product state and host registry. |
| Agent UI embed | package/assets served by host or Agent UI deployment | Cross-product visual and host relay. |
| Workbench control plane | Vercel SvelteKit deployment | Authenticated routes and Vercel Sandbox provider integration. |
| Codex/repository/dev server | Vercel Sandbox | Full process/filesystem workload and isolation. |
| Terminal stream | direct Vercel interactive WebSocket | Avoids Worker/function byte proxy and latency. |
| Normalized run events | realtime-egress / Sonik service | Durable cursor, fan-out, and observability. |
| Tool/deploy authority | Sonik server gateway | Tenant, scope, approval, audit, and credential custody. |

A Cloudflare Worker may broker short API calls and authority, but it should not run the full Codex process, repository checkout, tmux, or hot server.

## 8. UI architecture

The embedded terminal needs a persistent compact shell, not the current binary choice between “full dashboard” and “terminal with every control hidden.”

Recommended regions:

1. **Compact command strip:** source, sync, pick, capture, layout, connection indicator, overflow.
2. **Terminal body:** full xterm surface with correct resize propagation.
3. **Collapsible evidence tray:** context, problems, changed files/diff, console, failed requests, verification, approvals.
4. **Progress overlay:** workspace bootstrap phases and recovery actions.

At narrow width, controls collapse into labeled menus but remain keyboard reachable. Fullscreen removes host chrome, not Workbench capability access.

## 9. Deliberate exclusions

- No second workflow engine alongside Sonik's run/event journal.
- No generic provider abstraction until a second provider proves the seam.
- No provider-specific raw event shapes in product UI.
- No global tool catalog represented as live availability.
- No background browsing or continuous screenshot recording.
- No separate chat/history backend for web, terminal, voice, or WhatsApp.

# toolPolicy Enforcement Plan — 2026-07-07 (execute-only morning slice)

Status: PLANNED. Do not start until the demo is behind us. The agent-eval harness (`scripts/agent-eval-gate.mjs`, verified 2/2 PASS on deploy `e54e4e0b`) is the regression net; run it before AND after.

## The real gap (verified against HEAD `c9011e4`, not the audit summary)

Three permission layers exist today; only 1.5 are enforced:

| Layer | Source | Granularity | Enforced today? |
|---|---|---|---|
| Host-signed `approvedCommandIds` | embed handshake (`HostSessionEnvelope.metadata`) | per-command, per-session | **YES** — `evaluateCommandPolicy` (`tool-contracts/src/index.ts:1276-1303`): `approval_required` unless `context.approved`, plus destructive/auth/scope/runtime checks. This is the real gate and it works. |
| Agent Settings `toolPermissionModes` | `agent-settings.ts:50,237-246` | per-**family** (`off\|ask\|allow`) | **HALF** — `off` is enforced in `command-catalog.ts` (filtered from search `:51`, `assertToolFamilyEnabled` throws pre-execute/commit `:97,136`). **`ask` is telemetry-only** (`toolPermissionMode` stamped on receipts, no runtime effect). |
| Template `permissionDefaults` | `agent-workflows/templates.ts` (per-command `off\|ask\|allow`) | per-command, per-template | **NO** — connected to nothing. Cosmetic coloring on preview steps only. |

Additional hole found: **`commitActiveIntakeCommand` (`tools/artifact-state.ts:323-399`) never applies family modes at all** — zero `toolPermissionModes` references in that file. Even a family set to `off` in Agent Settings does not block the intake commit path (only the host grant does).

## Design

One resolution function, one enforcement point, layered semantics. **Absence of any policy input = today's behavior exactly** (pure-additive; zero regression for existing flows).

### 1. `resolveEffectiveToolPolicy` (new, in `packages/tool-contracts`)

```ts
type ToolPolicyMode = "off" | "ask" | "allow";
type ToolPolicyInput = {
  familyModes?: Record<string, ToolPolicyMode>;          // Agent Settings (family)
  commandModes?: Record<string, ToolPolicyMode>;         // template/install permissionDefaults (per-command)
};
// most-restrictive-wins: off > ask > allow; undefined layers are skipped
function resolveEffectiveToolPolicy(command: CommandDescriptor, input?: ToolPolicyInput): ToolPolicyMode
```

Per-command mode looked up by `command.id`; family mode by `command.familyId`. `off` beats `ask` beats `allow`. No input → `"allow"` (today's behavior).

### 2. Enforcement in `evaluateCommandPolicy`

Add optional `toolPolicy?: ToolPolicyInput` to `CommandExecutionContext`. New checks (inserted alongside existing reason pushes):

- effective `off` → push `tool_policy_off` → decision `deny`.
- effective `ask` AND `context.approved !== true` → push `tool_policy_requires_approval` → decision `needs_approval` (reuse the existing needs_approval bucketing at `:1301-1303`; extend the `reasons.every(...)` allowlist to include `tool_policy_requires_approval`).
- effective `allow` → no new reason (host-grant and all existing checks still apply — this layer can only tighten, never loosen).

`needs_approval` routes into the SAME trusted affordance that exists today (preview → host grant → `confirmation="APPROVE_AND_RUN"` → commit). No new approval UI needed.

### 3. Thread the inputs (3 call sites)

1. `command-catalog.ts` execute/commit: pass `toolPolicy: { familyModes: context.toolPermissionModes }` into the execution context; DELETE nothing — `assertToolFamilyEnabled` stays as a fast-fail (its throw message is already user-visible), enforcement just becomes double-covered.
2. `artifact-state.ts` `commitActiveIntakeCommand`: accept `toolPermissionModes` in its context (wire from `agent.ts:104`'s existing `context.agentSettings?.toolPermissionModes` — NOTE: `agent.ts` is the marketplace lane's uncommitted file; coordinate the one-line threading or land after their commit) and pass `toolPolicy.familyModes` into `executeHostCatalogCommand`'s execution context. Closes the intake-path hole.
3. Marketplace install path (LATER, their lane): on install, template `permissionDefaults` → persisted per-command modes → passed as `toolPolicy.commandModes`. Out of scope for this slice; the parameter exists for them.

### 4. Telemetry

Receipts already stamp `toolPermissionMode`; add `effectiveToolPolicy` + `toolPolicyReasons` so ask/off decisions are auditable and the eval harness can assert on them.

## Test list (write FIRST, red→green)

New `tests/unit/tool-policy-enforcement.test.mjs`:
1. No policy input → decisions identical to today for: mounted read execute, approved commit, unapproved commit (golden parity with existing `evaluateCommandPolicy` cases).
2. Family `off` → deny with `tool_policy_off`, even when commandId IS in approvedCommandIds (most-restrictive-wins proof).
3. Per-command `ask` + `approved: false` → `needs_approval` with `tool_policy_requires_approval`.
4. Per-command `ask` + `approved: true` → allow (approval satisfies ask).
5. Family `allow` + command `off` → deny (per-command more restrictive wins).
6. Family `ask` + command `allow` → ask (most-restrictive-wins across layers).
7. Effective `allow` grants nothing extra: unapproved required-approval commit still `needs_approval`.

Update `tests/unit/trusted-intake-controller.test.mjs` / `intake-command-execution-seam.test.mjs`:
8. `commitActiveIntakeCommand` with family `off` → refused (closes the hole).
9. Existing commit happy path with no modes → unchanged (regression).

Gates before merge: `pnpm check-types && pnpm test && pnpm build`, then `node scripts/agent-eval-gate.mjs` live (2/2 PASS required), then the manual approve→commit walkthrough once (or the smoke, if the sonik-sdk host-controller port has landed).

## Sequencing / risk notes

- Do NOT touch `agent.ts` until the marketplace lane commits or hands over — the one-line threading (call site 2) is the only contested edit; everything else is in tool-contracts + artifact-state + command-catalog.
- The demo flow (`booking.create.context` commit) runs with no `commandModes` and family modes defaulting to `ask`-stamped-but-allow behavior — after this change, if Agent Settings marks `booking` family as `ask`, the commit will REQUIRE the approval affordance. That is the intended behavior change; verify the default family mode for `booking` in `agent-settings.ts:237` (`defaultToolModes`) before shipping and decide the default deliberately.
- Rollback: the entire feature is behind "did anyone pass `toolPolicy`" — reverting call-site threading restores today's behavior without touching the policy engine.

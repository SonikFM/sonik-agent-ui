# Sonik MCP Architectural Doctrine: Dynamic CLI + Channel Parity

**Status:** startup doctrine for agents working in `sonik-mcp`  
**Last updated:** 2026-05-23  
**Audience:** Codex/Claude/ChatGPT agents, human maintainers, and future slice planners

## Executive doctrine

Sonik MCP is **not** a flat list of API-wrapper tools. It is a dynamic command OS: a shared command kernel projected into MCP, CLI, native MCP App iframes, Svelte surfaces, tests, and future A2A routes. The durable product contract is the command descriptor and `CommandReceipt`; MCP is one projection of that contract, not the architecture itself.

Every agent should begin with this model:

```txt
user intent
  -> dynamic command menu
  -> learn/describe the relevant command
  -> execute or explicitly commit
  -> compact receipt + handles
  -> optional native iframe/resource
  -> agent-visible markdown state summary
```

The rich iframe and the agent transcript are two renderings of the same action contract. The user may see a full Sonik Pulse app; the agent should see the compressed markdown equivalent: the state, selected option, available actions, policy boundary, and next step in as few words as possible. The agent should not receive repeated CSS, private hydration blobs, raw secrets, or unbounded JSON just to understand what the user sees.

## The four channels

All Sonik commerce work must preserve channel-parity intent across the channels it implements. If a slice intentionally gates a capability to only some channels, the docs and tests must say which renderings are implemented, which are blocked or fallback-only, and what evidence proves that boundary.

| Channel | Role | Expected representation |
|---|---|---|
| Native iframe / MCP App | Rich user UI | Full visual app, app bridge callbacks, accessibility labels, no direct Sonik API calls from the component. |
| Agent stream | Reasoning/control UI | Concise text summary: selected event/tier, totals, auth/reservation state, visible actions, errors, and next steps. |
| MCP projection | Host integration | Tiny generic verbs over the dynamic catalog; read/write separation; structured payloads and component resources. |
| Internal CLI | Developer/power-user UI | Friendly command summaries by default; `--json` for full receipts; same command kernel as MCP. |

Parity does **not** mean each channel receives identical bytes. It means every channel exposes the same product action, authorization boundary, state transition, and recovery information in the form that channel can use.

## Dynamic CLI law

The agent is a power user of a dynamic CLI, not a developer composing arbitrary REST calls.

1. **The command catalog is the menu.** Agents should dynamically enumerate/search commands instead of relying on stale hardcoded operations.
2. **`learn` is the man page.** A command description must be readable enough for an agent to call it without guessing schemas.
3. **`execute` is for read/non-mutating work.** Preview, search, availability, tier changes, and app-state deltas stay read-only.
4. **`commit` is for explicit mutations only.** Real writes require policy, confirmation, idempotency/replay protection, and no secret leakage.
5. **Handles carry large or stateful data.** Do not re-ship full event/tier/app models on every micro-action when a handle can preserve state.
6. **Every command result teaches the next safe move.** Use `nextActions` structurally and concise text hints conversationally.

"Dynamic CLI" names the command-kernel interaction model. The current `sonik` binary may expose friendly domain shortcuts, but those shortcuts must remain thin projections over descriptors/receipts. Add generic CLI catalog/learn/execute/commit commands only when CLI parity requires full dynamic discovery.

## Channel-parity acceptance test

For any new command, surface, or slice, ask:

1. What user action is this command enabling?
2. What does the iframe show for that action?
3. What does the agent-visible text say in ten useful words per element?
4. What does the CLI print without `--json`?
5. What does MCP return in `structuredContent`, transcript `content`, component-only metadata/resource payloads, and handles?
6. Is the same policy decision, auth state, boundary copy, and error/recovery path visible in every appropriate channel?
7. Are secrets, raw cookies, payment data, and private hydration data excluded from user/agent-visible text? Are confirmation tokens kept out of chat-visible text/fallback HTML/logs/docs and only crossed through documented tool/app boundaries when required?

If the iframe can act but the agent cannot tell what happened, parity is incomplete. If the agent can see full CSS/HTML that it cannot use, context shaping is wrong. If CLI/MCP/Svelte each implement business logic independently, the command OS contract has drifted.

## Token and context doctrine

Token efficiency is an architecture property, not cosmetic cleanup.

- The iframe needs full HTML/CSS/JS resources; the agent usually needs a compact state summary.
- Tool results should prefer concise transcript `content` plus bounded `structuredContent`; large component hydration should move through handles or component-only metadata where the host supports it.
- Micro-actions should return deltas and handles, not the full event and tier list.
- Repeated static assets, CSS foundations, and private app state should not be streamed into the agent transcript as default reasoning context.
- Compactness is only valid if it preserves enough state for the agent to reason: selected tier, total, availability/user ownership, auth status, allowed actions, policy boundary, and errors.

## Policy and transaction doctrine

Sonik MCP may demonstrate commerce, but transaction authority is deliberately narrow.

- No raw payment-card data belongs in this repo or transcript.
- Paid checkout/payment/order/provider mutation/account linking requires explicit policy, idempotency, auth/account-linking, reviewed demo profiles, and host-term review.
- Public/directory connector modes must not execute financial transactions.
- Free local-api reservation is the first mutation path: it requires auth, zero-total evaluation, explicit confirmation, one-time token, replay protection, and redacted transaction proof.
- `sonik_command_commit` is not user consent by itself. Mutation authority requires server-side policy allow, an explicit confirmation artifact such as a one-time token, host/user confirmation where applicable, replay protection, and redacted proof.
- Future paid flows should prefer Sonik-owned checkout handoff unless host policy and explicit consent allow a stronger in-host path.

## Source-backed platform guidance

This doctrine follows the current platform split between model-readable tool results and component/resource hydration:

- MCP tools are model-controlled functions whose definitions include names, descriptions, schemas, output schemas, and annotations; annotations such as `readOnlyHint`, `destructiveHint`, and `idempotentHint` are hints, not security boundaries. Sonik must enforce policy server-side. Source: MCP specification, Tools and ToolAnnotations (`https://modelcontextprotocol.io/specification/2025-06-18/server/tools`, `https://modelcontextprotocol.io/specification/2025-06-18/schema`).
- MCP resources are application-controlled context distinct from tools. Sonik surfaces should therefore be resources/app payloads, not business-logic owners. Source: MCP Resources (`https://modelcontextprotocol.io/specification/2025-06-18/server/resources`) and MCP architecture (`https://modelcontextprotocol.io/specification/2025-06-18/architecture`).
- OpenAI Apps SDK tool results separate transcript-visible `structuredContent`/`content` from component-only `_meta`; only `structuredContent` and `content` are visible to the model transcript. Sonik should put concise agent state in transcript-visible fields and component-only/private hydration in component channels. Source: OpenAI Apps SDK reference (`https://developers.openai.com/apps-sdk/reference`).
- OpenAI Apps guidance recommends concise structured content because the model reads it, and recommends separating data-fetching tools from render tools so the model can reason on data while components render rich UI. Source: OpenAI Apps SDK component/resource guidance (`https://developers.openai.com/apps-sdk/build/chatgpt-ui`).
- OpenAI metadata guidance treats tool names, descriptions, and parameters as product copy and recommends constrained enums and evaluation against golden prompts. Sonik command and meta-tool descriptions should therefore be written as user/agent-facing CLI language, not internal adapter jargon. Source: OpenAI Apps SDK metadata optimization (`https://developers.openai.com/apps-sdk/guides/optimize-metadata`).

## Startup checklist for future agents

Before changing Sonik MCP, gather context in this order:

1. Read `AGENTS.md` and this doctrine.
2. Inspect the relevant command descriptor(s) in `packages/sonik-adapter` and shared types in `packages/command-kernel`.
3. Inspect MCP projection text/structured/resource behavior in `packages/mcp-projection`.
4. Inspect CLI projection in `packages/cli` when command UX changes.
5. Inspect Svelte/native app/resource rendering in `packages/ui-surfaces` and `apps/mcp-server/mcp-app` when user-visible behavior changes.
6. Check parity tests (`tests/parity`) and resource/e2e tests (`tests/e2e`).
7. Verify with the smallest focused gate, then broader gates before claiming completion.

## Non-negotiable invariant

**One command contract, four renderings.**

If a future slice makes the iframe, agent transcript, MCP receipt, or CLI summary tell materially different stories about the same Sonik action, stop and repair the contract before adding more features.

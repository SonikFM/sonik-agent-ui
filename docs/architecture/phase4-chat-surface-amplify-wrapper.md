# Phase 4 chat-surface Amplify wrapper seam

Phase 4 replaces the page-owned chat chrome with `@sonik-agent-ui/chat-surface` components while preserving the copied JSON-render stream loop, inline artifact rendering, and workspace artifact pane.

## Scope delivered

| Area | Files | Treatment |
| --- | --- | --- |
| Pre-change baseline | `.omx/ultragoal/evidence/phase4-prechange-baseline.txt` | Ran the existing full verification before changing chat chrome. |
| Amplify donor copy | `packages/chat-surface/src/vendor/amplify-chat/*` | Copied selected MIT Amplify Svelte chat primitives by filesystem copy: `Conversation`, `Message`, `PromptInput`, plus shared `constants.ts`, `types.ts`, and `utils.ts`. |
| Wrapper components | `packages/chat-surface/src/components/AgentConversation.svelte`, `AgentMessage.svelte`, `AgentComposer.svelte`, `ToolCallBlock.svelte` | Wrap copied Amplify primitives behind Sonik Agent UI package-level components. |
| Public package exports | `packages/chat-surface/src/index.ts`, `packages/chat-surface/package.json`, `packages/chat-surface/tsconfig.json` | Promotes `chat-surface` from helper-only TypeScript package to Svelte package with component exports. |
| Standalone app wiring | `apps/standalone-sveltekit/src/routes/+page.svelte` | Replaces page-owned chat markup with `AgentConversation`, keeping `Chat`, `DefaultChatTransport`, `/api/generate`, `JsonArtifactRenderer`, and workspace artifact pane behavior intact. |

## Copy/adaptation notes

The copied Amplify donor files originally referenced the broader Amplify design-system alias `$ds`. This slice adapts only those imports to local copied shared helpers under `vendor/amplify-chat` so the donor primitives compile inside this standalone package.

Schema, Puck, and A2UI adapter exports from the copied primitive indexes were removed from this slice because those source files were not copied yet and belong to later catalog/A2UI integration work. The Svelte primitives themselves remain copied and wrapped rather than recreated.

## Transfer-loss guard

- The AI SDK `Chat` instance and `DefaultChatTransport` stay in `apps/standalone-sveltekit/src/routes/+page.svelte`.
- `/api/generate` is unchanged.
- Inline JSON artifacts still render through the `renderArtifact` snippet passed from the app into `AgentConversation`.
- The workspace artifact pane still renders `activeArtifact.content` through `JsonArtifactRenderer`.
- No ORPC, Sonik, sandbox, memory, or agent-client extraction was introduced.

## Deferred by design

- No ORPC/tool-contract/platform adapter implementation.
- No sandbox or memory adapter.
- No JSON catalog/registry migration from the app into `json-ui-runtime`.
- No Reasoning donor copy yet; reasoning/tool richness should be expanded after the chat chrome wrapper seam proves stable.
- No host embed lifecycle API yet.

## Verification

- Svelte autofixer was run against edited/new Svelte files.
- Focused `@sonik-agent-ui/chat-surface` typecheck passed.
- Standalone app typecheck passed after the wrapper replacement.
- Full `pnpm phase0:verify` is the final Phase 4 regression gate.

## Review-gate follow-up fixes

The final review gate found one production audit blocker and one architecture WATCH seam. Phase 4 resolved both inside the same bounded slice:

- Updated Svelte workspace resolution to a patched `^5.56.3` line so `pnpm audit --prod` reports no known vulnerabilities for the Svelte/devalue advisory path.
- Changed the app's latest JSON artifact derivation to preserve the active artifact object and increment its version when the latest assistant spec changes for the same artifact ID.
- Exposed `onStop` through `AgentConversation` and `AgentComposer`, wiring it to AI SDK `conversation.stop()` in the standalone app while keeping transport ownership in the app layer.

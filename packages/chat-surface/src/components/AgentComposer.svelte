<script lang="ts" module>
  import type { AgentContextItem } from "@sonik-agent-ui/tool-contracts/run-context";

  export type AgentChatStatus = "ready" | "submitted" | "streaming" | "error";

  export interface AgentComposerProps {
    value?: string;
    status?: AgentChatStatus;
    placeholder?: string;
    onSubmit: (text: string) => void;
    onStop?: () => void;
    /** Context chips for the current turn. Omit to render the plain composer. */
    contextItems?: AgentContextItem[];
    /** Attachable context sources shown in the plus menu. */
    contextSources?: AgentContextItem[];
    onAttachContext?: (item: AgentContextItem) => void;
    onRemoveContext?: (id: string) => void;
  }
</script>

<script lang="ts">
  import * as PromptInput from "../vendor/amplify-chat/PromptInput/index.js";
  import ContextChip from "./ContextChip.svelte";
  import ComposerContextMenu from "./ComposerContextMenu.svelte";

  let {
    value = $bindable(""),
    status = "ready",
    placeholder = "Ask a follow-up...",
    onSubmit,
    onStop,
    contextItems = [],
    contextSources = [],
    onAttachContext,
    onRemoveContext,
  }: AgentComposerProps = $props();

  const isGenerating = $derived(status === "submitted" || status === "streaming");
  // The context row is only shown when the host wired context sources in — the
  // plain composer (no context props) renders exactly as before.
  const contextEnabled = $derived(Boolean(onAttachContext || onRemoveContext) && (contextItems.length > 0 || contextSources.length > 0));
  const attachedIds = $derived(contextItems.map((item) => item.id));

  function handleSubmit(message: { text: string }): void {
    const text = message.text.trim();
    if (!text || isGenerating) return;

    value = "";
    onSubmit(text);
  }
</script>

<div class="px-6 pb-6 pt-3 flex-shrink-0 bg-background relative">
  <div class="max-w-3xl mx-auto relative">
    <PromptInput.Root {status} onSubmit={handleSubmit} class="rounded-3xl border border-border bg-card shadow-[var(--app-shadow-soft)]">
      {#if contextEnabled}
        <div class="flex flex-wrap items-center gap-1.5 px-3 pt-3" data-testid="composer-context-bar">
          {#if onAttachContext}
            <ComposerContextMenu
              sources={contextSources}
              {attachedIds}
              onAttach={onAttachContext}
              disabled={isGenerating}
            />
          {/if}
          {#each contextItems as item (item.id)}
            <ContextChip {item} onRemove={onRemoveContext} testId={`context-chip-${item.id}`} />
          {/each}
        </div>
      {/if}
      <PromptInput.Body>
        <PromptInput.Textarea
          bind:value
          {placeholder}
          rows={3}
          class="min-h-[76px] pr-16 text-sm text-foreground placeholder:text-muted-foreground"
        />
      </PromptInput.Body>
      <PromptInput.Toolbar class="justify-end border-t-0 px-3 pb-2 pt-0">
        <PromptInput.Submit {status} {onStop} class="h-8 min-h-8 rounded-full px-4">
          {isGenerating ? "Stop" : "Send"}
        </PromptInput.Submit>
      </PromptInput.Toolbar>
    </PromptInput.Root>
  </div>
</div>

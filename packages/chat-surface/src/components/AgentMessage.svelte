<script lang="ts" module>
  import type { DataPart, Spec } from "@json-render/svelte";
  import type { Snippet } from "svelte";
  import type { AgentContextItem } from "@sonik-agent-ui/tool-contracts/run-context";

  export interface AgentChatMessage {
    id: string;
    role: string;
    parts: DataPart[];
  }

  export interface AgentMessageProps {
    message: AgentChatMessage;
    isLast?: boolean;
    isStreaming?: boolean;
    toolLabels?: Record<string, [string, string]>;
    /** Persisted context selection to render as read-only provenance on this turn. */
    contextItems?: AgentContextItem[];
    renderArtifact: Snippet<[Spec, boolean]>;
    shouldRenderArtifact?: (message: AgentChatMessage) => boolean;
  }
</script>

<script lang="ts">
  import { getSegments, getSpec, getText, hasSpec, snapshotDataParts } from "../message-parts.js";
  import ChatText from "./ChatText.svelte";
  import ToolCallBlock from "./ToolCallBlock.svelte";
  import ContextChip from "./ContextChip.svelte";

  let {
    message,
    isLast = false,
    isStreaming = false,
    toolLabels = {},
    contextItems = [],
    renderArtifact,
    shouldRenderArtifact,
  }: AgentMessageProps = $props();

  const parts = $derived(snapshotDataParts(message.parts));
  const spec = $derived(getSpec(parts));
  const text = $derived(getText(parts));
  const messageHasSpec = $derived(hasSpec(parts));
  const segmentResult = $derived(getSegments(parts));
  const segments = $derived(segmentResult.segments);
  const specInserted = $derived(segmentResult.specInserted);
  const from = $derived(message.role === "user" ? "user" : message.role === "tool" ? "tool" : "assistant");
  const canRenderArtifact = $derived(shouldRenderArtifact?.(message) ?? true);

</script>

<div class="agent-message" data-role={from}>
  {#if message.role === "user"}
    {#if text}
      <div class="agent-message__user">
        <div class="agent-message__user-content">
          {text}
        </div>
      </div>
    {/if}
    {#if contextItems.length > 0}
      <div class="agent-message__context" data-testid={`message-context-${message.id}`}>
        {#each contextItems as item (item.id)}
          <ContextChip {item} testId={`message-context-chip-${item.id}`} />
        {/each}
      </div>
    {/if}
  {:else}
    {@const hasAnything = segments.length > 0 || messageHasSpec}
    {@const showLoader = isLast && isStreaming && !hasAnything}
    {@const showSpecAtEnd = messageHasSpec && !specInserted}

    <div class="agent-message__assistant">
      {#each segments as seg, i (`${seg.kind}-${i}`)}
        {#if seg.kind === "text"}
          <div class="agent-message__assistant-text">
            <ChatText text={seg.text} streaming={isLast && isStreaming} />
          </div>
        {:else if seg.kind === "spec"}
          {#if spec && canRenderArtifact}
            <div class="w-full">
              {@render renderArtifact(spec, isLast && isStreaming)}
            </div>
          {/if}
        {:else if seg.kind === "tools"}
          <div class="flex flex-col gap-1">
            {#each seg.tools as tool, toolIndex (tool.toolCallId || `${tool.toolName}-${toolIndex}`)}
              <ToolCallBlock {tool} labels={toolLabels} />
            {/each}
          </div>
        {/if}
      {/each}

      {#if showLoader}
        <div class="text-sm text-muted-foreground animate-shimmer">Thinking...</div>
      {/if}

      {#if showSpecAtEnd && spec && canRenderArtifact}
        <div class="w-full">
          {@render renderArtifact(spec, isLast && isStreaming)}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .agent-message {
    width: 100%;
    color: var(--foreground);
  }

  .agent-message__user {
    display: flex;
    justify-content: flex-end;
  }

  .agent-message__context {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.375rem;
    margin-top: 0.4rem;
  }

  .agent-message__user-content {
    max-width: min(78%, 42rem);
    border: 1px solid var(--sonik-border-color);
    border-radius: 1rem;
    background: var(--app-user-message-bg);
    padding: 0.65rem 0.9rem;
    color: var(--foreground);
    font-size: 0.875rem;
    line-height: 1.55;
    box-shadow: 0 1px 2px color-mix(in oklab, var(--foreground) 8%, transparent);
    white-space: pre-wrap;
  }

  .agent-message__assistant {
    display: flex;
    width: 100%;
    max-width: 48rem;
    flex-direction: column;
    gap: 0.85rem;
  }

  .agent-message__assistant-text {
    color: var(--foreground);
  }
</style>

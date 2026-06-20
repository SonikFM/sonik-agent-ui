<script lang="ts" module>
  import type { DataPart, Spec } from "@json-render/svelte";
  import type { Snippet } from "svelte";

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
    renderArtifact: Snippet<[Spec, boolean]>;
    shouldRenderArtifact?: (message: AgentChatMessage) => boolean;
  }
</script>

<script lang="ts">
  import * as MessagePrimitive from "../vendor/amplify-chat/Message/index.js";
  import { getSegments, getSpec, getText, hasSpec } from "../message-parts.js";
  import ToolCallBlock from "./ToolCallBlock.svelte";

  let {
    message,
    isLast = false,
    isStreaming = false,
    toolLabels = {},
    renderArtifact,
    shouldRenderArtifact,
  }: AgentMessageProps = $props();

  const parts = $derived(message.parts as DataPart[]);
  const spec = $derived(getSpec(parts));
  const text = $derived(getText(parts));
  const messageHasSpec = $derived(hasSpec(parts));
  const segmentResult = $derived(getSegments(parts));
  const segments = $derived(segmentResult.segments);
  const specInserted = $derived(segmentResult.specInserted);
  const from = $derived(message.role === "user" ? "user" : message.role === "tool" ? "tool" : "assistant");
  const canRenderArtifact = $derived(shouldRenderArtifact?.(message) ?? true);
</script>

<MessagePrimitive.Root {from} class="w-full">
  {#if message.role === "user"}
    {#if text}
      <div class="flex justify-end">
        <MessagePrimitive.Content
          class="ml-auto w-fit max-w-[78%] rounded-2xl rounded-br-md bg-[var(--app-user-message-bg)] px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-foreground shadow-sm">
          {text}
        </MessagePrimitive.Content>
      </div>
    {/if}
  {:else}
    {@const hasAnything = segments.length > 0 || messageHasSpec}
    {@const showLoader = isLast && isStreaming && !hasAnything}
    {@const showSpecAtEnd = messageHasSpec && !specInserted}

    <div class="w-full max-w-3xl flex flex-col gap-3 text-foreground">
      {#each segments as seg, i (`${seg.kind}-${i}`)}
        {#if seg.kind === "text"}
          <MessagePrimitive.Content class="bg-transparent px-0 py-0 shadow-none text-foreground">
            <div class="text-sm leading-relaxed [&_p+p]:mt-3 [&_ul]:mt-2 [&_ol]:mt-2 [&_pre]:mt-2">
              {seg.text}
            </div>
          </MessagePrimitive.Content>
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
</MessagePrimitive.Root>

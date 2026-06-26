<script lang="ts" module>
  import type { Spec } from "@json-render/svelte";
  import type { Snippet } from "svelte";
  import type { AgentChatMessage } from "./AgentMessage.svelte";
  import type { AgentChatStatus } from "./AgentComposer.svelte";

  export interface AgentSuggestion {
    label: string;
    prompt: string;
  }

  export interface AgentActivityStatus {
    label: string;
    detail?: string;
    tone?: "neutral" | "waiting" | "tool" | "artifact" | "error";
  }

  export interface AgentConversationProps {
    title?: string;
    messages: AgentChatMessage[];
    input?: string;
    status?: AgentChatStatus;
    error?: { message?: string } | null;
    suggestions?: AgentSuggestion[];
    toolLabels?: Record<string, [string, string]>;
    activity?: AgentActivityStatus | null;
    onSubmit: (text: string) => void;
    onStop?: () => void;
    onClear?: () => void;
    actions?: Snippet;
    renderArtifact: Snippet<[Spec, boolean]>;
    shouldRenderArtifact?: (message: AgentChatMessage) => boolean;
  }
</script>

<script lang="ts">
  import * as Conversation from "../vendor/amplify-chat/Conversation/index.js";
  import AgentComposer from "./AgentComposer.svelte";
  import AgentMessage from "./AgentMessage.svelte";

  let {
    title = "Sonik Chat",
    messages,
    input = $bindable(""),
    status = "ready",
    error = null,
    suggestions = [],
    toolLabels = {},
    activity = null,
    onSubmit,
    onStop,
    onClear,
    actions,
    renderArtifact,
    shouldRenderArtifact,
  }: AgentConversationProps = $props();

  const isStreaming = $derived(status === "streaming" || status === "submitted");
  const isEmpty = $derived(messages.length === 0);

  function submit(text: string): void {
    if (!text.trim() || isStreaming) return;
    onSubmit(text.trim());
  }

  function clear(): void {
    input = "";
    onClear?.();
  }
</script>

<Conversation.Root class="bg-background text-foreground">
  <header class="border-b border-border bg-card/95 px-8 py-4 flex items-center justify-between flex-shrink-0">
    <div class="flex items-center gap-3">
      <h1 class="text-lg font-semibold text-foreground">{title}</h1>
    </div>
    <div class="flex items-center gap-2">
      {@render actions?.()}
      {#if messages.length > 0}
        <button
          onclick={clear}
          class="px-3 py-1.5 rounded-full text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
          Start Over
        </button>
      {/if}
    </div>
  </header>

  <Conversation.Content class="px-0 py-0">
    {#if isEmpty}
      <Conversation.EmptyState class="h-full min-h-full px-6 py-12">
        <div class="max-w-2xl w-full space-y-8">
          <div class="text-center space-y-2">
            <h2 class="text-2xl font-semibold tracking-tight">
              What are we working on?
            </h2>
            <p class="text-muted-foreground">
              Ask a question, create a JSON-render artifact, or update the active document.
              The chat stays conversational unless you ask for a canvas artifact.
            </p>
          </div>

          <div class="flex flex-wrap gap-2 justify-center">
            {#each suggestions as suggestion (suggestion.label)}
              <button
                onclick={() => submit(suggestion.prompt)}
                class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-card text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                {suggestion.label}
              </button>
            {/each}
          </div>
        </div>
      </Conversation.EmptyState>
    {:else}
      <div class="max-w-3xl mx-auto px-8 py-8 space-y-7">
        {#each messages as message, index (message.id)}
          <AgentMessage
            {message}
            isLast={index === messages.length - 1}
            {isStreaming}
            {toolLabels}
            {renderArtifact}
            {shouldRenderArtifact}
          />
        {/each}

        {#if activity}
          <div
            class="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-card/80 px-3 py-1.5 text-xs text-muted-foreground shadow-sm"
            data-tone={activity.tone ?? "neutral"}
          >
            <span class="h-1.5 w-1.5 rounded-full bg-current opacity-70 animate-pulse"></span>
            <span class="font-medium text-foreground/80">{activity.label}</span>
            {#if activity.detail}
              <span class="truncate">{activity.detail}</span>
            {/if}
          </div>
        {/if}

        {#if error?.message}
          <div class="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error.message}
          </div>
        {/if}
      </div>
    {/if}
  </Conversation.Content>

  <Conversation.ScrollButton>Scroll to bottom</Conversation.ScrollButton>

  <AgentComposer
    bind:value={input}
    {status}
    placeholder={isEmpty ? "Start a chat, create an artifact, or update the active document..." : "Ask a follow-up..."}
    onSubmit={submit}
    {onStop}
  />
</Conversation.Root>

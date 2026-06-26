<script lang="ts" module>
  export type AgentChatStatus = "ready" | "submitted" | "streaming" | "error";

  export interface AgentComposerProps {
    value?: string;
    status?: AgentChatStatus;
    placeholder?: string;
    onSubmit: (text: string) => void;
    onStop?: () => void;
  }
</script>

<script lang="ts">
  import * as PromptInput from "../vendor/amplify-chat/PromptInput/index.js";

  let {
    value = $bindable(""),
    status = "ready",
    placeholder = "Ask a follow-up...",
    onSubmit,
    onStop,
  }: AgentComposerProps = $props();

  const isGenerating = $derived(status === "submitted" || status === "streaming");

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

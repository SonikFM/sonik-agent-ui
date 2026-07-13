<script lang="ts">
  // Phase 5 (agent-creation-tool-plan-2026-07-13.md): live Debug & Preview --
  // a side-by-side chat pane that runs the CURRENT DRAFT agent definition.
  //
  // Draft-resolution choice (documented for the team-exec handoff): a narrow
  // `draftAgentId` resolution was added to api/generate/+server.ts mirroring
  // the existing `publishedAgentId` path one-for-one (same store, same
  // fallback-safe null handling) -- smaller diff than threading draft
  // settings through the client agent-settings path, and it reuses
  // agentDefinitionStore.getDraft directly instead of requiring a publish
  // round-trip just to preview. Absent `draftAgentId` (every other request),
  // this is a no-op; behavior is byte-identical to before this change.
  //
  // This pane owns its own Chat instance -- independent of the main app
  // conversation -- so editing the definition never touches the real session.
  import { Chat } from "@ai-sdk/svelte";
  import { DefaultChatTransport } from "ai";
  import { getText } from "@sonik-agent-ui/chat-surface";
  import type { DataPart } from "@json-render/svelte";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";

  interface Props {
    draftAgentId: string;
  }
  let { draftAgentId }: Props = $props();

  let input = $state("");

  const preview = new Chat({
    transport: new DefaultChatTransport({
      api: "/api/generate",
      prepareSendMessagesRequest({ messages, id, trigger, messageId, body }) {
        return { body: { ...body, id, trigger, messageId, messages, draftAgentId } };
      },
    }),
  });

  const isStreaming = $derived(preview.status === "streaming" || preview.status === "submitted");

  function submit(): void {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    preview.sendMessage({ text: trimmed });
    input = "";
  }

  function clearPreview(): void {
    preview.messages = [];
  }
</script>

<div class="flex h-full flex-col gap-3" data-agent-panel="workflow-builder-preview">
  <div class="flex items-center justify-between">
    <span class="text-sm font-medium">Debug &amp; Preview</span>
    <Badge variant={isStreaming ? "default" : "secondary"}>{isStreaming ? "streaming" : "idle"}</Badge>
  </div>
  <div class="flex-1 overflow-y-auto rounded-md border border-border p-3">
    {#if preview.messages.length === 0}
      <p class="text-sm text-muted-foreground">Send a message to test the current draft's model, prompt modules, and tool scoping before publishing.</p>
    {/if}
    {#each preview.messages as message (message.id)}
      <div class="mb-3 flex flex-col gap-1">
        <span class="text-xs uppercase tracking-wide text-muted-foreground">{message.role}</span>
        <p class="whitespace-pre-wrap text-sm">{getText(message.parts as DataPart[])}</p>
      </div>
    {/each}
  </div>
  <div class="flex gap-2">
    <textarea
      class="min-h-16 flex-1 rounded-md border border-input bg-background p-2 text-sm"
      placeholder="Test prompt against the current draft&hellip;"
      bind:value={input}
      onkeydown={(event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          submit();
        }
      }}
    ></textarea>
    <div class="flex flex-col gap-2">
      <Button onclick={submit} disabled={isStreaming || !input.trim()}>Send</Button>
      <Button variant="outline" onclick={clearPreview} disabled={preview.messages.length === 0}>Clear</Button>
    </div>
  </div>
</div>

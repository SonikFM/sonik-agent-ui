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
  import type { WorkflowDefinition } from "@sonik-agent-ui/tool-contracts/marketplace";
  import type { CapabilityReadiness } from "@sonik-agent-ui/tool-contracts/workflow-vnext";

  interface Props {
    draftAgentId: string;
    workspaceFetch: typeof fetch;
    prepareDraft: () => Promise<{ ok: boolean; message: string }>;
    /** Fired when the drafting agent returns a validated workflow, so the shell
     *  can load it onto the canvas (describe -> draft -> canvas). */
    onWorkflowDrafted?: (workflow: WorkflowDefinition) => void;
    capabilityReadiness?: CapabilityReadiness[];
  }
  let { draftAgentId, workspaceFetch, prepareDraft, onWorkflowDrafted, capabilityReadiness = [] }: Props = $props();

  let input = $state("");
  let preparationMessage = $state("");
  let preparing = $state(false);
  let lastDraftedSignature = "";

  // Scan the chat for the draftWorkflow tool's validated output and surface it
  // to the shell. Defensive: the tool result rides in message parts as
  // `{ kind: "workflow-draft", ok, workflow }`; unknown part shapes are ignored.
  function scanForDraftedWorkflow(): void {
    if (!onWorkflowDrafted) return;
    for (let i = preview.messages.length - 1; i >= 0; i -= 1) {
      for (const part of (preview.messages[i].parts ?? []) as unknown[]) {
        const output = (part as { output?: unknown }).output;
        if (!output || typeof output !== "object") continue;
        const draft = output as { kind?: unknown; ok?: unknown; workflow?: WorkflowDefinition };
        if (draft.kind !== "workflow-draft" || draft.ok !== true || !draft.workflow) continue;
        const signature = JSON.stringify(draft.workflow);
        if (signature === lastDraftedSignature) return;
        lastDraftedSignature = signature;
        onWorkflowDrafted(draft.workflow);
        return;
      }
    }
  }
  $effect(() => {
    // depend on the messages array so the scan reruns as the stream lands parts
    void preview.messages.length;
    scanForDraftedWorkflow();
  });

  const preview = new Chat({
    transport: new DefaultChatTransport({
      api: "/api/generate",
      fetch: (input, init) => workspaceFetch(input, init),
      prepareSendMessagesRequest({ messages, id, trigger, messageId, body }) {
        return { body: { ...body, id, trigger, messageId, messages, draftAgentId } };
      },
    }),
  });

  const isStreaming = $derived(preview.status === "streaming" || preview.status === "submitted");
  const callableCapabilityCount = $derived(capabilityReadiness.filter((entry) => entry.callable).length);

  async function submit(): Promise<void> {
    const trimmed = input.trim();
    if (!trimmed || isStreaming || preparing) return;
    preparing = true;
    preparationMessage = "Saving the current draft before preview…";
    try {
      const prepared = await prepareDraft();
      if (!prepared.ok) {
        preparationMessage = prepared.message;
        return;
      }
      preparationMessage = "";
      await preview.sendMessage({ text: trimmed });
      input = "";
    } catch (error) {
      preparationMessage = error instanceof Error ? error.message : "Draft preview could not start.";
    } finally {
      preparing = false;
    }
  }

  function clearPreview(): void {
    preview.messages = [];
  }
</script>

<div class="flex h-full flex-col gap-3" data-agent-panel="workflow-builder-preview">
  <div class="flex items-center justify-between">
    <span class="text-sm font-medium">Debug &amp; Preview</span>
    <span class="flex items-center gap-2">
      <Badge variant="outline">{callableCapabilityCount} callable</Badge>
      <Badge variant={isStreaming ? "default" : "secondary"}>{isStreaming ? "streaming" : "idle"}</Badge>
    </span>
  </div>
  <div class="rounded-md border border-border bg-muted/30 p-3" data-debug-preview-context>
    <div class="flex items-center justify-between gap-2">
      <p class="text-sm font-medium">Isolated preview context</p>
      <Badge variant="secondary">read/preview only</Badge>
    </div>
    <ul class="mt-2 grid gap-1 text-xs text-muted-foreground">
      <li>✓ Separate conversation; main chat history is not included.</li>
      <li>✓ Current saved draft agent: <span class="font-mono">{draftAgentId}</span>.</li>
      <li>✓ Model, prompt modules, knowledge references, and tool scope come from that draft.</li>
      <li>✓ Write/destructive effects require the normal trusted approval path; preview does not grant authority.</li>
    </ul>
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
          void submit();
        }
      }}
    ></textarea>
    <div class="flex flex-col gap-2">
      <Button onclick={() => void submit()} disabled={isStreaming || preparing || !input.trim()}>{preparing ? "Preparing…" : "Send"}</Button>
      <Button variant="outline" onclick={clearPreview} disabled={preview.messages.length === 0}>Clear</Button>
    </div>
  </div>
  {#if preparationMessage}
    <p class="text-sm text-destructive" data-workflow-preview-status>{preparationMessage}</p>
  {/if}
</div>

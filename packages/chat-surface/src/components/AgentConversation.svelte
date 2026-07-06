<script lang="ts" module>
  import type { Spec } from "@json-render/svelte";
  import type { Snippet } from "svelte";
  import type { AgentContextItem } from "@sonik-agent-ui/tool-contracts/run-context";
  import type { AgentChatMessage } from "./AgentMessage.svelte";
  import type { AgentChatStatus } from "./AgentComposer.svelte";
  import type { ToolActivityLabelOverrides } from "../tool-activity.js";

  export interface AgentSuggestion {
    label: string;
    prompt: string;
    description?: string;
    familyId?: string;
    kind?: string;
    readiness?: "ready" | "needs_context" | "approval_required" | "draft_only";
    readinessLabel?: string;
  }

  export interface AgentActivityStatus {
    label: string;
    detail?: string;
    tone?: "neutral" | "waiting" | "tool" | "artifact" | "error";
  }

  export interface AgentRunRecovery {
    title: string;
    guidance: string;
    actionLabel: string | null;
    canContinue: boolean;
  }

  export interface AgentApprovalAffordance {
    title: string;
    description: string;
    commandId: string;
    artifactTitle?: string | null;
    status?: "draft" | "preview" | "approval_required" | "blocked";
    disabled?: boolean;
    disabledReason?: string | null;
    onRequestPreview: () => void;
    onApprove: () => void;
    onCancel: () => void;
  }

  export interface AgentConversationProps {
    title?: string;
    messages: AgentChatMessage[];
    input?: string;
    status?: AgentChatStatus;
    error?: { message?: string } | null;
    suggestions?: AgentSuggestion[];
    toolLabels?: ToolActivityLabelOverrides;
    activity?: AgentActivityStatus | null;
    onSubmit: (text: string) => void;
    /** Fires when a workflow launcher suggestion chip is chosen, before the
     *  prompt is submitted. Lets the host mark the turn's analytics entry point
     *  (workflow_launcher) distinctly from a plain composer send. */
    onSelectSuggestion?: (suggestion: AgentSuggestion) => void;
    onStop?: () => void;
    onClear?: () => void;
    /** Recovery affordance for a resumable/failed run, keyed off the run's error code. */
    runRecovery?: AgentRunRecovery | null;
    onContinue?: () => void;
    /** First-class trusted command approval affordance for active intake/workflow artifacts. */
    approvalAffordance?: AgentApprovalAffordance | null;
    /** Composer context chips for the current turn. */
    contextItems?: AgentContextItem[];
    /** Attachable context sources shown in the composer plus menu. */
    contextSources?: AgentContextItem[];
    onAttachContext?: (item: AgentContextItem) => void;
    onRemoveContext?: (id: string) => void;
    /** Resolves the persisted context selection to render as provenance on a past message. */
    messageContext?: (message: AgentChatMessage) => AgentContextItem[] | undefined;
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
    onSelectSuggestion,
    onStop,
    onClear,
    runRecovery = null,
    onContinue,
    approvalAffordance = null,
    contextItems = [],
    contextSources = [],
    onAttachContext,
    onRemoveContext,
    messageContext,
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
          New chat
        </button>
      {/if}
    </div>
  </header>

  <Conversation.Content class="px-0 py-0">
    {#if runRecovery}
      <div class="max-w-3xl mx-auto px-8 pt-8">
        <div
          class="flex flex-col gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm"
          data-run-recovery
        >
          <div class="font-medium text-foreground">{runRecovery.title}</div>
          <p class="text-muted-foreground">{runRecovery.guidance}</p>
          {#if runRecovery.canContinue && runRecovery.actionLabel}
            <div>
              <button
                type="button"
                onclick={() => onContinue?.()}
                disabled={isStreaming}
                data-run-recovery-action="continue"
                class="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-50"
              >
                {runRecovery.actionLabel}
              </button>
            </div>
          {/if}
        </div>
      </div>
    {/if}

    {#if isEmpty}
      <Conversation.EmptyState class="h-full min-h-full px-6 py-12">
        <div class="max-w-2xl w-full space-y-8">
          <div class="text-center space-y-2">
            <h2 class="text-2xl font-semibold tracking-tight">
              What are we working on?
            </h2>
            <p class="text-muted-foreground">
              Ask a question, launch a guided workflow, build a live draft,
              or update the active document.
            </p>
          </div>

          <div class="grid gap-3 sm:grid-cols-2" aria-label="Suggested agent workflows">
            {#each suggestions as suggestion (suggestion.label)}
              <button
                type="button"
                onclick={() => { onSelectSuggestion?.(suggestion); submit(suggestion.prompt); }}
                class="group rounded-2xl border border-border bg-card p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/50 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-workflow-suggestion={suggestion.familyId ?? suggestion.label}
                data-workflow-readiness={suggestion.readiness ?? "ready"}
              >
                <span class="flex items-start justify-between gap-3">
                  <span class="min-w-0">
                    <span class="block text-sm font-semibold text-foreground">{suggestion.label}</span>
                    {#if suggestion.description}
                      <span class="mt-1 block text-xs leading-5 text-muted-foreground">{suggestion.description}</span>
                    {/if}
                  </span>
                  <span class="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {suggestion.readinessLabel ?? (suggestion.readiness === "needs_context" ? "Context" : suggestion.readiness === "approval_required" ? "Approval" : suggestion.readiness === "draft_only" ? "Draft" : "Ready")}
                  </span>
                </span>
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
            contextItems={messageContext?.(message)}
            {renderArtifact}
            {shouldRenderArtifact}
          />
        {/each}

        {#if approvalAffordance}
          <div
            class="rounded-2xl border border-primary/35 bg-primary/10 p-4 shadow-sm"
            data-chat-approval-card
            data-command-id={approvalAffordance.commandId}
            data-status={approvalAffordance.status ?? "draft"}
          >
            <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div class="min-w-0 space-y-1">
                <div class="flex flex-wrap items-center gap-2">
                  <p class="text-sm font-semibold text-foreground">{approvalAffordance.title}</p>
                  <span class="rounded-full border border-primary/30 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-primary">
                    {approvalAffordance.commandId}
                  </span>
                </div>
                <p class="text-sm text-muted-foreground">{approvalAffordance.description}</p>
                {#if approvalAffordance.artifactTitle}
                  <p class="text-xs text-muted-foreground">Active draft: {approvalAffordance.artifactTitle}</p>
                {/if}
                {#if approvalAffordance.disabled && approvalAffordance.disabledReason}
                  <p class="text-xs font-medium text-destructive" data-approval-disabled-reason>{approvalAffordance.disabledReason}</p>
                {/if}
              </div>
              <div class="flex shrink-0 flex-wrap gap-2">
                <button
                  type="button"
                  class="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  onclick={approvalAffordance.onRequestPreview}
                  disabled={isStreaming || approvalAffordance.disabled}
                  data-approval-action="preview"
                >
                  Preview setup
                </button>
                <button
                  type="button"
                  class="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  onclick={approvalAffordance.onApprove}
                  disabled={isStreaming || approvalAffordance.disabled}
                  data-approval-action="approve"
                >
                  Approve and create
                </button>
                <button
                  type="button"
                  class="rounded-full px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  onclick={approvalAffordance.onCancel}
                  disabled={isStreaming || approvalAffordance.disabled}
                  data-approval-action="cancel"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        {/if}

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
    placeholder={isEmpty ? "Start a chat, build a live draft, or update the active document..." : "Ask a follow-up..."}
    onSubmit={submit}
    {onStop}
    {contextItems}
    {contextSources}
    {onAttachContext}
    {onRemoveContext}
  />
</Conversation.Root>

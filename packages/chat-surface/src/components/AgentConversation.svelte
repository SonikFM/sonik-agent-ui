<script lang="ts" module>
  import type { Spec } from "@json-render/svelte";
  import type { Snippet } from "svelte";
  import type { AgentContextItem } from "@sonik-agent-ui/tool-contracts/run-context";
  import type { AgentChatMessage } from "./AgentMessage.svelte";
  import type { AgentChatStatus } from "./AgentComposer.svelte";
  import type { ToolActivityLabelOverrides } from "../tool-activity.js";
  import type { ComposerCatalogStatus, ComposerRecentDocument, ComposerSuggestionItem, ComposerToolItem } from "../composer-context.js";

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

  export type AgentSessionHistoryState =
    | { status: "loading" }
    | { status: "ready" }
    | { status: "empty" }
    | { status: "error"; message: string };

  export interface AgentApprovalAffordance {
    title: string;
    description: string;
    commandId: string;
    artifactTitle?: string | null;
    status?: "draft" | "preview" | "approval_required" | "blocked";
    disabled?: boolean;
    disabledReason?: string | null;
    previewLabel?: string;
    approveLabel?: string;
    cancelLabel?: string;
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
    onSubmit: (text: string) => boolean | void;
    /** Launches a workflow suggestion. Return true only when a user turn was started.
     *  When absent, AgentConversation falls back to submitting suggestion.prompt. */
    onSelectSuggestion?: (suggestion: AgentSuggestion) => boolean | void;
    onSuppressSuggestion?: (suggestion: AgentSuggestion, reason: "duplicate" | "busy") => void;
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
    onOpenContext?: (item: AgentContextItem) => void;
    composerSuggestions?: ComposerSuggestionItem[];
    composerTools?: ComposerToolItem[];
    toolPermissionModes?: Record<string, "off" | "ask" | "allow">;
    pinnedToolIds?: string[];
    recentDocuments?: ComposerRecentDocument[];
    skillCatalogStatus?: ComposerCatalogStatus;
    commandCatalogStatus?: ComposerCatalogStatus;
    toolCatalogStatus?: ComposerCatalogStatus;
    recentDocumentCatalogStatus?: ComposerCatalogStatus;
    onRetryComposerCatalogs?: () => void;
    onRetryRecentDocuments?: () => void;
    onToolPermissionChange?: (familyId: string, mode: "off" | "ask" | "allow") => void;
    onPinToolChange?: (toolId: string, pinned: boolean) => void;
    onAttachRecentDocument?: (item: ComposerRecentDocument) => void;
    onUploadFile?: (file: File, signal: AbortSignal) => Promise<AgentContextItem>;
    /** Resolves the persisted context selection to render as provenance on a past message. */
    messageContext?: (message: AgentChatMessage) => AgentContextItem[] | undefined;
    /** Chat switcher rendered in place of the static title. Embedded widgets
     *  have no session rail, so without this the user cannot reach any other
     *  conversation. */
    sessionOptions?: Array<{ id: string; title: string }>;
    activeSessionId?: string | null;
    onSessionSwitch?: (sessionId: string) => void;
    sessionHistoryState?: AgentSessionHistoryState;
    onRefreshSessionHistory?: () => void | Promise<void>;
    actions?: Snippet;
    renderArtifact: Snippet<[Spec, boolean]>;
    shouldRenderArtifact?: (message: AgentChatMessage) => boolean;
  }
</script>

<script lang="ts">
  import * as Conversation from "../vendor/amplify-chat/Conversation/index.js";
  import { resolveApprovalDisabledState } from "../approval-disabled-state.js";
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
    onSuppressSuggestion,
    onStop,
    onClear,
    runRecovery = null,
    onContinue,
    approvalAffordance = null,
    contextItems = [],
    contextSources = [],
    onAttachContext,
    onRemoveContext,
    onOpenContext,
    composerSuggestions = [],
    composerTools = [],
    toolPermissionModes = {},
    pinnedToolIds = [],
    recentDocuments = [],
    skillCatalogStatus = "ready",
    commandCatalogStatus = "ready",
    toolCatalogStatus = "ready",
    recentDocumentCatalogStatus = "ready",
    onRetryComposerCatalogs,
    onRetryRecentDocuments,
    onToolPermissionChange,
    onPinToolChange,
    onAttachRecentDocument,
    onUploadFile,
    messageContext,
    sessionOptions,
    activeSessionId = null,
    onSessionSwitch,
    sessionHistoryState = { status: "loading" },
    onRefreshSessionHistory,
    actions,
    renderArtifact,
    shouldRenderArtifact,
  }: AgentConversationProps = $props();

  const isStreaming = $derived(status === "streaming" || status === "submitted");
  const isEmpty = $derived(messages.length === 0);
  const approvalDisabledState = $derived(resolveApprovalDisabledState({
    isStreaming,
    disabled: approvalAffordance?.disabled === true,
    reason: approvalAffordance?.disabledReason,
  }));
  const APPROVAL_DISABLED_REASON_ID = "agent-approval-disabled-reason";
  let suggestionLaunchLock: { sessionId: string | null; messageCount: number } | null = null;

  $effect(() => {
    if (!suggestionLaunchLock) return;
    if (activeSessionId !== suggestionLaunchLock.sessionId || messages.length > suggestionLaunchLock.messageCount) {
      suggestionLaunchLock = null;
    }
  });

  function submit(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return false;
    return onSubmit(trimmed) !== false;
  }

  function clear(): void {
    input = "";
    onClear?.();
  }

  function launchSuggestion(suggestion: AgentSuggestion): void {
    if (suggestionLaunchLock) {
      onSuppressSuggestion?.(suggestion, "duplicate");
      return;
    }
    if (isStreaming) {
      onSuppressSuggestion?.(suggestion, "busy");
      return;
    }
    suggestionLaunchLock = { sessionId: activeSessionId, messageCount: messages.length };
    const launched = onSelectSuggestion
      ? onSelectSuggestion(suggestion) === true
      : submit(suggestion.prompt);
    if (!launched) suggestionLaunchLock = null;
  }

  function approvalStatusLabel(status: AgentApprovalAffordance["status"] | undefined): string {
    switch (status) {
      case "blocked":
        return "Needs input";
      case "preview":
        return "Preview ready";
      case "approval_required":
        return "Trusted approval";
      case "draft":
      default:
        return "Draft preview";
    }
  }
</script>

<Conversation.Root class="bg-background text-foreground">
  <!-- flex-wrap: the embedded sidecar is narrow; without it the actions group
       overlaps the session switcher (2026-07-13 live report). The switcher
       carries an explicit "Chat history" caption so a session title like
       "Create a Booking Workflow" reads as history, not a call to action. -->
  <header class="border-b border-border bg-card/95 px-8 py-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 flex-shrink-0">
    <div class="flex items-center gap-3 min-w-0">
      {#if sessionOptions && sessionOptions.length > 0 && onSessionSwitch}
        <label class="flex min-w-0 items-center gap-2" data-testid="agent-session-switcher-group">
          <span class="text-xs font-medium whitespace-nowrap text-muted-foreground">Chat history</span>
          <select
            aria-label="Switch chat"
            data-testid="agent-session-switcher"
            class="min-w-0 max-w-60 truncate rounded-md border border-border bg-card px-2 py-1.5 text-sm font-medium text-foreground"
            value={activeSessionId ?? ""}
            onchange={(event) => {
              const nextId = event.currentTarget.value;
              if (nextId && nextId !== activeSessionId) onSessionSwitch(nextId);
            }}
          >
            {#each sessionOptions as option (option.id)}
              <option value={option.id}>{option.title}</option>
            {/each}
          </select>
        </label>
      {:else}
        <h1 class="text-lg font-semibold text-foreground">{title}</h1>
      {/if}
    </div>
    <div class="flex flex-wrap items-center gap-2">
      {@render actions?.()}
      {#if onRefreshSessionHistory && sessionHistoryState.status !== "error"}
        <button
          type="button"
          class="px-3 py-1.5 rounded-full text-sm whitespace-nowrap text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
          onclick={() => void onRefreshSessionHistory()}
          disabled={sessionHistoryState.status === "loading"}
          data-disabled-reason={sessionHistoryState.status === "loading" ? "Chat history is already loading." : undefined}
          data-testid="session-history-refresh"
        >Refresh history</button>
      {/if}
      {#if messages.length > 0}
        <button
          onclick={clear}
          class="px-3 py-1.5 rounded-full text-sm whitespace-nowrap text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
          New chat
        </button>
      {/if}
    </div>
    {#if sessionHistoryState.status === "error"}
      <div
        class="flex basis-full items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground"
        role="alert"
        data-testid="session-history-error"
      >
        <span>{sessionHistoryState.message}</span>
        <button
          type="button"
          class="shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
          onclick={() => void onRefreshSessionHistory?.()}
          data-testid="session-history-retry"
        >Retry</button>
      </div>
    {/if}
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

          <div
            class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-3"
            aria-label="Suggested agent workflows"
            data-workflow-suggestions-layout="intrinsic-grid"
          >
            {#each suggestions as suggestion (suggestion.label)}
              <button
                type="button"
                onclick={() => launchSuggestion(suggestion)}
                disabled={isStreaming}
                class="group min-w-0 rounded-2xl border border-border bg-card p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/50 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                data-workflow-suggestion={suggestion.familyId ?? suggestion.label}
                data-workflow-readiness={suggestion.readiness ?? "ready"}
              >
                <span class="flex min-w-0 flex-wrap items-start justify-between gap-3">
                  <span class="min-w-0">
                    <span class="block text-sm font-semibold text-foreground">{suggestion.label}</span>
                    {#if suggestion.description}
                      <span class="mt-1 block text-xs leading-5 text-muted-foreground">{suggestion.description}</span>
                    {/if}
                  </span>
                  <span class="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">
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
            data-status={approvalAffordance.status ?? "draft"}
          >
            <div
              class="flex flex-wrap items-start justify-between gap-3"
              data-chat-approval-layout="intrinsic-wrap"
            >
              <div class="min-w-0 flex-1 basis-72 space-y-1" data-chat-approval-copy>
                <div class="flex flex-wrap items-center gap-2">
                  <p class="text-sm font-semibold text-foreground">{approvalAffordance.title}</p>
                  <span class="rounded-full border border-primary/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">
                    {approvalStatusLabel(approvalAffordance.status)}
                  </span>
                </div>
                <p class="text-sm text-muted-foreground">{approvalAffordance.description}</p>
                {#if approvalAffordance.artifactTitle}
                  <p class="text-xs text-muted-foreground">Active draft: {approvalAffordance.artifactTitle}</p>
                {/if}
                <details class="text-xs text-muted-foreground" data-approval-technical-details data-command-id={approvalAffordance.commandId}>
                  <summary class="inline-flex cursor-pointer list-none rounded-full text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">Technical command receipt</summary>
                  <p class="mt-1 font-mono text-[11px] break-all">{approvalAffordance.commandId}</p>
                </details>
                {#if approvalDisabledState}
                  <p
                    id={APPROVAL_DISABLED_REASON_ID}
                    class="text-xs font-medium text-destructive"
                    role="status"
                    aria-live="polite"
                    data-approval-disabled-reason
                    data-disabled-reason={approvalDisabledState.code}
                  >{approvalDisabledState.message}</p>
                {/if}
              </div>
              <div class="flex min-w-0 flex-1 basis-72 flex-wrap gap-2" data-chat-approval-actions>
                <button
                  type="button"
                  class="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  onclick={approvalAffordance.onRequestPreview}
                  disabled={approvalDisabledState !== null}
                  data-disabled-reason={approvalDisabledState?.code}
                  aria-describedby={approvalDisabledState ? APPROVAL_DISABLED_REASON_ID : undefined}
                  data-approval-action="preview"
                >
                  {approvalAffordance.previewLabel ?? "Preview setup"}
                </button>
                <button
                  type="button"
                  class="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  onclick={approvalAffordance.onApprove}
                  disabled={approvalDisabledState !== null}
                  data-disabled-reason={approvalDisabledState?.code}
                  aria-describedby={approvalDisabledState ? APPROVAL_DISABLED_REASON_ID : undefined}
                  data-approval-action="approve"
                >
                  {approvalAffordance.approveLabel ?? "Approve and create"}
                </button>
                <button
                  type="button"
                  class="rounded-full px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  onclick={approvalAffordance.onCancel}
                  disabled={approvalDisabledState !== null}
                  data-disabled-reason={approvalDisabledState?.code}
                  aria-describedby={approvalDisabledState ? APPROVAL_DISABLED_REASON_ID : undefined}
                  data-approval-action="cancel"
                >
                  {approvalAffordance.cancelLabel ?? "Cancel"}
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
    {onOpenContext}
    suggestions={composerSuggestions}
    tools={composerTools}
    {toolPermissionModes}
    {pinnedToolIds}
    {recentDocuments}
    {skillCatalogStatus}
    {commandCatalogStatus}
    {toolCatalogStatus}
    {recentDocumentCatalogStatus}
    {onRetryComposerCatalogs}
    {onRetryRecentDocuments}
    {onToolPermissionChange}
    {onPinToolChange}
    {onAttachRecentDocument}
    {onUploadFile}
  />
</Conversation.Root>

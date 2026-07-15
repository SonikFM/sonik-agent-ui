<script lang="ts" module>
  import type { AgentContextItem } from "@sonik-agent-ui/tool-contracts/run-context";
  import type { ComposerCatalogStatus, ComposerRecentDocument, ComposerSuggestionItem, ComposerToolItem } from "../composer-context.js";

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
    onOpenContext?: (item: AgentContextItem) => void;
    suggestions?: ComposerSuggestionItem[];
    tools?: ComposerToolItem[];
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
  }
</script>

<script lang="ts">
  import * as PromptInput from "../vendor/amplify-chat/PromptInput/index.js";
  import ComposerAttachmentMenu from "./ComposerAttachmentMenu.svelte";
  import ComposerSuggestions from "./ComposerSuggestions.svelte";
  import ComposerToolSelector from "./ComposerToolSelector.svelte";
  import StagedContextRow from "./StagedContextRow.svelte";
  import { filterComposerSuggestions, findComposerTrigger, replaceComposerTrigger } from "../composer-context.js";
  import {
    createComposerFileUpload,
    executeComposerFileUpload,
    failComposerFileUpload,
    retryComposerFileUpload,
    type ComposerFileFailedState,
    type ComposerFileUploadState,
    type ComposerFileUploadingState,
  } from "../file-upload-state.js";

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
    onOpenContext,
    suggestions = [],
    tools = [],
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
  }: AgentComposerProps = $props();

  const isGenerating = $derived(status === "submitted" || status === "streaming");
  // The context row is only shown when the host wired context sources in — the
  // plain composer (no context props) renders exactly as before.
  const contextEnabled = $derived(Boolean(onAttachContext || onRemoveContext || onUploadFile) || contextItems.length > 0 || pinnedToolIds.length > 0);
  const attachedIds = $derived(contextItems.map((item) => item.id));
  const trigger = $derived(findComposerTrigger(value));
  let suggestionsDismissed = $state(false);
  const visibleTrigger = $derived(suggestionsDismissed ? null : trigger);
  const filteredSuggestions = $derived(filterComposerSuggestions(suggestions, visibleTrigger));
  const pinnedTools = $derived(tools.filter((tool) => pinnedToolIds.includes(tool.id)));
  let activeSuggestion = $state(0);
  let dragging = $state(false);
  let uploads = $state<ComposerFileUploadState[]>([]);

  function handleSubmit(message: { text: string }): void {
    const text = message.text.trim();
    if (!text || isGenerating) return;

    value = "";
    onSubmit(text);
  }

  function selectSuggestion(item: ComposerSuggestionItem): void {
    if (!trigger) return;
    suggestionsDismissed = false;
    if (item.kind === "skill") {
      onAttachContext?.({ id: `runtime-skill:${item.id}`, kind: "runtime-skill", label: item.label, source: "manual", ref: item.id, detail: item.description });
      value = replaceComposerTrigger(value, trigger);
      return;
    }
    value = replaceComposerTrigger(value, trigger, `/${item.id} `);
  }

  function handleEditorKeydown(event: KeyboardEvent): void {
    if (!trigger) return;
    if (event.key === "Escape") {
      suggestionsDismissed = true;
      event.preventDefault();
      return;
    }
    if (filteredSuggestions.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const delta = event.key === "ArrowDown" ? 1 : -1;
      activeSuggestion = (activeSuggestion + delta + filteredSuggestions.length) % filteredSuggestions.length;
      event.preventDefault();
    } else if (event.key === "Enter" || event.key === "Tab") {
      const selection = filteredSuggestions[activeSuggestion];
      if (selection) selectSuggestion(selection);
      event.preventDefault();
    }
  }

  function fileUploadError(file: File): string | null {
    const extension = file.name.toLowerCase().match(/\.([^.]+)$/)?.[1];
    if (extension === "docx") return "DOCX is unsupported. Convert it to PDF, text, or Markdown.";
    if (extension === "xlsx") return "XLSX is unsupported. Convert it to CSV.";
    if (extension === "pptx") return "PPTX is unsupported. Convert it to PDF.";
    const allowed = /^(application\/(pdf|json|javascript|xml)|text\/(plain|markdown|csv|html|xml|css|javascript)|image\/(bmp|jpeg|png|webp))$/i.test(file.type);
    if (!allowed) return "Unsupported file type. Use PDF, plain text, Markdown, CSV, HTML, XML, CSS, JavaScript, JSON, BMP, JPEG, PNG, or WebP.";
    if (file.size > 10 * 1024 * 1024) return "File exceeds the 10 MiB limit.";
    return null;
  }

  async function uploadFiles(files: File[]): Promise<void> {
    if (!onUploadFile) return;
    for (const file of files) {
      const upload = createComposerFileUpload(file);
      const error = fileUploadError(file);
      if (error) {
        uploads = [...uploads, failComposerFileUpload(upload, new Error(error))];
        continue;
      }
      uploads = [...uploads, upload];
      void startUpload(upload);
    }
  }

  async function startUpload(upload: ComposerFileUploadingState): Promise<void> {
    if (!onUploadFile) return;
    const failure = await executeComposerFileUpload({ upload, onUploadFile, onAttachContext });
    const current = uploads.find((candidate) => candidate.id === upload.id);
    if (current?.status !== "uploading" || current.controller !== upload.controller) return;
    uploads = failure
      ? uploads.map((candidate) => candidate.id === upload.id ? failure : candidate)
      : uploads.filter((candidate) => candidate.id !== upload.id);
  }

  function retryUpload(id: string): void {
    const failed = uploads.find((upload): upload is ComposerFileFailedState => upload.id === id && upload.status === "failed");
    if (!failed) return;
    const retry = retryComposerFileUpload(failed);
    uploads = uploads.map((upload) => upload.id === id ? retry : upload);
    void startUpload(retry);
  }

  function removeUpload(id: string): void {
    const upload = uploads.find((candidate) => candidate.id === id);
    if (upload?.status === "uploading") upload.controller.abort();
    uploads = uploads.filter((upload) => upload.id !== id);
  }
</script>

<div
  role="region"
  aria-label="Message composer"
  class="px-6 pb-6 pt-3 flex-shrink-0 bg-background relative"
  class:ring-2={dragging}
  class:ring-ring={dragging}
  ondragover={(event) => { if (onUploadFile) { event.preventDefault(); dragging = true; } }}
  ondragleave={() => dragging = false}
  ondrop={(event) => { if (onUploadFile) { event.preventDefault(); dragging = false; void uploadFiles([...(event.dataTransfer?.files ?? [])]); } }}
>
  <div class="max-w-3xl mx-auto relative">
    <PromptInput.Root {status} onSubmit={handleSubmit} class="rounded-3xl border border-border bg-card shadow-[var(--app-shadow-soft)]">
      {#if contextEnabled && (contextItems.length || pinnedTools.length || uploads.length)}
        <StagedContextRow
          items={contextItems}
          {pinnedTools}
          uploads={uploads.map((upload) => ({ id: upload.id, label: upload.label, status: upload.status, ...(upload.status === "failed" ? { error: upload.error } : {}) }))}
          onOpen={onOpenContext}
          onRemove={onRemoveContext}
          onUnpin={(id) => onPinToolChange?.(id, false)}
          onRetryUpload={retryUpload}
          onRemoveUpload={removeUpload}
        />
      {/if}
      <PromptInput.Body>
        {#if visibleTrigger}<ComposerSuggestions trigger={visibleTrigger} items={filteredSuggestions} activeIndex={activeSuggestion} {skillCatalogStatus} {commandCatalogStatus} onRetry={onRetryComposerCatalogs} onSelect={selectSuggestion} />{/if}
        <PromptInput.Textarea
          bind:value
          {placeholder}
          rows={3}
          class="min-h-[76px] pr-16 text-sm text-foreground placeholder:text-muted-foreground"
          oninput={() => { activeSuggestion = 0; suggestionsDismissed = false; }}
          onkeydown={handleEditorKeydown}
          onpaste={(event) => {
            const files = [...(event.clipboardData?.files ?? [])];
            if (files.length && onUploadFile) { event.preventDefault(); void uploadFiles(files); }
          }}
        />
      </PromptInput.Body>
      <PromptInput.Toolbar class="justify-between border-t-0 px-3 pb-2 pt-0">
        <div class="flex items-center gap-2">
          <ComposerAttachmentMenu
            sources={contextSources}
            {attachedIds}
            {recentDocuments}
            catalogStatus={recentDocumentCatalogStatus}
            onRetry={onRetryRecentDocuments}
            disabled={isGenerating}
            onAttach={onAttachContext}
            onAttachRecent={onAttachRecentDocument}
            onUpload={onUploadFile ? uploadFiles : undefined}
          />
          {#if tools.length || toolCatalogStatus !== "ready"}
            <ComposerToolSelector
              {tools}
              catalogStatus={toolCatalogStatus}
              onRetry={onRetryComposerCatalogs}
              permissionModes={toolPermissionModes}
              pinnedIds={pinnedToolIds}
              disabled={isGenerating}
              onPermissionChange={onToolPermissionChange}
              onPinChange={onPinToolChange}
            />
          {/if}
        </div>
        <PromptInput.Submit {status} {onStop} class="h-8 min-h-8 rounded-full px-4">
          {isGenerating ? "Stop" : "Send"}
        </PromptInput.Submit>
      </PromptInput.Toolbar>
    </PromptInput.Root>
  </div>
</div>

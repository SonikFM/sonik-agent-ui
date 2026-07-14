<script lang="ts">
  import type { AgentContextItem } from "@sonik-agent-ui/tool-contracts/run-context";
  import type { ComposerCatalogStatus, ComposerRecentDocument } from "../composer-context.js";

  let {
    sources,
    attachedIds,
    recentDocuments,
    catalogStatus,
    disabled = false,
    onAttach,
    onAttachRecent,
    onUpload,
    onRetry,
  }: {
    sources: AgentContextItem[];
    attachedIds: string[];
    recentDocuments: ComposerRecentDocument[];
    catalogStatus: ComposerCatalogStatus;
    disabled?: boolean;
    onAttach?: (item: AgentContextItem) => void;
    onAttachRecent?: (item: ComposerRecentDocument) => void;
    onUpload?: (files: File[]) => void;
    onRetry?: () => void;
  } = $props();

  let open = $state(false);
  let root = $state<HTMLDivElement | null>(null);
  let input = $state<HTMLInputElement | null>(null);
  const attached = $derived(new Set(attachedIds));
  const available = $derived(sources.filter((item) => !attached.has(item.id)));

  function chooseFiles(files: FileList | null): void {
    if (files?.length) onUpload?.([...files]);
    open = false;
    if (input) input.value = "";
  }
</script>

<svelte:window
  onmousedown={(event) => { if (open && root && !root.contains(event.target as Node)) open = false; }}
  onkeydown={(event) => { if (open && event.key === "Escape") open = false; }}
/>

<div class="relative" bind:this={root}>
  <button
    type="button"
    class="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
    aria-label="Attach context or document"
    aria-haspopup="menu"
    aria-expanded={open}
    data-testid="composer-attachment-trigger"
    {disabled}
    onclick={() => { if (!disabled) open = !open; }}
  >
    <span aria-hidden="true" class="text-lg leading-none">+</span>
  </button>
  <input bind:this={input} class="sr-only" type="file" multiple accept=".pdf,.txt,.md,.markdown,.csv,.html,.htm,.xml,.css,.js,.mjs,.cjs,.json,.bmp,.jpg,.jpeg,.png,.webp" onchange={(event) => chooseFiles(event.currentTarget.files)} />

  {#if open}
    <div class="absolute bottom-full left-0 z-40 mb-2 max-h-80 w-72 overflow-auto rounded-xl border border-border bg-popover p-1.5 shadow-lg" role="menu" data-testid="composer-attachment-menu">
      {#if onUpload}
        <button type="button" role="menuitem" class="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-foreground hover:bg-accent" onclick={() => input?.click()}>
          Upload file
        </button>
        <p class="px-3 pb-1 text-xs leading-4 text-muted-foreground">PDF, text, Markdown, CSV, HTML, XML, CSS, JavaScript, JSON, BMP, JPEG, PNG, or WebP · 10 MiB max</p>
      {/if}
      {#if recentDocuments.length > 0}
        <p class="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Recent documents</p>
        {#each recentDocuments.slice(0, 5) as document (document.id)}
          <button type="button" role="menuitem" class="w-full rounded-lg px-3 py-2 text-left hover:bg-accent" onclick={() => { onAttachRecent?.(document); open = false; }}>
            <span class="block truncate text-sm text-foreground">{document.label}</span>
            {#if document.detail}<span class="block truncate text-xs text-muted-foreground">{document.detail}</span>{/if}
          </button>
        {/each}
      {/if}
      {#if catalogStatus === "loading"}
        <p class="px-3 py-2 text-xs text-muted-foreground">Loading recent documents…</p>
      {:else if catalogStatus === "unavailable"}
        <p class="px-3 py-2 text-xs text-muted-foreground">Recent documents unavailable.</p>
        {#if onRetry}<button type="button" class="px-3 pb-2 text-xs font-medium text-foreground underline" onclick={onRetry}>Retry recent documents</button>{/if}
      {/if}
      {#if available.length > 0}
        <p class="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Available context</p>
        {#each available as item (item.id)}
          <button type="button" role="menuitem" class="w-full rounded-lg px-3 py-2 text-left text-sm text-foreground hover:bg-accent" onclick={() => { onAttach?.(item); open = false; }}>
            {item.label}
          </button>
        {/each}
      {/if}
      {#if !onUpload && recentDocuments.length === 0 && available.length === 0}
        <p class="px-3 py-2 text-xs text-muted-foreground">No context sources are available.</p>
      {/if}
    </div>
  {/if}
</div>

<script lang="ts">
  import { tick } from "svelte";
  import type { AgentContextItem } from "@sonik-agent-ui/tool-contracts/run-context";
  import type { ComposerToolItem } from "../composer-context.js";
  import ContextChip from "./ContextChip.svelte";

  type StagedPresentation =
    | { kind: "context"; id: string; item: AgentContextItem }
    | { kind: "tool"; id: string; tool: ComposerToolItem };

  let {
    items,
    pinnedTools,
    uploads,
    onOpen,
    onRemove,
    onUnpin,
    onRetryUpload,
    onRemoveUpload,
  }: {
    items: AgentContextItem[];
    pinnedTools: ComposerToolItem[];
    uploads: Array<{ id: string; label: string; status: "uploading" | "failed"; error?: string }>;
    onOpen?: (item: AgentContextItem) => void;
    onRemove?: (id: string) => void;
    onUnpin?: (id: string) => void;
    onRetryUpload?: (id: string) => void;
    onRemoveUpload?: (id: string) => void;
  } = $props();

  const stagedItemsId = $props.id();
  let stagedItemsElement: HTMLDivElement | null = $state(null);
  let disclosureElement: HTMLButtonElement | null = $state(null);
  let expanded = $state(false);
  let collapsedLimit = $state(1);

  const stagedPresentations = $derived<StagedPresentation[]>([
    ...items.map((item) => ({ kind: "context" as const, id: `context:${item.id}`, item })),
    ...pinnedTools.map((tool) => ({ kind: "tool" as const, id: `tool:${tool.id}`, tool })),
  ]);
  const hasOverflow = $derived(stagedPresentations.length > collapsedLimit);
  const visiblePresentations = $derived(expanded ? stagedPresentations : stagedPresentations.slice(0, collapsedLimit));
  const hiddenCount = $derived(Math.max(0, stagedPresentations.length - collapsedLimit));

  function collapsedLimitForWidth(width: number): number {
    if (width < 420) return 1;
    if (width < 640) return 2;
    return 3;
  }

  async function updateCollapsedLimit(width: number): Promise<void> {
    const nextLimit = collapsedLimitForWidth(width);
    if (nextLimit === collapsedLimit) return;

    const activeItem = document.activeElement?.closest<HTMLElement>("[data-staged-item-index]");
    const activeIndex = Number(activeItem?.dataset.stagedItemIndex ?? -1);
    collapsedLimit = nextLimit;
    if (!expanded && activeIndex >= nextLimit) {
      await tick();
      disclosureElement?.focus();
    }
  }

  $effect(() => {
    const element = stagedItemsElement;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) void updateCollapsedLimit(entry.contentRect.width);
    });
    observer.observe(element);
    void updateCollapsedLimit(element.getBoundingClientRect().width);
    return () => observer.disconnect();
  });
</script>

<div class="flex min-w-0 flex-wrap items-center gap-1.5 px-3 pt-3" data-testid="composer-context-bar" data-staged-context-row aria-label="Staged context">
  {#if uploads.length > 0}
    <div class="flex min-w-0 w-full flex-wrap items-center gap-1.5" aria-label="File upload status">
      {#each uploads as upload (upload.id)}
        <div
          class={`flex min-w-0 w-full items-center gap-2 rounded-lg border px-3 py-2 text-xs ${upload.status === "failed" ? "border-destructive/50 bg-destructive/10" : "border-border bg-muted/40"}`}
          data-file-upload-status={upload.id}
          data-state={upload.status}
          role={upload.status === "failed" ? "alert" : "status"}
          aria-live={upload.status === "failed" ? "assertive" : "polite"}
        >
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium text-foreground">{upload.label}</span>
            <span class="block text-muted-foreground">{upload.status === "failed" ? upload.error ?? "Upload failed" : "Uploading…"}</span>
          </span>
          {#if upload.status === "failed"}
            <button type="button" class="h-8 rounded-md border border-border bg-card px-2 font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onclick={() => onRetryUpload?.(upload.id)}>Retry</button>
            <button type="button" class="h-8 rounded-md px-2 font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onclick={() => onRemoveUpload?.(upload.id)}>Remove</button>
          {:else}
            <button type="button" class="h-8 rounded-md px-2 font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onclick={() => onRemoveUpload?.(upload.id)}>Cancel</button>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if stagedPresentations.length > 0}
    <div
      bind:this={stagedItemsElement}
      id={stagedItemsId}
      class="staged-context-items flex min-w-0 w-full items-center gap-1.5"
      class:staged-context-items--expanded={expanded}
      data-expanded={expanded}
    >
      {#each visiblePresentations as presentation, index (presentation.id)}
        <div class="staged-context-item" data-staged-item={presentation.id} data-staged-item-index={index}>
          {#if presentation.kind === "context"}
            <ContextChip item={presentation.item} {onOpen} {onRemove} testId={`context-chip-${presentation.item.id}`} />
          {:else}
            <span
              class="inline-flex min-w-0 max-w-full items-center rounded-full border border-border bg-card text-xs text-foreground"
              data-pinned-tool={presentation.tool.id}
            >
              <span class="min-w-0 truncate pl-2.5 pr-1 py-1">{presentation.tool.label}</span>
              <button
                type="button"
                class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Unpin ${presentation.tool.label}`}
                onclick={() => onUnpin?.(presentation.tool.id)}
              >
                <span aria-hidden="true" class="text-[0.8rem] leading-none">×</span>
              </button>
            </span>
          {/if}
        </div>
      {/each}

      {#if hasOverflow}
        <button
          bind:this={disclosureElement}
          type="button"
          class="inline-flex h-8 shrink-0 items-center justify-center rounded-full border border-border bg-card px-2.5 text-xs font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-controls={stagedItemsId}
          aria-expanded={expanded}
          aria-label={expanded ? "Show fewer staged items" : `Show ${hiddenCount} more staged items`}
          data-staged-context-toggle
          onclick={() => (expanded = !expanded)}
        >
          {expanded ? "Show less" : `+${hiddenCount} more`}
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .staged-context-items {
    flex-wrap: nowrap;
  }

  .staged-context-items--expanded {
    flex-wrap: wrap;
  }

  .staged-context-item {
    min-width: 0;
    max-width: 100%;
    overflow: visible;
  }

  .staged-context-items:not(.staged-context-items--expanded) .staged-context-item {
    flex: 1 1 0;
  }
</style>

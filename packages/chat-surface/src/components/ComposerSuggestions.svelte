<script lang="ts">
  import type { ComposerCatalogStatus, ComposerSuggestionItem, ComposerTrigger } from "../composer-context.js";

  let {
    trigger,
    items,
    activeIndex,
    skillCatalogStatus,
    commandCatalogStatus,
    onRetry,
    onSelect,
  }: {
    trigger: ComposerTrigger;
    items: ComposerSuggestionItem[];
    activeIndex: number;
    skillCatalogStatus: ComposerCatalogStatus;
    commandCatalogStatus: ComposerCatalogStatus;
    onRetry?: () => void;
    onSelect: (item: ComposerSuggestionItem) => void;
  } = $props();

  const catalogUnavailable = $derived(trigger.marker === "$"
    ? skillCatalogStatus === "unavailable"
    : trigger.marker === "/" && (skillCatalogStatus === "unavailable" || commandCatalogStatus === "unavailable"));
  const catalogUnavailableMessage = $derived(trigger.marker === "$"
    ? "Skill catalog unavailable."
    : "Some command and skill catalogs are unavailable.");

  const emptyMessage = $derived(trigger.marker === "#"
    ? "Knowledge sources are not available yet."
    : trigger.marker === "@"
      ? "Mentions are reserved for pages and documents."
      : trigger.marker === "$"
        ? skillCatalogStatus === "loading" ? "Loading skills…" : "No matching skills."
        : skillCatalogStatus === "loading" || commandCatalogStatus === "loading"
          ? "Loading commands and skills…"
          : "No matching commands or skills.");
</script>

<div
  class="absolute bottom-full left-3 right-3 z-30 mb-2 max-h-72 overflow-auto rounded-xl border border-border bg-popover p-1.5 shadow-lg"
  role="listbox"
  aria-label={trigger.marker === "$" ? "Skill suggestions" : "Composer suggestions"}
  data-composer-suggestions={trigger.marker}
>
  {#if items.length === 0}
    <p class="px-3 py-2 text-xs text-muted-foreground">{emptyMessage}</p>
  {:else}
    {#each items as item, index (item.kind + item.id)}
      <button
        type="button"
        role="option"
        aria-selected={index === activeIndex}
        class="flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left hover:bg-accent"
        class:bg-accent={index === activeIndex}
        data-composer-suggestion={`${item.kind}:${item.id}`}
        onmousedown={(event) => event.preventDefault()}
        onclick={() => onSelect(item)}
      >
        <span class="mt-0.5 rounded border border-border px-1 text-[10px] font-semibold uppercase text-muted-foreground">{item.kind}</span>
        <span class="min-w-0">
          <span class="block truncate text-sm font-medium text-foreground">{item.label}</span>
          {#if item.description}<span class="block truncate text-xs text-muted-foreground">{item.description}</span>{/if}
        </span>
      </button>
    {/each}
  {/if}
  {#if catalogUnavailable}
    <div class="flex items-center justify-between gap-3 px-3 py-2 text-xs text-muted-foreground" role="status">
      <span>{catalogUnavailableMessage}</span>
      {#if onRetry}
        <button type="button" class="shrink-0 font-medium text-foreground underline" onclick={onRetry}>Retry catalogs</button>
      {/if}
    </div>
  {/if}
</div>

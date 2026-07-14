<script lang="ts">
  import type { AgentContextItem } from "@sonik-agent-ui/tool-contracts/run-context";
  import type { ComposerToolItem } from "../composer-context.js";
  import ContextChip from "./ContextChip.svelte";

  let {
    items,
    pinnedTools,
    uploads,
    onOpen,
    onRemove,
    onUnpin,
    onCancelUpload,
  }: {
    items: AgentContextItem[];
    pinnedTools: ComposerToolItem[];
    uploads: Array<{ id: string; label: string; error?: string }>;
    onOpen?: (item: AgentContextItem) => void;
    onRemove?: (id: string) => void;
    onUnpin?: (id: string) => void;
    onCancelUpload?: (id: string) => void;
  } = $props();

  let filesExpanded = $state(false);
  const documents = $derived(items.filter((item) => item.kind === "document"));
  const visibleItems = $derived(documents.length > 3 && !filesExpanded ? items.filter((item) => item.kind !== "document") : items);
</script>

<div class="flex flex-wrap items-center gap-1.5 px-3 pt-3" data-testid="composer-context-bar" aria-label="Staged context">
  {#if documents.length > 3 && !filesExpanded}
    <span class="inline-flex items-center rounded-full border border-border bg-card text-xs text-foreground">
      <button type="button" class="rounded-l-full px-2.5 py-1 hover:bg-accent" onclick={() => filesExpanded = true}>{documents.length} files</button>
      <button type="button" class="rounded-r-full px-2 py-1 text-muted-foreground hover:bg-accent" aria-label="Remove all staged files" onclick={() => documents.forEach((item) => onRemove?.(item.id))}>×</button>
    </span>
  {/if}
  {#each visibleItems as item (item.id)}
    <ContextChip {item} {onOpen} {onRemove} testId={`context-chip-${item.id}`} />
  {/each}
  {#each uploads as upload (upload.id)}
    <span class="inline-flex items-center rounded-full border border-border bg-card text-xs text-foreground" data-upload-chip={upload.id}>
      <span class="px-2.5 py-1">{upload.error ?? `Uploading ${upload.label}…`}</span>
      <button type="button" class="rounded-r-full px-2 py-1 text-muted-foreground hover:bg-accent" aria-label={`Cancel upload ${upload.label}`} onclick={() => onCancelUpload?.(upload.id)}>×</button>
    </span>
  {/each}
  {#each pinnedTools as tool (tool.id)}
    <span class="inline-flex items-center rounded-full border border-border bg-card text-xs text-foreground" data-pinned-tool={tool.id}>
      <span class="px-2.5 py-1">{tool.label}</span>
      <button type="button" class="rounded-r-full px-2 py-1 text-muted-foreground hover:bg-accent" aria-label={`Unpin ${tool.label}`} onclick={() => onUnpin?.(tool.id)}>×</button>
    </span>
  {/each}
</div>

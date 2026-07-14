<script lang="ts">
  import type { ComposerCatalogStatus, ComposerToolItem } from "../composer-context.js";

  let {
    tools,
    permissionModes,
    pinnedIds,
    catalogStatus,
    disabled = false,
    onPermissionChange,
    onPinChange,
    onRetry,
  }: {
    tools: ComposerToolItem[];
    permissionModes: Record<string, "off" | "ask" | "allow">;
    pinnedIds: string[];
    catalogStatus: ComposerCatalogStatus;
    disabled?: boolean;
    onPermissionChange?: (familyId: string, mode: "off" | "ask" | "allow") => void;
    onPinChange?: (toolId: string, pinned: boolean) => void;
    onRetry?: () => void;
  } = $props();

  let open = $state(false);
  let query = $state("");
  let serverId = $state<string | null>(null);
  let root = $state<HTMLDivElement | null>(null);
  const pinned = $derived(new Set(pinnedIds));
  const matches = $derived(tools.filter((tool) => !query || `${tool.label} ${tool.id} ${tool.description ?? ""}`.toLowerCase().includes(query.toLowerCase())));
  const servers = $derived([...new Set(matches.map((tool) => tool.serverId))]);
  const visibleTools = $derived(serverId ? matches.filter((tool) => tool.serverId === serverId) : []);
</script>

<svelte:window
  onmousedown={(event) => { if (open && root && !root.contains(event.target as Node)) open = false; }}
  onkeydown={(event) => { if (open && event.key === "Escape") { if (serverId) serverId = null; else open = false; } }}
/>

<div class="relative" bind:this={root}>
  <button
    type="button"
    class="inline-flex h-8 items-center gap-1 rounded-full border border-border bg-card px-2.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
    aria-label="Choose tools and MCP servers"
    aria-haspopup="dialog"
    aria-expanded={open}
    data-testid="composer-tool-selector-trigger"
    {disabled}
    onclick={() => { if (!disabled) open = !open; }}
  >
    Tools{#if pinnedIds.length}<span class="rounded-full bg-accent px-1.5">{pinnedIds.length}</span>{/if}
  </button>

  {#if open}
    <div class="absolute bottom-full left-0 z-40 mb-2 w-80 rounded-xl border border-border bg-popover p-2 shadow-lg" role="dialog" aria-label="Tool selector" data-testid="composer-tool-selector">
      {#if serverId}
        <button type="button" class="mb-1 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent" onclick={() => serverId = null}>Back to servers</button>
        <p class="px-2 pb-2 text-sm font-semibold text-foreground">{serverId}</p>
        <div class="max-h-64 overflow-auto">
          {#each visibleTools as tool (tool.id)}
            <div class="flex items-start gap-2 rounded-lg px-2 py-2 hover:bg-accent" data-tool-row={tool.id}>
              <label class="flex min-w-0 flex-1 cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  class="mt-1"
                  checked={(permissionModes[tool.familyId] ?? "ask") !== "off"}
                  onchange={(event) => onPermissionChange?.(tool.familyId, event.currentTarget.checked ? "ask" : "off")}
                />
                <span class="min-w-0">
                  <span class="block truncate text-sm font-medium text-foreground">{tool.label}</span>
                  <span class="block truncate text-xs text-muted-foreground">{tool.description ?? tool.id}</span>
                </span>
              </label>
              <button
                type="button"
                class="rounded-full border border-border px-2 py-1 text-[10px] font-semibold hover:bg-card"
                aria-pressed={pinned.has(tool.id)}
                aria-label={`${pinned.has(tool.id) ? "Unpin" : "Pin"} ${tool.label} for this conversation`}
                onclick={() => onPinChange?.(tool.id, !pinned.has(tool.id))}
              >{pinned.has(tool.id) ? "Pinned" : "Pin"}</button>
            </div>
          {/each}
        </div>
        <p class="px-2 pt-2 text-[10px] text-muted-foreground">Pins are conversation-scoped context preferences only. They do not grant server tools or bypass approval.</p>
      {:else}
        <input bind:value={query} class="mb-2 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground" placeholder="Search tools or servers" aria-label="Search tools or MCP servers" />
        <div class="max-h-64 overflow-auto">
          {#each servers as server (server)}
            <button type="button" class="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-foreground hover:bg-accent" onclick={() => serverId = server}>
              <span>{server}</span><span class="text-xs text-muted-foreground">{matches.filter((tool) => tool.serverId === server).length} tools</span>
            </button>
          {/each}
          {#if catalogStatus === "loading"}
            <p class="px-3 py-2 text-xs text-muted-foreground">Loading tools…</p>
          {:else if catalogStatus === "unavailable"}
            <p class="px-3 py-2 text-xs text-muted-foreground">Tool catalog unavailable.</p>
            {#if onRetry}<button type="button" class="px-3 pb-2 text-xs font-medium text-foreground underline" onclick={onRetry}>Retry tool catalog</button>{/if}
          {:else if servers.length === 0}
            <p class="px-3 py-2 text-xs text-muted-foreground">No tools match.</p>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

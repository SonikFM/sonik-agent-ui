<script lang="ts" module>
  import type { AgentContextItem, AgentContextKind } from "@sonik-agent-ui/tool-contracts/run-context";

  export interface ComposerContextMenuProps {
    /** Attachable context sources (already-attached items are filtered out by the parent or here). */
    sources: AgentContextItem[];
    /** Ids currently in the selection, hidden from the menu. */
    attachedIds?: string[];
    onAttach: (item: AgentContextItem) => void;
    disabled?: boolean;
  }
</script>

<script lang="ts">
  import { agentContextKindLabel, AGENT_CONTEXT_KINDS } from "@sonik-agent-ui/tool-contracts/run-context";

  let { sources, attachedIds = [], onAttach, disabled = false }: ComposerContextMenuProps = $props();

  let open = $state(false);
  let rootEl = $state<HTMLDivElement | null>(null);

  const attached = $derived(new Set(attachedIds));
  const available = $derived(sources.filter((item) => !attached.has(item.id)));
  // Group available sources by kind, preserving the contract's kind order so the
  // menu reads the same way every time.
  const groups = $derived(
    AGENT_CONTEXT_KINDS
      .map((kind) => ({ kind, label: agentContextKindLabel(kind), items: available.filter((item) => item.kind === kind) }))
      .filter((group) => group.items.length > 0),
  );

  function close(): void {
    open = false;
  }

  function toggle(): void {
    if (disabled) return;
    open = !open;
  }

  function pick(item: AgentContextItem): void {
    onAttach(item);
    close();
  }

  function handleWindowPointer(event: MouseEvent): void {
    if (!open) return;
    if (rootEl && !rootEl.contains(event.target as Node)) close();
  }

  function handleWindowKey(event: KeyboardEvent): void {
    if (open && event.key === "Escape") close();
  }
</script>

<svelte:window onmousedown={handleWindowPointer} onkeydown={handleWindowKey} />

<div class="relative" bind:this={rootEl}>
  <button
    type="button"
    class="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
    data-testid="composer-context-menu-trigger"
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label="Attach context"
    title="Attach context"
    {disabled}
    onclick={toggle}
  >
    <span aria-hidden="true" class="text-base leading-none">+</span>
  </button>

  {#if open}
    <div
      class="absolute bottom-full left-0 z-30 mb-2 max-h-72 w-64 overflow-auto rounded-xl border border-border bg-popover p-1.5 shadow-lg"
      role="menu"
      data-testid="composer-context-menu"
    >
      {#if groups.length === 0}
        <div class="px-2 py-3 text-center text-xs text-muted-foreground" data-testid="composer-context-menu-empty">
          No context sources to attach.
        </div>
      {:else}
        {#each groups as group (group.kind)}
          <div class="px-2 pb-1 pt-2 text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
            {group.label}
          </div>
          {#each group.items as item (item.id)}
            <button
              type="button"
              role="menuitem"
              class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-foreground hover:bg-accent transition-colors"
              data-context-source={item.id}
              onclick={() => pick(item)}
            >
              <span class="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-current opacity-50"></span>
              <span class="truncate">{item.label}</span>
            </button>
          {/each}
        {/each}
      {/if}
    </div>
  {/if}
</div>

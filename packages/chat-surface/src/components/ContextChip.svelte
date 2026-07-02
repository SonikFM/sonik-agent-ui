<script lang="ts" module>
  import type { AgentContextItem } from "@sonik-agent-ui/tool-contracts/run-context";

  export interface ContextChipProps {
    item: AgentContextItem;
    /** Read-only chips (message provenance) omit the remove button. */
    onRemove?: (id: string) => void;
    /** Test id forwarded to the chip element. */
    testId?: string;
  }
</script>

<script lang="ts">
  import { agentContextKindLabel, agentContextDetailLine } from "@sonik-agent-ui/tool-contracts/run-context";

  let { item, onRemove, testId }: ContextChipProps = $props();

  // Hover/focus reveals a minimal card: kind label + primary locator. Mirrors
  // Open Design's ContextChipHoverCard — intentionally lightweight (type + one
  // line), not an expandable panel.
  let open = $state(false);
  const kindLabel = $derived(agentContextKindLabel(item.kind));
  const detail = $derived(agentContextDetailLine(item));
</script>

<span
  class="relative inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs text-foreground shadow-sm"
  data-testid={testId}
  data-context-chip={item.id}
  data-context-kind={item.kind}
  data-context-source={item.source}
  onmouseenter={() => (open = true)}
  onmouseleave={() => (open = false)}
  onfocusin={() => (open = true)}
  onfocusout={() => (open = false)}
  role="group"
  aria-label={`${kindLabel}: ${item.label}`}
>
  <span class="h-1.5 w-1.5 rounded-full bg-current opacity-50"></span>
  <span class="max-w-[12rem] truncate font-medium">{item.label}</span>
  {#if onRemove}
    <button
      type="button"
      class="ml-0.5 -mr-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
      data-context-chip-remove={item.id}
      aria-label={`Remove ${item.label} from context`}
      onclick={() => onRemove?.(item.id)}
    >
      <span aria-hidden="true" class="text-[0.8rem] leading-none">×</span>
    </button>
  {/if}

  {#if open}
    <span
      class="absolute bottom-full left-0 z-30 mb-1.5 flex w-max max-w-xs flex-col gap-0.5 rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md"
      role="tooltip"
      data-context-chip-info={item.id}
    >
      <span class="font-medium text-foreground">{kindLabel}</span>
      {#if detail}
        <span class="break-all text-muted-foreground">{detail}</span>
      {/if}
    </span>
  {/if}
</span>

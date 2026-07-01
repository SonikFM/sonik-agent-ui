<script lang="ts">
  import type { BaseComponentProps } from "@json-render/svelte";
  import { Badge } from "$lib/components/ui/badge";

  type ActionItem = { id: string; label: string; description?: string | null; status?: "ready" | "blocked" | "preview" | "requires_confirmation" | null; commandId?: string | null };

  interface Props extends BaseComponentProps<{
    title?: string | null;
    actions?: ActionItem[] | null;
    emptyMessage?: string | null;
  }> {}

  let { props }: Props = $props();
  const actions = $derived(props.actions ?? []);
</script>

<aside class="rounded-xl border bg-card p-4 shadow-sm">
  <p class="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{props.title ?? "Action preview"}</p>
  {#if actions.length === 0}
    <p class="text-sm text-muted-foreground">{props.emptyMessage ?? "No actions are ready."}</p>
  {:else}
    <div class="flex flex-col gap-2">
      {#each actions as action}
        <div class="rounded-lg border bg-background p-3">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-sm font-medium">{action.label}</p>
              {#if action.description}<p class="text-xs text-muted-foreground">{action.description}</p>{/if}
              {#if action.commandId}<p class="mt-1 font-mono text-[11px] text-muted-foreground">{action.commandId}</p>{/if}
            </div>
            <Badge variant={action.status === "blocked" ? "destructive" : "secondary"}>{action.status ?? "preview"}</Badge>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</aside>

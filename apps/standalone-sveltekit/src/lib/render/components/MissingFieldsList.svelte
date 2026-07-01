<script lang="ts">
  import type { BaseComponentProps } from "@json-render/svelte";
  import { Badge } from "$lib/components/ui/badge";

  type MissingField = string | { field?: string | null; label?: string | null; reason?: string | null; severity?: "blocking" | "warning" | "optional" | null };

  interface Props extends BaseComponentProps<{
    title?: string | null;
    items?: MissingField[] | null;
    emptyMessage?: string | null;
  }> {}

  let { props }: Props = $props();
  const items = $derived(props.items ?? []);

  function fieldLabel(item: MissingField) {
    return typeof item === "string" ? item : item.label ?? item.field ?? "Missing field";
  }
  function reason(item: MissingField) {
    return typeof item === "string" ? null : item.reason ?? null;
  }
  function severity(item: MissingField) {
    return typeof item === "string" ? "blocking" : item.severity ?? "blocking";
  }
</script>

<div class="rounded-xl border bg-card p-4 shadow-sm">
  <p class="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{props.title ?? "Missing fields"}</p>
  {#if items.length === 0}
    <p class="text-sm text-muted-foreground">{props.emptyMessage ?? "No missing fields."}</p>
  {:else}
    <ul class="flex flex-col gap-2">
      {#each items as item}
        <li class="flex items-start justify-between gap-3 rounded-lg bg-muted/50 p-3">
          <div>
            <p class="text-sm font-medium">{fieldLabel(item)}</p>
            {#if reason(item)}<p class="text-xs text-muted-foreground">{reason(item)}</p>{/if}
          </div>
          <Badge variant={severity(item) === "blocking" ? "destructive" : "secondary"}>{severity(item)}</Badge>
        </li>
      {/each}
    </ul>
  {/if}
</div>

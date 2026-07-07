<script lang="ts">
  import type { BaseComponentProps } from "@json-render/svelte";
  import * as Table from "$lib/components/ui/table";
  import { Badge } from "$lib/components/ui/badge";

  type Row = { field: string; value?: unknown; confidence?: number | null; source?: string | null; status?: string | null; reviewRequired?: boolean | null };

  interface Props extends BaseComponentProps<{
    title?: string | null;
    rows?: Row[] | null;
    emptyMessage?: string | null;
  }> {}

  let { props }: Props = $props();
  const rows = $derived(props.rows ?? []);

  function percent(value?: number | null) {
    return typeof value === "number" ? `${Math.round(value * 100)}%` : "—";
  }
</script>

<div class="rounded-xl border bg-card p-4 shadow-sm">
  <p class="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{props.title ?? "Confidence"}</p>
  {#if rows.length === 0}
    <p class="text-sm text-muted-foreground">{props.emptyMessage ?? "No confidence data."}</p>
  {:else}
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>Field</Table.Head>
          <Table.Head>Confidence</Table.Head>
          <Table.Head>Source</Table.Head>
          <Table.Head>Status</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each rows as row}
          <Table.Row>
            <Table.Cell class="font-medium">{row.field}</Table.Cell>
            <Table.Cell>{percent(row.confidence)}</Table.Cell>
            <Table.Cell>{row.source ?? "—"}</Table.Cell>
            <Table.Cell>
              <Badge variant={row.reviewRequired ? "outline" : "secondary"}>{row.status ?? (row.reviewRequired ? "review" : "ok")}</Badge>
            </Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  {/if}
</div>

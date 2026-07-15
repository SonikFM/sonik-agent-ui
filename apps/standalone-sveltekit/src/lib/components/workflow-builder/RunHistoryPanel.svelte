<script lang="ts">
  import { Badge } from "$lib/components/ui/badge";
  import * as Card from "$lib/components/ui/card";
  import type { OperatorHistoryItem, OperatorRunProjection } from "./organizer-model";

  interface Props {
    runs?: OperatorRunProjection[];
    onInspect?: (kind: "event" | "approval" | "artifact" | "receipt", item: OperatorHistoryItem, run: OperatorRunProjection) => void;
  }

  let { runs = [], onInspect }: Props = $props();

  const sections = ["events", "approvals", "artifacts", "receipts"] as const;

  function inspect(section: typeof sections[number], item: OperatorHistoryItem, run: OperatorRunProjection): void {
    onInspect?.(section.slice(0, -1) as "event" | "approval" | "artifact" | "receipt", item, run);
  }
</script>

<section class="flex flex-col gap-4" aria-labelledby="operator-history-title" data-run-history-panel>
  <h2 id="operator-history-title" class="text-lg font-semibold">Operator history</h2>
  {#each runs as run (run.runId)}
    <Card.Root>
      <Card.Header>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <Card.Title>{run.runId}</Card.Title>
          <Badge variant="outline">{run.status}</Badge>
        </div>
        <Card.Description>
          <span>Correlation ID: <code>{run.correlationId}</code></span>
          <span class="ml-2">{run.occurredAt}</span>
        </Card.Description>
      </Card.Header>
      <Card.Content class="grid gap-4 md:grid-cols-2">
        {#each sections as section (section)}
          <div>
            <h3 class="mb-2 text-sm font-medium capitalize">{section}</h3>
            {#if run[section].length > 0}
              <ul class="flex flex-col gap-2">
                {#each run[section] as item (item.id)}
                  <li>
                    <button
                      type="button"
                      class="w-full rounded-md border border-border p-2 text-left text-sm hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onclick={() => inspect(section, item, run)}
                    >
                      <span class="font-medium">{item.type}: {item.label}</span>
                      {#if item.status}<span class="ml-2 text-muted-foreground">{item.status}</span>{/if}
                      {#if item.reference}<code class="mt-1 block text-xs">{item.reference}</code>{/if}
                    </button>
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="text-sm text-muted-foreground">None</p>
            {/if}
          </div>
        {/each}
      </Card.Content>
    </Card.Root>
  {:else}
    <p class="text-sm text-muted-foreground">No workflow runs recorded.</p>
  {/each}
</section>

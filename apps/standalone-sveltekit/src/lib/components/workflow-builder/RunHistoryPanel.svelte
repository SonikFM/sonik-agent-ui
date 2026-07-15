<script lang="ts">
  import { Badge } from "$lib/components/ui/badge";
  import * as Card from "$lib/components/ui/card";
  import type { WorkflowHistoryProjection } from "./organizer-model";

  type HistoryKind = "event" | "approval" | "artifact" | "receipt";
  type HistoryItem = WorkflowHistoryProjection["events"][number]
    | WorkflowHistoryProjection["approvals"][number]
    | WorkflowHistoryProjection["artifacts"][number]
    | WorkflowHistoryProjection["receipts"][number];

  interface Props {
    history?: WorkflowHistoryProjection | null;
    onInspect?: (kind: HistoryKind, item: HistoryItem) => void;
  }

  let { history = null, onInspect }: Props = $props();
</script>

<section class="flex flex-col gap-4" aria-labelledby="operator-history-title" data-run-history-panel>
  <h2 id="operator-history-title" class="text-lg font-semibold">Operator history</h2>
  {#if history}
    <Card.Root>
      <Card.Header>
        <Card.Title>Correlation</Card.Title>
        <Card.Description>Redacted join keys for this operator-history projection.</Card.Description>
      </Card.Header>
      <Card.Content class="flex flex-wrap gap-2 text-xs">
        {#each Object.entries(history.query) as [key, value] (key)}
          {#if value}<Badge variant="outline">{key}: {value}</Badge>{/if}
        {/each}
      </Card.Content>
    </Card.Root>

    <div class="grid gap-4 md:grid-cols-2">
      <Card.Root>
        <Card.Header><Card.Title>Events ({history.events.length})</Card.Title></Card.Header>
        <Card.Content>
          <ul class="flex flex-col gap-2">
            {#each history.events as event (event.eventId)}
              <li><button type="button" class="w-full rounded-md border p-2 text-left text-sm" onclick={() => onInspect?.("event", event)}><strong>{event.source}</strong> · {event.eventId}<br /><span class="text-muted-foreground">{event.timestamp}{event.status ? ` · ${event.status}` : ""}</span></button></li>
            {:else}<li class="text-sm text-muted-foreground">None</li>{/each}
          </ul>
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header><Card.Title>Approvals ({history.approvals.length})</Card.Title></Card.Header>
        <Card.Content>
          <ul class="flex flex-col gap-2">
            {#each history.approvals as approval (approval.approvalId)}
              <li><button type="button" class="w-full rounded-md border p-2 text-left text-sm" onclick={() => onInspect?.("approval", approval)}><strong>{approval.approvalId}</strong> · {approval.status ?? "unknown"}<br /><code class="text-xs">{approval.workflowRunId}/{approval.nodeId}</code></button></li>
            {:else}<li class="text-sm text-muted-foreground">None</li>{/each}
          </ul>
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header><Card.Title>Artifacts ({history.artifacts.length})</Card.Title></Card.Header>
        <Card.Content>
          <ul class="flex flex-col gap-2">
            {#each history.artifacts as artifact (artifact.artifactId)}
              <li><button type="button" class="w-full rounded-md border p-2 text-left text-sm" onclick={() => onInspect?.("artifact", artifact)}><strong>{artifact.artifactId}</strong> · {artifact.status ?? "unknown"}<br /><code class="text-xs">{artifact.workflowRunId}/{artifact.nodeId}</code></button></li>
            {:else}<li class="text-sm text-muted-foreground">None</li>{/each}
          </ul>
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header><Card.Title>Receipts ({history.receipts.length})</Card.Title></Card.Header>
        <Card.Content>
          <ul class="flex flex-col gap-2">
            {#each history.receipts as receipt (receipt.receiptId)}
              <li><button type="button" class="w-full rounded-md border p-2 text-left text-sm" onclick={() => onInspect?.("receipt", receipt)}><strong>{receipt.receiptId}</strong> · {receipt.status ?? "unknown"}<br /><code class="text-xs">{receipt.workflowRunId}/{receipt.nodeId}</code></button></li>
            {:else}<li class="text-sm text-muted-foreground">None</li>{/each}
          </ul>
        </Card.Content>
      </Card.Root>
    </div>
  {:else}
    <p class="text-sm text-muted-foreground">No workflow history loaded.</p>
  {/if}
</section>

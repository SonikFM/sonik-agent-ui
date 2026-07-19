<script lang="ts">
  import { Badge } from "$lib/components/ui/badge";
  import * as Card from "$lib/components/ui/card";
  import { workflowHistoryItemKey, type WorkflowHistoryProjection } from "./organizer-model";

  type HistoryKind = "event" | "approval" | "artifact" | "receipt";
  type HistoryItem = WorkflowHistoryProjection["events"][number]
    | WorkflowHistoryProjection["approvals"][number]
    | WorkflowHistoryProjection["artifacts"][number]
    | WorkflowHistoryProjection["receipts"][number];
  type CorrelatedEvent = WorkflowHistoryProjection["events"][number] & {
    attemptId?: string | null;
    correlationIds?: string[];
    type?: string;
  };

  interface Props {
    history?: WorkflowHistoryProjection | null;
    onInspect?: (kind: HistoryKind, item: HistoryItem) => void;
  }

  let { history = null, onInspect }: Props = $props();
  let events = $derived((history?.events ?? []) as CorrelatedEvent[]);
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
        <Card.Header><Card.Title>Conversation runs ({history.conversations.length})</Card.Title></Card.Header>
        <Card.Content>
          <ul class="flex flex-col gap-2">
            {#each history.conversations as conversation (conversation.conversationRunId)}
              <li class="rounded-md border p-2 text-sm"><strong>{conversation.conversationRunId}</strong> · {conversation.status ?? "unknown"}<br /><code class="text-xs">{conversation.sessionId}{conversation.requestId ? ` / ${conversation.requestId}` : ""}{conversation.traceId ? ` / ${conversation.traceId}` : ""}</code></li>
            {:else}<li class="text-sm text-muted-foreground">None</li>{/each}
          </ul>
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header><Card.Title>Workflow runs ({history.workflows.length})</Card.Title></Card.Header>
        <Card.Content>
          <ul class="flex flex-col gap-2">
            {#each history.workflows as workflow (workflow.workflowRunId)}
              <li class="rounded-md border p-2 text-sm"><strong>{workflow.workflowRunId}</strong> · {workflow.status ?? "unknown"}<br /><code class="text-xs">{workflow.workflowVersionId} / {workflow.sessionId}</code></li>
            {:else}<li class="text-sm text-muted-foreground">None</li>{/each}
          </ul>
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header><Card.Title>Nodes ({history.nodes.length})</Card.Title></Card.Header>
        <Card.Content>
          <ul class="flex flex-col gap-2">
            {#each history.nodes as node (workflowHistoryItemKey(node.workflowRunId, node.nodeId))}
              <li class="rounded-md border p-2 text-sm"><strong>{node.nodeId}</strong> · {node.status ?? "unknown"}<br /><code class="text-xs">{node.workflowRunId}</code></li>
            {:else}<li class="text-sm text-muted-foreground">None</li>{/each}
          </ul>
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header><Card.Title>Tool calls ({history.toolCalls.length})</Card.Title></Card.Header>
        <Card.Content>
          <ul class="flex flex-col gap-2">
            {#each history.toolCalls as toolCall (toolCall.toolCallId)}
              <li class="rounded-md border p-2 text-sm"><strong>{toolCall.toolCallId}</strong> · {toolCall.status ?? "unknown"}<br /><code class="text-xs">{toolCall.sessionId}{toolCall.requestId ? ` / ${toolCall.requestId}` : ""}</code></li>
            {:else}<li class="text-sm text-muted-foreground">None</li>{/each}
          </ul>
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header><Card.Title>Events ({events.length})</Card.Title></Card.Header>
        <Card.Content>
          <ul class="flex flex-col gap-2">
            {#each events as event (event.eventId)}
              <li><button type="button" class="w-full rounded-md border p-2 text-left text-sm" onclick={() => onInspect?.("event", event)}><strong>{event.source}</strong> · {event.type ?? event.eventId}<br /><span class="text-muted-foreground">{event.timestamp}{event.status ? ` · ${event.status}` : ""}</span>{#if event.attemptId}<br /><code class="text-xs">attempt: {event.attemptId}</code>{/if}{#if event.correlationIds?.length}<br /><code class="text-xs">joins: {event.correlationIds.join(", ")}</code>{/if}</button></li>
            {:else}<li class="text-sm text-muted-foreground">None</li>{/each}
          </ul>
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header><Card.Title>Approvals ({history.approvals.length})</Card.Title></Card.Header>
        <Card.Content>
          <ul class="flex flex-col gap-2">
            {#each history.approvals as approval (workflowHistoryItemKey(approval.workflowRunId, approval.approvalId))}
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
            {#each history.receipts as receipt (workflowHistoryItemKey(receipt.workflowRunId, receipt.receiptId))}
              <li><button type="button" class="w-full rounded-md border p-2 text-left text-sm" onclick={() => onInspect?.("receipt", receipt)}><strong>{receipt.receiptId}</strong> · {receipt.semanticStatus ?? "unknown"}<br /><code class="text-xs">{receipt.workflowRunId}/{receipt.nodeId}</code></button></li>
            {:else}<li class="text-sm text-muted-foreground">None</li>{/each}
          </ul>
        </Card.Content>
      </Card.Root>
    </div>
  {:else}
    <p class="text-sm text-muted-foreground">No workflow history loaded.</p>
  {/if}
</section>

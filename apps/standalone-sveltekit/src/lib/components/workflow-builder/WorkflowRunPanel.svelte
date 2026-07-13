<script lang="ts">
  // P1 #5 (production-readiness-agent-creation-2026-07-13.md): the workflow-builder's Run
  // affordance -- drives POST /api/workflow-runs through its start -> preview -> approve -> commit
  // lifecycle for a workflow definition. The card fields (status/disabled/disabledReason) come from
  // the SAME createApprovalAffordanceFromWorkflowRun builder the reservation and campaign flows
  // already share (D011) -- this is that builder's first non-reservation UI instance, not a
  // hand-rolled card. "Approve" here is the operator clicking a host-side button, never a
  // model-callable tool; the server derives hostSigned from the resolved trusted host session, not
  // from anything this component sends.
  //
  // ponytail: the campaign brief inputs are hardcoded to the one workflow this endpoint has a real
  // callback for (amplify.campaign.create) -- generalize to a per-workflow input schema when a
  // second callback-backed workflow needs its own shape.
  import * as Card from "$lib/components/ui/card";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { Input } from "$lib/components/ui/input";
  import { createApprovalAffordanceFromWorkflowRun } from "../../agent-workflows/approval-affordance";
  import type { WorkflowDefinition } from "@sonik-agent-ui/tool-contracts/marketplace";
  import type { WorkflowRunState } from "@sonik-agent-ui/tool-contracts/workflow-run-state";

  interface Props {
    workflow: WorkflowDefinition;
  }
  let { workflow }: Props = $props();

  const previewNodeId = $derived(workflow.nodes.find((node) => node.type === "tool_preview")?.nodeId ?? null);
  const commitNodeId = $derived(workflow.nodes.find((node) => node.type === "tool_commit")?.nodeId ?? null);
  const needsCampaignBrief = $derived(workflow.workflowId === "amplify.campaign.create");

  let brief = $state({ productName: "Loyalty Weekend", audience: "returning_members", offer: "20% off", launchDate: "2026-08-01" });
  let runId = $state<string | null>(null);
  let run = $state<WorkflowRunState | null>(null);
  let statusMessage = $state("");
  let busy = $state(false);
  let receiptRef = $state<string | null>(null);

  async function callEndpoint(body: Record<string, unknown>): Promise<{ ok: boolean; reason?: string; run?: WorkflowRunState }> {
    const response = await fetch("/api/workflow-runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return response.json();
  }

  async function start(): Promise<void> {
    busy = true;
    statusMessage = "";
    receiptRef = null;
    try {
      const result = await callEndpoint({
        action: "start",
        workflowId: workflow.workflowId,
        ...(needsCampaignBrief ? { brief } : { workflow }),
      });
      if (!result.ok || !result.run) {
        statusMessage = result.reason ?? "Run could not be started.";
        run = null;
        runId = null;
        return;
      }
      run = result.run;
      runId = result.run.runId;
      statusMessage = "Run started.";
    } finally {
      busy = false;
    }
  }

  async function preview(): Promise<void> {
    if (!runId || !previewNodeId) return;
    busy = true;
    try {
      const result = await callEndpoint({ action: "preview", runId, nodeId: previewNodeId });
      run = result.run ?? run;
      statusMessage = result.ok ? "Preview ready." : (result.reason ?? "Preview failed.");
    } finally {
      busy = false;
    }
  }

  async function approve(): Promise<void> {
    if (!runId || !commitNodeId) return;
    busy = true;
    try {
      const result = await callEndpoint({ action: "approve", runId, nodeId: commitNodeId });
      run = result.run ?? run;
      statusMessage = result.ok ? "Approved." : (result.reason ?? "Approval failed.");
    } finally {
      busy = false;
    }
  }

  async function commit(): Promise<void> {
    if (!runId || !commitNodeId) return;
    busy = true;
    try {
      const result = await callEndpoint({ action: "commit", runId, nodeId: commitNodeId });
      run = result.run ?? run;
      statusMessage = result.ok ? "Committed." : (result.reason ?? "Commit failed.");
      receiptRef = result.ok ? (result.run?.receipts.at(-1)?.receiptRef ?? null) : null;
    } finally {
      busy = false;
    }
  }

  function reset(): void {
    runId = null;
    run = null;
    statusMessage = "";
    receiptRef = null;
  }

  const affordance = $derived(
    run
      ? createApprovalAffordanceFromWorkflowRun(run, {
          title: "Approve this run",
          description: workflow.title,
          onRequestPreview: () => void preview(),
          onApprove: () => void approve(),
          onCancel: reset,
        })
      : null,
  );
</script>

<Card.Root data-workflow-run-panel={workflow.workflowId}>
  <Card.Header>
    <Card.Title>Run</Card.Title>
    <Card.Description>Drive this workflow through the shipped controller: start, preview, approve, commit.</Card.Description>
  </Card.Header>
  <Card.Content class="flex flex-col gap-3">
    {#if needsCampaignBrief && !runId}
      <div class="grid grid-cols-2 gap-2">
        <Input placeholder="Product name" bind:value={brief.productName} />
        <Input placeholder="Audience" bind:value={brief.audience} />
        <Input placeholder="Offer" bind:value={brief.offer} />
        <Input placeholder="Launch date" bind:value={brief.launchDate} />
      </div>
    {/if}

    <div class="flex items-center gap-2">
      {#if !runId}
        <Button onclick={() => void start()} disabled={busy}>Run</Button>
      {:else}
        <Badge variant="outline">{run?.phase}</Badge>
        <Button variant="outline" onclick={reset} disabled={busy}>Reset</Button>
      {/if}
    </div>

    {#if statusMessage}
      <p class="text-sm text-muted-foreground" data-workflow-run-status>{statusMessage}</p>
    {/if}

    {#if affordance}
      <div class="rounded-md border border-border p-3" data-workflow-run-approval-card data-status={affordance.status}>
        <div class="flex items-center justify-between">
          <p class="text-sm font-semibold">{affordance.title}</p>
          <Badge variant={affordance.status === "approval_required" ? "default" : "secondary"}>{affordance.status}</Badge>
        </div>
        <p class="text-sm text-muted-foreground">{affordance.description}</p>
        {#if affordance.disabled && affordance.disabledReason}
          <p class="text-xs font-medium text-destructive">{affordance.disabledReason}</p>
        {/if}
        <div class="mt-2 flex gap-2">
          <Button size="sm" onclick={affordance.onApprove} disabled={busy || affordance.disabled || run?.approvalState.status === "approved"}>
            {run?.approvalState.status === "approved" ? "Approved" : "Approve"}
          </Button>
          {#if run?.approvalState.status === "approved" && run.phase !== "committed"}
            <Button size="sm" variant="outline" onclick={() => void commit()} disabled={busy}>Commit</Button>
          {/if}
        </div>
      </div>
    {/if}

    {#if receiptRef}
      <p class="text-sm" data-workflow-run-receipt>Committed. Receipt: <span class="font-mono text-xs">{receiptRef}</span></p>
    {/if}
  </Card.Content>
</Card.Root>

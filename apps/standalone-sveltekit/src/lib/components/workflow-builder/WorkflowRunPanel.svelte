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
  import * as Card from "$lib/components/ui/card";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { createApprovalAffordanceFromWorkflowRun } from "../../agent-workflows/approval-affordance";
  import { resolveWorkflowRunActionDisabledState, resolveWorkflowRunBusyDisabledState } from "./builder-model";
  import type { WorkflowDefinition } from "@sonik-agent-ui/tool-contracts/marketplace";
  import type { WorkflowRunState } from "@sonik-agent-ui/tool-contracts/workflow-run-state";

  interface Props {
    workflow: WorkflowDefinition;
    workspaceFetch: typeof fetch;
    signedHostApprovedCommandIds?: string[];
    onRunStateChange?: (workflowId: string, run: WorkflowRunState | null) => void;
  }
  let { workflow, workspaceFetch, signedHostApprovedCommandIds = [], onRunStateChange }: Props = $props();

  const previewNodeId = $derived(workflow.nodes.find((node) => node.type === "tool_preview")?.nodeId ?? null);
  const commitNodeId = $derived(workflow.nodes.find((node) => node.type === "tool_commit")?.nodeId ?? null);
  const needsCampaignBrief = $derived(workflow.workflowId === "amplify.campaign.create");

  let workflowInput = $state(needsCampaignBrief
    ? JSON.stringify({ productName: "Loyalty Weekend", audience: "returning_members", offer: "20% off", launchDate: "2026-08-01" }, null, 2)
    : "{}");
  let resumeAnswer = $state("");
  let runId = $state<string | null>(null);
  let run = $state<WorkflowRunState | null>(null);
  let statusMessage = $state("");
  let busy = $state(false);
  let receiptRef = $state<string | null>(null);
  const traceRows = $derived(run ? Object.values(run.nodeStates) : []);

  const commitCommandId = $derived(
    commitNodeId ? (run?.nodeStates[commitNodeId]?.commandId ?? null) : null,
  );
  const signedHostGrantCoversCommit = $derived(Boolean(
    commitCommandId && signedHostApprovedCommandIds.includes(commitCommandId),
  ));
  const runApprovalCoversCommit = $derived(Boolean(
    commitCommandId
      && run?.approvalState.status === "approved"
      && run.approvalState.hostSigned
      && run.approvalState.approvedCommandIds.includes(commitCommandId),
  ));
  const disabledReasonIdBase = $derived(`workflow-run-${workflow.workflowId.replace(/[^a-zA-Z0-9_-]/g, "-")}`);
  const busyDisabledState = $derived(resolveWorkflowRunBusyDisabledState(busy));
  const previewDisabledState = $derived(resolveWorkflowRunActionDisabledState({
    action: "preview",
    busy,
    hasRun: Boolean(runId && run),
    hasPreviewNode: Boolean(previewNodeId),
    hasCommitNode: Boolean(commitNodeId && commitCommandId),
    phase: run?.phase ?? null,
    approvalStatus: run?.approvalState.status ?? null,
    signedHostGrantCoversCommit,
    runApprovalCoversCommit,
  }));
  const approveDisabledState = $derived(resolveWorkflowRunActionDisabledState({
    action: "approve",
    busy,
    hasRun: Boolean(runId && run),
    hasPreviewNode: Boolean(previewNodeId),
    hasCommitNode: Boolean(commitNodeId && commitCommandId),
    phase: run?.phase ?? null,
    approvalStatus: run?.approvalState.status ?? null,
    signedHostGrantCoversCommit,
    runApprovalCoversCommit,
  }));
  const commitDisabledState = $derived(resolveWorkflowRunActionDisabledState({
    action: "commit",
    busy,
    hasRun: Boolean(runId && run),
    hasPreviewNode: Boolean(previewNodeId),
    hasCommitNode: Boolean(commitNodeId && commitCommandId),
    phase: run?.phase ?? null,
    approvalStatus: run?.approvalState.status ?? null,
    signedHostGrantCoversCommit,
    runApprovalCoversCommit,
  }));

  function updateRun(nextRun: WorkflowRunState | null): void {
    run = nextRun;
    onRunStateChange?.(workflow.workflowId, nextRun);
  }

  async function callEndpoint(body: Record<string, unknown>): Promise<{ ok: boolean; reason?: string; run?: WorkflowRunState }> {
    try {
      const response = await workspaceFetch("/api/workflow-runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => null) as { ok?: boolean; reason?: string; run?: WorkflowRunState } | null;
      return {
        ok: response.ok && result?.ok === true,
        ...(result?.reason ? { reason: result.reason } : {}),
        ...(result?.run ? { run: result.run } : {}),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      return {
        ok: false,
        reason: message.includes("missing-host-context")
          ? "missing_signed_host_context"
          : "workflow_run_request_failed",
      };
    }
  }

  async function start(): Promise<void> {
    busy = true;
    statusMessage = "";
    receiptRef = null;
    try {
      let input: unknown;
      try { input = JSON.parse(workflowInput); }
      catch { statusMessage = "Workflow input must be valid JSON."; return; }
      const result = await callEndpoint({
        action: "start",
        workflowId: workflow.workflowId,
        ...(needsCampaignBrief ? { brief: input } : { workflow, workflowInput: input }),
      });
      if (!result.ok || !result.run) {
        statusMessage = result.reason ?? "Run could not be started.";
        updateRun(null);
        runId = null;
        return;
      }
      updateRun(result.run);
      runId = result.run.runId;
      statusMessage = "Run started.";
    } finally {
      busy = false;
    }
  }

  async function resume(kind: "answer" | "approval"): Promise<void> {
    if (!runId) return;
    const wait = (run as unknown as { waits?: Array<{ waitpointId: string; nodeId: string; logicalEffectId?: string }> })?.waits?.[0];
    if (!wait) { statusMessage = "This run has no active waitpoint to resume."; return; }
    busy = true;
    try {
      const resumeEvent = {
        kind,
        eventId: crypto.randomUUID(),
        issuedAt: new Date().toISOString(),
        waitpointId: wait.waitpointId,
        nodeId: wait.nodeId,
        ...(kind === "answer" ? { answer: resumeAnswer } : { logicalEffectId: wait.logicalEffectId ?? "" }),
      };
      const result = await callEndpoint({ action: "resume_run", request: { workflowRunId: runId, resumeEvent } });
      updateRun(result.run ?? run);
      statusMessage = result.ok ? "Run resumed." : (result.reason ?? "Resume failed.");
    } finally { busy = false; }
  }

  async function preview(): Promise<void> {
    if (!runId || !previewNodeId || previewDisabledState) return;
    busy = true;
    try {
      const result = await callEndpoint({ action: "preview", runId, nodeId: previewNodeId });
      updateRun(result.run ?? run);
      statusMessage = result.ok ? "Preview ready." : (result.reason ?? "Preview failed.");
    } finally {
      busy = false;
    }
  }

  async function approve(): Promise<void> {
    if (!runId || !commitNodeId || approveDisabledState) return;
    busy = true;
    try {
      const result = await callEndpoint({ action: "approve", runId, nodeId: commitNodeId });
      updateRun(result.run ?? run);
      statusMessage = result.ok ? "Approved." : (result.reason ?? "Approval failed.");
    } finally {
      busy = false;
    }
  }

  async function commit(): Promise<void> {
    if (!runId || !commitNodeId || commitDisabledState) return;
    busy = true;
    try {
      const result = await callEndpoint({ action: "commit", runId, nodeId: commitNodeId });
      updateRun(result.run ?? run);
      statusMessage = result.ok ? "Committed." : (result.reason ?? "Commit failed.");
      receiptRef = result.ok ? (result.run?.receipts.at(-1)?.receiptRef ?? null) : null;
    } finally {
      busy = false;
    }
  }

  function reset(): void {
    runId = null;
    updateRun(null);
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
          ...(run.phase === "preview_ready" && !signedHostGrantCoversCommit
            ? { disabledReason: "trusted_host_approval_required" }
            : {}),
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
    {#if !runId}
      <label class="grid gap-1 text-sm">
        <span class="font-medium">Workflow input (JSON)</span>
        <textarea class="min-h-28 rounded-md border border-input bg-background p-2 font-mono text-xs" bind:value={workflowInput}></textarea>
      </label>
    {/if}

    <div class="flex items-center gap-2">
      {#if !runId}
        <Button
          onclick={() => void start()}
          disabled={Boolean(busyDisabledState)}
          data-disabled-reason={busyDisabledState?.code}
          aria-describedby={busyDisabledState ? `${disabledReasonIdBase}-busy-disabled` : undefined}
        >Run</Button>
      {:else}
        <Badge variant="outline">{run?.phase}</Badge>
        <Button
          variant="outline"
          onclick={reset}
          disabled={Boolean(busyDisabledState)}
          data-disabled-reason={busyDisabledState?.code}
          aria-describedby={busyDisabledState ? `${disabledReasonIdBase}-busy-disabled` : undefined}
        >Reset</Button>
      {/if}
    </div>

    {#if busyDisabledState}
      <p
        id={`${disabledReasonIdBase}-busy-disabled`}
        class="text-xs text-muted-foreground"
        aria-live="polite"
        data-workflow-run-disabled-reason={runId ? "reset" : "run"}
      >
        {busyDisabledState.message}
      </p>
    {/if}

    {#if statusMessage}
      <p class="text-sm text-muted-foreground" data-workflow-run-status>{statusMessage}</p>
    {/if}

    {#if (run as unknown as { waits?: unknown[] } | null)?.waits?.length}
      <div class="grid gap-2 rounded-md border border-border p-3" data-workflow-run-waitpoint>
        <p class="text-sm font-medium">Run paused at a human waitpoint.</p>
        <textarea class="min-h-16 rounded-md border border-input bg-background p-2 text-sm" placeholder="Answer" bind:value={resumeAnswer}></textarea>
        <div class="flex gap-2">
          <Button size="sm" onclick={() => void resume("answer")} disabled={busy || !resumeAnswer.trim()}>Answer &amp; resume</Button>
          <Button size="sm" variant="outline" onclick={() => void resume("approval")} disabled={busy}>Approve &amp; resume</Button>
        </div>
      </div>
    {/if}

    {#if affordance}
      <div class="rounded-md border border-border p-3" data-workflow-run-approval-card data-status={affordance.status}>
        <div class="flex items-center justify-between">
          <p class="text-sm font-semibold">{affordance.title}</p>
          <Badge variant={affordance.status === "approval_required" ? "default" : "secondary"}>{affordance.status}</Badge>
        </div>
        <p class="text-sm text-muted-foreground">{affordance.description}</p>
        {#if affordance.disabled && affordance.disabledReason && affordance.disabledReason !== "trusted_host_approval_required"}
          <p class="text-xs font-medium text-destructive" data-approval-disabled-reason>{affordance.disabledReason}</p>
        {/if}
        <div class="mt-2 flex gap-2">
          {#if run?.phase !== "preview_ready" && run?.approvalState.status !== "approved" && run?.phase !== "committed"}
            <Button
              size="sm"
              variant="outline"
              onclick={affordance.onRequestPreview}
              disabled={Boolean(previewDisabledState)}
              data-disabled-reason={previewDisabledState?.code}
              aria-describedby={previewDisabledState ? `${disabledReasonIdBase}-preview-disabled` : undefined}
            >Preview</Button>
          {/if}
          <Button
            size="sm"
            onclick={affordance.onApprove}
            disabled={Boolean(approveDisabledState)}
            data-disabled-reason={approveDisabledState?.code}
            aria-describedby={approveDisabledState ? `${disabledReasonIdBase}-approve-disabled` : undefined}
          >
            {run?.approvalState.status === "approved" ? "Approved" : "Approve"}
          </Button>
          {#if run?.approvalState.status === "approved" && run.phase !== "committed"}
            <Button
              size="sm"
              variant="outline"
              onclick={() => void commit()}
              disabled={Boolean(commitDisabledState)}
              data-disabled-reason={commitDisabledState?.code}
              aria-describedby={commitDisabledState ? `${disabledReasonIdBase}-commit-disabled` : undefined}
            >Commit</Button>
          {/if}
        </div>
        <div class="mt-2 grid gap-1" aria-live="polite">
          {#if run?.phase !== "preview_ready" && run?.approvalState.status !== "approved" && run?.phase !== "committed" && previewDisabledState}
            <p id={`${disabledReasonIdBase}-preview-disabled`} class="text-xs text-muted-foreground" data-workflow-run-disabled-reason="preview">
              {previewDisabledState.message}
            </p>
          {/if}
          {#if approveDisabledState}
            <p id={`${disabledReasonIdBase}-approve-disabled`} class="text-xs text-muted-foreground" data-workflow-run-disabled-reason="approve">
              {approveDisabledState.message}
            </p>
          {/if}
          {#if run?.approvalState.status === "approved" && run.phase !== "committed" && commitDisabledState}
            <p id={`${disabledReasonIdBase}-commit-disabled`} class="text-xs text-muted-foreground" data-workflow-run-disabled-reason="commit">
              {commitDisabledState.message}
            </p>
          {/if}
        </div>
      </div>
    {/if}

    {#if receiptRef}
      <p class="text-sm" data-workflow-run-receipt>Committed. Receipt: <span class="font-mono text-xs">{receiptRef}</span></p>
    {/if}
    {#if traceRows.length > 0}
      <details data-workflow-run-trace>
        <summary class="cursor-pointer text-sm font-medium">Run trace ({traceRows.length} nodes)</summary>
        <ol class="mt-2 grid gap-1 text-xs">
          {#each traceRows as node}
            <li><span class="font-mono">{node.nodeId}</span> — {node.status}</li>
          {/each}
        </ol>
      </details>
    {/if}
    {#if run?.receipts.length}
      <details data-workflow-run-history>
        <summary class="cursor-pointer text-sm font-medium">Receipts ({run.receipts.length})</summary>
        {#each run.receipts as receipt}
          <p class="font-mono text-xs">{receipt.receiptRef}</p>
        {/each}
      </details>
    {/if}
  </Card.Content>
</Card.Root>

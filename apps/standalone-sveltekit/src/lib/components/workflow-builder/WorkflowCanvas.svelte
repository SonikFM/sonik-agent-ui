<script lang="ts">
  // Phase 5 (agent-creation-tool-plan-2026-07-13.md, B2): node/edge editing
  // over `workflowDefinitionSchema` documents. LOCKED renders read-only (no
  // add/edit controls) -- used for example/published workflows; DRAFT allows
  // editing. ponytail: a small ordered-card + edge-list layout, not a
  // drag/pan graph canvas -- the reservation fixture and the campaign demo
  // (Decision 2) are both deliberately linear, single-digit node counts, so a
  // full @xyflow-style canvas (the copied Amplify source's dependency, not
  // installed here) buys nothing this wave. Upgrade path if a future non-linear
  // workflow needs it: a real positioned graph view.
  import * as Card from "$lib/components/ui/card";
  import * as Select from "$lib/components/ui/select";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Badge } from "$lib/components/ui/badge";
  import { Separator } from "$lib/components/ui/separator";
  import {
    WORKFLOW_NODE_TYPES,
    LIVE_CONTROLLER_NODE_TYPES,
    validateWorkflowDefinition,
    type WorkflowLockState,
  } from "./builder-model";
  import type { WorkflowDefinition, WorkflowNodeDefinition, WorkflowNodeType } from "@sonik-agent-ui/tool-contracts/marketplace";

  type NodeEffect = WorkflowNodeDefinition["effect"];
  type NodeApprovalPolicy = WorkflowNodeDefinition["approvalPolicy"];

  interface Props {
    workflow: WorkflowDefinition;
    lockState: WorkflowLockState;
    onMutation?: () => void;
  }
  let { workflow = $bindable(), lockState, onMutation }: Props = $props();

  const locked = $derived(lockState === "locked");
  const EFFECTS: NodeEffect[] = ["none", "read", "write", "external", "destructive"];
  const APPROVAL_POLICIES: NodeApprovalPolicy[] = ["none", "preview", "preview_then_trusted_approval"];

  const liveValidation = $derived(validateWorkflowDefinition(workflow));
  let undoStack = $state<WorkflowDefinition[]>([]);
  let announcement = $state("");

  function commit(next: WorkflowDefinition, message = "Workflow updated."): void {
    if (locked) return;
    undoStack = [...undoStack.slice(-19), structuredClone($state.snapshot(workflow))];
    workflow = next;
    announcement = message;
    onMutation?.();
  }

  function patchWorkflow(next: Partial<WorkflowDefinition>): void {
    commit({ ...workflow, ...next });
  }

  function patchNode(nodeId: string, patch: Partial<WorkflowNodeDefinition>): void {
    commit({ ...workflow, nodes: workflow.nodes.map((node) => (node.nodeId === nodeId ? { ...node, ...patch } : node)) });
  }

  function addNode(): void {
    if (locked) return;
    const nodeId = `node_${workflow.nodes.length + 1}`;
    commit({
      ...workflow,
      nodes: [...workflow.nodes, { nodeId, type: "ask_user", title: "New step", effect: "none", approvalPolicy: "none", requiredHostContext: [] }],
    }, `Added ${nodeId}.`);
  }

  function removeNode(nodeId: string): void {
    if (locked) return;
    commit({
      ...workflow,
      nodes: workflow.nodes.filter((node) => node.nodeId !== nodeId),
      edges: workflow.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId),
    }, `Deleted ${nodeId}.`);
  }

  function addEdge(): void {
    if (locked || workflow.nodes.length < 2) return;
    const edgeId = `edge_${workflow.edges.length + 1}`;
    commit({ ...workflow, edges: [...workflow.edges, { edgeId, from: workflow.nodes[0].nodeId, to: workflow.nodes[1].nodeId }] }, `Connected ${workflow.nodes[0].nodeId} to ${workflow.nodes[1].nodeId}.`);
  }

  function patchEdge(edgeId: string, patch: Partial<WorkflowDefinition["edges"][number]>): void {
    commit({ ...workflow, edges: workflow.edges.map((edge) => (edge.edgeId === edgeId ? { ...edge, ...patch } : edge)) });
  }

  function removeEdge(edgeId: string): void {
    if (locked) return;
    commit({ ...workflow, edges: workflow.edges.filter((edge) => edge.edgeId !== edgeId) }, `Disconnected ${edgeId}.`);
  }

  function undo(): void {
    const previous = undoStack.at(-1);
    if (!previous || locked) return;
    undoStack = undoStack.slice(0, -1);
    workflow = previous;
    announcement = "Undid the last canvas change.";
    onMutation?.();
  }

  function focusNode(index: number): void {
    const next = Math.max(0, Math.min(workflow.nodes.length - 1, index));
    document.querySelector<HTMLElement>(`[data-workflow-node-index="${next}"]`)?.focus();
  }

  function handleNodeKey(event: KeyboardEvent, nodeId: string, index: number): void {
    if (event.key === "ArrowDown" || event.key === "ArrowRight") { event.preventDefault(); focusNode(index + 1); }
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") { event.preventDefault(); focusNode(index - 1); }
    else if (!locked && (event.key === "Delete" || event.key === "Backspace")) { event.preventDefault(); removeNode(nodeId); focusNode(index - 1); }
    else if (!locked && event.key.toLowerCase() === "c" && workflow.nodes[index + 1]) {
      event.preventDefault();
      const to = workflow.nodes[index + 1].nodeId;
      const edgeId = `edge_${workflow.edges.length + 1}`;
      commit({ ...workflow, edges: [...workflow.edges, { edgeId, from: nodeId, to }] }, `Connected ${nodeId} to ${to}.`);
    } else if (!locked && event.key.toLowerCase() === "d") {
      event.preventDefault();
      commit({ ...workflow, edges: workflow.edges.filter((edge) => edge.from !== nodeId) }, `Disconnected outgoing edges from ${nodeId}.`);
    } else if (!locked && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); undo(); }
  }
</script>

<div class="flex flex-col gap-4" data-agent-panel="workflow-builder-canvas">
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-2">
      <span class="text-sm font-medium">{workflow.title}</span>
      <Badge variant={locked ? "secondary" : "default"}>{lockState.toUpperCase()}</Badge>
    </div>
    <Input
      class="max-w-56"
      value={workflow.title}
      disabled={locked}
      oninput={(event) => patchWorkflow({ title: (event.currentTarget as HTMLInputElement).value })}
      aria-label="Workflow title"
    />
  </div>

  {#if !liveValidation.ok}
    <Card.Root class="border-destructive/50">
      <Card.Content class="flex flex-col gap-1 pt-4 text-sm text-destructive">
        {#each liveValidation.issues ?? [] as issue}
          <span>{issue}</span>
        {/each}
      </Card.Content>
    </Card.Root>
  {/if}

  <div class="flex flex-col gap-3">
    {#each workflow.nodes as node, index (node.nodeId)}
      <Card.Root tabindex="0" data-workflow-node-index={index} onkeydown={(event) => handleNodeKey(event, node.nodeId, index)}>
        <Card.Content class="flex flex-col gap-2 pt-4">
          <div class="flex items-center justify-between gap-2">
            <Badge variant="outline">#{index + 1}</Badge>
            <span class="font-mono text-xs text-muted-foreground">{node.nodeId}</span>
            {#if !LIVE_CONTROLLER_NODE_TYPES.has(node.type)}
              <Badge variant="secondary" title="This node type parses but returns unsupported_node_type at the controller (Decision 2).">
                controller-unsupported
              </Badge>
            {/if}
            {#if !locked}
              <Button variant="ghost" size="sm" onclick={() => removeNode(node.nodeId)} aria-label="Remove node {node.nodeId}">Remove</Button>
            {/if}
          </div>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Input
              value={node.title}
              disabled={locked}
              oninput={(event) => patchNode(node.nodeId, { title: (event.currentTarget as HTMLInputElement).value })}
              aria-label="{node.nodeId} title"
            />
            <Select.Root type="single" value={node.type} onValueChange={(value) => !locked && patchNode(node.nodeId, { type: (value ?? node.type) as WorkflowNodeType })}>
              <Select.Trigger disabled={locked} aria-label="{node.nodeId} type">{node.type}</Select.Trigger>
              <Select.Content>
                {#each WORKFLOW_NODE_TYPES as type}
                  <Select.Item value={type}>{type}</Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
            <Input
              placeholder="commandId (facade-scoped)"
              value={node.commandId ?? ""}
              disabled={locked}
              oninput={(event) => patchNode(node.nodeId, { commandId: (event.currentTarget as HTMLInputElement).value || undefined })}
              aria-label="{node.nodeId} commandId"
            />
            <Select.Root type="single" value={node.effect} onValueChange={(value) => !locked && patchNode(node.nodeId, { effect: (value ?? node.effect) as NodeEffect })}>
              <Select.Trigger disabled={locked} aria-label="{node.nodeId} effect">{node.effect}</Select.Trigger>
              <Select.Content>
                {#each EFFECTS as effect}
                  <Select.Item value={effect}>{effect}</Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
            <Select.Root type="single" value={node.approvalPolicy} onValueChange={(value) => !locked && patchNode(node.nodeId, { approvalPolicy: (value ?? node.approvalPolicy) as NodeApprovalPolicy })}>
              <Select.Trigger disabled={locked} aria-label="{node.nodeId} approvalPolicy">{node.approvalPolicy}</Select.Trigger>
              <Select.Content>
                {#each APPROVAL_POLICIES as policy}
                  <Select.Item value={policy}>{policy}</Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
          </div>
        </Card.Content>
      </Card.Root>
      {#if index < workflow.nodes.length - 1}
        <div class="ml-4 text-xs text-muted-foreground">&darr;</div>
      {/if}
    {/each}
    {#if !locked}
      <div class="flex gap-2">
        <Button variant="secondary" onclick={addNode}>Add node</Button>
        <Button variant="ghost" onclick={undo} disabled={undoStack.length === 0}>Undo</Button>
      </div>
    {/if}
  </div>

  <Separator />

  <div class="flex flex-col gap-2">
    <span class="text-sm font-medium">Edges</span>
    {#each workflow.edges as edge (edge.edgeId)}
      <div class="flex items-center gap-2 text-sm">
        <Select.Root type="single" value={edge.from} onValueChange={(value) => !locked && patchEdge(edge.edgeId, { from: value ?? edge.from })}>
          <Select.Trigger disabled={locked} aria-label="{edge.edgeId} from">{edge.from}</Select.Trigger>
          <Select.Content>
            {#each workflow.nodes as node}
              <Select.Item value={node.nodeId}>{node.nodeId}</Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
        <span>&rarr;</span>
        <Select.Root type="single" value={edge.to} onValueChange={(value) => !locked && patchEdge(edge.edgeId, { to: value ?? edge.to })}>
          <Select.Trigger disabled={locked} aria-label="{edge.edgeId} to">{edge.to}</Select.Trigger>
          <Select.Content>
            {#each workflow.nodes as node}
              <Select.Item value={node.nodeId}>{node.nodeId}</Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
        <Input
          class="max-w-40"
          placeholder="condition"
          value={edge.condition ?? ""}
          disabled={locked}
          oninput={(event) => patchEdge(edge.edgeId, { condition: (event.currentTarget as HTMLInputElement).value || undefined })}
          aria-label="{edge.edgeId} condition"
        />
        {#if !locked}
          <Button variant="ghost" size="sm" onclick={() => removeEdge(edge.edgeId)} aria-label="Remove edge {edge.edgeId}">Remove</Button>
        {/if}
      </div>
    {/each}
    {#if !locked}
      <Button variant="secondary" size="sm" onclick={addEdge} disabled={workflow.nodes.length < 2}>Add edge</Button>
    {/if}
  </div>
  <p class="sr-only" aria-live="polite">{announcement}</p>
</div>

<script lang="ts" module>
  export interface WorkflowBuilderSnapshot {
    agentId: string;
    tab: "config" | "canvas" | "preview";
    saveStatus: "idle" | "saving" | "saved" | "error";
    saveMessage: string;
    definitionValid: boolean;
    workflowValid: boolean;
  }

  export interface WorkflowBuilderController {
    snapshot(): WorkflowBuilderSnapshot;
    setTab(tab: WorkflowBuilderSnapshot["tab"]): void;
    saveDraft(): Promise<{ ok: boolean; message: string }>;
    newAgent(): void;
  }
</script>

<script lang="ts">
  // Phase 5 (agent-creation-tool-plan-2026-07-13.md, Decision 3): the
  // workflow-builder mode's top shell -- owns the working AgentDefinition +
  // WorkflowDefinition, the draft list, and the config/canvas/preview tabs.
  // Reservation fixture renders LOCKED as a real-data proof the canvas works;
  // "New workflow" starts an editable DRAFT. Save writes through
  // POST /api/agent-definitions (Phase 4), always re-validating with
  // agentDefinitionSchema first (D016 emit discipline) -- the working object
  // is never trusted directly.
  import * as Card from "$lib/components/ui/card";
  import * as Tabs from "$lib/components/ui/tabs";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import AgentConfigPanel from "./AgentConfigPanel.svelte";
  import WorkflowCanvas from "./WorkflowCanvas.svelte";
  import DebugPreviewPane from "./DebugPreviewPane.svelte";
  import {
    createEmptyAgentDefinition,
    createEmptyWorkflowDefinition,
    validateAgentDefinition,
    validateWorkflowDefinition,
    type WorkflowLockState,
  } from "./builder-model";
  import { bookingReservationWorkflowManifest } from "@sonik-agent-ui/tool-contracts/marketplace-fixtures";
  import type { AgentDefinition, WorkflowDefinition } from "@sonik-agent-ui/tool-contracts/marketplace";

  interface Props {
    onController?: (controller: WorkflowBuilderController | null) => void;
  }
  let { onController }: Props = $props();

  function freshAgentId(): string {
    return `agent_${Math.random().toString(36).slice(2, 10)}`;
  }

  let agentId = $state(freshAgentId());
  let definition = $state<AgentDefinition>(createEmptyAgentDefinition(agentId));
  let tab = $state<WorkflowBuilderSnapshot["tab"]>("config");
  let saveStatus = $state<WorkflowBuilderSnapshot["saveStatus"]>("idle");
  let saveMessage = $state("");

  // Canvas: the reservation fixture renders LOCKED as a real published-shape
  // proof; the user's own draft workflow is editable alongside it.
  const exampleWorkflow = bookingReservationWorkflowManifest.payload.workflow as WorkflowDefinition;
  let exampleLockState: WorkflowLockState = "locked";
  let draftWorkflow = $state<WorkflowDefinition>(createEmptyWorkflowDefinition(`${agentId}.workflow`));
  let draftLockState = $state<WorkflowLockState>("draft");

  const definitionValidation = $derived(validateAgentDefinition(definition));
  const workflowValidation = $derived(validateWorkflowDefinition(draftWorkflow));

  async function saveDraft(): Promise<{ ok: boolean; message: string }> {
    const validation = validateAgentDefinition($state.snapshot(definition));
    if (!validation.ok) {
      saveStatus = "error";
      saveMessage = validation.issues?.[0] ?? "Definition failed validation.";
      return { ok: false, message: saveMessage };
    }
    saveStatus = "saving";
    try {
      const response = await fetch("/api/agent-definitions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "save_draft", definition: validation.definition }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) {
        saveStatus = "error";
        saveMessage = body?.error ?? `Save failed (${response.status})`;
        return { ok: false, message: saveMessage };
      }
      saveStatus = "saved";
      saveMessage = "Draft saved.";
      return { ok: true, message: saveMessage };
    } catch (error) {
      saveStatus = "error";
      saveMessage = error instanceof Error ? error.message : "Save failed.";
      return { ok: false, message: saveMessage };
    }
  }

  function newAgent(): void {
    agentId = freshAgentId();
    definition = createEmptyAgentDefinition(agentId);
    draftWorkflow = createEmptyWorkflowDefinition(`${agentId}.workflow`);
    saveStatus = "idle";
    saveMessage = "";
    tab = "config";
  }

  function setTab(next: WorkflowBuilderSnapshot["tab"]): void {
    tab = next;
  }

  const controller: WorkflowBuilderController = {
    snapshot: () => ({
      agentId,
      tab,
      saveStatus,
      saveMessage,
      definitionValid: definitionValidation.ok,
      workflowValid: workflowValidation.ok,
    }),
    setTab,
    saveDraft,
    newAgent,
  };

  $effect(() => {
    onController?.(controller);
    return () => onController?.(null);
  });
</script>

<div class="flex h-full flex-col gap-4 p-4" data-agent-mode="workflow-builder">
  <div class="flex items-center justify-between gap-3">
    <div class="flex items-center gap-2">
      <h1 class="text-lg font-semibold">Workflow Builder</h1>
      <Badge variant="outline">{agentId}</Badge>
      {#if !definitionValidation.ok}
        <Badge variant="destructive">invalid definition</Badge>
      {/if}
    </div>
    <div class="flex items-center gap-2">
      <Button variant="outline" onclick={newAgent}>New agent</Button>
      <Button onclick={() => void saveDraft()} disabled={saveStatus === "saving"}>
        {saveStatus === "saving" ? "Saving…" : "Save draft"}
      </Button>
    </div>
  </div>
  {#if saveMessage}
    <p class="text-sm {saveStatus === 'error' ? 'text-destructive' : 'text-muted-foreground'}">{saveMessage}</p>
  {/if}

  <Tabs.Root value={tab} onValueChange={(value) => setTab((value ?? "config") as WorkflowBuilderSnapshot["tab"])}>
    <Tabs.List>
      <Tabs.Trigger value="config">Config</Tabs.Trigger>
      <Tabs.Trigger value="canvas">Canvas</Tabs.Trigger>
      <Tabs.Trigger value="preview">Debug &amp; Preview</Tabs.Trigger>
    </Tabs.List>

    <Tabs.Content value="config">
      <AgentConfigPanel bind:definition validationIssues={definitionValidation.issues ?? []} />
    </Tabs.Content>

    <Tabs.Content value="canvas">
      <div class="flex flex-col gap-6">
        <Card.Root>
          <Card.Header>
            <Card.Title>Your workflow (draft)</Card.Title>
            <Card.Description>Editable. Schema-validated against workflowDefinitionSchema on every change.</Card.Description>
          </Card.Header>
          <Card.Content>
            <WorkflowCanvas bind:workflow={draftWorkflow} lockState={draftLockState} />
          </Card.Content>
        </Card.Root>
        <Card.Root>
          <Card.Header>
            <Card.Title>Example: booking reservation workflow</Card.Title>
            <Card.Description>The shipped reservation fixture, rendered LOCKED as a real-data proof of the canvas.</Card.Description>
          </Card.Header>
          <Card.Content>
            <WorkflowCanvas workflow={exampleWorkflow} lockState={exampleLockState} />
          </Card.Content>
        </Card.Root>
      </div>
    </Tabs.Content>

    <Tabs.Content value="preview">
      <DebugPreviewPane draftAgentId={agentId} />
    </Tabs.Content>
  </Tabs.Root>
</div>

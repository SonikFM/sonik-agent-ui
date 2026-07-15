<script lang="ts" module>
  // type alias (not interface) so the snapshot satisfies the __sonikAgentUI
  // Record<string, unknown> boundary via TS's implicit index signature rule
  export type WorkflowBuilderSnapshot = {
    agentId: string;
    tab: "config" | "canvas" | "preview";
    saveStatus: "idle" | "saving" | "saved" | "error";
    saveMessage: string;
    definitionValid: boolean;
    workflowValid: boolean;
  };

  export interface WorkflowBuilderController {
    snapshot(): WorkflowBuilderSnapshot;
    approvalState(): import("@sonik-agent-ui/agent-observability").AgentUiApprovalStateSnapshot;
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
  import WorkflowRunPanel from "./WorkflowRunPanel.svelte";
  import {
    createEmptyAgentDefinition,
    createEmptyWorkflowDefinition,
    validateAgentDefinition,
    validateWorkflowDefinition,
    createWorkflowBuilderApprovalState,
    selectActiveWorkflowRun,
    type ActiveWorkflowRunSelection,
    type WorkflowLockState,
  } from "./builder-model";
  import { bookingReservationWorkflowManifest, amplifyCampaignWorkflowManifest } from "@sonik-agent-ui/tool-contracts/marketplace-fixtures";
  import type { AgentDefinition, WorkflowDefinition } from "@sonik-agent-ui/tool-contracts/marketplace";
  import type { WorkflowRunState } from "@sonik-agent-ui/tool-contracts/workflow-run-state";
  import { AGENT_MODEL_OPTIONS, type AgentModelOption } from "$lib/agent-settings";

  interface Props {
    workspaceFetch: typeof fetch;
    workspaceContextReady?: boolean;
    signedHostApprovedCommandIds?: string[];
    onController?: (controller: WorkflowBuilderController | null) => void;
    /** Return to the chat workspace. The mode toggle lives in WorkspaceRoot's
     *  toolbar, which unmounts in builder mode — without this the builder is a
     *  one-way door (Lane D e2e finding, prod slice 2026-07-13). */
    onExit?: () => void;
  }
  let { workspaceFetch, workspaceContextReady = true, signedHostApprovedCommandIds = [], onController, onExit }: Props = $props();

  function freshAgentId(): string {
    return `agent_${Math.random().toString(36).slice(2, 10)}`;
  }

  const initialAgentId = freshAgentId();
  let agentId = $state(initialAgentId);
  let definition = $state<AgentDefinition>(createEmptyAgentDefinition(initialAgentId));
  let tab = $state<WorkflowBuilderSnapshot["tab"]>("config");
  let saveStatus = $state<WorkflowBuilderSnapshot["saveStatus"]>("idle");
  let saveMessage = $state("");

  // Canvas: the reservation fixture renders LOCKED as a real published-shape
  // proof; the user's own draft workflow is editable alongside it.
  const exampleWorkflow = bookingReservationWorkflowManifest.payload.workflow as WorkflowDefinition;
  let exampleLockState: WorkflowLockState = "locked";
  // P1 #5 (production-readiness-agent-creation-2026-07-13.md): the Amplify campaign fixture is the
  // one workflow POST /api/workflow-runs has real preview/commit callbacks for -- this is the
  // controller's first non-reservation Run affordance instance (D011).
  const runnableExampleWorkflow = amplifyCampaignWorkflowManifest.payload.workflow as WorkflowDefinition;
  let draftWorkflow = $state<WorkflowDefinition>(createEmptyWorkflowDefinition(`${initialAgentId}.workflow`));
  let draftLockState = $state<WorkflowLockState>("draft");
  let activeRunSelection = $state<ActiveWorkflowRunSelection | null>(null);

  const definitionValidation = $derived(validateAgentDefinition(definition));
  const workflowValidation = $derived(validateWorkflowDefinition(draftWorkflow));

  // Model catalog: fetched here (not in AgentConfigPanel) so the config panel
  // stays network-free -- same /api/agent-models route + fallback shape the
  // chat-surface AgentSettingsPanel already uses (routes/+page.svelte).
  let modelOptions = $state<AgentModelOption[]>(AGENT_MODEL_OPTIONS);
  let modelCatalogStatus = $state<"idle" | "loading" | "ready" | "fallback" | "error">("idle");
  let modelCatalogMessage = $state<string | null>(null);

  async function refreshModelCatalog(): Promise<void> {
    if (!workspaceContextReady) {
      modelOptions = AGENT_MODEL_OPTIONS;
      modelCatalogStatus = "error";
      modelCatalogMessage = "Reconnect the embedded page with an authenticated workspace session to load cloud models.";
      return;
    }
    modelCatalogStatus = "loading";
    modelCatalogMessage = null;
    try {
      const response = await workspaceFetch("/api/agent-models");
      if (!response.ok) throw new Error(`model_catalog_http_${response.status}`);
      const catalog = await response.json() as { models?: AgentModelOption[]; source?: string; error?: string };
      const models = Array.isArray(catalog.models) && catalog.models.length > 0 ? catalog.models : AGENT_MODEL_OPTIONS;
      modelOptions = models;
      modelCatalogStatus = catalog.source === "gateway" ? "ready" : "fallback";
      modelCatalogMessage = catalog.error ?? (catalog.source === "gateway" ? "Vercel AI Gateway catalog loaded." : "Using fallback model list.");
    } catch (error) {
      modelOptions = AGENT_MODEL_OPTIONS;
      modelCatalogStatus = "error";
      modelCatalogMessage = error instanceof Error ? error.message : "Model catalog fetch failed.";
    }
  }

  async function saveDraft(): Promise<{ ok: boolean; message: string }> {
    const validation = validateAgentDefinition($state.snapshot(definition));
    if (!validation.ok) {
      saveStatus = "error";
      saveMessage = validation.issues?.[0] ?? "Definition failed validation.";
      return { ok: false, message: saveMessage };
    }
    saveStatus = "saving";
    try {
      const response = await workspaceFetch("/api/agent-definitions", {
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
    activeRunSelection = null;
  }

  function setTab(next: WorkflowBuilderSnapshot["tab"]): void {
    tab = next;
  }

  function handleRunStateChange(workflowId: string, nextRun: WorkflowRunState | null): void {
    activeRunSelection = selectActiveWorkflowRun(activeRunSelection, workflowId, nextRun);
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
    approvalState: () => createWorkflowBuilderApprovalState(activeRunSelection?.run ?? null, signedHostApprovedCommandIds),
    setTab,
    saveDraft,
    newAgent,
  };

  $effect(() => {
    onController?.(controller);
    return () => onController?.(null);
  });

  $effect(() => {
    void refreshModelCatalog();
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
      {#if onExit}
        <Button variant="ghost" onclick={() => onExit?.()} aria-label="Return to the chat workspace">Back to chat</Button>
      {/if}
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
      <AgentConfigPanel
        bind:definition
        validationIssues={definitionValidation.issues ?? []}
        {modelOptions}
        {modelCatalogStatus}
        {modelCatalogMessage}
        onModelCatalogRefresh={() => void refreshModelCatalog()}
      />
    </Tabs.Content>

    <Tabs.Content value="canvas">
      <div class="flex flex-col gap-6">
        <Card.Root>
          <Card.Header>
            <Card.Title>Your workflow (draft)</Card.Title>
            <Card.Description>Editable. Schema-validated against workflowDefinitionSchema on every change. Describe one in Debug &amp; Preview and it loads here; Run drives it through the controller.</Card.Description>
          </Card.Header>
          <Card.Content class="flex flex-col gap-4">
            <WorkflowCanvas bind:workflow={draftWorkflow} lockState={draftLockState} />
            <WorkflowRunPanel
              workflow={draftWorkflow}
              {workspaceFetch}
              {signedHostApprovedCommandIds}
              onRunStateChange={handleRunStateChange}
            />
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
        <Card.Root>
          <Card.Header>
            <Card.Title>Example: Amplify campaign workflow</Card.Title>
            <Card.Description>The shipped campaign fixture, rendered LOCKED. This is the one workflow wired end to end through POST /api/workflow-runs -- click Run below to drive it.</Card.Description>
          </Card.Header>
          <Card.Content class="flex flex-col gap-4">
            <WorkflowCanvas workflow={runnableExampleWorkflow} lockState="locked" />
            <WorkflowRunPanel
              workflow={runnableExampleWorkflow}
              {workspaceFetch}
              {signedHostApprovedCommandIds}
              onRunStateChange={handleRunStateChange}
            />
          </Card.Content>
        </Card.Root>
      </div>
    </Tabs.Content>

    <Tabs.Content value="preview">
      <DebugPreviewPane
        draftAgentId={agentId}
        {workspaceFetch}
        prepareDraft={saveDraft}
        onWorkflowDrafted={(drafted) => {
          // Describe -> draft -> canvas: the drafting agent's validated workflow
          // loads into the editable draft and jumps to the canvas so it's ready
          // to inspect and Run.
          draftWorkflow = drafted;
          draftLockState = "draft";
          setTab("canvas");
        }}
      />
    </Tabs.Content>
  </Tabs.Root>
</div>

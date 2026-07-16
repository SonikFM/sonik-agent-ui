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
    workflowLifecycle: import("./builder-model").WorkflowDraftLifecycle;
  };

  export interface WorkflowBuilderController {
    snapshot(): WorkflowBuilderSnapshot;
    approvalState(): import("@sonik-agent-ui/agent-observability").AgentUiApprovalStateSnapshot;
    setTab(tab: WorkflowBuilderSnapshot["tab"]): void;
    saveDraft(): Promise<{ ok: boolean; message: string }>;
    newAgent(): void;
    publishWorkflow(): Promise<{ ok: boolean; message: string }>;
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
  import OrganizerPanel from "./OrganizerPanel.svelte";
  import RunHistoryPanel from "./RunHistoryPanel.svelte";
  import type { OrganizerAction, OrganizerParameter, OrganizerPatchRequest, WorkflowHistoryProjection } from "./organizer-model";
  import {
    createEmptyAgentDefinition,
    createEmptyWorkflowDefinition,
    validateAgentDefinition,
    validateWorkflowDefinition,
    createWorkflowBuilderApprovalState,
    selectActiveWorkflowRun,
    resolveWorkflowDraftLifecycle,
    hasUnsavedWorkflowChanges,
    workflowDefinitionToVNext,
    workflowVNextToDefinition,
    type ActiveWorkflowRunSelection,
    type WorkflowLockState,
    type WorkflowDraftLifecycle,
  } from "./builder-model";
  import { bookingReservationWorkflowManifest, amplifyCampaignWorkflowManifest } from "@sonik-agent-ui/tool-contracts/marketplace-fixtures";
  import type { AgentDefinition, WorkflowDefinition } from "@sonik-agent-ui/tool-contracts/marketplace";
  import type { WorkflowRunState } from "@sonik-agent-ui/tool-contracts/workflow-run-state";
  import type { CapabilityReadiness, WorkflowDependencyPins, WorkflowVNextDefinition } from "@sonik-agent-ui/tool-contracts/workflow-vnext";
  import { AGENT_MODEL_OPTIONS, type AgentModelOption } from "$lib/agent-settings";

  interface Props {
    workspaceFetch: typeof fetch;
    workspaceContextReady?: boolean;
    signedHostApprovedCommandIds?: string[];
    workflowPublishPins?: WorkflowDependencyPins;
    activeSessionId?: string | null;
    onController?: (controller: WorkflowBuilderController | null) => void;
    /** Return to the chat workspace. The mode toggle lives in WorkspaceRoot's
     *  toolbar, which unmounts in builder mode — without this the builder is a
     *  one-way door (Lane D e2e finding, prod slice 2026-07-13). */
    onExit?: () => void;
  }
  let { workspaceFetch, workspaceContextReady = true, signedHostApprovedCommandIds = [], workflowPublishPins, activeSessionId = null, onController, onExit }: Props = $props();

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
  type DraftRecord = { organizationId: string; workflowId: string; draftRevision: number; definitionDigest: string; definition: WorkflowVNextDefinition };
  type VersionRecord = { workflowVersionId: string; sourceDraftRevision: number; publishedAt: string };
  let persistedDrafts = $state<DraftRecord[]>([]);
  let workflowDraft = $state<DraftRecord | null>(null);
  let workflowVersions = $state<VersionRecord[]>([]);
  let workflowDirty = $state(false);
  let workflowSaving = $state(false);
  let workflowPublishing = $state(false);
  let workflowConflicted = $state(false);
  let workflowFailed = $state(false);
  let publishedRevision = $state<number | null>(null);
  let audience = $state<"builder" | "organizer" | "history">("builder");
  let organizerBusy = $state(false);
  let historyBusy = $state(false);
  let workflowHistory = $state<WorkflowHistoryProjection | null>(null);

  const definitionValidation = $derived(validateAgentDefinition(definition));
  const workflowValidation = $derived(validateWorkflowDefinition(draftWorkflow));
  const workflowLifecycle = $derived<WorkflowDraftLifecycle>(resolveWorkflowDraftLifecycle({
    valid: workflowValidation.ok,
    saving: workflowSaving || saveStatus === "saving",
    publishing: workflowPublishing,
    conflicted: workflowConflicted,
    failed: workflowFailed,
    dirty: workflowDirty,
    draftRevision: workflowDraft?.draftRevision ?? null,
    publishedRevision,
  }));
  const organizerParameters = $derived<OrganizerParameter[]>(draftWorkflow.nodes.map((node) => ({
    path: `nodes.${node.nodeId}.config.title`,
    kind: "safe_patch",
    label: `${node.title} title`,
    type: "text",
    value: node.title,
    description: "Organizer-safe label; graph structure remains hidden.",
  })));
  const organizerSafePatchPaths = $derived(organizerParameters.map((parameter) => parameter.path));
  const activeReceiptIds = $derived(activeRunSelection?.run.receipts
    .map((receipt) => receipt.receiptRef)
    .filter((receiptId): receiptId is string => Boolean(receiptId)) ?? []);

  // Model catalog: fetched here (not in AgentConfigPanel) so the config panel
  // stays network-free -- same /api/agent-models route + fallback shape the
  // chat-surface AgentSettingsPanel already uses (routes/+page.svelte).
  let modelOptions = $state<AgentModelOption[]>(AGENT_MODEL_OPTIONS);
  let modelCatalogStatus = $state<"idle" | "loading" | "ready" | "fallback" | "error">("idle");
  let modelCatalogMessage = $state<string | null>(null);
  let capabilityReadiness = $state<CapabilityReadiness[]>([]);

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

  async function refreshCapabilityReadiness(): Promise<void> {
    if (!workspaceContextReady) { capabilityReadiness = []; return; }
    const response = await workspaceFetch("/api/capability-readiness");
    const body = await response.json().catch(() => null) as { readiness?: CapabilityReadiness[] } | null;
    capabilityReadiness = response.ok && Array.isArray(body?.readiness) ? body.readiness : [];
  }

  async function saveDraft(): Promise<{ ok: boolean; message: string }> {
    if (!workspaceContextReady) {
      saveStatus = "error";
      saveMessage = "Reconnect the embedded page with an authenticated workspace session to save agent drafts.";
      return { ok: false, message: saveMessage };
    }
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
      const workflowResult = await saveWorkflowDraft();
      if (!workflowResult.ok) return workflowResult;
      saveStatus = "saved";
      saveMessage = "Draft saved.";
      return { ok: true, message: saveMessage };
    } catch (error) {
      saveStatus = "error";
      saveMessage = error instanceof Error ? error.message : "Save failed.";
      return { ok: false, message: saveMessage };
    }
  }

  async function workflowDefinitions(body: Record<string, unknown>): Promise<Record<string, any>> {
    const response = await workspaceFetch("/api/workflow-definitions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => null) as Record<string, any> | null;
    if (!response.ok || result?.ok !== true) throw new Error(result?.reason ?? `Workflow request failed (${response.status})`);
    return result;
  }

  async function saveWorkflowDraft(): Promise<{ ok: boolean; message: string }> {
    if (!workflowValidation.ok) {
      saveStatus = "error";
      saveMessage = workflowValidation.issues?.[0] ?? "Workflow failed validation.";
      return { ok: false, message: saveMessage };
    }
    workflowSaving = true;
    workflowConflicted = false;
    workflowFailed = false;
    try {
      const next = workflowDefinitionToVNext(workflowValidation.workflow!);
      const result = await workflowDefinitions(workflowDraft
        ? { action: "update", workflowId: next.workflowId, expectedRevision: workflowDraft.draftRevision, definition: next }
        : { action: "create", definition: next });
      workflowDraft = result.draft as DraftRecord;
      workflowDirty = false;
      workflowFailed = false;
      await refreshWorkflowVersions();
      return { ok: true, message: "Workflow draft saved." };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Workflow save failed.";
      workflowConflicted = message.includes("conflict");
      workflowFailed = !workflowConflicted;
      saveStatus = "error";
      saveMessage = message;
      return { ok: false, message };
    } finally { workflowSaving = false; }
  }

  async function refreshPersistedWorkflows(): Promise<void> {
    if (!workspaceContextReady) return;
    try { persistedDrafts = (await workflowDefinitions({ action: "list" })).drafts ?? []; }
    catch { persistedDrafts = []; }
  }

  async function loadWorkflow(workflowId: string): Promise<void> {
    if (!workflowId || !confirmDiscardUnsavedWorkflow()) return;
    const result = await workflowDefinitions({ action: "get", workflowId });
    if (!result.draft) return;
    workflowDraft = result.draft as DraftRecord;
    draftWorkflow = workflowVNextToDefinition(workflowDraft.definition);
    workflowDirty = false;
    workflowConflicted = false;
    workflowFailed = false;
    await refreshWorkflowVersions();
  }

  async function refreshWorkflowVersions(): Promise<void> {
    if (!workflowDraft) { workflowVersions = []; publishedRevision = null; return; }
    const result = await workflowDefinitions({ action: "versions", workflowId: workflowDraft.workflowId });
    workflowVersions = result.versions ?? [];
    publishedRevision = workflowVersions.at(-1)?.sourceDraftRevision ?? null;
  }

  async function publishWorkflow(): Promise<{ ok: boolean; message: string }> {
    if (!workflowDraft || !workflowPublishPins) return { ok: false, message: "Authoritative publish dependency pins are required." };
    workflowPublishing = true;
    workflowFailed = false;
    try {
      await workflowDefinitions({ action: "publish", workflowId: workflowDraft.workflowId, expectedRevision: workflowDraft.draftRevision, workflowVersionId: workflowPublishPins.workflowVersionId, dependencyPins: workflowPublishPins });
      publishedRevision = workflowDraft.draftRevision;
      await refreshWorkflowVersions();
      saveMessage = "Workflow published.";
      return { ok: true, message: saveMessage };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Publish failed.";
      workflowFailed = true;
      saveMessage = message;
      return { ok: false, message };
    } finally { workflowPublishing = false; }
  }

  async function cloneWorkflow(): Promise<void> {
    if (!workflowDraft || !confirmDiscardUnsavedWorkflow()) return;
    const targetWorkflowId = `${workflowDraft.workflowId}.copy.${Date.now().toString(36)}`;
    const result = await workflowDefinitions({ action: "clone", source: { kind: "draft", workflowId: workflowDraft.workflowId, draftRevision: workflowDraft.draftRevision, definitionDigest: workflowDraft.definitionDigest }, targetWorkflowId });
    workflowDraft = result.draft as DraftRecord;
    draftWorkflow = workflowVNextToDefinition(workflowDraft.definition);
    workflowDirty = false;
    workflowFailed = false;
    workflowVersions = [];
    publishedRevision = null;
  }

  async function configureOrganizer(request: OrganizerPatchRequest): Promise<void> {
    organizerBusy = true;
    try {
      const result = await workflowDefinitions(request as unknown as Record<string, unknown>);
      workflowDraft = result.draft as DraftRecord;
      draftWorkflow = workflowVNextToDefinition(workflowDraft.definition);
      workflowDirty = false;
      workflowConflicted = false;
      workflowFailed = false;
      saveStatus = "saved";
      saveMessage = `Organizer configuration saved at revision ${workflowDraft.draftRevision}.`;
      await refreshWorkflowVersions();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Organizer configuration failed.";
      workflowConflicted = message.includes("conflict");
      workflowFailed = !workflowConflicted;
      saveStatus = "error";
      saveMessage = message;
    } finally { organizerBusy = false; }
  }

  async function handleOrganizerAction(action: OrganizerAction): Promise<void> {
    if (action === "publish") { await publishWorkflow(); return; }
    const selector = action === "test"
      ? '[data-workflow-run-action="start"]'
      : '[data-workflow-run-action="approve"]';
    const target = document.querySelector<HTMLElement>(selector);
    target?.focus();
    saveMessage = target && document.activeElement === target
      ? `${action === "test" ? "Run" : "Approval"} control focused.`
      : action === "test"
        ? "Run controls are available below."
        : "Start and preview this workflow before reviewing its approval.";
  }

  async function refreshWorkflowHistory(extra: Record<string, string> = {}): Promise<void> {
    const query = new URLSearchParams(extra);
    if (activeSessionId) query.set("sessionId", activeSessionId);
    if (activeRunSelection?.run.runId) query.set("workflowRunId", activeRunSelection.run.runId);
    historyBusy = true;
    try {
      const response = await workspaceFetch(`/api/workflow-history?${query}`);
      const result = await response.json().catch(() => null) as { ok?: boolean; history?: WorkflowHistoryProjection; reason?: string } | null;
      if (!response.ok || result?.ok !== true || !result.history) throw new Error(result?.reason ?? `History request failed (${response.status})`);
      workflowHistory = result.history;
    } catch (error) {
      workflowHistory = null;
      saveMessage = error instanceof Error ? error.message : "Workflow history failed to load.";
    } finally { historyBusy = false; }
  }

  function newAgent(): void {
    if (!confirmDiscardUnsavedWorkflow()) return;
    agentId = freshAgentId();
    definition = createEmptyAgentDefinition(agentId);
    draftWorkflow = createEmptyWorkflowDefinition(`${agentId}.workflow`);
    saveStatus = "idle";
    saveMessage = "";
    tab = "config";
    activeRunSelection = null;
    workflowDraft = null;
    workflowVersions = [];
    workflowDirty = false;
    workflowSaving = false;
    workflowPublishing = false;
    workflowConflicted = false;
    workflowFailed = false;
    publishedRevision = null;
  }

  function setTab(next: WorkflowBuilderSnapshot["tab"]): void {
    tab = next;
  }

  function confirmDiscardUnsavedWorkflow(): boolean {
    return !hasUnsavedWorkflowChanges({ dirty: workflowDirty, saving: workflowSaving || saveStatus === "saving", publishing: workflowPublishing })
      || window.confirm("Discard unsaved workflow changes?");
  }

  function exitBuilder(): void {
    if (confirmDiscardUnsavedWorkflow()) onExit?.();
  }

  type BuilderAction = "publish" | "start" | "trace" | "resume";
  function focusBuilderAction(action: BuilderAction): void {
    const selectors: Record<BuilderAction, string> = {
      publish: '[data-builder-action="publish"]',
      start: '[data-workflow-run-panel] button',
      trace: '[data-workflow-run-trace] summary',
      resume: '[data-workflow-run-waitpoint] button',
    };
    const target = document.querySelector<HTMLElement>(selectors[action]);
    target?.focus();
    builderAnnouncement = target && document.activeElement === target
      ? `${target.textContent?.trim() || action} control focused.`
      : `${action} control is not available.`;
  }

  let builderAnnouncement = $state("");
  function handleBuilderShortcut(event: KeyboardEvent): void {
    if (!event.altKey || !event.shiftKey) return;
    const action = ({ p: "publish", r: "start", t: "trace", m: "resume" } as const)[event.key.toLowerCase() as "p" | "r" | "t" | "m"];
    if (!action) return;
    event.preventDefault();
    focusBuilderAction(action);
  }

  function handleRunStateChange(workflowId: string, nextRun: WorkflowRunState | null): void {
    activeRunSelection = selectActiveWorkflowRun(activeRunSelection, workflowId, nextRun);
    if (audience === "history") void refreshWorkflowHistory();
  }

  const controller: WorkflowBuilderController = {
    snapshot: () => ({
      agentId,
      tab,
      saveStatus,
      saveMessage,
      definitionValid: definitionValidation.ok,
      workflowValid: workflowValidation.ok,
      workflowLifecycle,
    }),
    approvalState: () => createWorkflowBuilderApprovalState(activeRunSelection?.run ?? null, signedHostApprovedCommandIds),
    setTab,
    saveDraft,
    newAgent,
    publishWorkflow,
  };

  $effect(() => {
    onController?.(controller);
    return () => onController?.(null);
  });

  $effect(() => {
    void refreshModelCatalog();
    void refreshCapabilityReadiness();
    void refreshPersistedWorkflows();
  });

  $effect(() => {
    const beforeunload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedWorkflowChanges({ dirty: workflowDirty, saving: workflowSaving || saveStatus === "saving", publishing: workflowPublishing })) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeunload);
    window.addEventListener("keydown", handleBuilderShortcut);
    return () => {
      window.removeEventListener("beforeunload", beforeunload);
      window.removeEventListener("keydown", handleBuilderShortcut);
    };
  });
</script>

<div class="flex h-full flex-col gap-4 p-4" data-agent-mode="workflow-builder">
  <div class="flex items-center justify-between gap-3">
    <div class="flex items-center gap-2">
      <h1 class="text-lg font-semibold">Workflow Builder</h1>
      <Badge variant="outline">{agentId}</Badge>
      <Badge variant={workflowLifecycle === "invalid" || workflowLifecycle === "conflicted" || workflowLifecycle === "failed" ? "destructive" : "secondary"} data-workflow-lifecycle={workflowLifecycle} aria-live="polite">{workflowLifecycle}</Badge>
      {#if !definitionValidation.ok}
        <Badge variant="destructive">invalid definition</Badge>
      {/if}
    </div>
    <div class="flex items-center gap-2">
      {#if onExit}
        <Button variant="ghost" onclick={exitBuilder} aria-label="Return to the chat workspace">Back to chat</Button>
      {/if}
      <Button variant="outline" onclick={newAgent}>New agent</Button>
      <Button variant="outline" onclick={() => void cloneWorkflow()} disabled={!workflowDraft}>Clone workflow</Button>
      {#if audience === "builder"}
        <Button data-builder-action="publish" variant="outline" onclick={() => void publishWorkflow()} disabled={!workflowDraft || !workflowPublishPins || workflowLifecycle === "dirty" || workflowLifecycle === "invalid" || workflowLifecycle === "saving" || workflowLifecycle === "publishing"} title={workflowPublishPins ? "Publish this saved revision" : "Authoritative dependency pins are required to publish"}>{workflowPublishing ? "Publishing…" : "Publish"}</Button>
      {/if}
      <Button onclick={() => void saveDraft()} disabled={saveStatus === "saving"}>
        {saveStatus === "saving" ? "Saving…" : "Save draft"}
      </Button>
    </div>
  </div>
  <p class="sr-only" aria-live="polite">{builderAnnouncement}</p>
  {#if saveMessage}
    <p class="text-sm {saveStatus === 'error' ? 'text-destructive' : 'text-muted-foreground'}">{saveMessage}</p>
  {/if}
  {#if persistedDrafts.length > 0}
    <label class="flex items-center gap-2 text-sm">
      <span>Saved workflows</span>
      <select class="rounded-md border border-input bg-background px-2 py-1" onchange={(event) => void loadWorkflow((event.currentTarget as HTMLSelectElement).value)}>
        <option value="">Select a draft</option>
        {#each persistedDrafts as draft}
          <option value={draft.workflowId}>{draft.workflowId} · r{draft.draftRevision}</option>
        {/each}
      </select>
      {#if workflowVersions.length}<span>{workflowVersions.length} published version{workflowVersions.length === 1 ? "" : "s"}</span>{/if}
    </label>
  {/if}

  <nav class="flex gap-2" aria-label="Workflow audience">
    <Button variant={audience === "builder" ? "default" : "outline"} onclick={() => { audience = "builder"; }}>Builder</Button>
    <Button variant={audience === "organizer" ? "default" : "outline"} onclick={() => { audience = "organizer"; }}>Organizer</Button>
    <Button variant={audience === "history" ? "default" : "outline"} onclick={() => { audience = "history"; void refreshWorkflowHistory(); }}>History</Button>
  </nav>

  {#if audience === "builder"}
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
        {capabilityReadiness}
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
            <WorkflowCanvas bind:workflow={draftWorkflow} lockState={draftLockState} onMutation={() => { workflowDirty = true; workflowConflicted = false; workflowFailed = false; }} />
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
        {capabilityReadiness}
        prepareDraft={saveDraft}
        onWorkflowDrafted={(drafted) => {
          // Describe -> draft -> canvas: the drafting agent's validated workflow
          // loads into the editable draft and jumps to the canvas so it's ready
          // to inspect and Run.
          draftWorkflow = drafted;
          draftLockState = "draft";
          workflowDirty = true;
          setTab("canvas");
        }}
      />
    </Tabs.Content>
  </Tabs.Root>
  {:else if audience === "organizer"}
    <OrganizerPanel
      workflow={draftWorkflow}
      revision={workflowDraft?.draftRevision ?? 0}
      parameters={organizerParameters}
      safePatchPaths={organizerSafePatchPaths}
      busy={organizerBusy || !workflowDraft}
      receiptIds={activeReceiptIds}
      onConfigure={(request) => void configureOrganizer(request)}
      onAction={(action) => void handleOrganizerAction(action)}
      onInspectReceipt={(receiptId) => { audience = "history"; void refreshWorkflowHistory({ receiptId }); }}
    />
    <WorkflowRunPanel
      workflow={draftWorkflow}
      {workspaceFetch}
      {signedHostApprovedCommandIds}
      onRunStateChange={handleRunStateChange}
    />
  {:else}
    <div class="flex flex-col gap-3">
      <div class="flex items-center justify-between gap-2">
        <p class="text-sm text-muted-foreground">Redacted operator history for the active session and workflow run. Builder and organizer state remain separate.</p>
        <Button variant="outline" onclick={() => void refreshWorkflowHistory()} disabled={historyBusy}>{historyBusy ? "Loading…" : "Refresh history"}</Button>
      </div>
      <RunHistoryPanel history={workflowHistory} />
    </div>
  {/if}
</div>

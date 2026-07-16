<script lang="ts">
  import { onMount } from "svelte";
  import TerminalHost from "$lib/client/TerminalHost.svelte";
  import {
    devWorkbenchSessionDescriptorSchema,
    type DevWorkbenchSessionDescriptor,
  } from "$lib/contracts/workbench";
  import {
    DevWorkbench,
    createDevWorkbenchCapability,
    devWorkbenchStartingFixture,
    workbenchDetailSchema,
    type DevWorkbenchViewProps,
    type WorkbenchDetail,
    type WorkbenchSemanticActionResult,
  } from "../design-system/patterns/DevWorkbench";
  import { unavailableAction, workbenchActionDescriptors } from "../design-system/patterns/DevWorkbench/actions";

  type Operation = "idle" | "resuming" | "starting" | "stopping";
  type TerminalState = "connecting" | "ready" | "error" | "closed";

  let workspace = $state<DevWorkbenchSessionDescriptor | null>(null);
  let operation = $state<Operation>("resuming");
  let terminalState = $state<TerminalState>("connecting");
  let activeDetail = $state<WorkbenchDetail>(devWorkbenchStartingFixture.activeDetail);
  let announcement = $state("");
  let visibleError = $state<string | null>(null);

  const view = $derived<DevWorkbenchViewProps>(createView());
  const capability = $derived(createDevWorkbenchCapability(view));
  const assertions = $derived({
    ...capability.assertions,
    repositoryMatchesVisibleUi: true,
    activeDetailMatchesVisibleUi: workbenchDetailSchema.safeParse(activeDetail).success,
    terminalUnavailableReasonVisible: Boolean(view.terminal.disabledReason),
    previewUnavailableReasonVisible: Boolean(view.preview.disabledReason),
  });

  function createView(): DevWorkbenchViewProps {
    if (!workspace) {
      const busy = operation === "resuming" || operation === "starting" || operation === "stopping";
      const message = operation === "starting"
        ? "Creating the sandbox, cloning the repository, installing dependencies, then starting tmux and the preview. First startup usually takes 60–90 seconds; keep this tab open."
        : operation === "resuming"
          ? "Checking for an existing isolated workspace."
          : operation === "stopping"
            ? "Stopping the isolated workspace."
            : visibleError ?? "Start an isolated checkout when you are ready to work.";
      return {
        ...devWorkbenchStartingFixture,
        workspace: {
          status: busy ? (operation === "stopping" ? "stopping" : "starting") : visibleError ? "error" : "idle",
          label: busy ? (operation === "stopping" ? "Stopping workspace" : "Preparing workspace") : visibleError ? "Workspace unavailable" : "Workspace not started",
          message,
        },
        activeDetail,
        problems: visibleError
          ? [{ id: "workspace-error", severity: "error", message: visibleError, file: null, line: null }]
          : [],
        actions: {
          ...devWorkbenchStartingFixture.actions,
          startWorkspace: busy
            ? { enabled: false, disabledReason: "A workspace operation is already running." }
            : { enabled: true, disabledReason: null },
        },
      };
    }

    const terminalReady = terminalState === "ready";
    const terminalReason = terminalReady
      ? null
      : terminalState === "connecting"
        ? "The terminal is connecting to the sandbox tmux session."
        : "The terminal connection ended. Reconnect to request a fresh short-lived token.";
    return {
      title: "Sonik Dev Workbench",
      repository: {
        name: repositoryLabel(workspace.repository.cloneUrl),
        branch: workspace.repository.branch ?? workspace.repository.revision,
        revision: workspace.repository.revision,
        dirty: false,
      },
      workspace: {
        status: operation === "stopping" ? "stopping" : "ready",
        label: operation === "stopping" ? "Stopping workspace" : "Workspace ready",
        message: operation === "stopping"
          ? "The isolated workspace is stopping."
          : "Codex, tmux, and the preview share the same isolated checkout.",
      },
      preview: workspace.preview
        ? {
            status: "ready",
            url: workspace.preview.url,
            path: "/",
            viewportLabel: "Responsive preview",
            disabledReason: null,
          }
        : {
            status: "unavailable",
            url: null,
            path: "/",
            viewportLabel: "Responsive preview",
            disabledReason: "The development server has not published a preview URL.",
          },
      terminal: {
        status: terminalReady ? "ready" : terminalState === "connecting" ? "connecting" : "error",
        sessionName: workspace.tmuxSession,
        cwd: workspace.repositoryRoot,
        transport: "Vercel interactive PTY · tmux",
        disabledReason: terminalReason,
      },
      activeDetail,
      problems: visibleError
        ? [{ id: "workspace-error", severity: "error", message: visibleError, file: null, line: null }]
        : [],
      changedFiles: [],
      consoleEntries: [],
      failedRequests: [],
      actions: {
        startWorkspace: { enabled: false, disabledReason: "A workspace is already running." },
        reconnectTerminal: operation === "idle"
          ? { enabled: true, disabledReason: null }
          : { enabled: false, disabledReason: "Wait for the current workspace operation to finish." },
        restartPreview: { enabled: false, disabledReason: "Preview restart wiring is not connected yet." },
        captureSnapshot: operation === "idle"
          ? { enabled: true, disabledReason: null }
          : { enabled: false, disabledReason: "Wait for the current workspace operation to finish." },
        openPreview: workspace.preview
          ? { enabled: true, disabledReason: null }
          : { enabled: false, disabledReason: "No preview URL is available." },
        stopWorkspace: operation === "idle"
          ? { enabled: true, disabledReason: null }
          : { enabled: false, disabledReason: "Wait for the current workspace operation to finish." },
      },
    };
  }

  function createPageContext() {
    return {
      schemaVersion: "1.0",
      route: "/",
      url: "/",
      title: view.title,
      theme: "host",
      auth: {
        signedIn: false,
        organizationPresent: Boolean(workspace?.organizationId),
        source: workspace ? "server-session" : "unavailable",
      },
      domain: {
        repository: { ...view.repository },
        previewPath: view.preview.path,
        tmuxSession: view.terminal.sessionName,
        workingDirectory: view.terminal.cwd,
      },
      interaction: { kind: view.workspace.status, activeDetail },
      actions: capability.actions,
      assertions,
      correlation: workspace ? { sessionId: workspace.sessionId, sandboxSessionId: workspace.sandboxSessionId } : null,
      warnings: [view.terminal.disabledReason, view.preview.disabledReason].filter((value): value is string => Boolean(value)),
      errors: visibleError ? [visibleError] : [],
      browserContextAuthority: "display-only",
    };
  }

  function snapshotPageContext() {
    return $state.snapshot(createPageContext());
  }

  function snapshotAssertions() {
    return $state.snapshot(assertions);
  }

  function accepted(message: string): WorkbenchSemanticActionResult {
    announcement = message;
    return { ok: true, state: "accepted", message, disabledReason: null };
  }

  function unavailable(action: keyof typeof view.actions): WorkbenchSemanticActionResult {
    const message = view.actions[action].disabledReason ?? `${action} is unavailable.`;
    announcement = message;
    return unavailableAction(message);
  }

  function startWorkspace(): WorkbenchSemanticActionResult {
    if (!view.actions.startWorkspace.enabled) return unavailable("startWorkspace");
    void startWorkspaceRequest();
    return accepted("Workspace creation started.");
  }

  function reconnectTerminal(): WorkbenchSemanticActionResult {
    if (!view.actions.reconnectTerminal.enabled) return unavailable("reconnectTerminal");
    terminalState = "connecting";
    void reconnectWorkspaceRequest();
    return accepted("Terminal reconnection started.");
  }

  function restartPreview(): WorkbenchSemanticActionResult {
    return unavailable("restartPreview");
  }

  function captureSnapshot(): WorkbenchSemanticActionResult {
    if (!view.actions.captureSnapshot.enabled) return unavailable("captureSnapshot");
    void synchronizePageContext();
    return accepted("Page context synchronization started.");
  }

  function openPreview(): WorkbenchSemanticActionResult {
    if (!view.actions.openPreview.enabled || !workspace?.preview) return unavailable("openPreview");
    window.open(workspace.preview.url, "_blank", "noopener,noreferrer");
    return accepted("Preview opened in a new tab.");
  }

  function stopWorkspace(): WorkbenchSemanticActionResult {
    if (!view.actions.stopWorkspace.enabled) return unavailable("stopWorkspace");
    if (!window.confirm("Stop and permanently delete this isolated development workspace?")) {
      announcement = "Workspace stop cancelled.";
      return unavailableAction(announcement);
    }
    void stopWorkspaceRequest();
    return accepted("Workspace stop started.");
  }

  function setDetail(detail: unknown): WorkbenchSemanticActionResult {
    const parsed = workbenchDetailSchema.safeParse(detail);
    if (!parsed.success) {
      announcement = "Unknown diagnostics panel.";
      return unavailableAction(announcement);
    }
    activeDetail = parsed.data;
    announcement = `${parsed.data} diagnostics selected.`;
    return { ok: true, state: "selected", message: announcement, disabledReason: null };
  }

  async function startWorkspaceRequest(): Promise<void> {
    operation = "starting";
    visibleError = null;
    const next = await requestWorkspace("POST");
    if (next) {
      workspace = next;
      terminalState = "connecting";
      announcement = "Workspace ready.";
    }
    operation = "idle";
  }

  async function reconnectWorkspaceRequest(): Promise<void> {
    visibleError = null;
    const next = await requestWorkspace("GET");
    if (next) workspace = next;
    else terminalState = "error";
  }

  async function synchronizePageContext(): Promise<void> {
    try {
      const response = await fetch("/api/workspaces/context", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(snapshotPageContext()),
      });
      if (!response.ok) throw new Error(await publicError(response));
      announcement = "Sanitized page context is available inside the sandbox.";
    } catch (error) {
      visibleError = safeMessage(error, "Page context could not be synchronized.");
      announcement = visibleError;
    }
  }

  async function stopWorkspaceRequest(): Promise<void> {
    operation = "stopping";
    visibleError = null;
    try {
      const response = await fetch("/api/workspaces", { method: "DELETE" });
      if (!response.ok) throw new Error(await publicError(response));
      workspace = null;
      terminalState = "closed";
      announcement = "Workspace stopped.";
    } catch (error) {
      visibleError = safeMessage(error, "The workspace could not be stopped.");
    } finally {
      operation = "idle";
    }
  }

  async function requestWorkspace(method: "GET" | "POST"): Promise<DevWorkbenchSessionDescriptor | null> {
    try {
      const response = await fetch("/api/workspaces", { method });
      if (method === "GET" && response.status === 404) return null;
      if (!response.ok) throw new Error(await publicError(response));
      const payload = await response.json() as { workspace?: unknown };
      const parsed = devWorkbenchSessionDescriptorSchema.safeParse(payload.workspace);
      if (!parsed.success) throw new Error("The server returned an invalid workspace descriptor.");
      return parsed.data;
    } catch (error) {
      visibleError = safeMessage(error, "The workspace request failed.");
      announcement = visibleError;
      return null;
    }
  }

  async function publicError(response: Response): Promise<string> {
    try {
      const payload = await response.json() as { error?: unknown };
      if (typeof payload.error === "string") return payload.error;
      if (payload.error && typeof payload.error === "object" && "message" in payload.error && typeof payload.error.message === "string") {
        return payload.error.message;
      }
    } catch {
      // The endpoint may have returned a platform error page. Do not surface it verbatim.
    }
    return "The Dev Workbench service is unavailable.";
  }

  function safeMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
  }

  function repositoryLabel(value: string): string {
    try {
      return new URL(value).pathname.replace(/^\/+|\.git$/g, "") || value;
    } catch {
      return value;
    }
  }

  function handleTerminalState(next: TerminalState, message: string): void {
    terminalState = next;
    announcement = message;
  }

  onMount(() => {
    void reconnectWorkspaceRequest().finally(() => { operation = "idle"; });
    const target = window as Window & { __sonikAgentUI?: unknown };
    const control = {
      schemaVersion: "sonik.agent_ui.page_control.v1" as const,
      getPageContext: snapshotPageContext,
      getAssertions: snapshotAssertions,
      getActions: () => ({
        schemaVersion: "sonik.agent_ui.actions.v1" as const,
        actions: Object.entries(workbenchActionDescriptors).map(([id, descriptor]) => ({
          id,
          ...descriptor,
          ...((view.actions as Record<string, { enabled: boolean; disabledReason: string | null }>)[id] ?? {
            enabled: true,
            disabledReason: null,
          }),
        })),
      }),
      actions: {
        startWorkspace,
        reconnectTerminal,
        restartPreview,
        captureSnapshot,
        openPreview,
        stopWorkspace,
        setDetail: ({ detail }: { detail?: unknown }) => setDetail(detail),
      },
    };
    target.__sonikAgentUI = control;
    return () => {
      if (target.__sonikAgentUI === control) delete target.__sonikAgentUI;
    };
  });
</script>

{#snippet terminalContent()}
  {#if workspace?.terminal}
    {#key workspace.terminal.accessToken}
      <TerminalHost
        connection={workspace.terminal}
        cwd={workspace.repositoryRoot}
        onStateChange={handleTerminalState}
      />
    {/key}
  {/if}
{/snippet}

<DevWorkbench
  {...view}
  terminalContent={workspace?.terminal ? terminalContent : undefined}
  onStartWorkspace={startWorkspace}
  onReconnectTerminal={reconnectTerminal}
  onRestartPreview={restartPreview}
  onCaptureSnapshot={captureSnapshot}
  onOpenPreview={openPreview}
  onStopWorkspace={stopWorkspace}
  onDetailChange={setDetail}
/>

<p class="sr-only" aria-live="polite">{announcement}</p>

<style>
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>

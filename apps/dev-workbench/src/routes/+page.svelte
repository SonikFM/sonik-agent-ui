<script lang="ts">
  import { env as publicEnv } from "$env/dynamic/public";
  import { page } from "$app/state";
  import {
    createAgentHostAuthorityDonationFromLegacyPayload,
    sanitizeAgentHostAuthorityDonation,
    sanitizeAgentHostPageContext,
  } from "@sonik-agent-ui/agent-embed";
  import {
    visualContextRequestSchema,
    visualContextSnapshotSchema,
    type VisualContextRequest,
    type VisualContextResult,
  } from "@sonik-agent-ui/tool-contracts/visual-context";
  import { onMount } from "svelte";
  import { z } from "zod";
  import TerminalHost from "$lib/client/TerminalHost.svelte";
  import {
    devWorkbenchSessionDescriptorSchema,
    visualBrowserStateSchema,
    type DevWorkbenchSessionDescriptor,
    type VisualBrowserState,
  } from "$lib/contracts/workbench";
  import {
    DevWorkbench,
    createDevWorkbenchCapability,
    derivePreviewStatus,
    devWorkbenchStartingFixture,
    workbenchDetailSchema,
    type DevWorkbenchViewProps,
    type WorkbenchDetail,
    type WorkbenchSemanticActionResult,
  } from "../design-system/patterns/DevWorkbench";
  import { unavailableAction, workbenchActionDescriptors } from "../design-system/patterns/DevWorkbench/actions";
  import {
    EXACT_ACTIVE_TAB_UNAVAILABLE_REASON,
    createAgentPageContextRequest,
    createEmbeddedPreviewUrl,
    createVisualContextSubmission,
    classifyVisualContextResult,
    defaultVisualSourceId,
    discoverVisualSources,
    hostVisualPersistenceState,
    isAgentHostActionRequestMessage,
    isAgentHostActionResultMessage,
    isAgentHostPageContextMessage,
    isAgentPageContextRequestMessage,
    isVisualContextResultMessage,
    pendingHostVisualRequestDisabledReason,
    resolveEmbeddedHostColorScheme,
    resolveEmbeddedHostOrigin,
    visualPickDisabledReason,
    type AgentHostPageContextMessage,
  } from "$lib/client/host-context-bridge";

  type Operation = "idle" | "resuming" | "starting" | "stopping";
  type TerminalState = "connecting" | "ready" | "error" | "closed";
  const visualContextPersistenceResponseSchema = z.strictObject({
    accepted: z.boolean(),
    snapshot: visualContextSnapshotSchema.nullable(),
  });
  const visualContextReadResponseSchema = z.strictObject({
    snapshot: visualContextSnapshotSchema.nullable(),
  });

  let workspace = $state<DevWorkbenchSessionDescriptor | null>(null);
  let operation = $state<Operation>("resuming");
  let terminalState = $state<TerminalState>("connecting");
  let previewInteractive = $state(false);
  let activeDetail = $state<WorkbenchDetail>(devWorkbenchStartingFixture.activeDetail);
  let announcement = $state("");
  let visibleError = $state<string | null>(null);
  let hostContextMessage = $state.raw<AgentHostPageContextMessage | null>(null);
  let embeddedHostOrigin = $state<string | null>(null);
  let workbenchOrigin = $state<string | null>(null);
  let hostColorScheme = $state<"light" | "dark" | null>(null);
  let hostContextRefreshTimer: number | null = null;
  let restoredHostRoute = $state<string | null>(null);
  let selectedVisualSourceId = $state<"preview" | "host" | null>(null);
  let sourceContextRevision = $state(0);
  let routeRevision = $state(0);
  let visualStatus = $state<"idle" | "picking" | "capturing" | "invalidated" | "error">("idle");
  let visualStatusMessage = $state("Start a workspace to discover visual sources.");
  let visualStaleReason = $state<"source-changed" | "route-changed" | "navigation" | "cancelled" | "provider-lost" | null>(null);
  let visualActionFocus: HTMLElement | null = null;
  let pendingVisualRequest = $state.raw<VisualContextRequest | null>(null);
  let visualBrowser = $state<VisualBrowserState | null>(null);
  let visualExtensionPaired = $state(false);

  const terminalOnly = $derived(page.url.searchParams.get("surface") === "terminal");
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
    const visualSources = discoveredVisualSources();
    const visualSourceId = selectedVisualSourceId && visualSources.some((source) => source.id === selectedVisualSourceId)
      ? selectedVisualSourceId
      : defaultVisualSourceId(visualSources);
    const sourceUnavailable = visualSourceId ? null : "No Preview or Host visual source is connected.";
    const pickDisabledReason = visualPickDisabledReason(visualSourceId);
    const pendingHostReason = pendingHostVisualRequestDisabledReason(pendingVisualRequest);
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
            status: derivePreviewStatus(true, previewInteractive),
            url: createEmbeddedPreviewUrl({
              previewUrl: workspace.preview.url,
              workbenchOrigin,
              theme: hostTheme(),
            }),
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
      visualContext: {
        sources: visualSources.map(({ id, label, route }) => ({ id, label, route })),
        selectedSourceId: visualSourceId,
        sourceContextRevision,
        routeRevision,
        status: visualStatus,
        statusMessage: visualStatusMessage,
        staleReason: visualStaleReason,
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
        restartPreview: !workspace.preview
          ? { enabled: false, disabledReason: "No preview URL is available." }
          : operation === "idle"
          ? { enabled: true, disabledReason: null }
          : { enabled: false, disabledReason: "Wait for the current workspace operation to finish." },
        captureSnapshot: operation === "idle"
          ? { enabled: true, disabledReason: null }
          : { enabled: false, disabledReason: "Wait for the current workspace operation to finish." },
        pickVisualTarget: pendingHostReason
          ? { enabled: false, disabledReason: pendingHostReason }
          : pickDisabledReason
          ? { enabled: false, disabledReason: pickDisabledReason }
          : { enabled: true, disabledReason: null },
        captureVisualContext: pendingHostReason
          ? { enabled: false, disabledReason: pendingHostReason }
          : sourceUnavailable
          ? { enabled: false, disabledReason: sourceUnavailable }
          : visualSourceId === "host"
            ? { enabled: false, disabledReason: EXACT_ACTIVE_TAB_UNAVAILABLE_REASON }
            : visualBrowser?.capability === "installed"
              ? { enabled: operation === "idle", disabledReason: operation === "idle" ? null : "Wait for the current workspace operation to finish." }
              : { enabled: false, disabledReason: visualBrowser?.disabledReason ?? "Checking controlled browser capture readiness." },
        setupVisualBrowser: visualBrowser?.setup === "pending"
          ? { enabled: false, disabledReason: "Controlled browser setup is in progress." }
          : visualBrowser?.capability === "installed"
            ? { enabled: false, disabledReason: "Controlled browser capture is ready." }
            : { enabled: operation === "idle", disabledReason: operation === "idle" ? null : "Wait for the current workspace operation to finish." },
        pairVisualExtension: pendingHostReason
          ? { enabled: false, disabledReason: pendingHostReason }
          : visualSources.some((source) => source.id === "host")
          ? { enabled: false, disabledReason: EXACT_ACTIVE_TAB_UNAVAILABLE_REASON }
          : { enabled: false, disabledReason: "Connect an embedded Host source before pairing the extension." },
        openPreview: workspace.preview
          ? { enabled: true, disabledReason: null }
          : { enabled: false, disabledReason: "No preview URL is available." },
        stopWorkspace: operation === "idle"
          ? { enabled: true, disabledReason: null }
          : { enabled: false, disabledReason: "Wait for the current workspace operation to finish." },
      },
    };
  }

  function discoveredVisualSources() {
    return discoverVisualSources({
      previewUrl: workspace?.preview?.url,
      previewRoute: viewPreviewPath(),
      hostOrigin: embeddedHostOrigin && hostContextMessage ? embeddedHostOrigin : null,
      hostRoute: hostContextMessage?.payload.route,
    });
  }

  function viewPreviewPath(): string {
    return "/";
  }

  function selectVisualSource(sourceId: "preview" | "host"): WorkbenchSemanticActionResult {
    const source = discoveredVisualSources().find((candidate) => candidate.id === sourceId);
    if (!source) return unavailableAction("That visual source is no longer connected.");
    if (selectedVisualSourceId !== sourceId) {
      visualExtensionPaired = false;
      selectedVisualSourceId = sourceId;
      sourceContextRevision += 1;
      invalidateVisualContext("source-changed", `${source.label} selected. Previous visual context was cleared.`);
    }
    return accepted(`${source.label} selected.`);
  }

  function cancelHostPicker(): void {
    const request = pendingVisualRequest;
    if (request?.operation !== "pick" || request.provider !== "host" || !embeddedHostOrigin || window.parent === window) return;
    window.parent.postMessage({ ...request, requestId: crypto.randomUUID(), operation: "clear" }, embeddedHostOrigin);
  }

  function invalidateVisualContext(reason: NonNullable<typeof visualStaleReason>, message: string): void {
    cancelHostPicker();
    pendingVisualRequest = null;
    visualStatus = "invalidated";
    visualStaleReason = reason;
    visualStatusMessage = message;
    announcement = message;
    if (workspace) void persistVisualInvalidation(reason);
  }

  function createPageContext() {
    const donated = hostContextMessage?.payload;
    const hostAuthenticated = donated?.authenticated === true;
    const donatedOrganizationId = typeof donated?.organizationId === "string" ? donated.organizationId : null;
    return {
      schemaVersion: "1.0",
      route: "/",
      url: "/",
      title: view.title,
      theme: hostTheme() ?? "host",
      auth: {
        signedIn: hostAuthenticated,
        organizationPresent: Boolean(donatedOrganizationId ?? workspace?.organizationId),
        source: hostAuthenticated ? "host-donation" : workspace ? "server-session" : "unavailable",
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

  function hostTheme(): string | null {
    const value = hostContextMessage?.payload.theme;
    return typeof value === "string" && value.trim() ? value.trim().slice(0, 64) : null;
  }

  function previewFrame(): HTMLIFrameElement | null {
    return document.querySelector<HTMLIFrameElement>("iframe.dev-workbench__preview-frame");
  }

  function currentPreviewOrigin(): string | null {
    const url = view.preview.url;
    if (!url) return null;
    try {
      return new URL(url).origin;
    } catch {
      return null;
    }
  }

  function postHostContextToPreview(): void {
    if (!hostContextMessage) return;
    const frame = previewFrame();
    const targetOrigin = currentPreviewOrigin();
    if (!frame?.contentWindow || !targetOrigin) return;
    frame.contentWindow.postMessage(hostContextMessage, targetOrigin);
  }

  function requestHostContext(reason: string): void {
    if (!embeddedHostOrigin || window.parent === window) return;
    window.parent.postMessage(createAgentPageContextRequest(reason), embeddedHostOrigin);
  }

  function handleBridgeMessage(event: MessageEvent): void {
    if (event.source === window.parent && event.origin === embeddedHostOrigin) {
      if (isAgentHostPageContextMessage(event.data)) {
        const previousRoute = restoredHostRoute
          ?? discoveredVisualSources().find((source) => source.id === "host")?.route;
        hostContextMessage = event.data;
        const nextRoute = discoveredVisualSources().find((source) => source.id === "host")?.route;
        restoredHostRoute = nextRoute ?? null;
        if (previousRoute && nextRoute && previousRoute !== nextRoute) {
          routeRevision += 1;
          const pairingLost = visualExtensionPaired;
          visualExtensionPaired = false;
          invalidateVisualContext(pairingLost ? "provider-lost" : "route-changed", pairingLost
            ? "Host navigation ended the active-tab pairing. Pair it again before capturing Host context."
            : "Host navigation cleared the previous visual context.");
        }
        const theme = hostTheme();
        if (theme) document.documentElement.dataset.hostTheme = theme;
        announcement = `${hostSourceLabel()} context connected.`;
        postHostContextToPreview();
        window.setTimeout(postHostContextToPreview, 250);
        if (workspace) void synchronizePageContext();
        scheduleHostContextRefresh();
        return;
      }
      if (isAgentHostActionResultMessage(event.data)) {
        const frame = previewFrame();
        const targetOrigin = currentPreviewOrigin();
        if (frame?.contentWindow && targetOrigin) frame.contentWindow.postMessage(event.data, targetOrigin);
      }
      if (isVisualContextResultMessage(event.data)) finishVisualOperation(event.data);
      return;
    }

    const frame = previewFrame();
    const previewOrigin = currentPreviewOrigin();
    if (!frame?.contentWindow || event.source !== frame.contentWindow || event.origin !== previewOrigin) return;
    if (!previewInteractive) {
      previewInteractive = true;
      if (!selectedVisualSourceId) {
        visualStatusMessage = "Preview is ready. Capture it to attach current visual context.";
      }
      announcement = "Preview interface connected.";
    }
    if (isAgentPageContextRequestMessage(event.data)) {
      if (hostContextMessage) postHostContextToPreview();
      else requestHostContext("sandbox_preview_requested_context");
      return;
    }
    if (isAgentHostActionRequestMessage(event.data) && embeddedHostOrigin) {
      window.parent.postMessage(event.data, embeddedHostOrigin);
    }
  }

  function finishVisualOperation(result: VisualContextResult): void {
    const source = discoveredVisualSources().find((candidate) => candidate.id === view.visualContext.selectedSourceId) ?? null;
    const classification = classifyVisualContextResult({ pending: pendingVisualRequest, result, sourceContextRevision, routeRevision, source });
    if (classification === "ignore") return;
    if (classification === "invalidate") {
      visualStatusMessage = "A stale visual result was discarded after the source changed.";
      announcement = visualStatusMessage;
      return;
    }
    const request = pendingVisualRequest!;
    pendingVisualRequest = null;
    const completed = result.status === "completed";
    const providerLost = request.provider === "chrome-active-tab"
      && (result.operation === "unpair-extension" || result.status === "failed" || result.status === "unavailable");
    if (completed && result.operation === "pair-extension") visualExtensionPaired = true;
    if (providerLost) {
      visualExtensionPaired = false;
      invalidateVisualContext("provider-lost", "The active-tab provider disconnected. Pair it again before capturing Host context.");
      visualActionFocus?.focus();
      visualActionFocus = null;
      if (workspace) void submitVisualResult(request, result, false);
      return;
    }
    const persistedHostOperation = request.operation === "pick" || request.operation === "capture" || request.operation === "clear";
    if (workspace && persistedHostOperation) {
      visualStatusMessage = "Saving Host visual context.";
      announcement = visualStatusMessage;
      visualActionFocus?.focus();
      visualActionFocus = null;
      void submitVisualResult(request, result);
      return;
    }
    visualStatus = completed ? "idle" : result.status === "cancelled" ? "invalidated" : "error";
    visualStaleReason = result.status === "cancelled" ? "cancelled" : null;
    visualStatusMessage = completed
      ? result.operation === "pair-extension"
        ? "Exact active-tab extension paired."
        : result.operation === "capture"
          ? "Host Capture is current."
          : "Visual target selected."
      : result.disabledReason ?? "Visual operation ended.";
    announcement = visualStatusMessage;
    visualActionFocus?.focus();
    visualActionFocus = null;
    if (workspace) void submitVisualResult(request, result);
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
    if (!workspace?.preview) return unavailable("restartPreview");
    void restartPreviewRequest();
    return accepted("Preview restart started.");
  }

  async function restartPreviewRequest(): Promise<void> {
    previewInteractive = false;
    try {
      const response = await fetch("/api/workspaces/preview", { method: "POST" });
      if (!response.ok) throw new Error(await publicError(response));
      announcement = "Preview restarted.";
    } catch (error) {
      visibleError = safeMessage(error, "The preview could not be restarted.");
      announcement = visibleError;
    }
  }

  function captureSnapshot(): WorkbenchSemanticActionResult {
    if (!view.actions.captureSnapshot.enabled) return unavailable("captureSnapshot");
    void synchronizePageContext();
    return accepted("Page context synchronization started.");
  }

  function pickVisualTarget(): WorkbenchSemanticActionResult {
    const pendingReason = pendingHostVisualRequestDisabledReason(pendingVisualRequest);
    if (pendingReason) {
      announcement = pendingReason;
      return unavailableAction(pendingReason);
    }
    if (!view.actions.pickVisualTarget.enabled) return unavailable("pickVisualTarget");
    const source = discoveredVisualSources().find((candidate) => candidate.id === view.visualContext.selectedSourceId);
    if (source?.id !== "host" || !embeddedHostOrigin || !workbenchOrigin || window.parent === window) {
      return unavailableAction(visualPickDisabledReason(source?.id ?? null) ?? "The Host source cannot receive picker requests.");
    }
    visualActionFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    visualStatus = "picking";
    visualStaleReason = null;
    visualStatusMessage = `Choose an element in ${source.label}; press Escape to cancel.`;
    pendingVisualRequest = {
      messageSource: "sonik-agent-ui", type: "sonik:visual-context:request", version: "sonik.visual-context.v1",
      requestId: crypto.randomUUID(), operation: "pick", origin: workbenchOrigin,
      sourceContextRevision, routeRevision, source, provider: "host",
    };
    void postRegisteredHostRequest(pendingVisualRequest);
    return accepted(visualStatusMessage);
  }

  function captureVisualContext(): WorkbenchSemanticActionResult {
    const pendingReason = pendingHostVisualRequestDisabledReason(pendingVisualRequest);
    if (pendingReason) {
      announcement = pendingReason;
      return unavailableAction(pendingReason);
    }
    const source = discoveredVisualSources().find((candidate) => candidate.id === view.visualContext.selectedSourceId);
    if (source?.id === "host") {
      announcement = EXACT_ACTIVE_TAB_UNAVAILABLE_REASON;
      return unavailableAction(EXACT_ACTIVE_TAB_UNAVAILABLE_REASON);
    }
    if (!view.actions.captureVisualContext.enabled) return unavailable("captureVisualContext");
    visualStatus = "capturing";
    visualStatusMessage = "Capturing Preview in the controlled browser.";
    announcement = visualStatusMessage;
    void requestVisualBrowser("capture");
    return accepted(visualStatusMessage);
  }

  function setupVisualBrowser(): WorkbenchSemanticActionResult {
    if (!view.actions.setupVisualBrowser.enabled) return unavailable("setupVisualBrowser");
    visualBrowser = { capability: visualBrowser?.capability ?? "missing", setup: "pending", disabledReason: visualBrowser?.disabledReason ?? "Controlled browser capture is not installed." };
    announcement = "Controlled browser setup started.";
    void requestVisualBrowser("setup-browser");
    return accepted(announcement);
  }

  function pairVisualExtension(): WorkbenchSemanticActionResult {
    const pendingReason = pendingHostVisualRequestDisabledReason(pendingVisualRequest);
    if (pendingReason) {
      announcement = pendingReason;
      return unavailableAction(pendingReason);
    }
    announcement = EXACT_ACTIVE_TAB_UNAVAILABLE_REASON;
    return unavailableAction(EXACT_ACTIVE_TAB_UNAVAILABLE_REASON);
  }

  async function postRegisteredHostRequest(request: VisualContextRequest): Promise<void> {
    if (!workspace || !embeddedHostOrigin || window.parent === window) return;
    try {
      const response = await fetch("/api/workspaces/visual-context", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      if (!response.ok) throw new Error(await publicError(response));
      const payload = await response.json() as { request?: unknown };
      const registered = visualContextRequestSchema.safeParse(payload.request);
      if (!registered.success || registered.data.requestId !== request.requestId) throw new Error("The visual request could not be registered.");
      if (pendingVisualRequest !== request) return;
      window.parent.postMessage(registered.data, embeddedHostOrigin);
    } catch (error) {
      if (pendingVisualRequest !== request) return;
      pendingVisualRequest = null;
      visualStatus = "error";
      visualStatusMessage = safeMessage(error, "The visual request could not be registered.");
      announcement = visualStatusMessage;
    }
  }

  async function submitVisualResult(request: VisualContextRequest, result: VisualContextResult, updateUi = true): Promise<void> {
    if (!workspace) return;
    try {
      const response = await fetch("/api/workspaces/visual-context", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(createVisualContextSubmission(workspace.sessionId, request, result)),
      });
      if (!response.ok) throw new Error(await publicError(response));
      const persisted = visualContextPersistenceResponseSchema.safeParse(await response.json());
      if (!persisted.success) throw new Error("The server returned an invalid visual persistence result.");
      const persistedHostOperation = request.operation === "pick" || request.operation === "capture" || request.operation === "clear";
      if (!persistedHostOperation || !updateUi) return;
      const state = hostVisualPersistenceState(persisted.data.accepted, result);
      visualStatus = state.status;
      visualStaleReason = state.staleReason;
      visualStatusMessage = state.message;
      announcement = visualStatusMessage;
    } catch (error) {
      visualStatus = "error";
      visualStatusMessage = safeMessage(error, "The visual result could not be saved.");
      announcement = visualStatusMessage;
    }
  }

  async function persistVisualInvalidation(staleReason: NonNullable<typeof visualStaleReason>): Promise<void> {
    const source = discoveredVisualSources().find((candidate) => candidate.id === view.visualContext.selectedSourceId);
    if (!workspace || !source) return;
    try {
      const response = await fetch("/api/workspaces/visual-context", {
        method: "DELETE", headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceSessionId: workspace.sessionId, sourceContextRevision, routeRevision, source, staleReason }),
      });
      if (!response.ok) throw new Error(await publicError(response));
    } catch (error) {
      visibleError = safeMessage(error, "Stale visual context could not be cleared.");
      announcement = visibleError;
    }
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
    previewInteractive = false;
    const next = await requestWorkspace("POST");
    if (next) {
      workspace = next;
      announcePreviewAvailability();
      terminalState = "connecting";
      announcement = "Workspace ready.";
      void requestVisualBrowser("get-capabilities");
      if (hostContextMessage) void synchronizePageContext();
    }
    operation = "idle";
  }

  async function reconnectWorkspaceRequest(startIfMissing = false): Promise<void> {
    visibleError = null;
    previewInteractive = false;
    const next = await requestWorkspace("GET");
    if (next) {
      workspace = next;
      await restoreVisualContext(next.sessionId);
      announcePreviewAvailability();
      void requestVisualBrowser("get-capabilities");
      if (hostContextMessage) void synchronizePageContext();
    }
    else if (startIfMissing && !visibleError) await startWorkspaceRequest();
    else terminalState = "error";
  }

  function announcePreviewAvailability(): void {
    if (selectedVisualSourceId || !workspace?.preview) return;
    visualStatusMessage = "Preview server is ready. Waiting for the interface to connect.";
  }

  async function restoreVisualContext(sessionId: string): Promise<void> {
    try {
      const response = await fetch("/api/workspaces/visual-context");
      if (response.status === 404) return;
      if (!response.ok) throw new Error(await publicError(response));
      const parsed = visualContextReadResponseSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("The server returned invalid saved visual context.");
      if (workspace?.sessionId !== sessionId || !parsed.data.snapshot) return;
      const snapshot = parsed.data.snapshot;
      selectedVisualSourceId = snapshot.source.id;
      sourceContextRevision = snapshot.sourceContextRevision;
      routeRevision = snapshot.routeRevision;
      restoredHostRoute = snapshot.source.id === "host" ? snapshot.source.route : null;
      visualStatus = snapshot.status === "current" ? "idle" : "invalidated";
      visualStaleReason = snapshot.staleReason;
      visualStatusMessage = snapshot.status === "current"
        ? `${snapshot.source.label} visual context restored.`
        : "Saved visual context is stale. Capture it again when the source is ready.";
      announcement = visualStatusMessage;
    } catch (error) {
      if (workspace?.sessionId !== sessionId) return;
      visualStatus = "error";
      visualStatusMessage = safeMessage(error, "Saved visual context could not be restored.");
      announcement = visualStatusMessage;
    }
  }

  async function synchronizePageContext(): Promise<void> {
    try {
      const authority = hostContextMessage
        ? sanitizeAgentHostAuthorityDonation(hostContextMessage.authority)
          ?? createAgentHostAuthorityDonationFromLegacyPayload(hostContextMessage.payload)
          ?? null
        : null;
      const host = embeddedHostOrigin && hostContextMessage
        ? {
            origin: embeddedHostOrigin,
            pageContext: sanitizeAgentHostPageContext(hostContextMessage.payload),
            authority,
          }
        : null;
      const response = await fetch("/api/workspaces/context", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pageContext: snapshotPageContext(), host }),
      });
      if (!response.ok) throw new Error(await publicError(response));
      const result = await response.json() as { openApiWritten?: unknown };
      announcement = result.openApiWritten === true
        ? "Sanitized host context and OpenAPI are available inside the sandbox. Signed authority was consumed only by the server."
        : "Host context is available inside the sandbox; OpenAPI could not be refreshed.";
    } catch (error) {
      visibleError = safeMessage(error, "Page context could not be synchronized.");
      announcement = visibleError;
    }
  }

  async function requestVisualBrowser(operation: "get-capabilities" | "setup-browser" | "capture"): Promise<void> {
    const sessionId = workspace?.sessionId;
    if (!sessionId) return;
    try {
      const source = discoveredVisualSources().find((candidate) => candidate.id === "preview");
      if (!source) throw new Error("Preview is not connected.");
      const response = await fetch("/api/workspaces/visual-browser", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messageSource: "sonik-agent-ui", type: "sonik:visual-context:request", version: "sonik.visual-context.v1",
          requestId: crypto.randomUUID(), operation, origin: window.location.origin,
          sourceContextRevision, routeRevision, source, provider: "playwright",
          ...(operation === "capture" ? { viewport: { width: 1440, height: 900, deviceScaleFactor: 1 } } : {}),
        }),
      });
      if (!response.ok) throw new Error(await publicError(response));
      const payload = await response.json() as { accepted?: unknown; browser?: unknown; result?: { status?: unknown } };
      const parsed = visualBrowserStateSchema.safeParse(payload.browser);
      if (!parsed.success) throw new Error("The server returned invalid browser readiness.");
      if (workspace?.sessionId !== sessionId) return;
      visualBrowser = parsed.data;
      if (operation === "capture") {
        const accepted = payload.accepted === true && payload.result?.status === "completed";
        visualStatus = accepted ? "idle" : payload.accepted === false ? "invalidated" : "error";
        visualStaleReason = payload.accepted === false ? "navigation" : null;
        visualStatusMessage = accepted ? "Preview Capture is current." : payload.accepted === false
          ? "A stale Preview result was discarded. Capture again."
          : "Preview Capture failed.";
      }
      announcement = parsed.data.capability === "installed"
        ? operation === "setup-browser" ? "Controlled browser setup succeeded. Preview Capture is ready." : operation === "capture" ? visualStatusMessage : "Preview Capture is ready."
        : parsed.data.disabledReason ?? "Controlled browser capture is unavailable.";
    } catch (error) {
      if (workspace?.sessionId !== sessionId) return;
      visualBrowser = { capability: "launch-failed", setup: operation === "setup-browser" ? "failed" : "idle", disabledReason: "Controlled browser capture could not launch." };
      if (operation === "capture") {
        visualStatus = "error";
        visualStatusMessage = "Preview Capture failed.";
      }
      announcement = safeMessage(error, visualBrowser.disabledReason ?? "Controlled browser capture is unavailable.");
    }
  }

  function scheduleHostContextRefresh(): void {
    if (hostContextRefreshTimer !== null) window.clearTimeout(hostContextRefreshTimer);
    const authority = hostContextMessage
      ? sanitizeAgentHostAuthorityDonation(hostContextMessage.authority)
        ?? createAgentHostAuthorityDonationFromLegacyPayload(hostContextMessage.payload)
      : undefined;
    const expiresAt = authority ? Date.parse(authority.expiresAt) : Number.NaN;
    const untilRefresh = Number.isFinite(expiresAt)
      ? Math.max(30_000, Math.min(4 * 60_000, expiresAt - Date.now() - 60_000))
      : 30_000;
    hostContextRefreshTimer = window.setTimeout(() => {
      requestHostContext("dev_workbench_authority_refresh");
    }, untilRefresh);
  }

  function hostSourceLabel(): string {
    return discoveredVisualSources().find((source) => source.id === "host")?.label ?? "Host";
  }

  async function stopWorkspaceRequest(): Promise<void> {
    operation = "stopping";
    visibleError = null;
    try {
      const response = await fetch("/api/workspaces", { method: "DELETE" });
      if (!response.ok) throw new Error(await publicError(response));
      workspace = null;
      visualBrowser = null;
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
    workbenchOrigin = window.location.origin;
    hostColorScheme = resolveEmbeddedHostColorScheme(window.location.search);
    if (hostColorScheme) {
      document.documentElement.style.colorScheme = hostColorScheme;
      document.documentElement.dataset.hostColorScheme = hostColorScheme;
    }
    embeddedHostOrigin = resolveEmbeddedHostOrigin({
      search: window.location.search,
      referrer: document.referrer,
      allowlist: publicEnv.PUBLIC_DEV_WORKBENCH_ALLOWED_HOST_ORIGINS,
    });
    window.addEventListener("message", handleBridgeMessage);
    requestHostContext("dev_workbench_mounted");
    void reconnectWorkspaceRequest(terminalOnly).finally(() => { operation = "idle"; });
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
        pickVisualTarget,
        captureVisualContext,
        setupVisualBrowser,
        pairVisualExtension,
        openPreview,
        stopWorkspace,
        setDetail: ({ detail }: { detail?: unknown }) => setDetail(detail),
      },
    };
    target.__sonikAgentUI = control;
    return () => {
      cancelHostPicker();
      window.removeEventListener("message", handleBridgeMessage);
      if (hostContextRefreshTimer !== null) window.clearTimeout(hostContextRefreshTimer);
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
  terminalOnly={terminalOnly}
  terminalContent={workspace?.terminal ? terminalContent : undefined}
  onStartWorkspace={startWorkspace}
  onReconnectTerminal={reconnectTerminal}
  onRestartPreview={restartPreview}
  onCaptureSnapshot={captureSnapshot}
  onVisualSourceChange={selectVisualSource}
  onPickVisualTarget={pickVisualTarget}
  onCaptureVisualContext={captureVisualContext}
  onSetupVisualBrowser={setupVisualBrowser}
  onPairVisualExtension={pairVisualExtension}
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

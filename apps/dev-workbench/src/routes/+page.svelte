<script lang="ts">
  import { env as publicEnv } from "$env/dynamic/public";
  import { page } from "$app/state";
  import {
    createAgentHostAuthorityDonationFromLegacyPayload,
    sanitizeAgentHostAuthorityDonation,
    sanitizeAgentHostPageContext,
  } from "@sonik-agent-ui/agent-embed";
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
  import {
    createAgentPageContextRequest,
    createEmbeddedPreviewUrl,
    defaultVisualSourceId,
    discoverVisualSources,
    isAgentHostActionRequestMessage,
    isAgentHostActionResultMessage,
    isAgentHostPageContextMessage,
    isAgentPageContextRequestMessage,
    isVisualContextResultMessage,
    resolveEmbeddedHostColorScheme,
    resolveEmbeddedHostOrigin,
    type AgentHostPageContextMessage,
  } from "$lib/client/host-context-bridge";

  type Operation = "idle" | "resuming" | "starting" | "stopping";
  type TerminalState = "connecting" | "ready" | "error" | "closed";

  let workspace = $state<DevWorkbenchSessionDescriptor | null>(null);
  let operation = $state<Operation>("resuming");
  let terminalState = $state<TerminalState>("connecting");
  let activeDetail = $state<WorkbenchDetail>(devWorkbenchStartingFixture.activeDetail);
  let announcement = $state("");
  let visibleError = $state<string | null>(null);
  let hostContextMessage = $state.raw<AgentHostPageContextMessage | null>(null);
  let embeddedHostOrigin = $state<string | null>(null);
  let workbenchOrigin = $state<string | null>(null);
  let hostColorScheme = $state<"light" | "dark" | null>(null);
  let hostContextRefreshTimer: number | null = null;
  let selectedVisualSourceId = $state<"preview" | "host" | null>(null);
  let sourceContextRevision = $state(0);
  let routeRevision = $state(0);
  let visualStatus = $state<"idle" | "picking" | "capturing" | "invalidated" | "error">("idle");
  let visualStatusMessage = $state("Start a workspace to discover visual sources.");
  let visualStaleReason = $state<"source-changed" | "route-changed" | "navigation" | "cancelled" | "provider-lost" | null>(null);
  let visualActionFocus: HTMLElement | null = null;

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
        restartPreview: { enabled: false, disabledReason: "Preview restart wiring is not connected yet." },
        captureSnapshot: operation === "idle"
          ? { enabled: true, disabledReason: null }
          : { enabled: false, disabledReason: "Wait for the current workspace operation to finish." },
        pickVisualTarget: sourceUnavailable
          ? { enabled: false, disabledReason: sourceUnavailable }
          : { enabled: true, disabledReason: null },
        captureVisualContext: sourceUnavailable
          ? { enabled: false, disabledReason: sourceUnavailable }
          : visualSourceId === "host"
            ? { enabled: false, disabledReason: "Pair the active-tab extension before capturing the Host source." }
            : { enabled: false, disabledReason: "Set up the controlled browser before capturing the Preview source." },
        setupVisualBrowser: { enabled: false, disabledReason: "Controlled browser setup is not connected in this release." },
        pairVisualExtension: visualSources.some((source) => source.id === "host")
          ? { enabled: true, disabledReason: null }
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
      selectedVisualSourceId = sourceId;
      sourceContextRevision += 1;
      invalidateVisualContext("source-changed", `${source.label} selected. Previous visual context was cleared.`);
    }
    return accepted(`${source.label} selected.`);
  }

  function invalidateVisualContext(reason: NonNullable<typeof visualStaleReason>, message: string): void {
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
        const previousRoute = discoveredVisualSources().find((source) => source.id === "host")?.route;
        hostContextMessage = event.data;
        const nextRoute = discoveredVisualSources().find((source) => source.id === "host")?.route;
        if (previousRoute && nextRoute && previousRoute !== nextRoute) {
          routeRevision += 1;
          invalidateVisualContext("route-changed", "Host navigation cleared the previous visual context.");
        }
        const theme = hostTheme();
        if (theme) document.documentElement.dataset.hostTheme = theme;
        announcement = "Booking session context connected.";
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
    if (isAgentPageContextRequestMessage(event.data)) {
      if (hostContextMessage) postHostContextToPreview();
      else requestHostContext("sandbox_preview_requested_context");
      return;
    }
    if (isAgentHostActionRequestMessage(event.data) && embeddedHostOrigin) {
      window.parent.postMessage(event.data, embeddedHostOrigin);
    }
    if (isVisualContextResultMessage(event.data)) finishVisualOperation(event.data);
  }

  function finishVisualOperation(value: unknown): void {
    const record = value as Record<string, unknown>;
    const completed = record.status === "completed";
    visualStatus = completed ? "idle" : record.status === "cancelled" ? "invalidated" : "error";
    visualStaleReason = record.status === "cancelled" ? "cancelled" : null;
    visualStatusMessage = completed ? "Visual target selected." : typeof record.disabledReason === "string" ? record.disabledReason : "Visual operation ended.";
    announcement = visualStatusMessage;
    visualActionFocus?.focus();
    visualActionFocus = null;
    if (workspace) void submitVisualResult(record);
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

  function pickVisualTarget(): WorkbenchSemanticActionResult {
    if (!view.actions.pickVisualTarget.enabled) return unavailable("pickVisualTarget");
    const source = discoveredVisualSources().find((candidate) => candidate.id === view.visualContext.selectedSourceId);
    const target = source?.id === "host" ? window.parent : previewFrame()?.contentWindow;
    const origin = source?.id === "host" ? embeddedHostOrigin : currentPreviewOrigin();
    if (!source || !target || !origin) return unavailableAction("The selected visual source cannot receive picker requests.");
    visualActionFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    visualStatus = "picking";
    visualStaleReason = null;
    visualStatusMessage = `Choose an element in ${source.label}; press Escape to cancel.`;
    target.postMessage({
      messageSource: "sonik-agent-ui", type: "sonik:visual-context:request", version: "sonik.visual-context.v1",
      requestId: crypto.randomUUID(), operation: "pick", origin: workbenchOrigin,
      sourceContextRevision, routeRevision, source, provider: "host",
    }, origin);
    return accepted(visualStatusMessage);
  }

  function captureVisualContext(): WorkbenchSemanticActionResult {
    if (!view.actions.captureVisualContext.enabled) return unavailable("captureVisualContext");
    return unavailableAction("No capture provider is ready.");
  }

  function setupVisualBrowser(): WorkbenchSemanticActionResult {
    if (!view.actions.setupVisualBrowser.enabled) return unavailable("setupVisualBrowser");
    return unavailableAction("Controlled browser setup is not connected in this release.");
  }

  function pairVisualExtension(): WorkbenchSemanticActionResult {
    if (!view.actions.pairVisualExtension.enabled) return unavailable("pairVisualExtension");
    if (!embeddedHostOrigin || window.parent === window) return unavailableAction("The embedded Host cannot receive extension pairing requests.");
    const source = discoveredVisualSources().find((candidate) => candidate.id === "host");
    if (!source) return unavailableAction("Host source is not connected.");
    window.parent.postMessage({
      messageSource: "sonik-agent-ui", type: "sonik:visual-context:request", version: "sonik.visual-context.v1",
      requestId: crypto.randomUUID(), operation: "pair-extension", origin: workbenchOrigin,
      sourceContextRevision, routeRevision, source, provider: "chrome-active-tab",
    }, embeddedHostOrigin);
    return accepted("Active-tab extension pairing requested.");
  }

  async function submitVisualResult(result: Record<string, unknown>): Promise<void> {
    if (!workspace) return;
    try {
      const response = await fetch("/api/workspaces/visual-context", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceSessionId: workspace.sessionId, result }),
      });
      if (!response.ok) throw new Error(await publicError(response));
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
    const next = await requestWorkspace("POST");
    if (next) {
      workspace = next;
      terminalState = "connecting";
      announcement = "Workspace ready.";
      if (hostContextMessage) void synchronizePageContext();
    }
    operation = "idle";
  }

  async function reconnectWorkspaceRequest(startIfMissing = false): Promise<void> {
    visibleError = null;
    const next = await requestWorkspace("GET");
    if (next) {
      workspace = next;
      if (hostContextMessage) void synchronizePageContext();
    }
    else if (startIfMissing && !visibleError) await startWorkspaceRequest();
    else terminalState = "error";
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
        ? "Host context, signed authority, and OpenAPI are available inside the sandbox."
        : "Host context is available inside the sandbox; OpenAPI could not be refreshed.";
    } catch (error) {
      visibleError = safeMessage(error, "Page context could not be synchronized.");
      announcement = visibleError;
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

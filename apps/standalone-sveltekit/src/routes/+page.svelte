<script lang="ts">
  import { onMount } from "svelte";
  import { dev } from "$app/environment";
  import { env as publicEnv } from "$env/dynamic/public";
  import type { PageData } from "./$types";
  import { SvelteSet } from "svelte/reactivity";
  import { Chat } from "@ai-sdk/svelte";
  import { DefaultChatTransport } from "ai";
  import type { DataPart, Spec } from "@json-render/svelte";
  import { JsonArtifactRenderer } from "@sonik-agent-ui/json-ui-runtime";
  import { AgentConversation, getSpec, getText, snapshotDataParts, type AgentActivityStatus, type AgentChatMessage } from "@sonik-agent-ui/chat-surface";
  import { upsertJsonRenderArtifact, type JsonRenderArtifact } from "@sonik-agent-ui/artifact-model";
  import { DEFAULT_WORKSPACE_SESSION_NAME, deriveWorkspaceSessionTitle, isDefaultWorkspaceSessionName } from "@sonik-agent-ui/workspace-session";
  import { promoteJsonRenderArtifact } from "$lib/artifacts/json-render-promotion";
  import { findDocumentArtifactToolCandidate, findJsonArtifactToolCandidate, type PreferredDocumentView } from "$lib/artifacts/tool-artifact-extraction";
  import { hasActiveArtifactUpdateIntent, hasExplicitArtifactIntent } from "$lib/artifacts/artifact-promotion";
  import { logArtifactTelemetry, summarizeSpec } from "$lib/artifacts/artifact-telemetry";
  import { createInMemoryArtifactWarehouse, type ArtifactWarehouseSnapshot, type ArtifactWarehouseVersion } from "$lib/artifacts/artifact-warehouse";
  import ArtifactInspector from "$lib/artifacts/ArtifactInspector.svelte";
  import SessionRail from "$lib/session/SessionRail.svelte";
  import ThemePicker from "$lib/theme/ThemePicker.svelte";
  import {
    appendArtifactObservationEvent,
    createArtifactObservationEvent,
    createArtifactStatus,
    type ArtifactObservationEvent,
    type ArtifactStatus,
  } from "$lib/artifacts/artifact-observability";
  import { CanvasViewport, WorkspaceDocumentFrame, WorkspaceRoot, type WorkspaceDocumentEvent, type WorkspaceLayoutMode, type WorkspaceRailMode } from "@sonik-agent-ui/workspace-core";
  import type { AgentUiPageAssertions, AgentUiPageContextSnapshot, AgentUiPageControl, AgentUiSemanticActionResult } from "@sonik-agent-ui/agent-observability";
  import {
    isAgentHostPageContextMessage,
    mergeAgentHostPageContext,
    normalizeAgentEmbedIntent,
    sanitizeAgentHostPageContext,
    isAgentOriginAllowed,
    type AgentHostMergedPageContext,
    type AgentHostPageContext,
    type AgentEmbedMode,
    type AgentEmbedRailMode,
  } from "@sonik-agent-ui/agent-embed";
  import { registry } from "$lib/render/registry";

  interface ActiveDocumentSnapshot {
    id: string;
    session_id?: string | null;
    title: string;
    language: string;
    current_content: string;
    version_count: number;
    created_at?: string;
    updated_at?: string;
  }

  interface WorkspaceSessionSummary {
    id: string;
    name: string;
    mode: "chat" | "artifact" | "document" | "research";
    archived: boolean;
    is_important: boolean;
    folder: string | null;
    message_count: number;
    active_document_id: string | null;
    active_artifact_id: string | null;
    created_at: string;
    updated_at: string;
    last_accessed: string;
    last_message_at: string | null;
  }

  interface WorkspaceArtifactSnapshot {
    id: string;
    session_id: string | null;
    kind: "json-render" | "document";
    title: string;
    content: Spec;
    version: number;
    created_at: string;
    updated_at: string;
  }

  interface WorkspaceArtifactVersionSnapshot {
    id: string;
    artifact_id: string;
    version_number: number;
    content: Spec;
    summary: string | null;
    source: "user" | "ai" | "system";
    created_at: string;
  }

  interface WorkspaceMessageSnapshot {
    id: string;
    session_id: string;
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    parts: DataPart[] | null;
    created_at: string;
  }

  interface WorkspaceSessionDetail {
    session: WorkspaceSessionSummary;
    activeDocument: ActiveDocumentSnapshot | null;
    messages: WorkspaceMessageSnapshot[];
    telemetry?: unknown[];
    artifactState?: {
      persistence: "cloud-or-memory-v1";
      activeArtifactId: string | null;
      activeArtifact: WorkspaceArtifactSnapshot | null;
      activeArtifactVersions: WorkspaceArtifactVersionSnapshot[];
      latestLayout?: unknown | null;
      note: string;
    };
  }

  // =============================================================================
  // Chat Setup
  // =============================================================================

  let { data }: { data: PageData } = $props();

  function getInitialEmbedIntent() {
    return data.embedIntent;
  }

  let input = $state("");
  const artifactWarehouse = createInMemoryArtifactWarehouse();

  let activeArtifact = $state<JsonRenderArtifact | null>(null);
  let activeArtifactStatus = $state<ArtifactStatus | null>(null);
  let activeArtifactVersions = $state<ArtifactWarehouseVersion<Spec>[]>([]);
  let pendingArtifactIntent = $state<string | null>(null);
  let documentEditorOpen = $state(false);
  let activeDocument = $state<ActiveDocumentSnapshot | null>(null);
  let documentSeed = $state<ActiveDocumentSnapshot | null>(null);
  let documentPreferredView = $state<PreferredDocumentView>("auto");
  let artifactEvents = $state<ArtifactObservationEvent[]>([]);
  let observationIndex = $state(0);
  let lastDocumentPromotionKey = $state<string | null>(null);
  let sessions = $state<WorkspaceSessionSummary[]>([]);
  let archivedSessionCount = $state(0);
  let activeSessionId = $state<string | null>(null);
  let sessionRailBusy = $state(false);
  let sessionRailError = $state<string | null>(null);
  let persistedMessageIds = new SvelteSet<string>();
  let reportedToolErrorKeys = new SvelteSet<string>();
  let processedJsonRenderPromotionKeys = new SvelteSet<string>();
  let messagePersistInFlight = false;
  let pendingDocumentSnapshot: ActiveDocumentSnapshot | null = null;
  let documentPersistPromise: Promise<void> | null = null;
  let lastPersistedDocumentSignature = "";
  let lastConversationTelemetrySignature = "";
  let lastPageContextSignature = "";
  let lastActivityTelemetrySignature = "";
  let lastWorkspaceRuntimeTelemetrySignature = "";
  const SONIK_AGENT_UI_PAGE_CONTEXT_REQUEST = "sonik:agent-ui:request-page-context";
  let sessionBootstrapKey: string | null = null;
  let sessionBootstrapPromise: Promise<void> | null = null;
  let hostContextWaitTimer: number | null = null;
  let hostPageContext = $state<AgentHostMergedPageContext | null>(null);
  let embedMode = $state<AgentEmbedMode>(getInitialEmbedIntent().mode);
  let embedRailMode = $state<AgentEmbedRailMode>(getInitialEmbedIntent().railMode);
  let streamStartedAt = $state<number | null>(null);
  let activityClock = $state(Date.now());
  let lastPersistStatus = $state<AgentUiPageAssertions["lastPersistStatus"]>("idle");

  const conversation = new Chat({
    transport: new DefaultChatTransport({
      api: "/api/generate",
      prepareSendMessagesRequest({ messages, id, trigger, messageId, body, headers }) {
        return {
          headers: {
            ...headers,
            ...createDevSmokeHeaders(),
            ...createWorkspaceRequestHeaders(),
          },
          body: {
            ...body,
            id,
            trigger,
            messageId,
            messages,
            workspace: {
              activeDocument,
              sessionId: activeSessionId,
              pageContext: createPageContextSnapshot(),
            },
            pageContext: createPageContextSnapshot(),
          },
        };
      },
    }),
  });

  const isStreaming = $derived(
    conversation.status === "streaming" || conversation.status === "submitted",
  );
  const currentSession = $derived(sessions.find((session) => session.id === activeSessionId) ?? null);
  const activeArtifactRawSpec = $derived(
    activeArtifact ? JSON.stringify(activeArtifact.content, null, 2) : "",
  );
  const activeArtifactVersionOptions = $derived(
    activeArtifactVersions.map((version) => ({
      version: version.version,
      label: `v${version.version}${version.source === "user-edit" ? " · edited" : ""}`,
    })),
  );
  const activeArtifactVersionNumber = $derived(activeArtifact?.version ?? null);
  const initialWorkspaceDocumentContent = "# Workspace Document\n\nThis is the isolated workspace document editor running as a document island. Use the language selector to switch Markdown, HTML, JSON, CSV, code, and preview modes.";
  const documentFrameTitle = $derived(documentSeed?.title ?? "Workspace Document");
  const documentFrameLanguage = $derived(documentSeed?.language ?? "markdown");
  const documentFrameContent = $derived(documentSeed?.current_content ?? initialWorkspaceDocumentContent);
  const documentFrameId = $derived(documentSeed?.id);
  const documentFramePreferredView = $derived(documentPreferredView);
  const documentFrameSubtitle = $derived(`${documentFrameLanguage} · v${documentSeed?.version_count ?? 1}`);
  const workspaceLayoutMode = $derived<WorkspaceLayoutMode>(embedMode);
  const workspaceRailMode = $derived<WorkspaceRailMode>(embedRailMode);
  const artifactOpen = $derived(
    embedMode === "chat"
      ? false
      : embedMode === "canvas"
        ? true
        : Boolean(activeArtifact || pendingArtifactIntent || documentEditorOpen),
  );
  const agentActivity = $derived<AgentActivityStatus | null>(createAgentActivityStatus());
  const pageAssertions = $derived<AgentUiPageAssertions>({
    schemaVersion: "sonik.agent_ui.assertions.v1",
    hasActiveSession: Boolean(activeSessionId),
    isStreaming,
    canSubmit: !getSubmitDisabledReason(input),
    submitDisabledReason: getSubmitDisabledReason(input),
    hasActiveArtifact: Boolean(activeArtifact),
    hasActiveDocument: Boolean(activeDocument || documentEditorOpen),
    messageCount: conversation.messages.length,
    visibleErrorCount: sessionRailError || conversation.error ? 1 : 0,
    lastPersistStatus,
  });
  const latestJsonRenderSpec = $derived.by<{ id: string; spec: Spec; sourceUserMessageId: string; userPrompt: string; title?: string; forcePromote?: boolean } | null>(() => {
    for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
      const message = conversation.messages[index];
      if (!message || message.role !== "assistant") continue;

      const sourcePrompt = findNearestUserPrompt(index);
      const parts = snapshotDataParts(message.parts as DataPart[]);
      const artifactToolCandidate = findJsonArtifactToolCandidate(message.id, parts as unknown[]);
      if (artifactToolCandidate) {
        return {
          id: artifactToolCandidate.id,
          spec: artifactToolCandidate.spec,
          title: artifactToolCandidate.title,
          sourceUserMessageId: sourcePrompt.id,
          userPrompt: sourcePrompt.text,
          forcePromote: true,
        };
      }

      const spec = getSpec(parts);
      if (!spec) continue;

      return {
        id: `json-render:${message.id}`,
        spec,
        sourceUserMessageId: sourcePrompt.id,
        userPrompt: sourcePrompt.text,
      };
    }

    return null;
  });
  const latestDocumentArtifact = $derived.by<{ id: string; document: ActiveDocumentSnapshot; action: "create" | "update"; title: string; preferredView?: PreferredDocumentView } | null>(() => {
    for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
      const message = conversation.messages[index];
      if (!message || message.role !== "assistant") continue;
      const candidate = findDocumentArtifactToolCandidate(message.id, snapshotDataParts(message.parts as DataPart[]) as unknown[]);
      if (!candidate) continue;
      return {
        id: candidate.id,
        action: candidate.action,
        title: candidate.title,
        document: candidate.document,
        preferredView: candidate.preferredView,
      };
    }

    return null;
  });

  $effect(() => {
    if (!latestDocumentArtifact) return;
    const promotionKey = [
      latestDocumentArtifact.id,
      latestDocumentArtifact.document.id,
      latestDocumentArtifact.document.version_count,
      latestDocumentArtifact.action,
    ].join("::");
    if (promotionKey === lastDocumentPromotionKey) return;

    let nextPreferredView: PreferredDocumentView;
    try {
      nextPreferredView = latestDocumentArtifact.preferredView ?? inferPreferredDocumentView(latestDocumentArtifact.document.language);
    } catch (error) {
      reportClientEffectError("document_artifact.promote_error", error, {
        messageId: latestDocumentArtifact.id,
        documentId: latestDocumentArtifact.document.id,
        documentVersion: latestDocumentArtifact.document.version_count,
      });
      return;
    }

    lastDocumentPromotionKey = promotionKey;
    activeDocument = latestDocumentArtifact.document;
    documentSeed = latestDocumentArtifact.document;
    documentPreferredView = nextPreferredView;
    documentEditorOpen = true;
    pendingArtifactIntent = null;
    logArtifactTelemetry({
      source: "client",
      event: "document_artifact.promoted",
      artifactId: latestDocumentArtifact.document.id,
      artifactVersion: latestDocumentArtifact.document.version_count,
      reason: latestDocumentArtifact.action,
      mode: documentPreferredView,
      messageId: latestDocumentArtifact.id,
      ok: true,
    });
  });

  $effect(() => {
    for (const message of conversation.messages) {
      if (!message || message.role !== "assistant") continue;
      for (const part of snapshotDataParts(message.parts as DataPart[]) as Array<DataPart & { toolCallId?: string; state?: string; errorText?: string }>) {
        if (!part.type?.startsWith("tool-") || part.state !== "output-error") continue;
        const key = `${message.id}:${part.toolCallId ?? part.type}`;
        if (reportedToolErrorKeys.has(key)) continue;
        reportedToolErrorKeys.add(key);
        logArtifactTelemetry({
          source: "client",
          event: "chat.tool.output_error",
          messageId: message.id,
          reason: part.type.replace(/^tool-/, ""),
          error: part.errorText,
          ok: false,
        });
      }
    }
  });

  $effect(() => {
    if (!latestJsonRenderSpec) return;

    let result: ReturnType<typeof promoteJsonRenderArtifact>;
    try {
      result = promoteJsonRenderArtifact({
        current: activeArtifact,
        messageArtifactId: latestJsonRenderSpec.id,
        spec: latestJsonRenderSpec.spec,
        userPrompt: latestJsonRenderSpec.userPrompt,
        title: latestJsonRenderSpec.title,
        forcePromote: latestJsonRenderSpec.forcePromote,
      });
    } catch (error) {
      reportClientEffectError("json_artifact.promote_error", error, {
        messageId: latestJsonRenderSpec.id,
        root: latestJsonRenderSpec.spec.root,
        elementCount: Object.keys(latestJsonRenderSpec.spec.elements).length,
      });
      return;
    }

    const promotionKey = [
      latestJsonRenderSpec.id,
      result.signature,
      result.decision.reason,
    ].join("::");

    if (processedJsonRenderPromotionKeys.has(promotionKey)) return;
    processedJsonRenderPromotionKeys.add(promotionKey);

    let promotedSnapshot: (ArtifactWarehouseSnapshot<Spec> & { artifact: JsonRenderArtifact }) | null = null;
    if (result.promoted && result.artifact) {
      promotedSnapshot = artifactWarehouse.commitJsonRenderArtifact({
        sessionId: activeSessionId,
        artifact: result.artifact,
        source: "agent",
      });
    }

    const eventResult = promotedSnapshot
      ? { ...result, artifact: promotedSnapshot.artifact }
      : result;

    observationIndex += 1;
    const event = createArtifactObservationEvent({
      result: eventResult,
      sourceMessageId: latestJsonRenderSpec.id,
      sourceUserMessageId: latestJsonRenderSpec.sourceUserMessageId,
      userPrompt: latestJsonRenderSpec.userPrompt,
      observationIndex,
    });
    artifactEvents = appendArtifactObservationEvent(artifactEvents, event);
    logArtifactTelemetry({
      source: "client",
      event: event.type,
      artifactId: event.artifactId,
      artifactVersion: event.artifactVersion,
      reason: event.promotionReason,
      mode: result.decision.mode,
      messageId: latestJsonRenderSpec.id,
      ...summarizeSpec(latestJsonRenderSpec.spec),
      ok: true,
    });

    if (promotedSnapshot) {
      applyArtifactWarehouseSnapshot(promotedSnapshot);
      persistJsonRenderArtifactSnapshot(promotedSnapshot, "agent");
      activeArtifactStatus = createArtifactStatus(promotedSnapshot.artifact, event);
      pendingArtifactIntent = null;
    }
  });

  function findNearestUserPrompt(beforeIndex: number): { id: string; text: string } {
    for (let index = beforeIndex - 1; index >= 0; index -= 1) {
      const message = conversation.messages[index];
      if (!message || message.role !== "user") continue;
      return { id: message.id, text: getText(snapshotDataParts(message.parts as DataPart[])) };
    }

    return { id: "", text: "" };
  }

  function shouldRenderInlineArtifact(message: AgentChatMessage): boolean {
    if (message.role !== "assistant") return true;

    const messageIndex = conversation.messages.findIndex((candidate) => candidate.id === message.id);
    if (messageIndex === -1) return true;

    if (findJsonArtifactToolCandidate(message.id, snapshotDataParts(message.parts as DataPart[]) as unknown[])) {
      return false;
    }

    const sourcePrompt = findNearestUserPrompt(messageIndex).text;
    if (hasExplicitArtifactIntent(sourcePrompt)) return false;
    if (activeArtifact && hasActiveArtifactUpdateIntent(sourcePrompt)) return false;

    return true;
  }

  function handleApplyRawSpec(rawSpec: string): string | null {
    if (!activeArtifact) {
      logArtifactTelemetry({
        source: "client",
        event: "artifact.editor.apply",
        ok: false,
        error: "no active artifact is open",
      });
      return "Invalid edit: no active artifact is open.";
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawSpec);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logArtifactTelemetry({
        source: "client",
        event: "artifact.editor.apply",
        artifactId: activeArtifact.id,
        artifactVersion: activeArtifact.version,
        ok: false,
        error: message,
      });
      return `Invalid JSON: ${message}`;
    }

    if (!isSpec(parsed)) {
      logArtifactTelemetry({
        source: "client",
        event: "artifact.editor.apply",
        artifactId: activeArtifact.id,
        artifactVersion: activeArtifact.version,
        ok: false,
        error: "invalid json-render spec",
      });
      return "Invalid JSON-render spec: expected { root, elements } with root pointing to an element.";
    }

    const upsert = upsertJsonRenderArtifact({
      previous: activeArtifact,
      id: activeArtifact.id,
      title: activeArtifact.title,
      spec: parsed,
    });

    const snapshot = artifactWarehouse.commitJsonRenderArtifact({
      sessionId: activeSessionId,
      artifact: upsert.artifact,
      source: "user-edit",
    });
    applyArtifactWarehouseSnapshot(snapshot);
    persistJsonRenderArtifactSnapshot(snapshot, "user-edit");
    if (activeArtifactStatus) {
      activeArtifactStatus = {
        ...activeArtifactStatus,
        artifactVersion: snapshot.artifact.version,
        updatedAt: snapshot.artifact.updatedAt,
      };
    }

    observationIndex += 1;
    artifactEvents = appendArtifactObservationEvent(artifactEvents, {
      id: `manual-json-editor::artifact_updated::${observationIndex}::${snapshot.artifact.id}`,
      type: "artifact_updated",
      artifactId: snapshot.artifact.id,
      artifactVersion: snapshot.artifact.version,
      promotionReason: "active_artifact_update",
      sourceMessageId: "manual-json-editor",
      sourceUserMessageId: "manual-json-editor",
      userPrompt: "Manual JSON editor apply",
      observationIndex,
      observedAt: new Date().toISOString(),
    });
    logArtifactTelemetry({
      source: "client",
      event: "artifact.editor.apply",
      artifactId: snapshot.artifact.id,
      artifactVersion: snapshot.artifact.version,
      reason: "active_artifact_update",
      ...summarizeSpec(snapshot.artifact.content),
      ok: true,
    });

    return null;
  }

  function applyArtifactWarehouseSnapshot(snapshot: ArtifactWarehouseSnapshot<Spec> & { artifact: JsonRenderArtifact }): void {
    activeArtifact = snapshot.artifact;
    activeArtifactVersions = snapshot.versions;
  }

  function persistJsonRenderArtifactSnapshot(snapshot: ArtifactWarehouseSnapshot<Spec> & { artifact: JsonRenderArtifact }, source: "agent" | "user-edit" | "system" = "agent"): void {
    const sessionId = activeSessionId ?? snapshot.record.sessionId;
    if (!sessionId) return;
    void workspaceFetch("/api/artifact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: snapshot.artifact.id,
        session_id: sessionId,
        kind: "json-render",
        title: snapshot.artifact.title,
        content: snapshot.artifact.content,
        source,
        summary: source === "user-edit" ? "Manual JSON editor apply" : "Promoted JSON-render artifact",
      }),
    }).then(async (response) => {
      if (!response.ok) throw new Error(await readWorkspaceResponseError(response));
      logArtifactTelemetry({
        source: "client",
        event: "artifact.persistence.success",
        sessionId,
        artifactId: snapshot.artifact.id,
        artifactVersion: snapshot.artifact.version,
        reason: source,
        ok: true,
      });
    }).catch((error) => {
      reportClientEffectError("artifact.persistence.error", error, {
        sessionId,
        root: snapshot.artifact.content.root,
        elementCount: Object.keys(snapshot.artifact.content.elements ?? {}).length,
      });
    });
  }

  function handleArtifactVersionChange(version: number): void {
    if (!activeArtifact) return;
    const snapshot = artifactWarehouse.selectJsonRenderArtifactVersion({
      sessionId: activeSessionId,
      artifactId: activeArtifact.id,
      version,
    });
    if (!snapshot) {
      logArtifactTelemetry({
        source: "client",
        event: "artifact.version.select_error",
        artifactId: activeArtifact.id,
        artifactVersion: version,
        ok: false,
        error: "version not found",
      });
      return;
    }
    applyArtifactWarehouseSnapshot(snapshot);
    if (activeArtifactStatus) {
      activeArtifactStatus = {
        ...activeArtifactStatus,
        artifactVersion: snapshot.artifact.version,
        updatedAt: snapshot.artifact.updatedAt,
      };
    }
    logArtifactTelemetry({
      source: "client",
      event: "artifact.version.selected",
      artifactId: snapshot.artifact.id,
      artifactVersion: snapshot.artifact.version,
      ok: true,
    });
  }

  function isSpec(value: unknown): value is Spec {
    if (!isRecord(value)) return false;
    if (typeof value.root !== "string") return false;
    if (!isRecord(value.elements)) return false;

    const rootElement = value.elements[value.root];
    if (!isRecord(rootElement)) return false;
    return typeof rootElement.type === "string" && isRecord(rootElement.props);
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }


  function formatToolActivityDetail(toolType: string): string {
    const slug = toolType.replace(/^tool-/, "");
    if (slug === "createJsonArtifact") return "Creating artifact";
    if (slug === "updateDocument") return "Updating document";
    if (slug === "createDocument") return "Creating document";
    if (slug === "readDocument") return "Reading document";
    return slug
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[-_]+/g, " ")
      .trim()
      .replace(/^./, (char) => char.toUpperCase()) || "Running tool";
  }

  function createAgentActivityStatus(): AgentActivityStatus | null {
    if (!isStreaming) return null;
    const elapsedSeconds = streamStartedAt ? Math.max(0, Math.floor((activityClock - streamStartedAt) / 1000)) : 0;
    const lastAssistant = [...conversation.messages].reverse().find((message) => message.role === "assistant");
    const parts = snapshotDataParts(lastAssistant?.parts as DataPart[]);
    const latestTool = [...parts].reverse().find((part) => part.type?.startsWith("tool-")) as (DataPart & { state?: string }) | undefined;

    if (latestTool?.state === "output-error") return { label: "Tool failed", detail: "Inspecting recovery path…", tone: "error" };
    if (latestTool && latestTool.state !== "output-available" && latestTool.state !== "output-denied") {
      return { label: "Calling tool", detail: formatToolActivityDetail(latestTool.type), tone: "tool" };
    }
    if (parts.some((part) => part.type === "data-spec" || part.type === "tool-createJsonArtifact")) {
      return { label: "Preparing canvas", detail: "Promoting artifact view…", tone: "artifact" };
    }
    if (parts.some((part) => part.type === "text" && typeof part.text === "string" && part.text.trim())) {
      return { label: "Streaming response", tone: "neutral" };
    }
    if (elapsedSeconds >= 10) return { label: "Waiting for model response", detail: `${elapsedSeconds}s elapsed`, tone: "waiting" };
    if (conversation.status === "submitted") return { label: "Starting request", tone: "neutral" };
    return { label: "Working", detail: "Waiting for visible output…", tone: "waiting" };
  }

  function recordAgentActivity(activity: AgentActivityStatus | null): void {
    if (!activity || !isStreaming) return;
    const signature = JSON.stringify({
      label: activity.label,
      tone: activity.tone,
      // Exclude exact elapsed-second detail so long waits emit bounded status-transition telemetry.
      sessionId: activeSessionId,
      status: conversation.status,
    });
    if (signature === lastActivityTelemetrySignature) return;
    lastActivityTelemetrySignature = signature;
    logArtifactTelemetry({
      source: "client",
      event: "chat.activity.status",
      sessionId: activeSessionId ?? undefined,
      runtimeStatus: conversation.status,
      mode: activity.tone ?? "neutral",
      reason: activity.label,
      ok: true,
    });
  }

  function getSubmitDisabledReason(message: string): AgentUiPageAssertions["submitDisabledReason"] {
    if (isStreaming) return "streaming";
    if (sessionRailBusy) return "session_loading";
    if (!activeSessionId) return "missing_session";
    if (!message.trim()) return "empty_prompt";
    return undefined;
  }

  function createDevSmokeHeaders(): Record<string, string> {
    if (!dev || typeof window === "undefined") return {};
    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get("smokeMockStream") !== "1") return {};
    const smokeRunId = searchParams.get("smokeRunId") ?? "agent-ui-smoke-local";
    return {
      "x-sonik-agent-ui-smoke-stream": "true",
      "x-sonik-agent-ui-smoke-run-id": smokeRunId,
    };
  }

  async function workspaceFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(input, {
      ...init,
      headers: {
        ...createWorkspaceRequestHeaders(),
        ...headersToRecord(init.headers),
      },
    });
    recordWorkspaceRuntimeDiagnostics(response, input);
    return response;
  }

  function recordWorkspaceRuntimeDiagnostics(response: Response, input: RequestInfo | URL): void {
    const policy = response.headers.get("x-sonik-agent-ui-persistence-policy");
    const mode = response.headers.get("x-sonik-agent-ui-persistence-mode");
    if (!policy && !mode) return;
    const signature = JSON.stringify({
      policy,
      mode,
      memoryReason: response.headers.get("x-sonik-agent-ui-memory-reason"),
      cloudError: response.headers.get("x-sonik-agent-ui-cloud-error"),
      hostAuthenticated: response.headers.get("x-sonik-agent-ui-host-authenticated"),
      hostOrg: response.headers.get("x-sonik-agent-ui-host-org"),
      hostUser: response.headers.get("x-sonik-agent-ui-host-user"),
      url: typeof input === "string" ? input : input instanceof URL ? input.pathname : "request",
    });
    if (signature === lastWorkspaceRuntimeTelemetrySignature) return;
    lastWorkspaceRuntimeTelemetrySignature = signature;
    logArtifactTelemetry({
      source: "client",
      event: "workspace.persistence.runtime",
      sessionId: activeSessionId ?? undefined,
      mode: mode ?? undefined,
      reason: response.headers.get("x-sonik-agent-ui-memory-reason") ?? response.headers.get("x-sonik-agent-ui-cloud-error") ?? undefined,
      ok: response.ok,
    });
  }

  function createWorkspaceRequestHeaders(): Record<string, string> {
    const hostSession = hostPageContext?.hostSession;
    const organizationId = hostSession?.organizationId ?? hostPageContext?.organizationId;
    const authenticated = hostSession?.authenticated === true || hostPageContext?.authenticated === true;
    const userId = hostSession?.userId ?? hostSession?.principalId;
    if (!authenticated || !organizationId || !userId || !hostSession) return {};
    return {
      "x-sonik-agent-ui-host-context": encodeWorkspaceHostContextHeader({
        authenticated,
        organizationId,
        scopes: hostPageContext?.scopes ?? hostSession.scopes ?? [],
        signatureVersion: hostPageContext?.signatureVersion ?? null,
        issuedAt: hostPageContext?.issuedAt ?? null,
        expiresAt: hostPageContext?.expiresAt ?? null,
        signature: hostPageContext?.signature ?? null,
        hostSession: {
          ...hostSession,
          authenticated,
          organizationId,
          userId,
          principalId: hostSession.principalId ?? userId,
        },
      }),
    };
  }

  function encodeWorkspaceHostContextHeader(value: unknown): string {
    return btoa(unescape(encodeURIComponent(JSON.stringify(value))))
      .replace(/=+$/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  }

  function hasHostPageContext(): boolean {
    return Boolean(hostPageContext?.route || hostPageContext?.surface || hostPageContext?.pageType || hostPageContext?.title || hostPageContext?.activeEntity);
  }

  function createHostPageContextKey(): string | null {
    if (!hasHostPageContext()) return null;
    return [
      hostPageContext?.route,
      hostPageContext?.surface,
      hostPageContext?.pageType,
      hostPageContext?.activeEntity?.type,
      hostPageContext?.activeEntity?.id,
    ].map((value) => typeof value === "string" ? value : "").join(":");
  }

  function isEmbeddedHostContextExpected(): boolean {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).has("agentUiHostOrigin");
  }

  function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
    if (!headers) return {};
    if (headers instanceof Headers) return Object.fromEntries(headers.entries());
    if (Array.isArray(headers)) return Object.fromEntries(headers);
    return { ...headers };
  }

  async function readWorkspaceResponseError(response: Response): Promise<string> {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        const body = await response.clone().json();
        if (isWorkspaceErrorEnvelope(body)) {
          return body.code ? `${body.error} (${body.code})` : body.error;
        }
      } catch {
        // Fall through to bounded text parsing below; malformed JSON should not hide the failure.
      }
    }
    const text = await response.text().catch(() => "");
    return text.trim().slice(0, 500) || `Workspace request failed with HTTP ${response.status}`;
  }

  function isWorkspaceErrorEnvelope(value: unknown): value is { ok: false; error: string; code?: string } {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return record.ok === false && typeof record.error === "string" && (record.code === undefined || typeof record.code === "string");
  }

  function getAllowedAgentHostOrigins(): Set<string> {
    const origins = new Set<string>();
    if (typeof window === "undefined") return origins;
    origins.add(window.location.origin);
    if (dev) {
      const configuredOrigin = new URLSearchParams(window.location.search).get("agentUiHostOrigin");
      if (configuredOrigin) {
        try {
          origins.add(new URL(configuredOrigin).origin);
        } catch (error) {
          logArtifactTelemetry({ source: "client", event: "host.page_context.origin_ignored", reason: "invalid_configured_origin", error: error instanceof Error ? error.message : String(error), ok: false });
        }
      }
    }
    return origins;
  }

  function isAllowedAgentHostOrigin(origin: string): boolean {
    const exactOrigins = getAllowedAgentHostOrigins();
    if (exactOrigins.has(origin)) return true;
    return isAgentOriginAllowed(origin, publicEnv.PUBLIC_AGENT_UI_ALLOWED_HOST_ORIGINS);
  }


  function requestHostPageContext(reason: string): void {
    if (typeof window === "undefined" || !isEmbeddedHostContextExpected()) return;
    const configuredOrigin = new URLSearchParams(window.location.search).get("agentUiHostOrigin");
    if (!configuredOrigin) return;
    try {
      const targetOrigin = new URL(configuredOrigin).origin;
      window.parent?.postMessage({ source: "sonik-agent-ui", type: SONIK_AGENT_UI_PAGE_CONTEXT_REQUEST, reason, sentAt: new Date().toISOString() }, targetOrigin);
      logArtifactTelemetry({ source: "client", event: "host.page_context.requested", reason, ok: true });
    } catch (error) {
      logArtifactTelemetry({ source: "client", event: "host.page_context.request_failed", reason, error: error instanceof Error ? error.message : String(error), ok: false });
    }
  }

  function handleAgentHostMessage(event: MessageEvent): void {
    if (!isAllowedAgentHostOrigin(event.origin)) {
      logArtifactTelemetry({ source: "client", event: "host.page_context.message_ignored", reason: "origin_not_allowed", route: event.origin, ok: false });
      return;
    }
    if (!isAgentHostPageContextMessage(event.data)) {
      if (event.data && typeof event.data === "object" && "source" in event.data) {
        logArtifactTelemetry({ source: "client", event: "host.page_context.message_ignored", reason: "invalid_shape", ok: false });
      }
      return;
    }
    const nextContext = sanitizeAgentHostPageContext(event.data.payload);
    if (!nextContext) {
      logArtifactTelemetry({ source: "client", event: "host.page_context.message_ignored", reason: "empty_context", ok: false });
      return;
    }
    hostPageContext = nextContext;
    logArtifactTelemetry({
      source: "client",
      event: "host.page_context.updated",
      route: nextContext.route,
      surface: nextContext.surface,
      commandFamilies: nextContext.commandFamilies,
      skillFamilies: nextContext.skillFamilies,
      pageContext: nextContext,
      ok: true,
    });
    syncDevPageContext("host_page_context_updated");
    maybeBootstrapSessions("host_page_context_updated");
  }

  function createPageContextSnapshot(): AgentUiPageContextSnapshot {
    const localContext: AgentUiPageContextSnapshot = {
      route: "/",
      surface: documentEditorOpen ? "document" : activeArtifact ? "artifact" : "chat",
      pageType: "standalone-agent-workspace",
      title: currentSession?.name ?? "Sonik Chat",
      theme: typeof document !== "undefined" ? document.documentElement.dataset.theme : undefined,
      mode: currentSession?.mode ?? "chat",
      activeSessionId,
      activeArtifactId: activeArtifact?.id ?? null,
      activeDocumentId: activeDocument?.id ?? null,
      artifactType: activeDocument?.language ?? (activeArtifact ? "json-render" : null),
      conversationStatus: conversation.status,
      messageCount: conversation.messages.length,
      visibleActions: ["theme-picker", "workspace-docs", "start-over", "createSession", "submitPrompt", "stop", "clearChat", "clearArtifact", "openWorkspaceDocument"],
      visibleWarnings: sessionRailError ? [sessionRailError] : undefined,
      commandFamilies: documentEditorOpen ? ["local-ui", "document", "artifact"] : activeArtifact ? ["local-ui", "artifact"] : ["local-ui", "discovery"],
      skillFamilies: documentEditorOpen || activeArtifact ? ["workspace"] : ["chat"],
      at: new Date().toISOString(),
    };
    return mergeAgentHostPageContext(localContext, hostPageContext) as AgentUiPageContextSnapshot;
  }

  function recordConversationLifecycle(reason: string): void {
    const lastMessage = conversation.messages.at(-1);
    const parts = (lastMessage?.parts ?? []) as unknown[];
    const signature = JSON.stringify({
      status: conversation.status,
      count: conversation.messages.length,
      lastId: lastMessage?.id,
      parts: parts.length,
      reason,
    });
    if (signature === lastConversationTelemetrySignature) return;
    lastConversationTelemetrySignature = signature;
    logArtifactTelemetry({
      source: "client",
      event: "chat.stream.lifecycle",
      sessionId: activeSessionId ?? undefined,
      messageId: lastMessage?.id,
      runtimeStatus: conversation.status,
      reason,
      elementCount: parts.length,
      totalMatches: conversation.messages.length,
      ok: !conversation.error,
      error: conversation.error ? String(conversation.error) : undefined,
    });
  }

  function snapshotPageContext(): AgentUiPageContextSnapshot {
    return $state.snapshot(createPageContextSnapshot()) as AgentUiPageContextSnapshot;
  }

  function snapshotAssertions(): AgentUiPageAssertions {
    return $state.snapshot(pageAssertions) as AgentUiPageAssertions;
  }

  function semanticActionResult(ok: boolean, message?: string, disabledReason?: string): AgentUiSemanticActionResult {
    return {
      ok,
      state: snapshotAssertions(),
      message,
      disabledReason,
    };
  }

  /** Runtime-safe host/page automation seam: snapshot reads + semantic actions only. */
  function installAgentPageControl(): void {
    const targetWindow = window as Window & {
      __sonikAgentUI?: AgentUiPageControl;
      __SONIK_AGENT_UI_PAGE_CONTEXT__?: () => AgentUiPageContextSnapshot;
    };
    targetWindow.__sonikAgentUI = {
      schemaVersion: "sonik.agent_ui.page_control.v1",
      getPageContext: snapshotPageContext,
      getAssertions: snapshotAssertions,
      actions: {
        createSession: async () => {
          if (isStreaming) return semanticActionResult(false, "Stop the current stream before creating a new session.", "streaming");
          await createSession({ force: true });
          if (!activeSessionId) return semanticActionResult(false, sessionRailError || "Session was not created.", "session_unavailable");
          if (sessionRailError) return semanticActionResult(false, sessionRailError, "session_error");
          return semanticActionResult(true, "New session created.");
        },
        submitPrompt: ({ prompt }) => {
          const message = typeof prompt === "string" ? prompt : "";
          const disabledReason = getSubmitDisabledReason(message);
          if (disabledReason) return semanticActionResult(false, `Prompt cannot be submitted: ${disabledReason}.`, disabledReason);
          handleSubmit(message);
          return semanticActionResult(true, "Prompt submitted.");
        },
        stop: () => {
          handleStop();
          return semanticActionResult(true, "Streaming stop requested.");
        },
        clearChat: () => {
          handleClear();
          return semanticActionResult(true, "Chat cleared.");
        },
        clearArtifact: () => {
          handleClearArtifact();
          return semanticActionResult(true, "Artifact cleared.");
        },
        openWorkspaceDocument: () => {
          openDocumentEditor();
          return semanticActionResult(true, "Workspace document opened.");
        },
      },
    };
    targetWindow.__SONIK_AGENT_UI_PAGE_CONTEXT__ = snapshotPageContext;
  }

  function syncDevPageContext(reason: string): void {
    if (typeof window === "undefined") return;
    installAgentPageControl();
    if (!dev) return;
    const pageContext = snapshotPageContext();
    const assertions = snapshotAssertions();
    const signature = JSON.stringify({
      reason,
      route: pageContext.route,
      surface: pageContext.surface,
      theme: pageContext.theme,
      activeSessionId: pageContext.activeSessionId,
      activeArtifactId: pageContext.activeArtifactId,
      activeDocumentId: pageContext.activeDocumentId,
      conversationStatus: pageContext.conversationStatus,
      messageCount: pageContext.messageCount,
      assertions,
    });
    if (signature === lastPageContextSignature) return;
    lastPageContextSignature = signature;
    void fetch("/api/dev/page-context", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason, pageContext, assertions }),
      keepalive: true,
    }).catch(() => undefined);
  }

  function applyEmbedUrlOptions(): void {
    const params = new URLSearchParams(window.location.search);
    const nextIntent = normalizeAgentEmbedIntent({
      embedMode: params.get("embedMode"),
      agentUiMode: params.get("agentUiMode"),
      railMode: params.get("railMode"),
      rail: params.get("rail"),
    });
    embedMode = nextIntent.mode;
    embedRailMode = nextIntent.railMode;
  }

  function installDevLongTaskTelemetry(): (() => void) | undefined {
    if (!dev || typeof window === "undefined" || typeof PerformanceObserver === "undefined") return undefined;
    let lastReportedAt = 0;
    let observer: PerformanceObserver;
    try {
      observer = new PerformanceObserver((list) => {
        const now = Date.now();
        if (now - lastReportedAt < 5_000) return;
        const longest = list.getEntries().reduce((max, entry) => Math.max(max, entry.duration), 0);
        if (longest < 250) return;
        lastReportedAt = now;
        logArtifactTelemetry({
          source: "client",
          event: "client.performance.long_task",
          sessionId: activeSessionId ?? undefined,
          durationMs: Math.round(longest),
          runtimeStatus: conversation.status,
          pageContext: snapshotPageContext(),
          ok: false,
          reason: "browser_main_thread_blocked",
        });
      });
      observer.observe({ entryTypes: ["longtask"] });
    } catch {
      return undefined;
    }
    return () => observer.disconnect();
  }

  onMount(() => {
    applyEmbedUrlOptions();
    const stopLongTaskTelemetry = installDevLongTaskTelemetry();
    const activityTimer = window.setInterval(() => {
      if (isStreaming) activityClock = Date.now();
    }, 1_000);
    window.addEventListener("message", handleAgentHostMessage);
    requestHostPageContext("mount");
    maybeBootstrapSessions("mount");
    if (isEmbeddedHostContextExpected()) {
      hostContextWaitTimer = window.setTimeout(() => {
        if (!activeSessionId && !createHostPageContextKey()) {
          sessionRailError = "Waiting for host page context before starting an embedded workspace session.";
          logSessionTelemetry("session.bootstrap.waiting_for_host_context", { ok: false, reason: "missing_host_page_context" });
          requestHostPageContext("host_context_wait_timeout");
          syncDevPageContext("host_context_wait_timeout");
        }
      }, 1_500);
    }
    return () => {
      stopLongTaskTelemetry?.();
      window.clearInterval(activityTimer);
      if (hostContextWaitTimer !== null) window.clearTimeout(hostContextWaitTimer);
      window.removeEventListener("message", handleAgentHostMessage);
    };
  });

  $effect(() => {
    if (isStreaming && streamStartedAt === null) {
      streamStartedAt = Date.now();
      activityClock = streamStartedAt;
    }
    if (!isStreaming && streamStartedAt !== null) {
      streamStartedAt = null;
      lastActivityTelemetrySignature = "";
    }
    recordConversationLifecycle("status_or_message_changed");
  });

  $effect(() => {
    recordAgentActivity(agentActivity);
  });

  $effect(() => {
    syncDevPageContext("state_changed");
  });

  $effect(() => {
    if (!activeSessionId) return;
    if (isStreaming) return;
    void persistConversationMessages().catch((error) => {
      reportClientEffectError("session.messages.persist_unhandled", error, { sessionId: activeSessionId });
    });
  });

  function maybeBootstrapSessions(reason: string): void {
    const hostPageKey = createHostPageContextKey();
    const bootstrapKey = hostPageKey ?? (isEmbeddedHostContextExpected() ? null : "standalone");
    if (!bootstrapKey) return;
    if (sessionBootstrapKey === bootstrapKey && (activeSessionId || sessionRailBusy || sessionBootstrapPromise)) return;
    sessionBootstrapKey = bootstrapKey;
    if (hostContextWaitTimer !== null) {
      window.clearTimeout(hostContextWaitTimer);
      hostContextWaitTimer = null;
    }
    logSessionTelemetry("session.bootstrap.start", { reason, mode: hostPageKey ? "embedded-page-context" : "standalone" });
    sessionBootstrapPromise = initializeSessions(reason)
      .catch((error) => {
        sessionRailError = error instanceof Error ? error.message : String(error);
        logSessionTelemetry("session.bootstrap.error", { ok: false, error: sessionRailError, reason });
      })
      .finally(() => {
        sessionBootstrapPromise = null;
      });
  }

  async function initializeSessions(reason = "manual"): Promise<void> {
    await loadSessions();
    const firstSession = sessions[0];
    if (firstSession) {
      await switchSession(firstSession.id, { force: true });
      logSessionTelemetry("session.bootstrap.success", { sessionId: firstSession.id, reason });
      return;
    }
    await createSession({ force: true });
  }

  async function loadSessions(): Promise<void> {
    sessionRailError = null;
    try {
      const response = await workspaceFetch("/api/sessions");
      if (!response.ok) throw new Error(await readWorkspaceResponseError(response));
      sessions = (await response.json()) as WorkspaceSessionSummary[];
      void loadArchivedSessionCount();
    } catch (error) {
      sessionRailError = error instanceof Error ? error.message : String(error);
    }
  }

  async function loadArchivedSessionCount(): Promise<void> {
    try {
      const response = await workspaceFetch("/api/sessions?archived=true");
      if (!response.ok) throw new Error(await readWorkspaceResponseError(response));
      archivedSessionCount = ((await response.json()) as WorkspaceSessionSummary[]).length;
    } catch (error) {
      logSessionTelemetry("session.archive_count.error", {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function logSessionTelemetry(event: string, input: { sessionId?: string | null; ok?: boolean; error?: string; reason?: string; mode?: string } = {}): void {
    logArtifactTelemetry({
      source: "client",
      event,
      sessionId: input.sessionId ?? activeSessionId ?? undefined,
      ok: input.ok ?? true,
      error: input.error,
      reason: input.reason,
      mode: input.mode,
    });
  }

  function reportClientEffectError(event: string, error: unknown, input: { sessionId?: string | null; messageId?: string; documentId?: string; documentVersion?: number; root?: string; elementCount?: number } = {}): void {
    logArtifactTelemetry({
      source: "client",
      event,
      sessionId: input.sessionId ?? activeSessionId ?? undefined,
      messageId: input.messageId,
      documentId: input.documentId,
      documentVersion: input.documentVersion,
      root: input.root,
      elementCount: input.elementCount,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  async function createSession({ force = false }: { force?: boolean } = {}): Promise<void> {
    if (isStreaming) {
      sessionRailError = "Stop the current stream before creating a new session.";
      return;
    }
    if (sessionRailBusy && !force) return;
    sessionRailBusy = true;
    sessionRailError = null;
    try {
      await flushPendingDocumentPersistence();
      const response = await workspaceFetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: DEFAULT_WORKSPACE_SESSION_NAME, mode: "chat" }),
      });
      if (!response.ok) throw new Error(await readWorkspaceResponseError(response));
      const session = (await response.json()) as WorkspaceSessionSummary;
      await loadSessions();
      await switchSession(session.id, { force: true });
      logSessionTelemetry("session.create.success", { sessionId: session.id, mode: session.mode });
    } catch (error) {
      sessionRailError = error instanceof Error ? error.message : String(error);
      logSessionTelemetry("session.create.error", { ok: false, error: sessionRailError });
    } finally {
      sessionRailBusy = false;
    }
  }

  async function switchSession(sessionId: string, { force = false }: { force?: boolean } = {}): Promise<void> {
    if (isStreaming) {
      sessionRailError = "Stop the current stream before switching sessions.";
      return;
    }
    if (sessionId === activeSessionId && conversation.messages.length > 0) return;
    if (sessionRailBusy && !force) return;
    sessionRailBusy = true;
    sessionRailError = null;
    try {
      await flushPendingDocumentPersistence();
      const response = await workspaceFetch(`/api/session/${encodeURIComponent(sessionId)}`);
      if (!response.ok) throw new Error(await readWorkspaceResponseError(response));
      const detail = (await response.json()) as WorkspaceSessionDetail;
      activeSessionId = detail.session.id;
      sessions = upsertSessionSummary(sessions, detail.session);
      hydrateWorkspaceSession(detail);
      logSessionTelemetry("session.switch.success", { sessionId: detail.session.id, mode: detail.session.mode });
    } catch (error) {
      sessionRailError = error instanceof Error ? error.message : String(error);
      logSessionTelemetry("session.switch.error", { sessionId, ok: false, error: sessionRailError });
    } finally {
      sessionRailBusy = false;
    }
  }

  async function archiveSession(sessionId: string): Promise<void> {
    if (isStreaming) {
      sessionRailError = "Stop the current stream before archiving sessions.";
      return;
    }
    if (sessionRailBusy) return;
    sessionRailBusy = true;
    sessionRailError = null;
    try {
      await flushPendingDocumentPersistence();
      const response = await workspaceFetch(`/api/session/${encodeURIComponent(sessionId)}/archive`, { method: "POST" });
      if (!response.ok) throw new Error(await readWorkspaceResponseError(response));
      await loadSessions();
      if (activeSessionId === sessionId) {
        const nextSession = sessions.find((session) => session.id !== sessionId);
        if (nextSession) {
          await switchSession(nextSession.id, { force: true });
        } else {
          await createSession({ force: true });
        }
      }
      logSessionTelemetry("session.archive.success", { sessionId, reason: "hidden_from_active_recents" });
    } catch (error) {
      sessionRailError = error instanceof Error ? error.message : String(error);
      logSessionTelemetry("session.archive.error", { sessionId, ok: false, error: sessionRailError });
    } finally {
      sessionRailBusy = false;
    }
  }

  async function deleteSession(sessionId: string): Promise<void> {
    if (isStreaming) {
      sessionRailError = "Stop the current stream before deleting sessions.";
      return;
    }
    const session = sessions.find((entry) => entry.id === sessionId);
    const sessionName = session?.name?.trim() || "this chat";
    if (!confirm(`Delete ${sessionName}? This removes its local messages and artifacts from the current in-memory workspace.`)) return;
    if (sessionRailBusy) return;
    sessionRailBusy = true;
    sessionRailError = null;
    try {
      await flushPendingDocumentPersistence();
      const response = await workspaceFetch(`/api/session/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await readWorkspaceResponseError(response));
      artifactWarehouse.deleteSession(sessionId);
      await loadSessions();
      if (activeSessionId === sessionId) {
        const nextSession = sessions.find((entry) => entry.id !== sessionId);
        if (nextSession) {
          await switchSession(nextSession.id, { force: true });
        } else {
          await createSession({ force: true });
        }
      }
      logSessionTelemetry("session.delete.success", { sessionId });
    } catch (error) {
      sessionRailError = error instanceof Error ? error.message : String(error);
      logSessionTelemetry("session.delete.error", { sessionId, ok: false, error: sessionRailError });
    } finally {
      sessionRailBusy = false;
    }
  }

  async function renameSession(sessionId: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const response = await workspaceFetch(`/api/session/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!response.ok) throw new Error(await readWorkspaceResponseError(response));
      const session = (await response.json()) as WorkspaceSessionSummary;
      sessions = upsertSessionSummary(sessions, session);
      logSessionTelemetry("session.rename.success", { sessionId: session.id });
    } catch (error) {
      sessionRailError = error instanceof Error ? error.message : String(error);
      logSessionTelemetry("session.rename.error", { sessionId, ok: false, error: sessionRailError });
    }
  }

  function maybeNameNewChat(message: string): void {
    const session = currentSession;
    if (!session || !isUntitledChat(session)) return;
    if (conversation.messages.length > 0 || session.message_count > 0) return;
    const title = deriveChatTitle(message);
    if (!title) return;
    void renameSession(session.id, title);
  }

  function isUntitledChat(session: WorkspaceSessionSummary): boolean {
    return isDefaultWorkspaceSessionName(session.name);
  }

  function deriveChatTitle(message: string): string {
    return deriveWorkspaceSessionTitle(message);
  }

  function hydrateWorkspaceSession(detail: WorkspaceSessionDetail): void {
    conversation.messages = detail.messages.map((message) => ({
      id: message.id,
      role: message.role,
      parts: normalizePersistedParts(message),
    })) as typeof conversation.messages;
    persistedMessageIds = new SvelteSet(detail.messages.map((message) => message.id));
    activeDocument = detail.activeDocument;
    documentSeed = detail.activeDocument;
    documentPreferredView = detail.activeDocument ? inferPreferredDocumentView(detail.activeDocument.language) : "auto";
    documentEditorOpen = Boolean(detail.activeDocument);
    const restoredArtifact = hydrateArtifactState(detail);
    if (restoredArtifact) {
      applyArtifactWarehouseSnapshot(restoredArtifact);
      activeArtifactStatus = null;
    } else {
      activeArtifact = null;
      activeArtifactStatus = null;
      activeArtifactVersions = [];
    }
    pendingArtifactIntent = null;
    streamStartedAt = null;
    lastActivityTelemetrySignature = "";
    artifactEvents = [];
    observationIndex = 0;
    processedJsonRenderPromotionKeys.clear();
    lastDocumentPromotionKey = null;
    pendingDocumentSnapshot = null;
    lastPersistedDocumentSignature = detail.activeDocument ? createDocumentSnapshotSignature(detail.activeDocument) : "";
  }

  function hydrateArtifactState(detail: WorkspaceSessionDetail): (ArtifactWarehouseSnapshot<Spec> & { artifact: JsonRenderArtifact }) | null {
    const activeArtifactRecord = detail.artifactState?.activeArtifact;
    if (activeArtifactRecord?.kind === "json-render") {
      return artifactWarehouse.hydrateJsonRenderArtifact({
        sessionId: detail.session.id,
        artifact: {
          id: activeArtifactRecord.id,
          kind: "json-render",
          title: activeArtifactRecord.title,
          version: activeArtifactRecord.version,
          content: activeArtifactRecord.content,
          createdAt: activeArtifactRecord.created_at,
          updatedAt: activeArtifactRecord.updated_at,
        },
        versions: detail.artifactState?.activeArtifactVersions.map((version) => ({
          versionId: version.id,
          artifactId: version.artifact_id,
          version: version.version_number,
          payload: version.content,
          source: version.source === "user" ? "user-edit" : version.source === "system" ? "system" : "agent",
          createdAt: version.created_at,
        })) ?? [],
      });
    }
    return artifactWarehouse.getActiveJsonRenderArtifact(detail.session.id);
  }

  async function persistConversationMessages(): Promise<void> {
    const sessionId = activeSessionId;
    if (!sessionId) return;
    if (messagePersistInFlight) return;
    const messagesToPersist = conversation.messages.filter((message) => !persistedMessageIds.has(message.id));
    if (messagesToPersist.length === 0) {
      lastPersistStatus = "idle";
      return;
    }

    lastPersistStatus = "eligible";
    logSessionTelemetry("session.messages.persist_eligible", { sessionId, reason: `${messagesToPersist.length} message(s)` });
    messagePersistInFlight = true;
    lastPersistStatus = "in_flight";
    logSessionTelemetry("session.messages.persist_start", { sessionId, reason: `${messagesToPersist.length} message(s)` });
    try {
      for (const message of messagesToPersist) {
        const parts = snapshotDataParts(message.parts as DataPart[]);
        const response = await workspaceFetch(`/api/session/${encodeURIComponent(sessionId)}/messages`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: message.id,
            role: message.role,
            content: getText(parts),
            parts,
          }),
        });
        if (!response.ok) {
          sessionRailError = await readWorkspaceResponseError(response);
          lastPersistStatus = "error";
          logSessionTelemetry("session.messages.persist_error", {
            sessionId,
            ok: false,
            error: sessionRailError,
            reason: message.id,
          });
          return;
        }
        persistedMessageIds.add(message.id);
      }
      await loadSessions();
      lastPersistStatus = "success";
      logSessionTelemetry("session.messages.persist_success", { sessionId, reason: `${messagesToPersist.length} message(s)` });
    } catch (error) {
      sessionRailError = error instanceof Error ? error.message : String(error);
      lastPersistStatus = "error";
      logSessionTelemetry("session.messages.persist_error", {
        sessionId,
        ok: false,
        error: sessionRailError,
      });
      throw error;
    } finally {
      messagePersistInFlight = false;
    }
  }


  function scheduleDocumentPersistence(document: ActiveDocumentSnapshot): void {
    pendingDocumentSnapshot = document;
    startDocumentPersistenceWorker();
  }

  function startDocumentPersistenceWorker(): void {
    if (documentPersistPromise) return;
    let failed = false;
    documentPersistPromise = (async () => {
      try {
        await persistPendingDocumentSnapshots();
      } catch (error) {
        failed = true;
        sessionRailError = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        documentPersistPromise = null;
        if (!failed && pendingDocumentSnapshot) startDocumentPersistenceWorker();
      }
    })();
    void documentPersistPromise.catch(() => undefined);
  }

  async function tryFlushPendingDocumentPersistence(): Promise<boolean> {
    try {
      await flushPendingDocumentPersistence();
      return true;
    } catch (error) {
      sessionRailError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  async function flushPendingDocumentPersistence(): Promise<void> {
    if (!pendingDocumentSnapshot && !documentPersistPromise) return;
    if (!documentPersistPromise) startDocumentPersistenceWorker();
    await documentPersistPromise;
    if (pendingDocumentSnapshot) await flushPendingDocumentPersistence();
  }

  async function persistPendingDocumentSnapshots(): Promise<void> {
    while (pendingDocumentSnapshot) {
      const snapshot = pendingDocumentSnapshot;
      const signature = createDocumentSnapshotSignature(snapshot);
      if (signature === lastPersistedDocumentSignature) {
        if (pendingDocumentSnapshot && createDocumentSnapshotSignature(pendingDocumentSnapshot) === signature) {
          pendingDocumentSnapshot = null;
        }
        continue;
      }

      const response = await workspaceFetch(`/api/document/${encodeURIComponent(snapshot.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          session_id: activeSessionId ?? snapshot.session_id ?? undefined,
          title: snapshot.title,
          language: snapshot.language,
          content: snapshot.current_content,
        }),
      });
      if (!response.ok) {
        const message = await readWorkspaceResponseError(response);
        throw new Error(message || "Document changes could not be saved; session transition was blocked.");
      }
      const persisted = (await response.json()) as ActiveDocumentSnapshot;
      lastPersistedDocumentSignature = createDocumentSnapshotSignature(persisted);
      if (pendingDocumentSnapshot && createDocumentSnapshotSignature(pendingDocumentSnapshot) === signature) {
        pendingDocumentSnapshot = null;
        activeDocument = persisted;
        documentSeed = persisted;
      }
    }
  }

  function createDocumentSnapshotSignature(document: ActiveDocumentSnapshot): string {
    return JSON.stringify({
      id: document.id,
      session_id: document.session_id ?? null,
      title: document.title,
      language: document.language,
      current_content: document.current_content,
    });
  }

  function normalizePersistedParts(message: WorkspaceMessageSnapshot): DataPart[] {
    if (Array.isArray(message.parts) && message.parts.length > 0) return snapshotDataParts(message.parts as DataPart[]);
    if (!message.content) return [];
    return [{ type: "text", text: message.content }] as DataPart[];
  }

  function upsertSessionSummary(current: WorkspaceSessionSummary[], session: WorkspaceSessionSummary): WorkspaceSessionSummary[] {
    const withoutSession = current.filter((entry) => entry.id !== session.id);
    return [session, ...withoutSession].sort((a, b) => b.last_accessed.localeCompare(a.last_accessed));
  }

  // =============================================================================
  // Suggestions
  // =============================================================================

  const SUGGESTIONS = [
    {
      label: "Weather comparison",
      prompt: "Compare the weather in New York, London, and Tokyo",
    },
    {
      label: "GitHub repo stats",
      prompt: "Show me stats for the vercel/next.js and vercel/ai GitHub repos",
    },
    {
      label: "Crypto dashboard",
      prompt: "Build a crypto dashboard for Bitcoin, Ethereum, and Solana",
    },
    {
      label: "Hacker News top stories",
      prompt: "Show me the top 15 Hacker News stories right now",
    },
  ];

  // =============================================================================
  // Tool Labels
  // =============================================================================

  const TOOL_LABELS: Record<string, [string, string]> = {
    getWeather: ["Getting weather data", "Got weather data"],
    getGitHubRepo: ["Fetching GitHub repo", "Fetched GitHub repo"],
    getGitHubPullRequests: ["Fetching pull requests", "Fetched pull requests"],
    getCryptoPrice: ["Looking up crypto price", "Looked up crypto price"],
    getCryptoPriceHistory: ["Fetching price history", "Fetched price history"],
    getHackerNewsTop: ["Loading Hacker News", "Loaded Hacker News"],
    webSearch: ["Searching the web", "Searched the web"],
    createJsonArtifact: ["Creating artifact", "Created artifact"],
    createDocumentArtifact: ["Creating document", "Created document"],
    updateDocumentArtifact: ["Updating document", "Updated document"],
    readActiveDocument: ["Reading document", "Read document"],
    readDocumentArtifact: ["Reading document", "Read document"],
    listAvailableTools: ["Reading tool manifest", "Read tool manifest"],
  };

  // =============================================================================
  // Message Handling
  // =============================================================================

  function handleSubmit(message: string) {
    const trimmed = message.trim();
    if (getSubmitDisabledReason(trimmed)) return;

    if (hasExplicitArtifactIntent(trimmed) || (activeArtifact && hasActiveArtifactUpdateIntent(trimmed))) {
      pendingArtifactIntent = trimmed;
    }

    if (/\b(document|markdown|html|code|editor|workspace)\b/i.test(trimmed)) {
      documentEditorOpen = true;
    }

    logSessionTelemetry("chat.submit.start", { sessionId: activeSessionId, reason: `${trimmed.length} chars` });
    maybeNameNewChat(trimmed);
    conversation.sendMessage({ text: trimmed });
  }

  function handleClear() {
    conversation.messages = [];
    persistedMessageIds.clear();
    reportedToolErrorKeys.clear();
    lastPersistStatus = "idle";
    input = "";
    artifactWarehouse.clearActiveArtifact(activeSessionId);
    activeArtifact = null;
    activeArtifactStatus = null;
    activeArtifactVersions = [];
    pendingArtifactIntent = null;
    streamStartedAt = null;
    lastActivityTelemetrySignature = "";
    artifactEvents = [];
    observationIndex = 0;
    processedJsonRenderPromotionKeys.clear();
    lastDocumentPromotionKey = null;
    documentEditorOpen = false;
    activeDocument = null;
    documentSeed = null;
    documentPreferredView = "auto";
  }

  function handleStop() {
    void conversation.stop();
  }

  function handleClearArtifact() {
    artifactWarehouse.clearActiveArtifact(activeSessionId);
    activeArtifact = null;
    activeArtifactStatus = null;
    activeArtifactVersions = [];
    pendingArtifactIntent = null;
    streamStartedAt = null;
    lastActivityTelemetrySignature = "";
    artifactEvents = [];
  }

  function openDocumentEditor(): void {
    documentEditorOpen = true;
    pendingArtifactIntent = null;
  }

  function handleDocumentEvent(event: WorkspaceDocumentEvent): void {
    if (!event.document) {
      if (event.type === "view") {
        logArtifactTelemetry({ source: "client", event: "document_frame.view", mode: documentPreferredView, ok: true });
      }
      return;
    }
    activeDocument = event.document;
    if (!documentSeed || event.type === "opened") {
      documentSeed = event.document;
    }
    if (event.type === "changed" || event.type === "saved" || event.type === "opened") {
      scheduleDocumentPersistence(event.document);
      logArtifactTelemetry({
        source: "client",
        event: `document_frame.${event.type}`,
        documentId: event.document.id,
        documentVersion: event.document.version_count,
        title: event.document.title,
        mode: documentPreferredView,
        ok: true,
      });
    }
  }

  function inferPreferredDocumentView(language?: string): PreferredDocumentView {
    return /^(markdown|md|html|htm|svg|xml)$/i.test(language ?? "") ? "preview" : "edit";
  }
</script>

<WorkspaceRoot title="Sonik Chat" {artifactOpen} layoutMode={workspaceLayoutMode} railMode={workspaceRailMode}>
  {#snippet rail()}
    <SessionRail
      {sessions}
      {currentSession}
      {activeSessionId}
      archivedCount={archivedSessionCount}
      busy={sessionRailBusy || isStreaming}
      error={sessionRailError}
      collapsed={workspaceRailMode === "collapsed"}
      onCreate={() => void createSession()}
      onSwitch={(sessionId) => void switchSession(sessionId)}
      onArchive={(sessionId) => void archiveSession(sessionId)}
      onDelete={(sessionId) => void deleteSession(sessionId)}
    />
  {/snippet}

  {#snippet chat()}
    <AgentConversation
      title="Sonik Chat"
      messages={conversation.messages as AgentChatMessage[]}
      status={conversation.status}
      error={conversation.error}
      suggestions={SUGGESTIONS}
      toolLabels={TOOL_LABELS}
      activity={agentActivity}
      bind:input
      onSubmit={handleSubmit}
      onStop={handleStop}
      onClear={handleClear}
      shouldRenderArtifact={shouldRenderInlineArtifact}
    >
      {#snippet actions()}
        <ThemePicker />
        <button
          type="button"
          onclick={openDocumentEditor}
          class="px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          Workspace Docs
        </button>
      {/snippet}

      {#snippet renderArtifact(spec, loading)}
        <JsonArtifactRenderer {spec} {registry} {loading} />
      {/snippet}
    </AgentConversation>
  {/snippet}

  {#snippet artifact()}
    <CanvasViewport
      artifact={activeArtifact}
      loading={isStreaming}
      {pendingArtifactIntent}
      rawSpec={activeArtifactRawSpec}
      onClear={handleClearArtifact}
      onApplyRawSpec={handleApplyRawSpec}
      artifactVersions={activeArtifactVersionOptions}
      activeArtifactVersion={activeArtifactVersionNumber}
      onArtifactVersionChange={handleArtifactVersionChange}
      documentAvailable={documentEditorOpen}
      documentTitle={documentFrameTitle}
      documentSubtitle={documentFrameSubtitle}
    >
      {#snippet document()}
        <WorkspaceDocumentFrame
          documentId={documentFrameId}
          title={documentFrameTitle}
          language={documentFrameLanguage}
          content={documentFrameContent}
          preferredView={documentFramePreferredView}
          onDocumentEvent={handleDocumentEvent}
        />
      {/snippet}

      {#snippet inspector()}
        {#if activeArtifact}
          <ArtifactInspector
            artifact={activeArtifact}
            status={activeArtifactStatus}
            rawSpec={activeArtifactRawSpec}
            events={artifactEvents}
          />
        {/if}
      {/snippet}

      {#if activeArtifact}
        <JsonArtifactRenderer
          spec={activeArtifact.content}
          {registry}
          loading={isStreaming}
        />
      {/if}
    </CanvasViewport>
  {/snippet}
</WorkspaceRoot>

<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { dev } from "$app/environment";
  import { env as publicEnv } from "$env/dynamic/public";
  import type { PageData } from "./$types";
  import { SvelteSet, SvelteMap } from "svelte/reactivity";
  import { Chat } from "@ai-sdk/svelte";
  import { DefaultChatTransport } from "ai";
  import type { DataPart, Spec } from "@json-render/svelte";
  import type { StateStore } from "@json-render/core";
  import { JsonArtifactRenderer } from "@sonik-agent-ui/json-ui-runtime";
  import { AgentConversation, getSpec, getText, snapshotDataParts, type AgentActivityStatus, type AgentChatMessage } from "@sonik-agent-ui/chat-surface";
  import { createJsonRenderArtifactSignature, upsertJsonRenderArtifact, type JsonRenderArtifact } from "@sonik-agent-ui/artifact-model";
  import { DEFAULT_WORKSPACE_SESSION_NAME, deriveWorkspaceSessionTitle, isDefaultWorkspaceSessionName } from "@sonik-agent-ui/workspace-session";
  import { RESUME_CONTINUE_PROMPT, describeRunError, isRunErrorCode, type AgentAnalyticsEntryFrom, type AgentAnalyticsHints } from "@sonik-agent-ui/tool-contracts";
  import {
    createEmptyAgentRunContextSelection,
    reconcileAgentContextSelection,
    addAgentContextItem,
    removeAgentContextItem,
    parseAgentRunContextSelection,
    type AgentContextItem,
    type AgentRunContextSelection,
  } from "@sonik-agent-ui/tool-contracts/run-context";
  import { deriveAgentContextCandidates } from "$lib/agent-context/context-sources";
  import { promoteJsonRenderArtifact } from "$lib/artifacts/json-render-promotion";
  import { findDocumentArtifactToolCandidate, findJsonArtifactToolCandidate, type PreferredDocumentView } from "$lib/artifacts/tool-artifact-extraction";
  import { findStreamingJsonArtifactSpecCandidate } from "$lib/artifacts/streaming-artifact";
  import { hasActiveArtifactUpdateIntent, hasExplicitArtifactIntent } from "$lib/artifacts/artifact-promotion";
  import { logArtifactTelemetry, summarizeSpec } from "$lib/artifacts/artifact-telemetry";
  import { createInMemoryArtifactWarehouse, type ArtifactWarehouseSnapshot, type ArtifactWarehouseVersion } from "$lib/artifacts/artifact-warehouse";
  import ArtifactInspector from "$lib/artifacts/ArtifactInspector.svelte";
  import SessionRail from "$lib/session/SessionRail.svelte";
  import ThemePicker from "$lib/theme/ThemePicker.svelte";
  import { applyEmbeddedThemeSetting } from "$lib/theme/theme-runtime";
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
  import {
    applyJsonRenderStateChanges,
    buildJsonRenderStatePatchPayload,
    createJsonRenderStateStore,
    type JsonRenderStateChange,
  } from "$lib/render/json-render-state-controller";
  import {
    createQuestionAnswerTurnPayload,
    serializeQuestionAnswerTurnMessage,
  } from "$lib/render/question-answer-loop";
  import { createWorkflowSuggestions } from "$lib/agent-workflows/suggestions";

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

  interface WorkspaceRunSummary {
    id: string;
    status: "running" | "succeeded" | "failed" | "canceled";
    resumable: boolean;
    error: string | null;
    error_code: string | null;
    message_id: string | null;
    context_selection?: AgentRunContextSelection | null;
    started_at: string;
    ended_at: string | null;
  }

  interface WorkspaceSessionDetail {
    session: WorkspaceSessionSummary;
    activeDocument: ActiveDocumentSnapshot | null;
    messages: WorkspaceMessageSnapshot[];
    runs?: WorkspaceRunSummary[];
    reattach?: {
      run: WorkspaceRunSummary;
      message: { id: string; role: "assistant"; content: string; parts: DataPart[] } | null;
    } | null;
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
  let activeArtifactStateStore = $state<StateStore | undefined>();
  let activeArtifactStateStoreKey = $state<string | null>(null);
  let activeArtifactStateSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingActiveArtifactStateChanges: JsonRenderStateChange[] = [];
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
  let resumableRun = $state<WorkspaceRunSummary | null>(null);
  // Composer context selection for the next turn (chips + authoritative dismissals).
  let runContextSelection = $state<AgentRunContextSelection>(createEmptyAgentRunContextSelection());
  // Analytics-only run hints, computed client-side at send time. `analyticsTurnIndex`
  // is 0-based per workspace session (reset on clear/switch); `pendingAnalyticsEntryFrom`
  // records how the next turn started (default composer; workflow launcher / Continue
  // override it); `pendingAnalyticsHints` is the object read by the transport for the
  // in-flight send. Never influences behavior — analytics dimension only.
  let analyticsTurnIndex = 0;
  let pendingAnalyticsEntryFrom: AgentAnalyticsEntryFrom = "composer";
  let pendingAnalyticsHints: AgentAnalyticsHints | null = null;
  // Per-turn provenance: user message id -> the context items sent with that turn.
  let turnContextByMessageId = new SvelteMap<string, AgentContextItem[]>();
  let persistedMessageIds = new SvelteSet<string>();
  let reportedToolErrorKeys = new SvelteSet<string>();
  let processedJsonRenderPromotionKeys = new SvelteSet<string>();
  // Live tool-input streaming: the partial-spec signature currently mounted as a
  // preview, and the artifact ids we have already logged a first preview mount
  // for. Non-reactive bookkeeping so the preview effect skips no-op re-runs.
  let lastStreamingPreviewSignature: string | null = null;
  let streamingPreviewMountedIds = new SvelteSet<string>();
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
  let embeddedHostContextExpected = $state(false);
  let embeddedUrlTheme: string | null = null;
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
            contextSelection: $state.snapshot(runContextSelection),
            analyticsHints: pendingAnalyticsHints ?? undefined,
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
  // Live preview of a createJsonArtifact spec while its tool-call arguments are
  // still streaming. Only fires while streaming and only until the completed
  // tool output exists — at that point findJsonArtifactToolCandidate owns the
  // artifact (latestJsonRenderSpec below), so the partial preview hands off to
  // the authoritative, persisted version with no double-render.
  const streamingJsonRenderPreview = $derived.by<{ id: string; spec: Spec; title?: string } | null>(() => {
    if (!isStreaming) return null;
    for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
      const message = conversation.messages[index];
      if (!message || message.role !== "assistant") continue;
      const parts = snapshotDataParts(message.parts as DataPart[]);
      if (findJsonArtifactToolCandidate(message.id, parts as unknown[])) return null;
      return findStreamingJsonArtifactSpecCandidate(message.id, parts as unknown[]);
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

  // Mount the streaming createJsonArtifact spec into the live canvas as its
  // arguments arrive. This stays in memory only — no warehouse version commit
  // and no /api/artifact persistence per delta — so the completed tool output
  // (handled by the promotion effect above) remains the single authoritative,
  // persisted spec. Reusing the same artifact id makes partial -> final an
  // in-place update rather than a swap.
  $effect(() => {
    const preview = streamingJsonRenderPreview;
    if (!preview) {
      lastStreamingPreviewSignature = null;
      return;
    }

    let signature: string;
    let upsert: ReturnType<typeof upsertJsonRenderArtifact>;
    try {
      signature = createJsonRenderArtifactSignature(preview.spec);
      if (signature === lastStreamingPreviewSignature && activeArtifact?.id === preview.id) return;
      upsert = upsertJsonRenderArtifact({
        previous: activeArtifact?.id === preview.id ? activeArtifact : null,
        id: preview.id,
        title: preview.title ?? "Live artifact",
        spec: preview.spec,
      });
    } catch (error) {
      reportClientEffectError("json_artifact.stream_preview_error", error, { messageId: preview.id });
      return;
    }

    lastStreamingPreviewSignature = signature;
    activeArtifact = upsert.artifact;
    pendingArtifactIntent = null;

    if (!streamingPreviewMountedIds.has(preview.id)) {
      streamingPreviewMountedIds.add(preview.id);
      logArtifactTelemetry({
        source: "client",
        event: "artifact.stream.preview_mounted",
        artifactId: preview.id,
        ...summarizeSpec(preview.spec),
        ok: true,
      });
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


  function ensureActiveArtifactStateStore(): void {
    if (!activeArtifact) {
      activeArtifactStateStore = undefined;
      activeArtifactStateStoreKey = null;
      pendingActiveArtifactStateChanges = [];
      clearActiveArtifactStateSaveTimer();
      return;
    }
    const key = `${activeArtifact.id}:${activeArtifact.version}`;
    if (activeArtifactStateStoreKey === key && activeArtifactStateStore) return;
    activeArtifactStateStore = createJsonRenderStateStore(activeArtifact.content);
    activeArtifactStateStoreKey = key;
    pendingActiveArtifactStateChanges = [];
    clearActiveArtifactStateSaveTimer();
  }

  function handleActiveArtifactStateChange(changes: JsonRenderStateChange[]): void {
    if (!activeArtifact) return;
    let payload: ReturnType<typeof buildJsonRenderStatePatchPayload>;
    try {
      payload = buildJsonRenderStatePatchPayload({
        artifactId: activeArtifact.id,
        baseVersion: activeArtifact.version,
        changes,
      });
    } catch (error) {
      reportClientEffectError("json_render.state_patch.invalid", error, {
        sessionId: activeSessionId,
        root: activeArtifact.content.root,
        elementCount: Object.keys(activeArtifact.content.elements ?? {}).length,
      });
      return;
    }

    activeArtifact = {
      ...activeArtifact,
      content: applyJsonRenderStateChanges(activeArtifact.content, payload.changes),
      updatedAt: new Date().toISOString(),
    };
    pendingActiveArtifactStateChanges = mergeStateChanges(pendingActiveArtifactStateChanges, payload.changes);
    logArtifactTelemetry({
      source: "client",
      event: "json_render.state_patch.requested",
      sessionId: activeSessionId ?? undefined,
      artifactId: payload.artifactId,
      artifactVersion: payload.baseVersion,
      reason: payload.summary,
      elementCount: payload.changes.length,
      ok: true,
    });
    scheduleActiveArtifactStatePersistence();
  }

  function mergeStateChanges(current: JsonRenderStateChange[], incoming: JsonRenderStateChange[]): JsonRenderStateChange[] {
    const map = new Map<string, JsonRenderStateChange>();
    for (const change of current) map.set(change.path, change);
    for (const change of incoming) map.set(change.path, change);
    return Array.from(map.values());
  }

  function scheduleActiveArtifactStatePersistence(): void {
    clearActiveArtifactStateSaveTimer();
    activeArtifactStateSaveTimer = setTimeout(() => {
      void persistActiveArtifactStatePatch();
    }, 600);
  }

  function clearActiveArtifactStateSaveTimer(): void {
    if (activeArtifactStateSaveTimer) {
      clearTimeout(activeArtifactStateSaveTimer);
      activeArtifactStateSaveTimer = null;
    }
  }

  async function persistActiveArtifactStatePatch(): Promise<{ artifact: WorkspaceArtifactSnapshot; activeArtifactVersions: WorkspaceArtifactVersionSnapshot[] } | null> {
    clearActiveArtifactStateSaveTimer();
    const artifact = activeArtifact;
    const changes = pendingActiveArtifactStateChanges;
    if (!artifact || changes.length === 0) return null;

    let payload: ReturnType<typeof buildJsonRenderStatePatchPayload>;
    try {
      payload = buildJsonRenderStatePatchPayload({
        artifactId: artifact.id,
        baseVersion: artifact.version,
        changes,
      });
    } catch (error) {
      pendingActiveArtifactStateChanges = [];
      reportClientEffectError("json_render.state_patch.invalid", error, {
        sessionId: activeSessionId,
        root: artifact.content.root,
        elementCount: Object.keys(artifact.content.elements ?? {}).length,
      });
      return null;
    }

    pendingActiveArtifactStateChanges = [];
    try {
      const response = await workspaceFetch(`/api/artifact/${encodeURIComponent(payload.artifactId)}/state`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.status === 409) {
        const body = await response.json().catch(() => null) as { latestVersion?: number; error?: string } | null;
        logArtifactTelemetry({
          source: "client",
          event: "json_render.state_patch.conflict",
          sessionId: activeSessionId ?? undefined,
          artifactId: payload.artifactId,
          artifactVersion: payload.baseVersion,
          reason: body?.latestVersion ? `latest v${body.latestVersion}` : undefined,
          ok: false,
          error: body?.error ?? "Artifact version conflict",
        });
        if (activeSessionId) await switchSession(activeSessionId, { force: true });
        return null;
      }
      if (!response.ok) throw new Error(await readWorkspaceResponseError(response));
      const result = await response.json() as { artifact: WorkspaceArtifactSnapshot; activeArtifactVersions: WorkspaceArtifactVersionSnapshot[] };
      applyPersistedArtifactStatePatch(result);
      if (pendingActiveArtifactStateChanges.length > 0 && activeArtifact?.id === result.artifact.id) {
        activeArtifact = {
          ...activeArtifact,
          content: applyJsonRenderStateChanges(activeArtifact.content, pendingActiveArtifactStateChanges),
          updatedAt: new Date().toISOString(),
        };
        scheduleActiveArtifactStatePersistence();
      }
      logArtifactTelemetry({
        source: "client",
        event: "json_render.state_patch.persisted",
        sessionId: activeSessionId ?? undefined,
        artifactId: result.artifact.id,
        artifactVersion: result.artifact.version,
        elementCount: payload.changes.length,
        ok: true,
      });
      return result;
    } catch (error) {
      pendingActiveArtifactStateChanges = mergeStateChanges(pendingActiveArtifactStateChanges, payload.changes);
      reportClientEffectError("json_render.state_patch.error", error, {
        sessionId: activeSessionId,
        root: artifact.content.root,
        elementCount: Object.keys(artifact.content.elements ?? {}).length,
      });
      return null;
    }
  }

  function applyPersistedArtifactStatePatch(result: { artifact: WorkspaceArtifactSnapshot; activeArtifactVersions: WorkspaceArtifactVersionSnapshot[] }): void {
    const artifact = result.artifact;
    const snapshot = artifactWarehouse.hydrateJsonRenderArtifact({
      sessionId: artifact.session_id ?? activeSessionId,
      artifact: {
        id: artifact.id,
        kind: "json-render",
        title: artifact.title,
        version: artifact.version,
        content: artifact.content,
        createdAt: artifact.created_at,
        updatedAt: artifact.updated_at,
      },
      versions: result.activeArtifactVersions.map((version) => ({
        versionId: version.id,
        artifactId: version.artifact_id,
        version: version.version_number,
        payload: version.content,
        source: version.source === "user" ? "user-edit" : version.source === "system" ? "system" : "agent",
        createdAt: version.created_at,
      })),
    });
    applyArtifactWarehouseSnapshot(snapshot);
    if (activeArtifactStatus) {
      activeArtifactStatus = {
        ...activeArtifactStatus,
        artifactVersion: snapshot.artifact.version,
        updatedAt: snapshot.artifact.updatedAt,
      };
    }
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
    const smokeScenario = searchParams.get("smokeScenario");
    return {
      "x-sonik-agent-ui-smoke-stream": "true",
      "x-sonik-agent-ui-smoke-run-id": smokeRunId,
      ...(smokeScenario ? { "x-sonik-agent-ui-smoke-scenario": smokeScenario } : {}),
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
    if (isEmbeddedHostContextExpected() && !hasSignedHostContext(hostPageContext)) return {};
    return {
      "x-sonik-agent-ui-host-context": encodeWorkspaceHostContextHeader({
        authenticated,
        organizationId,
        scopes: hostPageContext?.scopes ?? hostSession.scopes ?? [],
        signatureVersion: hostPageContext?.signatureVersion ?? null,
        issuedAt: hostPageContext?.issuedAt ?? null,
        expiresAt: hostPageContext?.expiresAt ?? null,
        signature: hostPageContext?.signature ?? null,
        hostSession: createSignedWorkspaceHostSession(hostSession, {
          authenticated,
          organizationId,
          userId,
        }),
      }),
    };
  }

  function createSignedWorkspaceHostSession(
    hostSession: NonNullable<AgentHostMergedPageContext["hostSession"]>,
    input: { authenticated: boolean; organizationId: string; userId: string },
  ) {
    // This object is HMAC-covered by the embedding host. Do not spread sanitized
    // display-only fields (for example hostSession.theme) into the header: adding
    // even a harmless null changes the stable JSON payload and makes the cloud
    // runtime reject the session as missing-host-context.
    return {
      source: hostSession.source,
      sessionId: hostSession.sessionId ?? null,
      userId: input.userId,
      principalId: hostSession.principalId ?? input.userId,
      organizationId: input.organizationId,
      authenticated: input.authenticated,
      scopes: hostSession.scopes ?? [],
      expiresAt: hostSession.expiresAt ?? null,
      ...(hostSession.metadata ? { metadata: hostSession.metadata } : {}),
    };
  }

  function hasSignedHostContext(context: AgentHostMergedPageContext | null): boolean {
    return Boolean(
      context?.hostSession
        && context.authenticated === true
        && context.organizationId
        && context.signatureVersion
        && context.issuedAt
        && context.expiresAt
        && context.signature,
    );
  }

  function isWorkspaceHostContextReady(): boolean {
    if (!isEmbeddedHostContextExpected()) return true;
    return hasSignedHostContext(hostPageContext);
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
    return embeddedHostContextExpected;
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
    applyEmbeddedThemeFromHost(nextContext.theme ?? embeddedUrlTheme);
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
      visibleActions: [
        ...(isEmbeddedHostContextExpected() ? [] : ["theme-picker"]),
        "workspace-docs",
        "start-over",
        "createSession",
        "submitPrompt",
        "stop",
        "clearChat",
        "clearArtifact",
        "openWorkspaceDocument",
      ],
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
        openWorkspaceDocument: async () => {
          await openDocumentEditor();
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
    embeddedHostContextExpected = params.has("agentUiHostOrigin");
    embeddedUrlTheme = params.get("theme");
    const nextIntent = normalizeAgentEmbedIntent({
      embedMode: params.get("embedMode"),
      agentUiMode: params.get("agentUiMode"),
      railMode: params.get("railMode"),
      rail: params.get("rail"),
    });
    embedMode = nextIntent.mode;
    embedRailMode = nextIntent.railMode;
    applyEmbeddedThemeFromHost(embeddedUrlTheme);
  }

  function applyEmbeddedThemeFromHost(hostTheme?: string | null): void {
    if (!isEmbeddedHostContextExpected()) return;
    applyEmbeddedThemeSetting({ hostTheme });
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
    ensureActiveArtifactStateStore();
  });

  $effect(() => {
    if (!activeSessionId) return;
    if (isStreaming) return;
    void persistConversationMessages().catch((error) => {
      reportClientEffectError("session.messages.persist_unhandled", error, { sessionId: activeSessionId });
    });
  });

  function maybeBootstrapSessions(reason: string): void {
    if (!isWorkspaceHostContextReady()) {
      requestHostPageContext(`session_bootstrap_${reason}`);
      logSessionTelemetry("session.bootstrap.waiting_for_signed_host_context", { ok: false, reason });
      return;
    }
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
    if (!isWorkspaceHostContextReady()) {
      sessionRailError = "Waiting for signed host context from the embedded page.";
      requestHostPageContext("session_create_waiting_for_signed_host_context");
      logSessionTelemetry("session.create.waiting_for_signed_host_context", { ok: false, reason: "missing_signed_host_context" });
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

  async function refreshActiveSessionRunState(reason: string): Promise<void> {
    const sessionId = activeSessionId;
    if (!sessionId) return;

    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const response = await workspaceFetch(`/api/session/${encodeURIComponent(sessionId)}`);
        if (!response.ok) throw new Error(await readWorkspaceResponseError(response));
        const detail = (await response.json()) as WorkspaceSessionDetail;
        if (activeSessionId !== sessionId) return;

        sessions = upsertSessionSummary(sessions, detail.session);
        reattachRunState(detail);
        rehydrateRunContextState(detail);

        const latestRun = detail.runs?.at(-1);
        if (!latestRun || latestRun.status !== "running" || latestRun.resumable) {
          logSessionTelemetry("session.run.refresh", { sessionId, reason });
          return;
        }
      } catch (error) {
        logSessionTelemetry("session.run.refresh_error", {
          sessionId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          reason,
        });
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    logSessionTelemetry("session.run.refresh_timeout", { sessionId, ok: false, reason });
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
    reattachRunState(detail);
    rehydrateRunContextState(detail);
    // Entering a session restarts its per-session analytics turn sequence.
    analyticsTurnIndex = 0;
    pendingAnalyticsEntryFrom = "composer";
    pendingAnalyticsHints = null;
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

  // Reattach a persisted run after reload: a non-succeeded latest run may carry
  // a rebuilt assistant message (from its event log) that the client never got
  // to persist because the stream was interrupted; a resumable run also drives
  // the Continue affordance.
  function reattachRunState(detail: WorkspaceSessionDetail): void {
    resumableRun = null;
    const reattach = detail.reattach;
    if (!reattach?.run || reattach.run.status === "succeeded") return;

    const rebuilt = reattach.message;
    const runCount = detail.runs?.length ?? 0;
    const localAssistantCount = conversation.messages.filter((message) => message.role === "assistant").length;
    const localAssistantTurnExists = runCount > 0 && localAssistantCount >= runCount;
    if (rebuilt && rebuilt.parts.length > 0 && !localAssistantTurnExists && !persistedMessageIds.has(rebuilt.id)) {
      conversation.messages = [
        ...conversation.messages,
        { id: rebuilt.id, role: "assistant", parts: snapshotDataParts(rebuilt.parts) },
      ] as typeof conversation.messages;
      // The reattached message is a view of an unfinished run, not a new turn to
      // persist — mark it so the persist effect leaves it alone.
      persistedMessageIds.add(rebuilt.id);
    }

    if (reattach.run.resumable) {
      resumableRun = reattach.run;
      logSessionTelemetry("session.run.reattached", {
        sessionId: detail.session.id,
        reason: reattach.run.error_code ?? reattach.run.status,
      });
    }
  }

  // Restore composer context + per-turn provenance from persisted runs on reload.
  // The most recent run's persisted selection re-seeds the composer so removed
  // chips stay removed (its dismissedAutoSeedIds survive); each run's selection
  // is paired to its user turn (runs and user messages are 1:1, both ordered) for
  // historical provenance.
  function rehydrateRunContextState(detail: WorkspaceSessionDetail): void {
    turnContextByMessageId.clear();
    const runs = detail.runs ?? [];
    const userMessageIds = detail.messages.filter((message) => message.role === "user").map((message) => message.id);
    runs.forEach((run, index) => {
      const items = (run.context_selection?.items ?? []) as AgentContextItem[];
      const userId = userMessageIds[index];
      if (userId && items.length > 0) turnContextByMessageId.set(userId, items);
    });
    const latest = [...runs].reverse().find((run) => run.context_selection);
    runContextSelection = latest?.context_selection
      ? parseAgentRunContextSelection(latest.context_selection) ?? createEmptyAgentRunContextSelection()
      : createEmptyAgentRunContextSelection();
  }

  const runRecovery = $derived.by(() => {
    if (!resumableRun) return null;
    const code = isRunErrorCode(resumableRun.error_code) ? resumableRun.error_code : null;
    const affordance = describeRunError(code);
    return {
      title: affordance.title,
      guidance: affordance.guidance,
      actionLabel: affordance.actionLabel,
      canContinue: affordance.resumable && resumableRun.resumable,
    };
  });

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
  // Workflow Suggestions
  // =============================================================================

  const workflowSuggestions = $derived(createWorkflowSuggestions(createPageContextSnapshot()));

  // =============================================================================
  // Composer Context Selection
  // =============================================================================

  // Auto-seed candidates (current page + active document) and the full attachable
  // catalog for the plus menu, derived from live host/page + workspace state.
  const contextCandidates = $derived(deriveAgentContextCandidates({
    pageContext: createPageContextSnapshot(),
    activeDocument: activeDocument ? { id: activeDocument.id, title: activeDocument.title, language: activeDocument.language } : null,
    activeArtifact: activeArtifact ? { id: activeArtifact.id, title: activeArtifact.title } : null,
  }));

  // Reconcile fresh seeds into the selection whenever host/page context changes.
  // reconcile keeps manual chips and honors dismissedAutoSeedIds, so a chip the
  // user removed does not reappear (authoritative removal); idempotent, so this
  // never loops even though it may reassign the selection.
  $effect(() => {
    const seeds = contextCandidates.seeds;
    const next = reconcileAgentContextSelection({ previous: untrack(() => runContextSelection), seeds });
    if (JSON.stringify(next) !== untrack(() => JSON.stringify(runContextSelection))) {
      runContextSelection = next;
    }
  });

  function handleAttachContext(item: AgentContextItem): void {
    runContextSelection = addAgentContextItem(runContextSelection, item);
    logArtifactTelemetry({ source: "client", event: "composer.context.attach", sessionId: activeSessionId ?? undefined, reason: item.kind, ok: true });
  }

  function handleRemoveContext(id: string): void {
    runContextSelection = removeAgentContextItem(runContextSelection, id);
    logArtifactTelemetry({ source: "client", event: "composer.context.remove", sessionId: activeSessionId ?? undefined, reason: id, ok: true });
  }

  function messageContextItems(message: AgentChatMessage): AgentContextItem[] | undefined {
    return turnContextByMessageId.get(message.id);
  }

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

  // Compute the analytics hints for the turn about to be sent and stash them for
  // the transport (see prepareSendMessagesRequest). Advances the per-session turn
  // index. Analytics-only: dropped hints reproduce today's behavior.
  function stampAnalyticsHints(entryFrom: AgentAnalyticsEntryFrom) {
    const turnIndex = analyticsTurnIndex;
    pendingAnalyticsHints = {
      entryFrom,
      turnIndex,
      isFirstRun: turnIndex === 0,
      hasExistingArtifact: Boolean(activeArtifact),
    };
    analyticsTurnIndex = turnIndex + 1;
  }

  function handleSubmit(message: string) {
    const trimmed = message.trim();
    if (getSubmitDisabledReason(trimmed)) return;

    if (hasExplicitArtifactIntent(trimmed) || (activeArtifact && hasActiveArtifactUpdateIntent(trimmed))) {
      pendingArtifactIntent = trimmed;
    }

    logSessionTelemetry("chat.submit.start", { sessionId: activeSessionId, reason: `${trimmed.length} chars` });
    // A fresh user turn supersedes any pending run recovery.
    resumableRun = null;
    // Entry point defaults to composer; a workflow launcher chip sets it just
    // before this call and we consume + reset it here.
    stampAnalyticsHints(pendingAnalyticsEntryFrom);
    pendingAnalyticsEntryFrom = "composer";
    maybeNameNewChat(trimmed);
    const turnContext = ($state.snapshot(runContextSelection).items ?? []) as AgentContextItem[];
    conversation.sendMessage({ text: trimmed });
    // Associate the selection sent with this turn to the just-appended user
    // message so it renders as provenance (survives reload via persisted runs).
    const sentUserMessage = conversation.messages.at(-1);
    if (turnContext.length > 0 && sentUserMessage?.role === "user") {
      turnContextByMessageId.set(sentUserMessage.id, turnContext);
    }
  }

  function sendUserTurnWithEntryFrom(message: string, entryFrom: AgentAnalyticsEntryFrom): void {
    const trimmed = message.trim();
    if (!trimmed || isStreaming) return;
    resumableRun = null;
    stampAnalyticsHints(entryFrom);
    pendingAnalyticsEntryFrom = "composer";
    const turnContext = ($state.snapshot(runContextSelection).items ?? []) as AgentContextItem[];
    conversation.sendMessage({ text: trimmed });
    const sentUserMessage = conversation.messages.at(-1);
    if (turnContext.length > 0 && sentUserMessage?.role === "user") {
      turnContextByMessageId.set(sentUserMessage.id, turnContext);
    }
  }

  async function handleJsonRenderAction(actionName: string, params?: Record<string, unknown>): Promise<void> {
    if (actionName === "submitAnswer") {
      await handleSubmitAnswerAction(params ?? {});
      return;
    }
    logArtifactTelemetry({
      source: "client",
      event: "json_render.action.ignored",
      sessionId: activeSessionId ?? undefined,
      artifactId: activeArtifact?.id,
      artifactVersion: activeArtifact?.version,
      reason: actionName,
      ok: false,
      error: "No trusted host action handler is registered for this action.",
    });
  }

  async function handleSubmitAnswerAction(params: Record<string, unknown>): Promise<void> {
    const artifactBeforePersist = activeArtifact;
    if (!artifactBeforePersist) {
      logArtifactTelemetry({
        source: "client",
        event: "question_answer.submit.blocked",
        sessionId: activeSessionId ?? undefined,
        reason: "missing_active_artifact",
        ok: false,
        error: "Question answers require an active persisted artifact.",
      });
      return;
    }

    const persisted = await persistActiveArtifactStatePatch();
    if (!persisted) {
      logArtifactTelemetry({
        source: "client",
        event: "question_answer.submit.blocked",
        sessionId: activeSessionId ?? undefined,
        artifactId: artifactBeforePersist.id,
        artifactVersion: artifactBeforePersist.version,
        reason: "artifact_state_not_persisted",
        ok: false,
        error: "Question answer state was not persisted; generate turn was not sent.",
      });
      return;
    }

    const payload = createQuestionAnswerTurnPayload({
      actionParams: params,
      artifactId: persisted.artifact.id,
      artifactVersion: persisted.artifact.version,
      sessionId: activeSessionId,
    });
    const message = serializeQuestionAnswerTurnMessage(payload);
    logArtifactTelemetry({
      source: "client",
      event: "question_answer.submit.generate",
      sessionId: activeSessionId ?? undefined,
      artifactId: payload.artifact.id,
      artifactVersion: payload.artifact.version,
      reason: payload.submission.questionId,
      ok: true,
    });
    sendUserTurnWithEntryFrom(message, "question_answer");
  }

  // Continue a resumable failed/interrupted run. Distinct from retry-from-scratch:
  // this sends the canonical continuation prompt so the agent picks up its
  // interrupted work rather than re-running the original user turn.
  function handleContinue() {
    const run = resumableRun;
    if (!run) return;
    resumableRun = null;
    logSessionTelemetry("chat.continue.start", { sessionId: activeSessionId, reason: run.error_code ?? run.status });
    stampAnalyticsHints("resume_continue");
    conversation.sendMessage({ text: RESUME_CONTINUE_PROMPT });
  }

  function handleClear() {
    conversation.messages = [];
    persistedMessageIds.clear();
    reportedToolErrorKeys.clear();
    resumableRun = null;
    // A cleared chat drops manual chips and prior dismissals; the reconcile
    // effect re-seeds fresh page/document chips for the new turn.
    runContextSelection = createEmptyAgentRunContextSelection();
    turnContextByMessageId.clear();
    // New conversation → restart the per-session analytics turn sequence.
    analyticsTurnIndex = 0;
    pendingAnalyticsEntryFrom = "composer";
    pendingAnalyticsHints = null;
    lastPersistStatus = "idle";
    input = "";
    artifactWarehouse.clearActiveArtifact(activeSessionId);
    activeArtifact = null;
    activeArtifactStatus = null;
    activeArtifactVersions = [];
    activeArtifactStateStore = undefined;
    activeArtifactStateStoreKey = null;
    pendingActiveArtifactStateChanges = [];
    clearActiveArtifactStateSaveTimer();
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
    void refreshActiveSessionRunState("chat.stop");
  }

  function handleClearArtifact() {
    artifactWarehouse.clearActiveArtifact(activeSessionId);
    activeArtifact = null;
    activeArtifactStatus = null;
    activeArtifactVersions = [];
    activeArtifactStateStore = undefined;
    activeArtifactStateStoreKey = null;
    pendingActiveArtifactStateChanges = [];
    clearActiveArtifactStateSaveTimer();
    pendingArtifactIntent = null;
    streamStartedAt = null;
    lastActivityTelemetrySignature = "";
    artifactEvents = [];
  }

  async function createInitialWorkspaceDocument(): Promise<ActiveDocumentSnapshot> {
    const response = await workspaceFetch("/api/document", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        session_id: activeSessionId ?? "workspace-document-island",
        title: documentFrameTitle,
        language: documentFrameLanguage,
        content: documentFrameContent,
      }),
    });
    if (!response.ok) {
      const message = await readWorkspaceResponseError(response);
      throw new Error(message || "Workspace document could not be created.");
    }
    return (await response.json()) as ActiveDocumentSnapshot;
  }

  async function openDocumentEditor(): Promise<void> {
    pendingArtifactIntent = null;
    if (!documentSeed) {
      try {
        const document = await createInitialWorkspaceDocument();
        activeDocument = document;
        documentSeed = document;
        documentPreferredView = inferPreferredDocumentView(document.language);
        lastPersistedDocumentSignature = createDocumentSnapshotSignature(document);
      } catch (error) {
        sessionRailError = error instanceof Error ? error.message : String(error);
        reportClientEffectError("document_frame.open_error", error, { sessionId: activeSessionId });
        return;
      }
    }
    documentEditorOpen = true;
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
      suggestions={workflowSuggestions}
      toolLabels={TOOL_LABELS}
      activity={agentActivity}
      bind:input
      onSubmit={handleSubmit}
      onSelectSuggestion={() => { pendingAnalyticsEntryFrom = "workflow_launcher"; }}
      onStop={handleStop}
      onClear={handleClear}
      runRecovery={runRecovery}
      onContinue={handleContinue}
      contextItems={runContextSelection.items}
      contextSources={contextCandidates.sources}
      onAttachContext={handleAttachContext}
      onRemoveContext={handleRemoveContext}
      messageContext={messageContextItems}
      shouldRenderArtifact={shouldRenderInlineArtifact}
    >
      {#snippet actions()}
        {#if !isEmbeddedHostContextExpected()}
          <ThemePicker />
        {/if}
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
          store={activeArtifactStateStore}
          onStateChange={handleActiveArtifactStateChange}
          onAction={handleJsonRenderAction}
        />
      {/if}
    </CanvasViewport>
  {/snippet}
</WorkspaceRoot>

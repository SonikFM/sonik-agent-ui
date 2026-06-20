<script lang="ts">
  import { onMount } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import { Chat } from "@ai-sdk/svelte";
  import { DefaultChatTransport } from "ai";
  import type { DataPart, Spec } from "@json-render/svelte";
  import { JsonArtifactRenderer } from "@sonik-agent-ui/json-ui-runtime";
  import { AgentConversation, getSpec, getText, type AgentChatMessage } from "@sonik-agent-ui/chat-surface";
  import { upsertJsonRenderArtifact, type JsonRenderArtifact } from "@sonik-agent-ui/artifact-model";
  import { DEFAULT_WORKSPACE_SESSION_NAME, deriveWorkspaceSessionTitle, isDefaultWorkspaceSessionName } from "@sonik-agent-ui/workspace-session";
  import { promoteJsonRenderArtifact } from "$lib/artifacts/json-render-promotion";
  import { findDocumentArtifactToolCandidate, findJsonArtifactToolCandidate, type PreferredDocumentView } from "$lib/artifacts/tool-artifact-extraction";
  import { hasActiveArtifactUpdateIntent, hasExplicitArtifactIntent } from "$lib/artifacts/artifact-promotion";
  import { logArtifactTelemetry, summarizeSpec } from "$lib/artifacts/artifact-telemetry";
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
  import { CanvasViewport, OdysseusDocumentFrame, WorkspaceRoot, type OdysseusDocumentEvent } from "@sonik-agent-ui/workspace-core";
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
      persistence: "ephemeral-v0";
      activeArtifactId: string | null;
      note: string;
    };
  }

  // =============================================================================
  // Chat Setup
  // =============================================================================

  let input = $state("");
  let activeArtifact = $state<JsonRenderArtifact | null>(null);
  let activeArtifactStatus = $state<ArtifactStatus | null>(null);
  let pendingArtifactIntent = $state<string | null>(null);
  let documentEditorOpen = $state(false);
  let activeDocument = $state<ActiveDocumentSnapshot | null>(null);
  let documentSeed = $state<ActiveDocumentSnapshot | null>(null);
  let documentPreferredView = $state<PreferredDocumentView>("auto");
  let artifactEvents = $state<ArtifactObservationEvent[]>([]);
  let observationIndex = $state(0);
  let lastPromotionKey = $state<string | null>(null);
  let lastDocumentPromotionKey = $state<string | null>(null);
  let sessions = $state<WorkspaceSessionSummary[]>([]);
  let archivedSessionCount = $state(0);
  let activeSessionId = $state<string | null>(null);
  let sessionRailBusy = $state(false);
  let sessionRailError = $state<string | null>(null);
  let persistedMessageIds = new SvelteSet<string>();
  let messagePersistInFlight = false;
  let pendingDocumentSnapshot: ActiveDocumentSnapshot | null = null;
  let documentPersistPromise: Promise<void> | null = null;
  let lastPersistedDocumentSignature = "";

  const conversation = new Chat({
    transport: new DefaultChatTransport({
      api: "/api/generate",
      prepareSendMessagesRequest({ messages, id, trigger, messageId, body }) {
        return {
          body: {
            ...body,
            id,
            trigger,
            messageId,
            messages,
            workspace: {
              activeDocument,
              sessionId: activeSessionId,
            },
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
  const initialOdysseusDocumentContent = "# Sonik Odysseus Document\n\nThis is the copied Odysseus document editor running as an isolated island. Use the language selector to switch Markdown, HTML, JSON, CSV, code, and preview modes.";
  const documentFrameTitle = $derived(documentSeed?.title ?? "Sonik Odysseus Document");
  const documentFrameLanguage = $derived(documentSeed?.language ?? "markdown");
  const documentFrameContent = $derived(documentSeed?.current_content ?? initialOdysseusDocumentContent);
  const documentFrameId = $derived(documentSeed?.id);
  const documentFramePreferredView = $derived(documentPreferredView);
  const documentFrameSubtitle = $derived(`${documentFrameLanguage} · v${documentSeed?.version_count ?? 1}`);
  const artifactOpen = $derived(Boolean(activeArtifact || pendingArtifactIntent || documentEditorOpen));
  const latestJsonRenderSpec = $derived.by<{ id: string; spec: Spec; sourceUserMessageId: string; userPrompt: string; title?: string; forcePromote?: boolean } | null>(() => {
    for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
      const message = conversation.messages[index];
      if (!message || message.role !== "assistant") continue;

      const sourcePrompt = findNearestUserPrompt(index);
      const artifactToolCandidate = findJsonArtifactToolCandidate(message.id, message.parts as unknown[]);
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

      const spec = getSpec(message.parts as DataPart[]);
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
      const candidate = findDocumentArtifactToolCandidate(message.id, message.parts as unknown[]);
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
    lastDocumentPromotionKey = promotionKey;
    activeDocument = latestDocumentArtifact.document;
    documentSeed = latestDocumentArtifact.document;
    documentPreferredView = latestDocumentArtifact.preferredView ?? inferPreferredDocumentView(latestDocumentArtifact.document.language);
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
    if (!latestJsonRenderSpec) return;

    const result = promoteJsonRenderArtifact({
      current: activeArtifact,
      messageArtifactId: latestJsonRenderSpec.id,
      spec: latestJsonRenderSpec.spec,
      userPrompt: latestJsonRenderSpec.userPrompt,
      title: latestJsonRenderSpec.title,
      forcePromote: latestJsonRenderSpec.forcePromote,
    });
    const promotionKey = [
      latestJsonRenderSpec.id,
      result.artifact?.id ?? "no-artifact",
      result.signature,
      result.decision.reason,
    ].join("::");

    if (promotionKey === lastPromotionKey) return;
    lastPromotionKey = promotionKey;

    observationIndex += 1;
    const event = createArtifactObservationEvent({
      result,
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

    if (result.promoted && result.artifact) {
      activeArtifact = result.artifact;
      activeArtifactStatus = createArtifactStatus(result.artifact, event);
      pendingArtifactIntent = null;
    }
  });

  function findNearestUserPrompt(beforeIndex: number): { id: string; text: string } {
    for (let index = beforeIndex - 1; index >= 0; index -= 1) {
      const message = conversation.messages[index];
      if (!message || message.role !== "user") continue;
      return { id: message.id, text: getText(message.parts as DataPart[]) };
    }

    return { id: "", text: "" };
  }

  function shouldRenderInlineArtifact(message: AgentChatMessage): boolean {
    if (message.role !== "assistant") return true;

    const messageIndex = conversation.messages.findIndex((candidate) => candidate.id === message.id);
    if (messageIndex === -1) return true;

    if (findJsonArtifactToolCandidate(message.id, message.parts as unknown[])) {
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

    activeArtifact = upsert.artifact;
    if (activeArtifactStatus) {
      activeArtifactStatus = {
        ...activeArtifactStatus,
        artifactVersion: upsert.artifact.version,
        updatedAt: upsert.artifact.updatedAt,
      };
    }

    observationIndex += 1;
    artifactEvents = appendArtifactObservationEvent(artifactEvents, {
      id: `manual-json-editor::artifact_updated::${observationIndex}::${upsert.artifact.id}`,
      type: "artifact_updated",
      artifactId: upsert.artifact.id,
      artifactVersion: upsert.artifact.version,
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
      artifactId: upsert.artifact.id,
      artifactVersion: upsert.artifact.version,
      reason: "active_artifact_update",
      ...summarizeSpec(upsert.artifact.content),
      ok: true,
    });

    return null;
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

  onMount(() => {
    void initializeSessions();
  });

  $effect(() => {
    if (!activeSessionId) return;
    if (isStreaming) return;
    void persistConversationMessages();
  });

  async function initializeSessions(): Promise<void> {
    await loadSessions();
    const firstSession = sessions[0];
    if (firstSession) {
      await switchSession(firstSession.id);
      return;
    }
    await createSession();
  }

  async function loadSessions(): Promise<void> {
    sessionRailError = null;
    try {
      const response = await fetch("/api/sessions");
      if (!response.ok) throw new Error(await response.text());
      sessions = (await response.json()) as WorkspaceSessionSummary[];
      void loadArchivedSessionCount();
    } catch (error) {
      sessionRailError = error instanceof Error ? error.message : String(error);
    }
  }

  async function loadArchivedSessionCount(): Promise<void> {
    try {
      const response = await fetch("/api/sessions?archived=true");
      if (!response.ok) throw new Error(await response.text());
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
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: DEFAULT_WORKSPACE_SESSION_NAME, mode: "chat" }),
      });
      if (!response.ok) throw new Error(await response.text());
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
      const response = await fetch(`/api/session/${encodeURIComponent(sessionId)}`);
      if (!response.ok) throw new Error(await response.text());
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
      const response = await fetch(`/api/session/${encodeURIComponent(sessionId)}/archive`, { method: "POST" });
      if (!response.ok) throw new Error(await response.text());
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
      const response = await fetch(`/api/session/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await response.text());
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
      const response = await fetch(`/api/session/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!response.ok) throw new Error(await response.text());
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
    activeArtifact = null;
    activeArtifactStatus = null;
    pendingArtifactIntent = null;
    artifactEvents = [];
    observationIndex = 0;
    lastPromotionKey = null;
    lastDocumentPromotionKey = null;
    pendingDocumentSnapshot = null;
    lastPersistedDocumentSignature = detail.activeDocument ? createDocumentSnapshotSignature(detail.activeDocument) : "";
  }

  async function persistConversationMessages(): Promise<void> {
    const sessionId = activeSessionId;
    if (!sessionId) return;
    if (messagePersistInFlight) return;
    const messagesToPersist = conversation.messages.filter((message) => !persistedMessageIds.has(message.id));
    if (messagesToPersist.length === 0) return;

    messagePersistInFlight = true;
    try {
      for (const message of messagesToPersist) {
        const parts = message.parts as DataPart[];
        const response = await fetch(`/api/session/${encodeURIComponent(sessionId)}/messages`, {
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
          sessionRailError = await response.text();
          return;
        }
        persistedMessageIds.add(message.id);
      }
      await loadSessions();
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

      const response = await fetch(`/api/document/${encodeURIComponent(snapshot.id)}`, {
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
        const message = await response.text();
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
    if (Array.isArray(message.parts) && message.parts.length > 0) return message.parts;
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
    if (!trimmed || isStreaming) return;

    if (hasExplicitArtifactIntent(trimmed) || (activeArtifact && hasActiveArtifactUpdateIntent(trimmed))) {
      pendingArtifactIntent = trimmed;
    }

    if (/\b(document|markdown|html|code|editor|odysseus)\b/i.test(trimmed)) {
      documentEditorOpen = true;
    }

    maybeNameNewChat(trimmed);
    conversation.sendMessage({ text: trimmed });
  }

  function handleClear() {
    conversation.messages = [];
    persistedMessageIds.clear();
    input = "";
    activeArtifact = null;
    activeArtifactStatus = null;
    pendingArtifactIntent = null;
    artifactEvents = [];
    observationIndex = 0;
    lastPromotionKey = null;
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
    activeArtifact = null;
    activeArtifactStatus = null;
    pendingArtifactIntent = null;
    artifactEvents = [];
    lastPromotionKey = null;
  }

  function openDocumentEditor(): void {
    documentEditorOpen = true;
    pendingArtifactIntent = null;
  }

  function handleDocumentEvent(event: OdysseusDocumentEvent): void {
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

<WorkspaceRoot title="Sonik Chat" {artifactOpen}>
  {#snippet rail()}
    <SessionRail
      {sessions}
      {currentSession}
      {activeSessionId}
      archivedCount={archivedSessionCount}
      busy={sessionRailBusy || isStreaming}
      error={sessionRailError}
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
          Odysseus Docs
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
      documentAvailable={documentEditorOpen}
      documentTitle={documentFrameTitle}
      documentSubtitle={documentFrameSubtitle}
    >
      {#snippet document()}
        <OdysseusDocumentFrame
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

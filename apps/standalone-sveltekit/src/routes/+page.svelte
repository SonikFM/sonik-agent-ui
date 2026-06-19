<script lang="ts">
  import { Chat } from "@ai-sdk/svelte";
  import { DefaultChatTransport } from "ai";
  import type { DataPart, Spec } from "@json-render/svelte";
  import { JsonArtifactRenderer } from "@sonik-agent-ui/json-ui-runtime";
  import { AgentConversation, getSpec, getText, type AgentChatMessage } from "@sonik-agent-ui/chat-surface";
  import { upsertJsonRenderArtifact, type JsonRenderArtifact } from "@sonik-agent-ui/artifact-model";
  import { promoteJsonRenderArtifact } from "$lib/artifacts/json-render-promotion";
  import { findDocumentArtifactToolCandidate, findJsonArtifactToolCandidate, type PreferredDocumentView } from "$lib/artifacts/tool-artifact-extraction";
  import { hasActiveArtifactUpdateIntent, hasExplicitArtifactIntent } from "$lib/artifacts/artifact-promotion";
  import { logArtifactTelemetry, summarizeSpec } from "$lib/artifacts/artifact-telemetry";
  import ArtifactInspector from "$lib/artifacts/ArtifactInspector.svelte";
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
            },
          },
        };
      },
    }),
  });

  const isStreaming = $derived(
    conversation.status === "streaming" || conversation.status === "submitted",
  );
  const activeArtifactRawSpec = $derived(
    activeArtifact ? JSON.stringify(activeArtifact.content, null, 2) : "",
  );
  const initialOdysseusDocumentContent = "# Sonik Odysseus Document\n\nThis is the copied Odysseus document editor running as an isolated island. Use the language selector to switch Markdown, HTML, JSON, CSV, code, and preview modes.";
  const documentFrameTitle = $derived(documentSeed?.title ?? "Sonik Odysseus Document");
  const documentFrameLanguage = $derived(documentSeed?.language ?? "markdown");
  const documentFrameContent = $derived(documentSeed?.current_content ?? initialOdysseusDocumentContent);
  const documentFrameId = $derived(documentSeed?.id);
  const documentFramePreferredView = $derived(documentPreferredView);
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

    conversation.sendMessage({ text: trimmed });
  }

  function handleClear() {
    conversation.messages = [];
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

<WorkspaceRoot title="json-render Svelte Chat" {artifactOpen}>
  {#snippet chat()}
    <AgentConversation
      title="json-render Svelte Chat"
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

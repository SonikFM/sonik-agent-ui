<script lang="ts" module>
  import type { Snippet } from "svelte";
  import type { Artifact } from "@sonik-agent-ui/artifact-model";
  import type { CanvasPanel } from "./CanvasToolbar.svelte";

  export interface CanvasViewportProps {
    artifact: Artifact | null;
    loading?: boolean;
    pendingArtifactIntent?: string | null;
    rawSpec?: string;
    inspector?: Snippet;
    document?: Snippet;
    children?: Snippet;
    onClear?: () => void;
    onApplyRawSpec?: (rawSpec: string) => string | null | void;
    documentAvailable?: boolean;
    documentTitle?: string | null;
    documentSubtitle?: string | null;
    artifactVersions?: Array<{ version: number; label?: string }>;
    activeArtifactVersion?: number | null;
    onArtifactVersionChange?: (version: number) => void;
  }
</script>

<script lang="ts">
  import CanvasToolbar from "./CanvasToolbar.svelte";

  let {
    artifact,
    loading = false,
    pendingArtifactIntent = null,
    rawSpec = "",
    inspector,
    document,
    children,
    onClear,
    onApplyRawSpec,
    documentAvailable = false,
    documentTitle = null,
    documentSubtitle = null,
    artifactVersions = [],
    activeArtifactVersion = null,
    onArtifactVersionChange,
  }: CanvasViewportProps = $props();

  let panel = $state<CanvasPanel>("canvas");
  let isFullscreen = $state(false);
  let draftRawSpec = $state("");
  let editMessage = $state<string | null>(null);
  let lastDraftArtifactKey = $state("");

  const title = $derived(
    artifact?.title ?? (documentAvailable ? (documentTitle ?? "Document workspace") : "Artifact workspace"),
  );
  const subtitle = $derived.by(() => {
    if (artifact) return `${artifact.kind} · v${artifact.version}`;
    if (documentAvailable) return documentSubtitle ?? "Document editor active";
    if (pendingArtifactIntent) return "Preparing artifact...";
    return "No promoted artifact yet";
  });
  const hasArtifact = $derived(Boolean(artifact));
  const hasWorkspaceContent = $derived(Boolean(artifact || documentAvailable));
  const artifactKey = $derived(artifact ? `${artifact.id}:${artifact.version}` : "");

  $effect(() => {
    if (!artifact) {
      panel = documentAvailable ? "document" : "canvas";
      draftRawSpec = rawSpec;
      editMessage = null;
      lastDraftArtifactKey = "";
      return;
    }

    if (artifactKey !== lastDraftArtifactKey) {
      draftRawSpec = rawSpec;
      editMessage = null;
      lastDraftArtifactKey = artifactKey;
    }
  });

  $effect(() => {
    if (panel === "document" && !documentAvailable) panel = hasArtifact ? "canvas" : "canvas";
    if (!hasArtifact && documentAvailable && panel !== "document") panel = "document";
  });

  function applyDraft(): void {
    const result = onApplyRawSpec?.(draftRawSpec);
    editMessage = result ?? "Applied JSON spec to canvas.";
    if (!result) panel = "canvas";
  }
</script>

<section
  class="canvas-viewport"
  class:canvas-viewport--fullscreen={isFullscreen}
  aria-label="Artifact canvas viewport"
>
  <CanvasToolbar
    {title}
    {subtitle}
    {loading}
    {panel}
    {hasArtifact}
    {documentAvailable}
    {isFullscreen}
    {artifactVersions}
    {activeArtifactVersion}
    {onArtifactVersionChange}
    onPanelChange={(nextPanel) => (panel = nextPanel)}
    onToggleFullscreen={() => (isFullscreen = !isFullscreen)}
    {onClear}
  />

  <div class="canvas-viewport__body">
    {#if hasWorkspaceContent}
      {#if panel === "document" && documentAvailable}
        <div class="canvas-viewport__scroll canvas-viewport__scroll--document" data-canvas-panel="document">
          {@render document?.()}
        </div>
      {:else if artifact && panel === "canvas"}
        <div class="canvas-viewport__scroll" data-canvas-panel="renderer">
          <div class="canvas-viewport__surface">
            {@render children?.()}
          </div>
        </div>
      {:else if artifact && panel === "editor"}
        <div class="canvas-viewport__scroll" data-canvas-panel="editor">
          <div class="canvas-viewport__editor-shell">
            <div class="canvas-viewport__editor-header">
              <div>
                <p class="canvas-viewport__editor-title">Editable JSON-render spec</p>
                <p class="canvas-viewport__editor-help">Edit the artifact spec directly, then apply it back to the live canvas.</p>
              </div>
              <button type="button" class="canvas-viewport__apply" onclick={applyDraft}>Apply JSON</button>
            </div>
            {#if editMessage}
              <p class:canvas-viewport__edit-error={editMessage.startsWith("Invalid")} class="canvas-viewport__edit-message">{editMessage}</p>
            {/if}
            <textarea bind:value={draftRawSpec} spellcheck="false" aria-label="Editable artifact JSON spec"></textarea>
          </div>
        </div>
      {:else if artifact && panel === "inspector"}
        <div class="canvas-viewport__scroll" data-canvas-panel="inspector">
          <div class="canvas-viewport__surface">
            {@render inspector?.()}
          </div>
        </div>
      {:else if artifact}
        <div class="canvas-viewport__scroll" data-canvas-panel="raw-json">
          <pre class="canvas-viewport__raw"><code>{rawSpec}</code></pre>
        </div>
      {:else}
        <div class="canvas-viewport__empty">
          <div class="canvas-viewport__empty-card">
            <p class="canvas-viewport__empty-title">Select a workspace mode</p>
            <p>Open a document editor or create an artifact to use this canvas viewport.</p>
          </div>
        </div>
      {/if}
    {:else}
      <div class="canvas-viewport__empty">
        {#if pendingArtifactIntent}
          <div class="canvas-viewport__empty-card">
            <p class="canvas-viewport__empty-title">Artifact creation requested</p>
            <p>The agent is generating a JSON-render spec for this canvas viewport.</p>
            <p class="canvas-viewport__empty-prompt">{pendingArtifactIntent}</p>
          </div>
        {:else}
          <div class="canvas-viewport__empty-card">
            <p class="canvas-viewport__empty-title">Canvas viewport ready</p>
            <p>Ask the agent to create a canvas artifact. Temporary JSON-render responses can still stay inline in chat.</p>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</section>

<style>
  .canvas-viewport {
    display: flex;
    height: 100%;
    min-height: 0;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--sonik-border-color);
    border-radius: 0.75rem;
    background: var(--card);
    box-shadow: 0 1px 2px color-mix(in oklab, var(--foreground) 12%, transparent);
  }

  .canvas-viewport--fullscreen {
    position: fixed;
    inset: 0.75rem;
    z-index: 1000;
    height: auto;
    background: var(--background);
  }

  .canvas-viewport__body {
    min-height: 0;
    flex: 1;
    overflow: hidden;
    background: color-mix(in oklab, var(--background) 80%, transparent);
  }

  .canvas-viewport__scroll {
    height: 100%;
    overflow: auto;
    padding: 1rem;
  }

  .canvas-viewport__scroll--document {
    overflow: hidden;
    padding: 0;
  }

  .canvas-viewport__surface,
  .canvas-viewport__editor-shell {
    min-height: 100%;
    max-width: 72rem;
    margin: 0 auto;
    border: 1px solid var(--sonik-border-color);
    border-radius: 0.75rem;
    background: color-mix(in oklab, var(--card) 86%, transparent);
    padding: 1rem;
    box-shadow: 0 1px 2px color-mix(in oklab, var(--foreground) 10%, transparent);
  }

  .canvas-viewport--fullscreen .canvas-viewport__surface,
  .canvas-viewport--fullscreen .canvas-viewport__editor-shell {
    max-width: min(96rem, calc(100vw - 4rem));
  }

  .canvas-viewport__editor-shell {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .canvas-viewport__editor-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
  }

  .canvas-viewport__editor-title,
  .canvas-viewport__empty-title {
    color: var(--foreground);
    font-weight: 700;
  }

  .canvas-viewport__editor-help,
  .canvas-viewport__edit-message,
  .canvas-viewport__empty {
    color: var(--muted-foreground);
    font-size: 0.875rem;
  }

  .canvas-viewport__edit-error {
    color: var(--destructive);
  }

  .canvas-viewport__apply {
    flex-shrink: 0;
    border: 1px solid var(--sonik-border-color);
    border-radius: 0.5rem;
    background: var(--primary);
    padding: 0.45rem 0.7rem;
    color: var(--primary-foreground);
    font-size: 0.75rem;
    font-weight: 700;
  }

  textarea {
    min-height: 32rem;
    width: 100%;
    resize: vertical;
    border: 1px solid var(--sonik-border-color);
    border-radius: 0.75rem;
    background: var(--background);
    padding: 1rem;
    color: var(--foreground);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    font-size: 0.8125rem;
    line-height: 1.55;
    outline: none;
  }

  textarea:focus {
    border-color: var(--ring);
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--ring) 28%, transparent);
  }

  .canvas-viewport__raw {
    min-height: 100%;
    overflow: auto;
    border: 1px solid var(--sonik-border-color);
    border-radius: 0.75rem;
    background: color-mix(in oklab, var(--muted) 40%, transparent);
    padding: 1rem;
    color: var(--foreground);
    font-size: 0.75rem;
    line-height: 1.55;
  }

  .canvas-viewport__empty {
    display: flex;
    height: 100%;
    min-height: 17.5rem;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    text-align: center;
  }

  .canvas-viewport__empty-card {
    max-width: 36rem;
    border: 1px dashed var(--sonik-border-color);
    border-radius: 0.75rem;
    background: color-mix(in oklab, var(--card) 70%, transparent);
    padding: 1.5rem;
  }

  .canvas-viewport__empty-prompt {
    margin-top: 0.5rem;
    overflow-wrap: anywhere;
    font-size: 0.75rem;
  }
</style>

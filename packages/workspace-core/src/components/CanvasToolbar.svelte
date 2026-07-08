<script lang="ts" module>
  export type CanvasPanel = "canvas" | "document" | "editor" | "inspector" | "raw";

  export interface CanvasToolbarProps {
    title: string;
    subtitle?: string;
    loading?: boolean;
    panel?: CanvasPanel;
    hasArtifact?: boolean;
    documentAvailable?: boolean;
    isFullscreen?: boolean;
    onPanelChange?: (panel: CanvasPanel) => void;
    onToggleFullscreen?: () => void;
    artifactVersions?: Array<{ version: number; label?: string }>;
    activeArtifactVersion?: number | null;
    onArtifactVersionChange?: (version: number) => void;
    onClear?: () => void;
    showDeveloperPanels?: boolean;
    /** Wired to the floating canvas window controller; omit to keep the toolbar static (e.g. embedded host contexts). */
    onDragPointerDown?: (event: PointerEvent) => void;
    onDragPointerMove?: (event: PointerEvent) => void;
    onDragPointerUp?: (event: PointerEvent) => void;
    onDragKeyDown?: (event: KeyboardEvent) => void;
    onResetLayout?: () => void;
  }
</script>

<script lang="ts">
  let {
    title,
    subtitle,
    loading = false,
    panel = "canvas",
    hasArtifact = false,
    documentAvailable = false,
    isFullscreen = false,
    onPanelChange,
    onToggleFullscreen,
    artifactVersions = [],
    activeArtifactVersion = null,
    onArtifactVersionChange,
    onClear,
    showDeveloperPanels = true,
    onDragPointerDown,
    onDragPointerMove,
    onDragPointerUp,
    onDragKeyDown,
    onResetLayout,
  }: CanvasToolbarProps = $props();

  const allPanelButtons: Array<{ id: CanvasPanel; label: string; developer?: boolean }> = [
    { id: "canvas", label: "Preview" },
    { id: "document", label: "Document" },
    { id: "editor", label: "Edit JSON", developer: true },
    { id: "inspector", label: "Inspector", developer: true },
    { id: "raw", label: "Raw", developer: true },
  ];

  const panelButtons = $derived(allPanelButtons.filter((item) => showDeveloperPanels || !item.developer));

  function panelEnabled(panelId: CanvasPanel): boolean {
    if (panelId === "document") return documentAvailable;
    return hasArtifact;
  }
</script>

<header
  class="canvas-toolbar"
  class:canvas-toolbar--draggable={Boolean(onDragPointerDown)}
  role={onDragPointerDown ? "group" : undefined}
  aria-label={onDragPointerDown ? "Canvas window title bar. Drag to move." : undefined}
  onpointerdown={onDragPointerDown}
  onpointermove={onDragPointerMove}
  onpointerup={onDragPointerUp}
  onpointercancel={onDragPointerUp}
  ondblclick={onResetLayout}
>
  <div class="canvas-toolbar__title">
    <div class="canvas-toolbar__eyebrow-row">
      <span class="canvas-toolbar__eyebrow">Artifact Canvas</span>
      {#if loading}
        <span class="canvas-toolbar__streaming animate-shimmer">Streaming</span>
      {/if}
      {#if onDragKeyDown}
        <!-- Keyboard alternative to pointer-drag: a real focusable button so arrow-key
             nudge works without making the whole (button-containing) header focusable. -->
        <button
          type="button"
          class="canvas-toolbar__move-handle"
          onkeydown={onDragKeyDown}
          aria-label="Move canvas window. Focus this control, then use arrow keys to reposition it. Double-click the title bar or use Reset layout to restore the default position."
        >
          Move
        </button>
      {/if}
    </div>
    <p class="canvas-toolbar__heading">{title}</p>
    {#if subtitle}
      <p class="canvas-toolbar__subtitle">{subtitle}</p>
    {/if}
  </div>

  <div class="canvas-toolbar__actions">
    {#if artifactVersions.length > 1}
      <label class="canvas-toolbar__version" aria-label="Artifact version selector">
        <span>Version</span>
        <select
          value={activeArtifactVersion ?? artifactVersions.at(-1)?.version}
          onchange={(event) => onArtifactVersionChange?.(Number(event.currentTarget.value))}
        >
          {#each artifactVersions as version (version.version)}
            <option value={version.version}>{version.label ?? `v${version.version}`}</option>
          {/each}
        </select>
      </label>
    {/if}

    <div class="canvas-toolbar__panel-tabs" aria-label="Artifact view mode">
      {#each panelButtons as item (item.id)}
        <button
          type="button"
          disabled={!panelEnabled(item.id)}
          class:active={panel === item.id}
          onclick={() => onPanelChange?.(item.id)}
        >
          {item.label}
        </button>
      {/each}
    </div>

    {#if onResetLayout}
      <button
        type="button"
        class="canvas-toolbar__button"
        onclick={onResetLayout}
        aria-label="Reset the canvas window to its default position and size"
      >
        Reset layout
      </button>
    {/if}

    <button
      type="button"
      disabled={!hasArtifact && !documentAvailable}
      class="canvas-toolbar__button"
      onclick={onToggleFullscreen}
    >
      {isFullscreen ? "Exit" : "Fullscreen"}
    </button>

    {#if onClear}
      <button
        type="button"
        disabled={!hasArtifact}
        class="canvas-toolbar__button"
        onclick={onClear}
      >
        Clear
      </button>
    {/if}
  </div>
</header>

<style>
  .canvas-toolbar {
    display: flex;
    flex-wrap: wrap;
    min-height: 3.25rem;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--sonik-border-color);
    background: color-mix(in oklab, var(--card) 95%, transparent);
    padding: 0.5rem 0.75rem;
    backdrop-filter: blur(10px);
  }

  .canvas-toolbar--draggable {
    cursor: move;
    touch-action: none;
  }

  .canvas-toolbar__move-handle {
    border: 1px dashed var(--sonik-border-color);
    border-radius: 0.375rem;
    background: transparent;
    padding: 0.125rem 0.5rem;
    color: var(--muted-foreground);
    font-size: 0.6875rem;
    cursor: move;
  }

  .canvas-toolbar__move-handle:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 1px;
  }

  .canvas-toolbar__title {
    min-width: 10rem;
    flex: 1 1 12rem;
  }

  .canvas-toolbar__eyebrow-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .canvas-toolbar__eyebrow {
    border: 1px solid var(--sonik-border-color);
    border-radius: 0.375rem;
    background: var(--background);
    padding: 0.125rem 0.5rem;
    color: var(--muted-foreground);
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .canvas-toolbar__streaming,
  .canvas-toolbar__subtitle {
    color: var(--muted-foreground);
    font-size: 0.75rem;
  }

  .canvas-toolbar__heading {
    margin-top: 0.25rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--foreground);
    font-size: 0.875rem;
    font-weight: 700;
  }

  .canvas-toolbar__subtitle {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .canvas-toolbar__actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    gap: 0.25rem;
  }

  .canvas-toolbar__version {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    color: var(--muted-foreground);
    font-size: 0.75rem;
    font-weight: 600;
  }

  .canvas-toolbar__version select {
    border: 1px solid var(--sonik-border-color);
    border-radius: 0.5rem;
    background: var(--background);
    padding: 0.35rem 0.55rem;
    color: var(--foreground);
    font: inherit;
  }

  .canvas-toolbar__panel-tabs {
    display: flex;
    border: 1px solid var(--sonik-border-color);
    border-radius: 0.5rem;
    background: var(--background);
    padding: 0.125rem;
  }

  .canvas-toolbar__panel-tabs button,
  .canvas-toolbar__button {
    border-radius: 0.375rem;
    padding: 0.375rem 0.55rem;
    color: var(--muted-foreground);
    font-size: 0.75rem;
    cursor: pointer;
    transition: color 120ms ease, background 120ms ease, opacity 120ms ease;
  }

  .canvas-toolbar__panel-tabs button:hover,
  .canvas-toolbar__button:hover,
  .canvas-toolbar__panel-tabs button.active {
    background: var(--accent);
    color: var(--foreground);
  }

  .canvas-toolbar__panel-tabs button:disabled,
  .canvas-toolbar__button:disabled {
    cursor: not-allowed;
    opacity: 0.42;
  }

  .canvas-toolbar__button {
    border: 1px solid var(--sonik-border-color);
    background: var(--background);
  }
</style>

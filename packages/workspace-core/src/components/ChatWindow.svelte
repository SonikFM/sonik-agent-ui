<script lang="ts" module>
  import type { Snippet } from "svelte";
  import type { ResizeEdge } from "../lib/window-geometry.js";

  export interface ChatWindowProps {
    children: Snippet;
    title?: string;
    /** Pointer-drag reposition + edge/corner resize for the standalone chat window. Off in embedded host contexts (the host owns window chrome there), matching CanvasViewport's windowControlsEnabled gate. */
    windowControlsEnabled?: boolean;
  }

  const RESIZE_EDGES: ResizeEdge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
</script>

<script lang="ts">
  import { fly } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { createCanvasWindowController } from "../lib/window-drag.svelte.js";

  // "Pops up from the bottom" open transition (Dan's Linear-style spec) -- same
  // reduced-motion-aware svelte/transition approach as CanvasViewport's mount
  // transition, just entering from below instead of from above.
  const prefersReducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const mountTransition = { y: 48, duration: prefersReducedMotion ? 0 : 240, easing: cubicOut };

  let { children, title = "Chat", windowControlsEnabled = true }: ChatWindowProps = $props();

  // Reuses the exact same floating-window controller as CanvasViewport (Slice 016),
  // just with a chat-sized default and a bottom-left resting spot instead of the
  // canvas's top-left one -- "pops up from the bottom" per Dan's spec.
  const windowController = createCanvasWindowController({
    storageKey: "sonik-agent-ui:chat-window:v1",
    defaultSize: { width: 420, height: 600 },
    defaultPosition: { xPct: 3, yPct: 55 },
  });
  const isFloating = $derived(windowControlsEnabled && !windowController.docked);

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (!isFloating || event.key !== "Escape") return;
    event.preventDefault();
    windowController.dock();
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<section
  class="chat-window"
  class:chat-window--floating={isFloating}
  style={isFloating ? windowController.style : undefined}
  aria-label={`${title} window`}
  in:fly={mountTransition}
>
  {#if windowControlsEnabled}
    <div
      class="chat-window__grip"
      class:chat-window__grip--floating={isFloating}
      role="group"
      aria-label="Chat window controls. Drag the utility strip to move, or double-click it to reset."
      onpointerdown={windowController.onDragPointerDown}
      onpointermove={windowController.onDragPointerMove}
      onpointerup={windowController.onDragPointerUp}
      onpointercancel={windowController.onDragPointerUp}
      ondblclick={windowController.reset}
    >
      <span class="chat-window__drag-region" aria-hidden="true">Drag</span>
      <div class="chat-window__grip-actions">
        <button
          type="button"
          class="chat-window__move-handle"
          onkeydown={windowController.onDragKeyDown}
          aria-label="Move chat window. Focus this control, then use arrow keys to reposition it. Press Escape to dock, or double-click the utility strip to reset."
        >
          Move
        </button>
        <button
          type="button"
          class="chat-window__reset"
          onclick={windowController.reset}
          aria-label="Reset the chat window to its default position and size"
        >
          Reset layout
        </button>
      </div>
    </div>

    {#each RESIZE_EDGES as edge (edge)}
      <div
        class="chat-window__resize-handle chat-window__resize-handle--{edge}"
        onpointerdown={windowController.onResizePointerDown(edge)}
        onpointermove={windowController.onResizePointerMove}
        onpointerup={windowController.onResizePointerUp}
        onpointercancel={windowController.onResizePointerUp}
        aria-hidden="true"
      ></div>
    {/each}
  {/if}

  <div class="chat-window__body">
    {@render children()}
  </div>
</section>

<style>
  .chat-window {
    position: relative;
    display: flex;
    height: 100%;
    min-height: 0;
    flex-direction: column;
    overflow: hidden;
  }

  .chat-window--floating {
    position: fixed;
    z-index: 850;
    height: auto;
    border: 1px solid var(--sonik-border-color);
    border-radius: 0.75rem;
    background: var(--card);
    box-shadow: 0 12px 32px color-mix(in oklab, var(--foreground) 22%, transparent);
    overflow: visible;
  }

  .chat-window__grip {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: flex-end;
    gap: 0.5rem;
    border-bottom: 1px solid var(--sonik-border-color);
    background: color-mix(in oklab, var(--card) 95%, transparent);
    padding: 0.3rem 0.75rem;
    cursor: move;
    touch-action: none;
  }

  .chat-window__grip--floating {
    position: absolute;
    right: 0.5rem;
    bottom: calc(100% + 0.375rem);
    z-index: 6;
    border: 1px solid var(--sonik-border-color);
    border-radius: 0.625rem;
    background: var(--card);
    padding: 0.25rem;
    box-shadow: var(--app-card-shadow-elevated);
  }

  .chat-window__grip-actions {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }

  .chat-window__drag-region {
    padding: 0.125rem 0.25rem;
    color: var(--muted-foreground);
    font-size: 0.6875rem;
    font-weight: 600;
  }

  .chat-window__move-handle,
  .chat-window__reset {
    border: 1px dashed var(--sonik-border-color);
    border-radius: 0.375rem;
    background: transparent;
    padding: 0.125rem 0.5rem;
    color: var(--muted-foreground);
    font-size: 0.6875rem;
    cursor: pointer;
  }

  .chat-window__reset {
    border-style: solid;
  }

  .chat-window__move-handle {
    cursor: move;
  }

  .chat-window__move-handle:focus-visible,
  .chat-window__reset:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 1px;
  }

  .chat-window__resize-handle {
    position: absolute;
    z-index: 5;
    touch-action: none;
  }

  .chat-window__resize-handle--n,
  .chat-window__resize-handle--s {
    left: 0.75rem;
    right: 0.75rem;
    height: 8px;
    cursor: ns-resize;
  }

  .chat-window__resize-handle--n {
    top: -4px;
  }

  .chat-window__resize-handle--s {
    bottom: -4px;
  }

  .chat-window__resize-handle--e,
  .chat-window__resize-handle--w {
    top: 0.75rem;
    bottom: 0.75rem;
    width: 8px;
    cursor: ew-resize;
  }

  .chat-window__resize-handle--e {
    right: -4px;
  }

  .chat-window__resize-handle--w {
    left: -4px;
  }

  .chat-window__resize-handle--ne,
  .chat-window__resize-handle--nw,
  .chat-window__resize-handle--se,
  .chat-window__resize-handle--sw {
    width: 14px;
    height: 14px;
  }

  .chat-window__resize-handle--ne {
    top: -4px;
    right: -4px;
    cursor: nesw-resize;
  }

  .chat-window__resize-handle--nw {
    top: -4px;
    left: -4px;
    cursor: nwse-resize;
  }

  .chat-window__resize-handle--se {
    bottom: -4px;
    right: -4px;
    cursor: nwse-resize;
  }

  .chat-window__resize-handle--sw {
    bottom: -4px;
    left: -4px;
    cursor: nesw-resize;
  }

  .chat-window__body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .chat-window--floating .chat-window__body {
    overflow: hidden;
    border-radius: inherit;
  }
</style>

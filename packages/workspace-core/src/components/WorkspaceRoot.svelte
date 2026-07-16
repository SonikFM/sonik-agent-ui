<script lang="ts">
  import type { Snippet } from "svelte";
  import type { AgentEmbedMode, AgentEmbedRailMode } from "@sonik-agent-ui/agent-embed";

  export type WorkspaceLayoutMode = AgentEmbedMode;
  export type WorkspaceRailMode = AgentEmbedRailMode;

  interface Props {
    chat: Snippet;
    artifact: Snippet;
    rail?: Snippet;
    title?: string;
    artifactOpen?: boolean;
    layoutMode?: WorkspaceLayoutMode;
    railMode?: WorkspaceRailMode;
    chatArtifactSplit?: string;
    /** Canvas-layout variant of chatArtifactSplit (feeds --workspace-canvas-pane-split). */
    canvasChatArtifactSplit?: string;
    /** Mounts the drag divider between the panes. Receives the chat pane's
     *  fraction of the grid width (clamped 0.25..0.75); the parent converts it
     *  to a grid template and persists it per layout mode. */
    onSplitChange?: (chatFraction: number) => void;
    /** Double-click / Escape on the divider — parent clears the stored split. */
    onSplitReset?: () => void;
  }

  let {
    chat,
    artifact,
    rail,
    title = "Agent workspace",
    artifactOpen = true,
    layoutMode = "workspace",
    railMode = "expanded",
    chatArtifactSplit,
    canvasChatArtifactSplit,
    onSplitChange,
    onSplitReset,
  }: Props = $props();

  const railVisible = $derived(Boolean(rail) && railMode !== "hidden");
  const splitStyle = $derived(
    [
      chatArtifactSplit ? `--workspace-pane-split: ${chatArtifactSplit};` : "",
      canvasChatArtifactSplit ? `--workspace-canvas-pane-split: ${canvasChatArtifactSplit};` : "",
    ].join("") || undefined,
  );

  let gridElement: HTMLDivElement | null = $state(null);
  let resizing = $state(false);
  // Snap-back animation is scoped to explicit resets only: a blanket
  // grid-template-columns transition also animated the artifact pane OPENING,
  // shifting the transcript's scroll geometry mid-stream (CI-reproducible
  // stream-follows-bottom failure).
  let resetting = $state(false);
  let resetTimer = 0;
  let resizeFrame = 0;

  function animateSplitReset(): void {
    if (!onSplitReset) return;
    resetting = true;
    window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      resetting = false;
    }, 220);
    onSplitReset();
  }

  const SPLIT_MIN = 0.25;
  const SPLIT_MAX = 0.75;

  function emitSplitFromClientX(clientX: number): void {
    if (!gridElement || !onSplitChange) return;
    const rect = gridElement.getBoundingClientRect();
    if (rect.width <= 0) return;
    const fraction = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, (clientX - rect.left) / rect.width));
    onSplitChange(fraction);
  }

  function startSplitDrag(event: PointerEvent): void {
    if (!onSplitChange) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    resizing = true;
    const move = (moveEvent: PointerEvent) => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => emitSplitFromClientX(moveEvent.clientX));
    };
    const end = () => {
      cancelAnimationFrame(resizeFrame);
      resizing = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
    window.addEventListener("pointercancel", end, { once: true });
  }

  function handleSplitKeydown(event: KeyboardEvent): void {
    if (!gridElement || !onSplitChange) return;
    if (event.key === "Escape") {
      animateSplitReset();
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const rect = gridElement.getBoundingClientRect();
    const chatRect = gridElement.querySelector(".workspace-pane--chat")?.getBoundingClientRect();
    const current = chatRect && rect.width > 0 ? chatRect.width / rect.width : 0.5;
    const next = current + (event.key === "ArrowRight" ? 0.02 : -0.02);
    onSplitChange(Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, next)));
  }
</script>

<div
  class="workspace-root"
  data-artifact-open={artifactOpen}
  data-has-rail={railVisible}
  data-layout-mode={layoutMode}
  data-rail-mode={railMode}
>
  {#if railVisible && rail}
    <aside class="workspace-rail" class:workspace-rail--collapsed={railMode === "collapsed"} aria-label={`${title} session rail`}>
      {@render rail()}
    </aside>
  {/if}

  <div
    bind:this={gridElement}
    class="workspace-grid"
    class:workspace-grid--artifact-open={artifactOpen}
    class:workspace-grid--resetting={resetting}
    data-resizing={resizing}
    style={splitStyle}
  >
    <section class="workspace-pane workspace-pane--chat" aria-label={`${title} chat pane`}>
      {@render chat()}
    </section>

    {#if artifactOpen}
      {#if onSplitChange}
        <!-- Overlays the grid gap at the artifact pane's left edge; no extra
             grid column, so the split templates stay two-column. Drag tracks
             1:1; the snap-back on reset animates via the grid transition.
             WAI-ARIA "window splitter": a focusable role="separator" with
             keyboard support IS the spec-correct widget — Svelte's a11y
             lint doesn't model that pattern, hence the targeted ignores. -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div
          class="workspace-pane-divider"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize chat and canvas panes. Arrow keys adjust; Escape or double-click resets."
          tabindex="0"
          onpointerdown={startSplitDrag}
          ondblclick={animateSplitReset}
          onkeydown={handleSplitKeydown}
        ></div>
      {/if}
      <aside class="workspace-pane workspace-pane--artifact" aria-label={`${title} artifact pane`}>
        {@render artifact()}
      </aside>
    {/if}
  </div>
</div>

<style>
  .workspace-root {
    height: 100vh;
    min-height: 0;
    overflow: hidden;
    background: var(--app-shell-bg, var(--background));
    color: var(--foreground);
  }

  .workspace-root[data-has-rail="true"] {
    display: grid;
    grid-template-columns: var(--workspace-rail-width, minmax(230px, 16.75rem)) minmax(0, 1fr);
  }

  .workspace-root[data-rail-mode="collapsed"] {
    --workspace-rail-width: 4rem;
  }

  .workspace-rail {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    border-right: 1px solid var(--sonik-border-color);
    background: var(--app-rail-bg, var(--card));
  }

  .workspace-rail--collapsed {
    min-width: 0;
  }

  .workspace-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: "chat";
    gap: 0.5rem;
    height: 100%;
    min-height: 0;
    padding: 0.5rem;
  }

  .workspace-grid--artifact-open {
    grid-template-areas: "chat" "artifact";
  }

  .workspace-pane {
    min-height: 0;
    overflow: hidden;
    border: 1px solid var(--sonik-border-color);
    background: var(--app-panel-bg, var(--card));
  }

  .workspace-pane--chat {
    grid-area: chat;
    border-radius: 0.75rem;
  }

  .workspace-pane--artifact {
    grid-area: artifact;
    border-radius: 0.75rem;
  }

  /* Divider rides the artifact pane's grid area and shifts left into the gap —
     no third grid column, so the split templates stay two-column. Hidden below
     1024px where the panes stack vertically. */
  .workspace-pane-divider {
    display: none;
    grid-area: artifact;
    justify-self: start;
    align-self: stretch;
    width: 0.75rem;
    transform: translateX(-0.5rem);
    cursor: col-resize;
    touch-action: none;
    z-index: 2;
    border-radius: 0.375rem;
  }

  .workspace-pane-divider::after {
    content: "";
    display: block;
    width: 2px;
    height: 100%;
    margin-left: 0.1875rem;
    border-radius: 1px;
    background: var(--sonik-border-color);
    transition: background 120ms ease-out;
  }

  .workspace-pane-divider:hover::after,
  .workspace-pane-divider:focus-visible::after {
    background: var(--muted-foreground, var(--foreground));
  }

  .workspace-pane-divider:focus-visible {
    outline: 2px solid var(--ring, var(--foreground));
    outline-offset: -2px;
  }

  /* Snap-back animates ONLY during an explicit reset (double-click/Escape);
     live drags track 1:1, and layout changes like the artifact pane opening
     must never animate — a blanket transition shifted the transcript's scroll
     geometry mid-stream. */
  .workspace-grid--resetting {
    transition: grid-template-columns 180ms ease-out;
  }

  @media (prefers-reduced-motion: reduce) {
    .workspace-grid--resetting {
      transition: none;
    }
  }

  /* Narrow canvas keeps artifact-first stacking, but the chat area must stay a
     usable conversation pane, not a composer-only sliver (2026-07-13 live
     report: "when I switch to canvas I can't see my chat"). */
  .workspace-root[data-layout-mode="canvas"] .workspace-grid--artifact-open {
    grid-template-areas: "artifact" "chat";
    grid-template-rows: minmax(0, 1.4fr) minmax(14rem, 1fr);
  }

  /* The conversation header stays visible in embedded canvas: it now carries
     the chat-history switcher, and the chat pane is a full column beside the
     artifact (2026-07-13 live report: "chat history no longer shows on the
     canvas"). The old hide rule dated from the compact-strip era. */

  @media (max-width: 820px) {
    .workspace-root[data-has-rail="true"] {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto minmax(0, 1fr);
    }

    .workspace-rail {
      max-height: 12rem;
      border-right: 0;
      border-bottom: 1px solid var(--sonik-border-color);
    }
  }

  @media (min-width: 1024px) {
    .workspace-grid--artifact-open {
      grid-template-areas: "chat artifact";
      grid-template-columns: var(
        --workspace-pane-split,
        minmax(360px, 0.92fr) minmax(420px, 1.08fr)
      );
    }

    /* Wide canvas: conversation rides beside the artifact instead of being
       squeezed into a bottom strip — switching to canvas must never hide the
       chat (2026-07-13 live report). Artifact keeps the majority share;
       the drag divider overrides via --workspace-canvas-pane-split. */
    .workspace-root[data-layout-mode="canvas"] .workspace-grid--artifact-open {
      grid-template-areas: "chat artifact";
      grid-template-rows: minmax(0, 1fr);
      grid-template-columns: var(
        --workspace-canvas-pane-split,
        minmax(320px, 0.62fr) minmax(480px, 1.38fr)
      );
    }

    .workspace-pane-divider {
      display: block;
    }

    .workspace-grid--artifact-open .workspace-pane--chat :global([role="log"] > .overflow-auto) {
      margin-inline-end: 0.5rem;
    }
  }
</style>

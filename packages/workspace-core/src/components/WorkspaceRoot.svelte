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
  }: Props = $props();

  const railVisible = $derived(Boolean(rail) && railMode !== "hidden");
  const splitStyle = $derived(chatArtifactSplit ? `--workspace-pane-split: ${chatArtifactSplit};` : undefined);
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

  <div class="workspace-grid" class:workspace-grid--artifact-open={artifactOpen} style={splitStyle}>
    <section class="workspace-pane workspace-pane--chat" aria-label={`${title} chat pane`}>
      {@render chat()}
    </section>

    {#if artifactOpen}
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

  /* Narrow canvas keeps artifact-first stacking, but the chat area must stay a
     usable conversation pane, not a composer-only sliver (2026-07-13 live
     report: "when I switch to canvas I can't see my chat"). */
  .workspace-root[data-layout-mode="canvas"] .workspace-grid--artifact-open {
    grid-template-areas: "artifact" "chat";
    grid-template-rows: minmax(0, 1.4fr) minmax(14rem, 1fr);
  }

  .workspace-root[data-layout-mode="canvas"][data-rail-mode="hidden"]
    .workspace-pane--chat
    :global([role="log"] > header) {
    display: none;
  }

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
       chat (2026-07-13 live report). Artifact keeps the majority share. */
    .workspace-root[data-layout-mode="canvas"] .workspace-grid--artifact-open {
      grid-template-areas: "chat artifact";
      grid-template-rows: minmax(0, 1fr);
      grid-template-columns: minmax(320px, 0.62fr) minmax(480px, 1.38fr);
    }
  }
</style>

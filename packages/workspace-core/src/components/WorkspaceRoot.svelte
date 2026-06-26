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
    gap: 0.5rem;
    height: 100%;
    min-height: 0;
    padding: 0.5rem;
  }

  .workspace-pane {
    min-height: 0;
    overflow: hidden;
    border: 1px solid var(--sonik-border-color);
    background: var(--app-panel-bg, var(--card));
  }

  .workspace-pane--chat {
    border-radius: 0.75rem;
  }

  .workspace-pane--artifact {
    border-radius: 0.75rem;
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
      grid-template-columns: var(
        --workspace-pane-split,
        minmax(360px, 0.92fr) minmax(420px, 1.08fr)
      );
    }

    .workspace-root[data-layout-mode="canvas"] .workspace-grid--artifact-open {
      grid-template-columns: var(
        --workspace-pane-split,
        minmax(320px, 0.52fr) minmax(520px, 1.48fr)
      );
    }
  }
</style>

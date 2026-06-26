<script lang="ts">
  import type { Snippet } from "svelte";
  import type { Artifact } from "@sonik-agent-ui/artifact-model";

  interface Props {
    artifact: Artifact | null;
    loading?: boolean;
    pendingArtifactIntent?: string | null;
    children?: Snippet;
  }

  let { artifact, loading = false, pendingArtifactIntent = null, children }: Props = $props();
</script>

<section class="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
  <div class="flex items-center justify-between border-b border-border px-3 py-2">
    <div class="min-w-0">
      <p class="truncate text-sm font-medium">
        {artifact?.title ?? "Artifact workspace"}
      </p>
      {#if artifact}
        <p class="text-xs text-muted-foreground">
          {artifact.kind} · v{artifact.version}
        </p>
      {:else if pendingArtifactIntent}
        <p class="text-xs text-muted-foreground">Preparing artifact...</p>
      {:else}
        <p class="text-xs text-muted-foreground">No promoted artifact yet</p>
      {/if}
    </div>
    {#if loading}
      <span class="text-xs text-muted-foreground animate-shimmer">Streaming</span>
    {/if}
  </div>

  <div class="min-h-0 flex-1 overflow-auto p-3">
    {#if artifact && children}
      {@render children()}
    {:else}
      <div class="flex h-full min-h-[220px] items-center justify-center rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        {#if pendingArtifactIntent}
          <div class="max-w-xl space-y-2">
            <p class="font-medium text-foreground">Artifact creation requested</p>
            <p>The agent is fetching data and generating the JSON-render spec for this canvas.</p>
            <p class="break-words text-xs">{pendingArtifactIntent}</p>
          </div>
        {:else}
          Ask the agent to create or update a canvas artifact. Temporary JSON-render responses can stay inline in chat without replacing this workspace.
        {/if}
      </div>
    {/if}
  </div>
</section>

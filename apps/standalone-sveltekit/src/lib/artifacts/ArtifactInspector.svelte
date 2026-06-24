<script lang="ts">
  import type { JsonRenderArtifact } from "@sonik-agent-ui/artifact-model";
  import type { ArtifactObservationEvent, ArtifactStatus } from "./artifact-observability";

  interface Props {
    artifact: JsonRenderArtifact;
    status: ArtifactStatus | null;
    rawSpec: string;
    events?: readonly ArtifactObservationEvent[];
  }

  let { artifact, status, rawSpec, events = [] }: Props = $props();
  let copyState = $state<"idle" | "copied" | "failed">("idle");

  const visibleEvents = $derived(events.slice(0, 5));

  async function copyRawSpec() {
    try {
      await navigator.clipboard.writeText(rawSpec);
      copyState = "copied";
    } catch {
      copyState = "failed";
    }
  }
</script>

<div class="mb-3 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div>
      <p class="font-medium text-foreground">Promoted workspace artifact</p>
      <p class="font-mono">{artifact.id}</p>
    </div>
    <div class="flex flex-wrap gap-2">
      <span class="rounded-full border border-border px-2 py-1">v{artifact.version}</span>
      <span class="rounded-full border border-border px-2 py-1">{status?.promotionReason ?? "unknown"}</span>
    </div>
  </div>

  {#if status?.sourcePrompt}
    <p class="mt-2 break-words">
      <span class="font-medium text-foreground">Source prompt:</span>
      {status.sourcePrompt}
    </p>
  {/if}

  <div class="mt-3 grid gap-2 md:grid-cols-2">
    <p>
      <span class="font-medium text-foreground">Assistant message:</span>
      <span class="font-mono">{status?.sourceMessageId ?? "unknown"}</span>
    </p>
    <p>
      <span class="font-medium text-foreground">User message:</span>
      <span class="font-mono">{status?.sourceUserMessageId ?? "unknown"}</span>
    </p>
    <p>
      <span class="font-medium text-foreground">Updated:</span>
      {status?.updatedAt ?? artifact.updatedAt}
    </p>
  </div>

  <details class="mt-3 rounded-md border border-border bg-background/70 p-2">
    <summary class="cursor-pointer font-medium text-foreground">View raw JSON-render spec</summary>
    <div class="mt-2 flex items-center justify-between gap-2">
      <p class="text-muted-foreground">This is the active JSON-render artifact payload. In cloud mode it is synced through the workspace persistence adapter.</p>
      <button
        type="button"
        class="rounded-md border border-border px-2 py-1 text-foreground hover:bg-muted"
        onclick={copyRawSpec}
      >
        {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy JSON"}
      </button>
    </div>
    <pre class="mt-2 max-h-56 overflow-auto rounded bg-background p-2 text-[11px] leading-relaxed text-foreground">{rawSpec}</pre>
  </details>

  {#if visibleEvents.length > 0}
    <details class="mt-2 rounded-md border border-border bg-background/70 p-2">
      <summary class="cursor-pointer font-medium text-foreground">Recent artifact events</summary>
      <ol class="mt-2 space-y-2">
        {#each visibleEvents as event (event.id)}
          <li class="rounded border border-border p-2">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="font-medium text-foreground">{event.type}</span>
              <span>{event.promotionReason}</span>
            </div>
            <p class="font-mono">#{event.observationIndex} · {event.artifactId ?? "inline-only"}{event.artifactVersion ? ` · v${event.artifactVersion}` : ""}</p>
            <p class="font-mono">assistant: {event.sourceMessageId}</p>
            <p class="font-mono">user: {event.sourceUserMessageId ?? "unknown"}</p>
          </li>
        {/each}
      </ol>
    </details>
  {/if}
</div>

<script lang="ts">
  import type { BaseComponentProps } from "@json-render/svelte";

  interface Props extends BaseComponentProps<{
    title?: string | null;
    manifest?: unknown;
    emptyMessage?: string | null;
  }> {}

  let { props }: Props = $props();
  const rendered = $derived(props.manifest === undefined || props.manifest === null ? "" : JSON.stringify(props.manifest, null, 2));
</script>

<div class="rounded-xl border bg-card p-4 shadow-sm">
  {#if props.title}
    <p class="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{props.title}</p>
  {/if}
  {#if rendered}
    <pre class="max-h-96 overflow-auto rounded-lg bg-muted p-4 text-xs leading-relaxed"><code>{rendered}</code></pre>
  {:else}
    <p class="text-sm text-muted-foreground">{props.emptyMessage ?? "No manifest preview yet."}</p>
  {/if}
</div>

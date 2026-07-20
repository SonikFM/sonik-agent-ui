<script lang="ts">
  import type { BaseComponentProps } from "@json-render/svelte";
  import { Info, Lightbulb, AlertTriangle, Star } from "lucide-svelte";

  interface Props extends BaseComponentProps<{
    type?: "info" | "tip" | "warning" | "important" | null;
    title?: string | null;
    content: string;
  }> {}

  let { props }: Props = $props();

  const configs = {
    info: {
      border: "border-l-info",
      bg: "bg-info/10",
      iconColor: "text-info",
    },
    tip: {
      border: "border-l-success",
      bg: "bg-success/10",
      iconColor: "text-success",
    },
    warning: {
      border: "border-l-warning",
      bg: "bg-warning/10",
      iconColor: "text-warning",
    },
    important: {
      border: "border-l-secondary",
      bg: "bg-secondary/10",
      iconColor: "text-secondary",
    },
  };

  const config = $derived(configs[props.type ?? "info"] ?? configs.info);
</script>

<div role="note" class="border-l-4 {config.border} {config.bg} rounded-r-lg p-4">
  <div class="flex items-start gap-3">
    {#if props.type === "tip"}
      <Lightbulb class="h-5 w-5 mt-0.5 shrink-0 {config.iconColor}" />
    {:else if props.type === "warning"}
      <AlertTriangle class="h-5 w-5 mt-0.5 shrink-0 {config.iconColor}" />
    {:else if props.type === "important"}
      <Star class="h-5 w-5 mt-0.5 shrink-0 {config.iconColor}" />
    {:else}
      <Info class="h-5 w-5 mt-0.5 shrink-0 {config.iconColor}" />
    {/if}
    <div class="flex-1 min-w-0">
      {#if props.title}
        <p class="font-semibold text-sm mb-1">{props.title}</p>
      {/if}
      <p class="text-sm text-muted-foreground">{props.content}</p>
    </div>
  </div>
</div>

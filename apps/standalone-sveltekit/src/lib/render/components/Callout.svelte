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
      surface: "alert-info",
      iconColor: "text-info-content",
    },
    tip: {
      surface: "alert-success",
      iconColor: "text-success-content",
    },
    warning: {
      surface: "alert-warning",
      iconColor: "text-warning-content",
    },
    important: {
      surface: "border-primary bg-primary/10",
      iconColor: "text-primary",
    },
  };

  const config = $derived(configs[props.type ?? "info"] ?? configs.info);
</script>

<div role="note" class="alert border {config.surface} rounded-lg p-4">
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
      <p class="text-sm opacity-80">{props.content}</p>
    </div>
  </div>
</div>

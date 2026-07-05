<script lang="ts" module>
  import type { ToolInfo } from "../message-parts.js";
  import { resolveToolActivity, type ToolActivityLabelOverrides } from "../tool-activity.js";

  export interface ToolCallBlockProps {
    tool: ToolInfo;
    labels?: ToolActivityLabelOverrides;
  }
</script>

<script lang="ts">
  let { tool, labels = {} }: ToolCallBlockProps = $props();

  const activity = $derived(resolveToolActivity(tool.toolName, tool.state, labels));
  const isLoading = $derived(activity.isLoading);
  const isError = $derived(activity.isError);
  const label = $derived(activity.label);
  const title = $derived(tool.errorText ? `${activity.technicalLabel}: ${tool.errorText}` : activity.technicalLabel);
</script>

<div class="text-sm group">
  <span
    class:text-muted-foreground={!isError}
    class:text-error={isError}
    class:animate-shimmer={isLoading}
    title={title}
    data-tool-phase={activity.phase}
  >
    {label}
  </span>
</div>

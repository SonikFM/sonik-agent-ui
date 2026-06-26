<script lang="ts" module>
  import type { ToolInfo } from "../message-parts.js";

  export interface ToolCallBlockProps {
    tool: ToolInfo;
    labels?: Record<string, [string, string]>;
  }
</script>

<script lang="ts">
  let { tool, labels = {} }: ToolCallBlockProps = $props();

  const isLoading = $derived(
    tool.state !== "output-available" &&
      tool.state !== "output-error" &&
      tool.state !== "output-denied",
  );
  const isError = $derived(tool.state === "output-error" || tool.state === "output-denied");
  const label = $derived.by(() => {
    const known = labels[tool.toolName];
    if (isError) {
      const base = known?.[0] ?? tool.toolName;
      return `${base.replace(/ing\b/i, "").trim()} failed`;
    }
    if (!known) return tool.toolName;
    return isLoading ? known[0] : known[1];
  });
</script>

<div class="text-sm group">
  <span
    class:text-muted-foreground={!isError}
    class:text-error={isError}
    class:animate-shimmer={isLoading}
    title={tool.errorText}
  >
    {label}
  </span>
</div>

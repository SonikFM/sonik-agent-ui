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
  const stateLabel = $derived(tool.state ?? "unknown");

  const commitSuccess = $derived.by(() => {
    const output = tool.output as { kind?: string; ok?: boolean; command?: { input?: { name?: unknown } } } | null | undefined;
    if (!output || output.kind !== "intake-command-commit" || output.ok !== true) return null;
    const name = typeof output.command?.input?.name === "string" && output.command.input.name.trim() ? output.command.input.name.trim() : null;
    return { name };
  });
</script>

{#if commitSuccess}
  <p
    class="mt-1 flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-medium text-primary"
    role="status"
    data-commit-receipt="success"
  >
    <span aria-hidden="true">✓</span>
    {commitSuccess.name ? `“${commitSuccess.name}” was created.` : "Setup created."}
    <span class="font-normal text-primary/80">Approved by your workspace and saved.</span>
  </p>
{/if}

<details
  class="tool-call-block group rounded-lg border border-transparent text-sm open:border-border open:bg-muted/30 open:px-3 open:py-2"
  data-tool-phase={activity.phase}
  data-tool-state={stateLabel}
>
  <summary
    class="flex cursor-pointer list-none items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
  >
    <span
      class="h-1.5 w-1.5 rounded-full bg-current opacity-70"
      class:animate-pulse={isLoading}
      class:text-error={isError}
      aria-hidden="true"
    ></span>
    <span
      class:text-muted-foreground={!isError}
      class:text-error={isError}
      class:animate-shimmer={isLoading}
    >
      {label}
    </span>
    <span class="ml-auto hidden text-[11px] uppercase tracking-[0.12em] text-muted-foreground/70 group-open:inline">Receipt</span>
  </summary>

  <dl class="mt-2 grid gap-1 border-t border-border pt-2 text-xs text-muted-foreground" aria-label="Technical tool receipt">
    <div class="grid grid-cols-[6rem_minmax(0,1fr)] gap-2">
      <dt>Tool</dt>
      <dd class="break-all font-mono">{activity.technicalLabel}</dd>
    </div>
    <div class="grid grid-cols-[6rem_minmax(0,1fr)] gap-2">
      <dt>Phase</dt>
      <dd>{activity.phase}</dd>
    </div>
    <div class="grid grid-cols-[6rem_minmax(0,1fr)] gap-2">
      <dt>State</dt>
      <dd>{stateLabel}</dd>
    </div>
    {#if tool.toolCallId}
      <div class="grid grid-cols-[6rem_minmax(0,1fr)] gap-2">
        <dt>Call id</dt>
        <dd class="break-all font-mono">{tool.toolCallId}</dd>
      </div>
    {/if}
    {#if tool.errorText}
      <div class="grid grid-cols-[6rem_minmax(0,1fr)] gap-2 text-error">
        <dt>Error</dt>
        <dd>{tool.errorText}</dd>
      </div>
    {/if}
  </dl>
</details>

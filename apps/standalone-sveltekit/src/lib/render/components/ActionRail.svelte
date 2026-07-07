<script lang="ts">
  import type { BaseComponentProps } from "@json-render/svelte";
  import { Badge } from "$lib/components/ui/badge";

  type ActionItem = {
    id: string;
    label: string;
    description?: string | null;
    status?: "ready" | "blocked" | "preview" | "requires_confirmation" | null;
    commandId?: string | null;
    effect?: string | null;
    approval?: string | null;
  };

  type ActionReceipt = {
    actionName?: string | null;
    ok?: boolean | null;
    status?: string | null;
    message?: string | null;
    commandId?: string | null;
    updatedAt?: string | null;
    hostAction?: { actionKey?: string | null; status?: string | null; policyMode?: string | null; targetId?: string | null } | null;
  };

  interface Props extends BaseComponentProps<{
    title?: string | null;
    actions?: ActionItem[] | null;
    emptyMessage?: string | null;
    lastReceipt?: ActionReceipt | null;
  }> {}

  let { props }: Props = $props();
  const actions = $derived(props.actions ?? []);
  const lastReceipt = $derived(props.lastReceipt ?? null);
  const receiptTone = $derived(lastReceipt?.ok ? "success" : lastReceipt ? "error" : "neutral");
</script>

<aside class="rounded-xl border bg-card p-4 shadow-sm">
  <p class="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{props.title ?? "Action preview"}</p>
  {#if lastReceipt}
    <div
      class={`mb-3 rounded-lg border px-3 py-2 text-xs ${receiptTone === "success" ? "border-primary bg-primary/10" : receiptTone === "error" ? "border-destructive bg-destructive/10" : "border-border bg-muted/20"}`}
      data-action-receipt
      data-action-receipt-ok={lastReceipt.ok ? "true" : "false"}
      data-action-receipt-action={lastReceipt.actionName ?? "unknown"}
    >
      <div class="flex flex-wrap items-center gap-2">
        <span class="font-semibold">{lastReceipt.ok ? "Done" : "Needs attention"}</span>
        {#if lastReceipt.status}<Badge variant={lastReceipt.ok ? "secondary" : "destructive"}>{lastReceipt.status}</Badge>{/if}
        {#if lastReceipt.commandId}<span class="font-mono text-muted-foreground">{lastReceipt.commandId}</span>{/if}
      </div>
      {#if lastReceipt.message}<p class="mt-1 text-muted-foreground">{lastReceipt.message}</p>{/if}
      {#if lastReceipt.hostAction?.actionKey}
        <p class="mt-1 font-mono text-[11px] text-muted-foreground">{lastReceipt.hostAction.actionKey}{lastReceipt.hostAction.targetId ? ` → ${lastReceipt.hostAction.targetId}` : ""}</p>
      {/if}
    </div>
  {/if}

  {#if actions.length === 0}
    <p class="text-sm text-muted-foreground">{props.emptyMessage ?? "No actions are ready."}</p>
  {:else}
    <div class="flex flex-col gap-2">
      {#each actions as action}
        <div class="rounded-lg border bg-background p-3">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-sm font-medium">{action.label}</p>
              {#if action.description}<p class="text-xs text-muted-foreground">{action.description}</p>{/if}
              {#if action.commandId}<p class="mt-1 font-mono text-[11px] text-muted-foreground">{action.commandId}</p>{/if}
              <div class="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                {#if action.effect}<span class="rounded bg-muted px-1.5 py-0.5">{action.effect}</span>{/if}
                {#if action.approval}<span class="rounded bg-muted px-1.5 py-0.5">approval: {action.approval}</span>{/if}
              </div>
            </div>
            <Badge variant={action.status === "blocked" ? "destructive" : "secondary"}>{action.status ?? "preview"}</Badge>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</aside>

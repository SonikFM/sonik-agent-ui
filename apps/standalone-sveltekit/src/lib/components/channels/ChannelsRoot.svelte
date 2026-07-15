<script lang="ts">
  import type { AgentUiChannelsStateSnapshot } from "@sonik-agent-ui/agent-observability";
  import { Button } from "$lib/components/ui/button";
  import * as Card from "$lib/components/ui/card";

  export interface FixtureTriggerBindingDraft {
    channelId: string;
    event: string;
    workflowId: string;
    sourcePath: string;
    targetPath: string;
  }

  interface Props {
    projection: AgentUiChannelsStateSnapshot;
    saveDisabledReason?: string;
    onSave: (draft: FixtureTriggerBindingDraft) => Promise<unknown> | unknown;
    onExit?: () => void;
  }

  let { projection, saveDisabledReason, onSave, onExit }: Props = $props();

  const workflowIds = $derived([...new Set(projection.triggerBindings.map((binding) => binding.workflowId))]);
  const preferredChannelId = $derived(
    projection.channels.find((channel) => channel.provisioningState === "connected")?.channelId
      ?? projection.channels[0]?.channelId
      ?? "",
  );
  let channelId = $state("");
  let event = $state("message.received");
  let workflowId = $state("");
  let sourcePath = $state("/event/message");
  let targetPath = $state("/input/request");

  $effect(() => {
    if (!projection.channels.some((channel) => channel.channelId === channelId)) {
      channelId = preferredChannelId;
    }
    if (!workflowIds.includes(workflowId)) {
      workflowId = workflowIds[0] ?? "";
    }
  });

  function stateLabel(state: string): string {
    return state.charAt(0).toUpperCase() + state.slice(1);
  }

  function submitBinding(eventObject: SubmitEvent): void {
    eventObject.preventDefault();
    if (saveDisabledReason) return;
    void onSave({ channelId, event, workflowId, sourcePath, targetPath });
  }
</script>

<div class="flex h-full min-w-0 flex-col overflow-y-auto p-4 sm:p-6" data-agent-mode="channels">
  <div class="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-6">
    <header class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div class="min-w-0">
        <p class="text-sm font-medium text-muted-foreground">Fixture-only pre-work</p>
        <h1 class="text-2xl font-semibold tracking-tight">Channels</h1>
        <p class="mt-1 max-w-3xl text-sm text-muted-foreground">
          Review dormant WhatsApp and Slack channel states, then save a session-scoped fixture trigger binding. External integrations are not available yet.
        </p>
      </div>
      {#if onExit}
        <Button class="min-h-11 w-full shrink-0 sm:w-auto" variant="ghost" onclick={() => onExit?.()} aria-label="Return to the chat workspace">
          Back to chat
        </Button>
      {/if}
    </header>

    {#if projection.status === "loading" || projection.status === "idle"}
      <p class="text-sm text-muted-foreground" role="status" aria-live="polite">Loading session channel fixtures…</p>
    {/if}
    {#if projection.message && projection.status === "error"}
      <p class="text-sm text-destructive" role="alert">{projection.message}</p>
    {:else if projection.message}
      <p class="text-sm text-muted-foreground" role="status" aria-live="polite">{projection.message}</p>
    {/if}

    <section aria-labelledby="channel-fixtures-heading">
      <div class="mb-3">
        <h2 id="channel-fixtures-heading" class="text-lg font-semibold">Channel fixtures</h2>
        <p class="text-sm text-muted-foreground">All controls remain visibly unavailable until an external integration is deliberately designed and approved.</p>
      </div>
      <div class="grid min-w-0 gap-4 lg:grid-cols-2">
        {#each ["whatsapp", "slack"] as kind (kind)}
          <Card.Root class="min-w-0" data-channel-kind={kind}>
            <Card.Header>
              <Card.Title>{kind === "whatsapp" ? "WhatsApp" : "Slack"}</Card.Title>
              <Card.Description>Four honest fixture states; no external account or connection is created.</Card.Description>
            </Card.Header>
            <Card.Content class="grid min-w-0 gap-3">
              {#each projection.channels.filter((channel) => channel.kind === kind) as channel (channel.channelId)}
                <article
                  class="min-w-0 rounded-lg border border-border bg-background p-4"
                  data-channel-id={channel.channelId}
                  data-channel-status={channel.provisioningState}
                  data-channel-kind={channel.kind}
                >
                  <div class="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div class="min-w-0">
                      <h3 class="break-words font-medium">{channel.label}</h3>
                      <p class="text-sm font-medium" data-channel-state-text>{stateLabel(channel.provisioningState)}</p>
                      <p class="break-words text-sm text-muted-foreground">
                        {channel.identity?.displayName ?? channel.statusMessage ?? "No fixture identity is attached."}
                      </p>
                    </div>
                    <Button
                      class="min-h-11 w-full shrink-0 sm:w-auto"
                      type="button"
                      variant="outline"
                      disabled
                      aria-describedby={`channel-disabled-reason-${channel.channelId}`}
                      data-disabled-reason={channel.integrationAction.disabledReason}
                    >
                      {channel.integrationAction.label}
                    </Button>
                  </div>
                  <p id={`channel-disabled-reason-${channel.channelId}`} class="mt-2 text-xs text-muted-foreground">
                    Unavailable: integration_not_yet_available
                  </p>
                </article>
              {/each}
            </Card.Content>
          </Card.Root>
        {/each}
      </div>
    </section>

    <section class="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" aria-labelledby="trigger-bindings-heading">
      <Card.Root class="min-w-0">
        <Card.Header>
          <Card.Title id="trigger-bindings-heading">Fixture trigger bindings</Card.Title>
          <Card.Description>Dormant channel event mappings associated with fixture workflows.</Card.Description>
        </Card.Header>
        <Card.Content class="grid min-w-0 gap-3">
          {#each projection.triggerBindings as binding (binding.bindingId)}
            <article class="min-w-0 rounded-lg border border-border p-4" data-trigger-binding-id={binding.bindingId}>
              <div class="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div class="min-w-0 text-sm">
                  <h3 class="break-words font-medium">{binding.workflowId}</h3>
                  <p class="break-words text-muted-foreground">{binding.channelId} · {binding.event}</p>
                  <p class="break-words text-muted-foreground">{binding.inputMapping[0]?.sourcePath ?? "No source"} → {binding.inputMapping[0]?.targetPath ?? "No target"}</p>
                </div>
                <Button
                  class="min-h-11 w-full shrink-0 sm:w-auto"
                  type="button"
                  variant="outline"
                  disabled
                  aria-describedby={`trigger-disabled-reason-${binding.bindingId}`}
                  data-disabled-reason={binding.disabledReason}
                >
                  Activate
                </Button>
              </div>
              <p id={`trigger-disabled-reason-${binding.bindingId}`} class="mt-2 text-xs text-muted-foreground">
                Unavailable: integration_not_yet_available
              </p>
            </article>
          {/each}
        </Card.Content>
      </Card.Root>

      <Card.Root class="min-w-0">
        <Card.Header>
          <Card.Title>Save a fixture binding</Card.Title>
          <Card.Description>This writes only a disabled fixture_only binding to the active session’s display-only page-context snapshot.</Card.Description>
        </Card.Header>
        <Card.Content>
          <form class="grid min-w-0 gap-4" onsubmit={submitBinding} data-channel-binding-form>
            <label class="grid min-w-0 gap-1 text-sm font-medium">
              Channel
              <select class="min-h-11 min-w-0 rounded-md border border-input bg-background px-3" bind:value={channelId} name="channelId">
                {#each projection.channels as channel (channel.channelId)}
                  <option value={channel.channelId}>{channel.label}</option>
                {/each}
              </select>
            </label>
            <label class="grid min-w-0 gap-1 text-sm font-medium">
              Neutral event
              <input class="min-h-11 min-w-0 rounded-md border border-input bg-background px-3" bind:value={event} name="event" autocomplete="off" required />
            </label>
            <label class="grid min-w-0 gap-1 text-sm font-medium">
              Fixture workflow
              <select class="min-h-11 min-w-0 rounded-md border border-input bg-background px-3" bind:value={workflowId} name="workflowId">
                {#each workflowIds as id (id)}
                  <option value={id}>{id}</option>
                {/each}
              </select>
            </label>
            <div class="grid min-w-0 gap-4 sm:grid-cols-2">
              <label class="grid min-w-0 gap-1 text-sm font-medium">
                Source mapping
                <input class="min-h-11 min-w-0 rounded-md border border-input bg-background px-3" bind:value={sourcePath} name="sourcePath" autocomplete="off" required />
              </label>
              <label class="grid min-w-0 gap-1 text-sm font-medium">
                Target mapping
                <input class="min-h-11 min-w-0 rounded-md border border-input bg-background px-3" bind:value={targetPath} name="targetPath" autocomplete="off" required />
              </label>
            </div>
            <Button
              class="min-h-11 w-full sm:w-auto"
              type="submit"
              disabled={Boolean(saveDisabledReason)}
              aria-describedby={saveDisabledReason ? "channel-save-disabled-reason" : undefined}
              data-disabled-reason={saveDisabledReason}
            >
              {projection.status === "saving" ? "Saving…" : "Save fixture binding"}
            </Button>
            {#if saveDisabledReason}
              <p id="channel-save-disabled-reason" class="text-sm text-muted-foreground" data-channel-save-disabled-reason>
                Unavailable: {saveDisabledReason}
              </p>
            {/if}
          </form>
        </Card.Content>
      </Card.Root>
    </section>
  </div>
</div>

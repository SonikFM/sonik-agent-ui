<script lang="ts">
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import * as Card from "$lib/components/ui/card";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import type { WorkflowDefinition } from "@sonik-agent-ui/tool-contracts/marketplace";
  import {
    createOrganizerPatchRequest,
    type OrganizerAction,
    type OrganizerParameter,
    type OrganizerPatchRequest,
  } from "./organizer-model";

  interface Props {
    workflow: WorkflowDefinition;
    revision: number;
    parameters?: OrganizerParameter[];
    safePatchPaths?: string[];
    busy?: boolean;
    onConfigure?: (request: OrganizerPatchRequest) => void;
    onAction?: (action: OrganizerAction, workflow: WorkflowDefinition) => void;
    onInspectReceipt?: (receiptId: string) => void;
    receiptIds?: string[];
  }

  let {
    workflow,
    revision,
    parameters = [],
    safePatchPaths = [],
    busy = false,
    onConfigure,
    onAction,
    onInspectReceipt,
    receiptIds = [],
  }: Props = $props();

  let values = $state<Record<string, string | number | boolean>>({});
  const editableParameters = $derived(parameters.filter((parameter) => safePatchPaths.includes(parameter.path)));

  function currentValue(parameter: OrganizerParameter): string | number | boolean {
    return values[parameter.path] ?? parameter.value;
  }

  function setValue(parameter: OrganizerParameter, value: string | number | boolean): void {
    values = { ...values, [parameter.path]: value };
  }

  function configure(): void {
    onConfigure?.(createOrganizerPatchRequest(workflow, revision, parameters, safePatchPaths, values));
  }
</script>

<section class="flex flex-col gap-4" aria-labelledby="organizer-panel-title" data-organizer-panel>
  <Card.Root>
    <Card.Header>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <Card.Title id="organizer-panel-title">{workflow.title}</Card.Title>
        <Badge variant="outline">Revision {revision}</Badge>
      </div>
      <Card.Description>{workflow.workflowId} · {workflow.version}</Card.Description>
    </Card.Header>
    <Card.Content class="flex flex-col gap-4">
      {#each editableParameters as parameter (parameter.path)}
        <div class="flex flex-col gap-2">
          <Label for={`organizer-${parameter.path}`}>{parameter.label}</Label>
          {#if parameter.type === "boolean"}
            <label class="flex items-center gap-2 text-sm">
              <input
                id={`organizer-${parameter.path}`}
                type="checkbox"
                checked={Boolean(currentValue(parameter))}
                onchange={(event) => setValue(parameter, event.currentTarget.checked)}
              />
              {parameter.description ?? parameter.label}
            </label>
          {:else if parameter.type === "textarea"}
            <textarea
              id={`organizer-${parameter.path}`}
              class="min-h-24 rounded-md border border-input bg-background p-2 text-sm"
              value={String(currentValue(parameter))}
              oninput={(event) => setValue(parameter, event.currentTarget.value)}
            ></textarea>
          {:else}
            <Input
              id={`organizer-${parameter.path}`}
              type={parameter.type === "number" ? "number" : "text"}
              value={String(currentValue(parameter))}
              oninput={(event) => setValue(parameter, parameter.type === "number" ? event.currentTarget.valueAsNumber : event.currentTarget.value)}
            />
          {/if}
          {#if parameter.description && parameter.type !== "boolean"}
            <p class="text-xs text-muted-foreground">{parameter.description}</p>
          {/if}
        </div>
      {:else}
        <p class="text-sm text-muted-foreground">No organizer-editable parameters are declared for this workflow.</p>
      {/each}

      <div class="flex flex-wrap gap-2">
        <Button disabled={busy || editableParameters.length === 0} onclick={configure}>Save configuration</Button>
        <Button variant="outline" disabled={busy} onclick={() => onAction?.("test", workflow)}>Test</Button>
        <Button variant="outline" disabled={busy} onclick={() => onAction?.("publish", workflow)}>Publish</Button>
        <Button variant="outline" disabled={busy} onclick={() => onAction?.("approve", workflow)}>Review approvals</Button>
      </div>
    </Card.Content>
  </Card.Root>

  {#if receiptIds.length > 0}
    <Card.Root>
      <Card.Header><Card.Title>Receipts</Card.Title></Card.Header>
      <Card.Content class="flex flex-wrap gap-2">
        {#each receiptIds as receiptId (receiptId)}
          <Button variant="ghost" size="sm" onclick={() => onInspectReceipt?.(receiptId)}>{receiptId}</Button>
        {/each}
      </Card.Content>
    </Card.Root>
  {/if}
</section>

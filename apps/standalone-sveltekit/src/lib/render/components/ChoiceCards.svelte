<script lang="ts">
  import type { BaseComponentProps } from "@json-render/svelte";
  import { getBoundProp } from "@json-render/svelte";
  import { Badge } from "$lib/components/ui/badge";
  import {
    emitComponentPropValidationTelemetry,
    sanitizeChoiceCardsProps,
    type Choice,
  } from "../component-prop-safety";

  interface Props extends BaseComponentProps<{
    label?: string | null;
    value?: string | number | boolean | Array<string | number | boolean> | null;
    options: Choice[];
    mode?: "single" | "multiple" | null;
    helperText?: string | null;
  }> {}

  let { props, bindings }: Props = $props();
  let normalized = $derived(sanitizeChoiceCardsProps(props));
  let safeProps = $derived(normalized.props);
  let lastTelemetryKey = $state<string | null>(null);

  $effect(() => {
    const telemetry = normalized.telemetry;
    const key = telemetry ? `${telemetry.component}:${telemetry.reason}:${telemetry.issuePaths.join(",")}` : null;
    if (telemetry && key !== lastTelemetryKey) emitComponentPropValidationTelemetry(telemetry);
    lastTelemetryKey = key;
  });

  const valueBinding = getBoundProp<unknown>(
    () => safeProps.value,
    () => bindings?.value,
  );

  let current = $derived(valueBinding.current);
  const isMultiple = $derived(safeProps.mode === "multiple");

  function selected(value: Choice["value"]) {
    return Array.isArray(current) ? current.includes(value) : current === value;
  }

  function choose(value: Choice["value"], disabled?: boolean | null) {
    if (disabled) return;
    if (isMultiple) {
      const arr = Array.isArray(valueBinding.current) ? [...valueBinding.current as Array<Choice["value"]>] : [];
      valueBinding.current = arr.includes(value) ? arr.filter((item) => item !== value) : [...arr, value];
      return;
    }
    valueBinding.current = value;
  }
</script>

<div class="flex flex-col gap-3">
  {#if safeProps.label}
    <div>
      <p class="text-sm font-medium">{safeProps.label}</p>
      {#if safeProps.helperText}<p class="text-xs text-muted-foreground">{safeProps.helperText}</p>{/if}
    </div>
  {/if}
  <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
    {#each safeProps.options as option (option.value)}
      <button
        type="button"
        class="rounded-xl border bg-card p-4 text-left shadow-sm transition hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50 {selected(option.value) ? 'border-primary ring-2 ring-primary/20' : 'border-border'}"
        disabled={option.disabled === true}
        aria-pressed={selected(option.value)}
        onclick={() => choose(option.value, option.disabled)}
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="font-medium">{option.label ?? String(option.value)}</p>
            {#if option.description}
              <p class="mt-1 text-sm text-muted-foreground">{option.description}</p>
            {/if}
          </div>
          {#if selected(option.value)}
            <Badge variant="secondary">Selected</Badge>
          {/if}
        </div>
      </button>
    {/each}
  </div>
</div>

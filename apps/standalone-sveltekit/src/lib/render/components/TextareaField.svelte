<script lang="ts">
  import type { BaseComponentProps } from "@json-render/svelte";
  import { getBoundProp } from "@json-render/svelte";
  import { Label } from "$lib/components/ui/label";

  interface Props extends BaseComponentProps<{
    label: string;
    value?: string | null;
    placeholder?: string | null;
    required?: boolean | null;
    helperText?: string | null;
    rows?: number | null;
  }> {}

  let { props, bindings }: Props = $props();

  const valueBinding = getBoundProp<string | null>(
    () => props.value ?? null,
    () => bindings?.value,
  );

  let value = $derived(valueBinding.current ?? "");

  function handleInput(e: Event) {
    valueBinding.current = (e.target as HTMLTextAreaElement).value;
  }
</script>

<div class="flex flex-col gap-2">
  <Label class="text-sm font-medium">
    {props.label}
    {#if props.required}<span class="text-destructive"> *</span>{/if}
  </Label>
  <textarea
    class="min-h-24 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
    rows={props.rows ?? 4}
    placeholder={props.placeholder ?? ""}
    aria-required={props.required === true}
    value={String(value ?? "")}
    oninput={handleInput}
  ></textarea>
  {#if props.helperText}
    <p class="text-xs text-muted-foreground">{props.helperText}</p>
  {/if}
</div>

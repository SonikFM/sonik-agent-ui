<script lang="ts">
  import type { BaseComponentProps } from "@json-render/svelte";
  import { getBoundProp } from "@json-render/svelte";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";

  interface Props extends BaseComponentProps<{
    label: string;
    value?: string | number | null;
    placeholder?: string | null;
    type?: "text" | "email" | "number" | "url" | "date" | "datetime-local" | null;
    required?: boolean | null;
    helperText?: string | null;
  }> {}

  let { props, bindings }: Props = $props();

  const valueBinding = getBoundProp<string | number | null>(
    () => props.value ?? null,
    () => bindings?.value,
  );

  let value = $derived(valueBinding.current ?? "");

  function handleInput(e: Event) {
    const raw = (e.target as HTMLInputElement).value;
    valueBinding.current = props.type === "number" && raw !== "" ? Number(raw) : raw;
  }
</script>

<div class="flex flex-col gap-2">
  <Label class="text-sm font-medium">
    {props.label}
    {#if props.required}<span class="text-destructive"> *</span>{/if}
  </Label>
  <Input
    type={props.type ?? "text"}
    placeholder={props.placeholder ?? ""}
    value={String(value ?? "")}
    aria-required={props.required === true}
    oninput={handleInput}
  />
  {#if props.helperText}
    <p class="text-xs text-muted-foreground">{props.helperText}</p>
  {/if}
</div>

<script lang="ts">
  import type { BaseComponentProps } from "@json-render/svelte";
  import { getBoundProp, getStateContext } from "@json-render/svelte";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { createAskUserQuestionSpec } from "@sonik-agent-ui/tool-contracts";
  import { createQuestionStateUpdateRecord } from "../question-state";

  type AnswerValue = string | number | boolean | Array<string | number | boolean> | null;
  type Choice = { value: string | number | boolean; label?: string | null; description?: string | null; disabled?: boolean | null };

  interface Props extends BaseComponentProps<{
    questionId: string;
    title: string;
    body: string;
    whyThisMatters?: string | null;
    answerType: string;
    choices?: Choice[] | null;
    value?: AnswerValue;
    required?: boolean | null;
    allowSkip?: boolean | null;
    skipValue?: unknown;
    writesTo?: string | null;
    minSelections?: number | null;
    maxSelections?: number | null;
    confidence?: number | null;
    reviewRequired?: boolean | null;
    submitLabel?: string | null;
    skipLabel?: string | null;
  }> {}

  let { props, bindings, emit }: Props = $props();
  const stateContext = getStateContext();

  let error = $state<string | null>(null);

  function valueBinding() {
    return getBoundProp<AnswerValue>(
      () => props.value ?? null,
      () => bindings?.value,
    );
  }

  let value = $derived(valueBinding().current ?? null);
  const choices = $derived(props.choices ?? []);
  const isChoice = $derived(["single_choice", "choice_cards", "confirmation"].includes(props.answerType));
  const isMulti = $derived(props.answerType === "multi_choice");
  const isLongText = $derived(["long_text", "textarea", "weekly_schedule"].includes(props.answerType));

  function isSelected(choiceValue: Choice["value"]) {
    return Array.isArray(value) ? value.includes(choiceValue) : value === choiceValue;
  }

  function choose(choiceValue: Choice["value"], disabled?: boolean | null) {
    if (disabled) return;
    error = null;
    const binding = valueBinding();
    if (isMulti) {
      const current = Array.isArray(binding.current) ? [...binding.current] : [];
      binding.current = current.includes(choiceValue) ? current.filter((item) => item !== choiceValue) : [...current, choiceValue];
      return;
    }
    binding.current = choiceValue;
  }

  function handleText(e: Event) {
    error = null;
    const raw = (e.target as HTMLInputElement | HTMLTextAreaElement).value;
    valueBinding().current = props.answerType === "number" && raw !== "" ? Number(raw) : raw;
  }

  function questionSpec() {
    return createAskUserQuestionSpec({
      id: props.questionId,
      title: props.title,
      body: props.body,
      whyThisMatters: props.whyThisMatters ?? undefined,
      answerType: props.answerType,
      choices,
      required: props.required === true,
      allowSkip: props.allowSkip !== false,
      skipValue: props.skipValue ?? "unknown",
      writesTo: props.writesTo ?? undefined,
      minSelections: props.minSelections ?? 0,
      maxSelections: props.maxSelections ?? undefined,
      confidence: props.confidence ?? undefined,
      reviewRequired: props.reviewRequired === true,
    });
  }

  function submit(skipped = false) {
    try {
      const updates = createQuestionStateUpdateRecord({
        question: questionSpec(),
        value: skipped ? undefined : valueBinding().current,
        skipped,
        writesTo: props.writesTo,
      });
      stateContext.update(updates);
      error = null;
      emit(skipped ? "skip" : "submit");
    } catch (err) {
      error = err instanceof Error ? err.message : "Answer could not be saved.";
      stateContext.set(`/questionErrors/${props.questionId}`, error);
    }
  }
</script>

<section class="rounded-xl border bg-card p-5 shadow-sm">
  <div class="flex flex-col gap-4">
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="text-base font-semibold">{props.title}</h3>
          {#if props.required}
            <Badge variant="destructive">Required</Badge>
          {/if}
          {#if props.reviewRequired}
            <Badge variant="outline">Review</Badge>
          {/if}
          {#if typeof props.confidence === "number"}
            <Badge variant="secondary">{Math.round(props.confidence * 100)}% confidence</Badge>
          {/if}
        </div>
        <p class="mt-1 text-sm text-muted-foreground">{props.body}</p>
        {#if props.whyThisMatters}
          <p class="mt-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{props.whyThisMatters}</p>
        {/if}
      </div>
    </div>

    {#if isChoice || isMulti}
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        {#each choices as choice}
          <button
            type="button"
            class="rounded-lg border p-3 text-left transition hover:border-primary/60 disabled:cursor-not-allowed disabled:opacity-50 {isSelected(choice.value) ? 'border-primary bg-primary/5 ring-2 ring-primary/15' : 'border-border bg-background'}"
            disabled={choice.disabled === true}
            aria-pressed={isSelected(choice.value)}
            onclick={() => choose(choice.value, choice.disabled)}
          >
            <p class="font-medium">{choice.label ?? String(choice.value)}</p>
            {#if choice.description}
              <p class="mt-1 text-sm text-muted-foreground">{choice.description}</p>
            {/if}
          </button>
        {/each}
      </div>
    {:else if isLongText}
      <textarea
        class="min-h-28 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        value={String(value ?? "")}
        oninput={handleText}
      ></textarea>
    {:else}
      <input
        class="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        type={props.answerType === "number" ? "number" : props.answerType === "date" ? "date" : props.answerType === "datetime" ? "datetime-local" : "text"}
        value={String(value ?? "")}
        oninput={handleText}
      />
    {/if}

    {#if error}
      <p class="text-sm text-destructive">{error}</p>
    {/if}

    <div class="flex flex-wrap items-center gap-2">
      <Button type="button" onclick={() => submit(false)}>{props.submitLabel ?? "Save answer"}</Button>
      {#if props.allowSkip !== false}
        <Button type="button" variant="outline" onclick={() => submit(true)}>{props.skipLabel ?? "Mark unknown"}</Button>
      {/if}
      {#if props.writesTo}
        <span class="text-xs text-muted-foreground">Writes to {props.writesTo}</span>
      {/if}
    </div>
  </div>
</section>

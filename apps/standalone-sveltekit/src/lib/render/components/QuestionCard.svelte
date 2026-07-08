<script lang="ts">
  import type { BaseComponentProps } from "@json-render/svelte";
  import { getBoundProp, getStateContext } from "@json-render/svelte";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { createAskUserQuestionSpec } from "@sonik-agent-ui/tool-contracts";
  import { createQuestionStateUpdateRecord } from "../question-state";
  import {
    emitComponentPropValidationTelemetry,
    emitQuestionSubmitAttemptTelemetry,
    formatQuestionSubmitError,
    sanitizeQuestionCardProps,
    type Choice,
  } from "../component-prop-safety";
  import { createQuestionErrorStatePath } from "../question-card-state";

  type AnswerValue = string | number | boolean | Array<string | number | boolean> | null;

  interface Props extends BaseComponentProps<{
    questionId: string;
    title: string;
    body: string;
    whyThisMatters?: string | null;
    answerType: string;
    choices?: Choice[] | null;
    value?: AnswerValue;
    lifecycleState?: string | null;
    errorMessage?: string | null;
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
  let normalized = $derived(sanitizeQuestionCardProps(props));
  let safeProps = $derived(normalized.props);
  let lastTelemetryKey = $state<string | null>(null);

  let error = $state<string | null>(null);
  let submitStatus = $state<"idle" | "saving" | "failed">("idle");

  $effect(() => {
    const telemetry = normalized.telemetry;
    const key = telemetry ? `${telemetry.component}:${telemetry.reason}:${telemetry.issuePaths.join(",")}` : null;
    if (telemetry && key !== lastTelemetryKey) emitComponentPropValidationTelemetry(telemetry);
    lastTelemetryKey = key;
  });

  const valueBinding = getBoundProp<AnswerValue>(
    () => safeProps.value ?? null,
    () => bindings?.value,
  );

  let value = $derived(valueBinding.current ?? null);
  const choices = $derived(safeProps.choices ?? []);
  const lifecycleState = $derived(safeProps.lifecycleState ?? "draft");
  const persistedError = $derived(safeProps.errorMessage ?? null);
  const visibleError = $derived(error ?? persistedError);
  const visibleState = $derived(visibleError ? "failed" : submitStatus === "saving" ? "saving" : lifecycleState);
  const isChoice = $derived(["single_choice", "choice_cards", "confirmation"].includes(safeProps.answerType));
  const isMulti = $derived(safeProps.answerType === "multi_choice");
  const isLongText = $derived(["long_text", "textarea", "weekly_schedule"].includes(safeProps.answerType));

  const questionErrorPath = $derived(createQuestionErrorStatePath(safeProps.questionId));

  function isSelected(choiceValue: Choice["value"]) {
    return Array.isArray(value) ? value.includes(choiceValue) : value === choiceValue;
  }

  function choose(choiceValue: Choice["value"], disabled?: boolean | null) {
    if (disabled) return;
    error = null;
    submitStatus = "idle";
    stateContext.set(questionErrorPath, null);
    if (isMulti) {
      const current = Array.isArray(valueBinding.current) ? [...valueBinding.current] : [];
      valueBinding.current = current.includes(choiceValue) ? current.filter((item) => item !== choiceValue) : [...current, choiceValue];
      return;
    }
    valueBinding.current = choiceValue;
  }

  function selectAllChoices() {
    if (!isMulti) return;
    error = null;
    submitStatus = "idle";
    stateContext.set(questionErrorPath, null);
    valueBinding.current = choices.filter((choice) => choice.disabled !== true).map((choice) => choice.value);
  }

  function clearChoices() {
    if (!isMulti) return;
    error = null;
    submitStatus = "idle";
    stateContext.set(questionErrorPath, null);
    valueBinding.current = [];
  }

  function handleText(e: Event) {
    error = null;
    submitStatus = "idle";
    stateContext.set(questionErrorPath, null);
    const raw = (e.target as HTMLInputElement | HTMLTextAreaElement).value;
    valueBinding.current = safeProps.answerType === "number" && raw !== "" ? Number(raw) : raw;
  }

  function questionSpec() {
    return createAskUserQuestionSpec({
      id: safeProps.questionId,
      title: safeProps.title,
      body: safeProps.body,
      whyThisMatters: safeProps.whyThisMatters ?? undefined,
      answerType: safeProps.answerType,
      choices,
      required: safeProps.required === true,
      allowSkip: safeProps.allowSkip !== false,
      skipValue: safeProps.skipValue ?? "unknown",
      writesTo: safeProps.writesTo ?? undefined,
      minSelections: safeProps.minSelections ?? 0,
      maxSelections: safeProps.maxSelections ?? undefined,
      confidence: safeProps.confidence ?? undefined,
      reviewRequired: safeProps.reviewRequired === true,
    });
  }

  function submit(skipped = false) {
    emitQuestionSubmitAttemptTelemetry({ questionId: safeProps.questionId, skipped });
    try {
      const updates = createQuestionStateUpdateRecord({
        question: questionSpec(),
        value: skipped ? undefined : valueBinding.current,
        skipped,
        writesTo: safeProps.writesTo,
      });
      stateContext.update({
        ...updates,
        [questionErrorPath]: null,
      });
      error = null;
      submitStatus = "saving";
      emit(skipped ? "skip" : "submit");
      if (typeof window !== "undefined") {
        window.setTimeout(() => {
          if (submitStatus === "saving") submitStatus = "idle";
        }, 1_200);
      }
    } catch (err) {
      const formatted = formatQuestionSubmitError(err);
      error = formatted.message;
      submitStatus = "failed";
      emitComponentPropValidationTelemetry(formatted.telemetry);
      stateContext.set(questionErrorPath, error);
    }
  }
</script>

<section
  class="rounded-xl border bg-card p-5 shadow-sm"
  data-question-card
  data-question-card-id={safeProps.questionId}
  data-question-answer-type={safeProps.answerType}
  data-question-state={visibleState}
>
  <div class="flex flex-col gap-4">
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="text-base font-semibold">{safeProps.title}</h3>
          {#if safeProps.required}
            <Badge variant="destructive">Required</Badge>
          {/if}
          {#if safeProps.reviewRequired}
            <Badge variant="outline">Review</Badge>
          {/if}
          {#if typeof safeProps.confidence === "number"}
            <Badge variant="secondary">{Math.round(safeProps.confidence * 100)}% confidence</Badge>
          {/if}
        </div>
        <p class="mt-1 text-sm text-muted-foreground">{safeProps.body}</p>
        {#if safeProps.whyThisMatters}
          <p class="mt-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{safeProps.whyThisMatters}</p>
        {/if}
      </div>
    </div>

    {#if isChoice || isMulti}
      {#if isMulti}
        <div class="flex flex-wrap gap-2" data-question-multi-controls data-question-card-id={safeProps.questionId}>
          <Button type="button" variant="outline" onclick={selectAllChoices} data-question-action="select-all" data-question-card-id={safeProps.questionId}>Select all</Button>
          <Button type="button" variant="ghost" onclick={clearChoices} data-question-action="clear" data-question-card-id={safeProps.questionId}>Clear</Button>
        </div>
      {/if}
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        {#each choices as choice (choice.value)}
          <button
            type="button"
            class="rounded-lg border p-3 text-left transition hover:border-primary/60 disabled:cursor-not-allowed disabled:opacity-50 {isSelected(choice.value) ? 'border-primary bg-primary/5 ring-2 ring-primary/15' : 'border-border bg-background'}"
            disabled={choice.disabled === true}
            aria-pressed={isSelected(choice.value)}
            onclick={() => choose(choice.value, choice.disabled)}
            data-question-option
            data-question-card-id={safeProps.questionId}
            data-question-option-value={String(choice.value)}
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
        data-question-input
        data-question-card-id={safeProps.questionId}
      ></textarea>
    {:else}
      <input
        class="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        type={safeProps.answerType === "number" ? "number" : safeProps.answerType === "date" ? "date" : safeProps.answerType === "datetime" ? "datetime-local" : "text"}
        value={String(value ?? "")}
        oninput={handleText}
        data-question-input
        data-question-card-id={safeProps.questionId}
      />
    {/if}

    {#if visibleError}
      <p class="text-sm text-destructive">{visibleError}</p>
    {/if}

    <div class="flex flex-wrap items-center gap-2">
      <Button type="button" onclick={() => submit(false)} data-question-action="submit" data-question-card-id={safeProps.questionId}>{safeProps.submitLabel ?? "Submit answer"}</Button>
      {#if safeProps.allowSkip !== false}
        <Button type="button" variant="outline" onclick={() => submit(true)} data-question-action="skip" data-question-card-id={safeProps.questionId}>{safeProps.skipLabel ?? "Skip for now"}</Button>
      {/if}
      {#if visibleState === "saving"}
        <span class="text-xs font-medium text-primary">Saving answer and asking the next question…</span>
      {:else if visibleState === "answered"}
        <span class="text-xs font-medium text-primary">Answer saved</span>
      {:else if visibleState === "skipped"}
        <span class="text-xs font-medium text-muted-foreground">Skipped for now</span>
      {:else if visibleState === "failed" || visibleState === "error" || visibleState === "errored" || visibleState === "invalid"}
        <span class="text-xs font-medium text-destructive">Answer not saved. Retry this question before continuing.</span>
      {/if}
    </div>
  </div>
</section>

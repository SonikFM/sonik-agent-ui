<script lang="ts">
  import type { BaseComponentProps } from "@json-render/svelte";
  import { Badge } from "$lib/components/ui/badge";

  type MissingField = string | { field?: string | null; label?: string | null; reason?: string | null; severity?: "blocking" | "warning" | "optional" | null };
  type QuestionRef = { id: string; label?: string | null; required?: boolean | null };

  interface Props extends BaseComponentProps<{
    title?: string | null;
    items?: MissingField[] | null;
    questions?: QuestionRef[] | null;
    questionStates?: Record<string, unknown> | null;
    emptyMessage?: string | null;
  }> {}

  let { props }: Props = $props();

  const SEVERITY_LABELS: Record<string, string> = { blocking: "Required", warning: "Review", optional: "Optional" };

  function deriveFromQuestions(questions: QuestionRef[], states: Record<string, unknown>): MissingField[] {
    const missing: MissingField[] = [];
    for (const question of questions) {
      const state = typeof states[question.id] === "string" ? (states[question.id] as string) : "draft";
      if (state === "answered") continue;
      missing.push({
        field: question.id,
        label: question.label ?? question.id,
        reason: state === "skipped" ? "Skipped for now" : null,
        severity: question.required === true && state !== "skipped" ? "blocking" : "optional",
      });
    }
    return missing;
  }

  const items = $derived(
    props.items ?? (Array.isArray(props.questions) ? deriveFromQuestions(props.questions, props.questionStates ?? {}) : []),
  );

  function fieldLabel(item: MissingField) {
    return typeof item === "string" ? item : item.label ?? item.field ?? "Missing field";
  }
  function reason(item: MissingField) {
    return typeof item === "string" ? null : item.reason ?? null;
  }
  function severity(item: MissingField) {
    return typeof item === "string" ? "blocking" : item.severity ?? "blocking";
  }
</script>

<div class="rounded-xl border bg-card p-4 shadow-sm">
  <p class="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{props.title ?? "Missing fields"}</p>
  {#if items.length === 0}
    <p class="text-sm text-muted-foreground">{props.emptyMessage ?? "No missing fields."}</p>
  {:else}
    <ul class="flex flex-col gap-2">
      {#each items as item}
        <li class="flex items-start justify-between gap-3 rounded-lg bg-muted/50 p-3">
          <div>
            <p class="text-sm font-medium">{fieldLabel(item)}</p>
            {#if reason(item)}<p class="text-xs text-muted-foreground">{reason(item)}</p>{/if}
          </div>
          <Badge variant={severity(item) === "blocking" ? "destructive" : "secondary"}>{SEVERITY_LABELS[severity(item)] ?? severity(item)}</Badge>
        </li>
      {/each}
    </ul>
  {/if}
</div>

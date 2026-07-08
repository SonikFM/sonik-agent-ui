// Generic "what is the agent asking for" extractor for the persona harness.
//
// The booking.context.intake skill (label: "Set up a venue") is documented
// to render QuestionCard elements (see lib/spec-walker.mjs, a faithful port
// of the client's QuestionCard reducer) — but a manual verification run
// against the deployed agent-ui (2026-07-07, prompt "I need to set up dinner
// reservations for my trattoria.") showed the real model instead routing to
// booking.reservation.create and rendering a plain multi-step form (Card >
// Stack > TextInput/Select/etc, no QuestionCard). Both are legitimate live
// outcomes depending on how a persona phrases their opening request, and the
// task's extraction requirement ("questionsAsked") needs to cover both
// honestly rather than assuming QuestionCard is the only shape that occurs.
//
// This module extracts a best-effort, answerType-labeled question list from
// *either* shape:
//   - QuestionCard elements (authoritative; see getQuestionCards)
//   - generic form-field element types (TextInput, Textarea, NumberInput,
//     Select, DateInput, Checkbox, RadioGroup, MultiSelect) that carry a
//     label/name, found anywhere in spec.elements.
//
// It intentionally does not try to resolve values against spec.state for the
// generic-field case (there is no documented state-write contract for them,
// unlike QuestionCard's /answers/<id> + writesTo), so "answered" tracking for
// generic fields is turn-based (see lib/conversation-store.mjs) rather than
// state-based.

import { getQuestionCards } from "./spec-walker.mjs";

const GENERIC_FIELD_TYPES = new Set([
  "TextInput",
  "Textarea",
  "TextArea",
  "NumberInput",
  "Select",
  "MultiSelect",
  "DateInput",
  "DateTimeInput",
  "Checkbox",
  "RadioGroup",
  "Switch",
  "Toggle",
]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Generic form-field elements in a Spec (fallback question shape, see module docstring). */
export function getGenericFormFields(spec) {
  const elements = isRecord(spec?.elements) ? spec.elements : {};
  const fields = [];
  for (const [key, element] of Object.entries(elements)) {
    if (!isRecord(element) || !GENERIC_FIELD_TYPES.has(element.type) || !isRecord(element.props)) continue;
    const props = element.props;
    const label = typeof props.label === "string" && props.label.trim() ? props.label.trim() : typeof props.placeholder === "string" ? props.placeholder.trim() : key;
    fields.push({
      elementKey: key,
      id: typeof props.name === "string" && props.name ? props.name : key,
      title: label,
      answerType: element.type,
      required: props.required === true,
    });
  }
  return fields;
}

/**
 * Unified "questions the agent is asking" snapshot for a spec: QuestionCard
 * elements when present (authoritative), else generic form fields
 * (best-effort). Returns `{ source, questions }`.
 */
export function extractQuestions(spec) {
  const questionCards = getQuestionCards(spec);
  if (questionCards.length > 0) {
    return { source: "QuestionCard", questions: questionCards.map((question) => ({ ...question, source: "QuestionCard" })) };
  }
  const genericFields = getGenericFormFields(spec);
  return { source: genericFields.length > 0 ? "generic-form-field" : "none", questions: genericFields.map((field) => ({ ...field, source: "generic-form-field" })) };
}

/** Question ids present in `nextSpec` but not in `previousSpec` (newly rendered this turn). */
export function diffNewQuestions(previousSpec, nextSpec) {
  const previousIds = new Set(extractQuestions(previousSpec).questions.map((question) => question.id));
  return extractQuestions(nextSpec).questions.filter((question) => !previousIds.has(question.id));
}

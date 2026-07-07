// Pure re-implementation of the client-side workflow-state reducers in
// apps/standalone-sveltekit/src/lib/render/json-render-state-controller.ts
// and apps/standalone-sveltekit/src/lib/agent-workflows/page-control-workflow.ts,
// so the headless persona harness can compute "what question is next" / "are
// we ready for preview" from a json-render Spec without a Svelte runtime.
// Kept as a deliberate parallel port (not an import) so this harness has no
// build-step dependency on the TS workspace packages. Ported from the P1
// headless-workflow-harness driver (scripts/harness/lib/spec-walker.mjs on
// worktree agent-a54f9dfe2f570941c), unchanged.

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** All QuestionCard elements declared in a json-render Spec, in element order. */
export function getQuestionCards(spec) {
  const elements = isRecord(spec?.elements) ? spec.elements : {};
  const cards = [];
  for (const [key, element] of Object.entries(elements)) {
    if (!isRecord(element) || element.type !== "QuestionCard" || !isRecord(element.props)) continue;
    const props = element.props;
    const id = typeof props.questionId === "string" ? props.questionId.trim() : "";
    const title = typeof props.title === "string" ? props.title.trim() : "";
    const answerType = typeof props.answerType === "string" ? props.answerType.trim() : "";
    if (!id || !title || !answerType) continue;
    cards.push({
      elementKey: key,
      id,
      title,
      body: typeof props.body === "string" ? props.body : undefined,
      required: props.required === true,
      allowSkip: props.allowSkip !== false,
      skipValue: props.skipValue,
      answerType,
      writesTo: typeof props.writesTo === "string" ? props.writesTo : undefined,
      choices: Array.isArray(props.choices) ? props.choices : [],
      minSelections: typeof props.minSelections === "number" ? props.minSelections : 0,
      maxSelections: typeof props.maxSelections === "number" ? props.maxSelections : undefined,
    });
  }
  return cards;
}

/** Question ids the artifact state already considers answered or skipped. */
export function getAnsweredQuestionIds(spec) {
  const state = isRecord(spec?.state) ? spec.state : {};
  const questionStates = isRecord(state.questionStates) ? state.questionStates : {};
  const answers = isRecord(state.answers) ? state.answers : {};
  const answered = new Set();
  for (const [id, status] of Object.entries(questionStates)) {
    const normalized = String(status).toLowerCase();
    if (normalized === "answered" || normalized === "skipped") answered.add(id);
  }
  for (const id of Object.keys(answers)) answered.add(id);
  return answered;
}

/** First unanswered QuestionCard in a Spec, or null when every card is answered. */
export function findNextQuestion(spec) {
  const cards = getQuestionCards(spec);
  const answered = getAnsweredQuestionIds(spec);
  return cards.find((card) => !answered.has(card.id)) ?? null;
}

/** Visible question-answer errors surfaced by the current artifact state. */
export function getVisibleErrors(spec) {
  const state = isRecord(spec?.state) ? spec.state : {};
  const questionErrors = isRecord(state.questionErrors) ? state.questionErrors : {};
  const questionStates = isRecord(state.questionStates) ? state.questionStates : {};
  const errors = [];
  for (const [field, value] of Object.entries(questionErrors)) {
    if (value === undefined || value === null || value === false || value === "") continue;
    errors.push({ field, code: "question_answer_not_saved", message: String(value).slice(0, 300) });
  }
  for (const [field, value] of Object.entries(questionStates)) {
    const status = String(value).toLowerCase();
    if (["error", "errored", "invalid"].includes(status) && !errors.some((error) => error.field === field)) {
      errors.push({ field, code: "question_state_invalid", message: `Question ${field} is ${status}.` });
    }
  }
  return errors;
}

/**
 * Port of +page.svelte's isActiveBookingIntakeArtifact(): true when the spec
 * carries a booking.context.intake surface/manifest marker.
 */
export function isBookingIntakeArtifact(spec) {
  const state = isRecord(spec?.state) ? spec.state : null;
  if (!state) return false;
  const surface = isRecord(state.surface) ? state.surface : null;
  if (surface?.skillId === "booking.context.intake") return true;
  const manifest = isRecord(state.manifest) ? state.manifest : null;
  const source = manifest && isRecord(manifest.source) ? manifest.source : null;
  return source?.skill === "booking.context.intake";
}

/**
 * Port of +page.svelte's getActiveIntakeApprovalReadiness(): whether the
 * booking-context-intake manifest has enough answered fields to preview the
 * booking.create.context command.
 */
export function getIntakeApprovalReadiness(spec) {
  const state = isRecord(spec?.state) ? spec.state : null;
  if (!state) return { ready: false, visible: false, reason: "Open a saved booking intake first." };
  const manifest = isRecord(state.manifest) ? state.manifest : {};
  const inventory = isRecord(manifest.inventory) ? manifest.inventory : {};
  const visibleErrors = getVisibleErrors(spec);
  if (visibleErrors.length > 0) {
    return { ready: false, visible: false, reason: `Fix the saved answer for ${visibleErrors[0].field} before previewing.` };
  }
  const hasKind = typeof manifest.intakeMode === "string" && manifest.intakeMode.trim().length > 0;
  const hasInventory = typeof inventory.coreDescription === "string" && inventory.coreDescription.trim().length > 0;
  if (!hasKind || !hasInventory) return { ready: false, visible: false, reason: "Answer setup type and inventory before previewing." };
  return { ready: true, visible: true, reason: null };
}

/**
 * Workflow phase, mirroring resolveWorkflowPhase in json-render-state-controller.ts:
 * idle (no workflow) -> intake (questions pending) -> preview_ready (all
 * required answers present, no errors) -> error (visible errors present).
 */
export function resolveWorkflowPhase(spec) {
  if (!isBookingIntakeArtifact(spec)) return "idle";
  const visibleErrors = getVisibleErrors(spec);
  if (visibleErrors.length > 0) return "error";
  const readiness = getIntakeApprovalReadiness(spec);
  if (readiness.ready) return "preview_ready";
  return "intake";
}

/** One-shot snapshot combining the above for the CLI/scorer's convenience. */
export function summarizeWorkflow(spec) {
  const cards = getQuestionCards(spec);
  const answered = getAnsweredQuestionIds(spec);
  const nextQuestion = findNextQuestion(spec);
  return {
    isBookingIntake: isBookingIntakeArtifact(spec),
    phase: resolveWorkflowPhase(spec),
    questionCount: cards.length,
    answeredCount: [...answered].filter((id) => cards.some((card) => card.id === id)).length,
    nextQuestion,
    visibleErrors: getVisibleErrors(spec),
    readiness: getIntakeApprovalReadiness(spec),
  };
}

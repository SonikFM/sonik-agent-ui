// Hand-authored port of the booking.context.intake surface + state-patch
// shapes, so the demo-seed batch tool can build real json-render artifacts
// without a TypeScript build step. This is intentionally NOT a call into
// createInteractiveSurfaceJsonRenderSpec/createIntakeArtifact (curated direct
// authoring per the task decision, not model/build-driven) — but every field
// name, JSON-Pointer path, and default mirrors the real source of truth:
//
//   - Question set: apps/standalone-sveltekit/src/lib/server/booking-workflows/context-intake.ts
//     (BOOKING_CONTEXT_INTAKE_SURFACE_TEMPLATE)
//   - Rendered element/state shape: apps/standalone-sveltekit/src/lib/server/intake-artifacts.ts
//     (createIntakeSurfaceSpec) — the server generator actually wired to the
//     booking.context.intake skill (QuestionCard.value bound to
//     /draftAnswers/<id>, .lifecycleState bound to /questionStates/<id>).
//   - State-patch JSON-Pointer paths: packages/tool-contracts/src/index.ts
//     (createQuestionAnswerStateUpdates) — /answers/<id>, /questionStates/<id>,
//     /questionSubmissions/<id>, /lastQuestionSubmission, /answerWrites/<id>,
//     and the question's writesTo pointer.
//
// If any of those three files changes shape, this file must be updated to
// match — see tests/unit/seed-batch.test.mjs for a shape-drift guard.

export const BOOKING_CONTEXT_INTAKE_SKILL_ID = "booking.context.intake";

function escapeJsonPointerSegment(segment) {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

function stableQuestionElementId(questionId, index) {
  return `question-${index}-${escapeJsonPointerSegment(questionId).replace(/[^a-zA-Z0-9_~.-]/g, "-")}`;
}

/**
 * The nine booking.context.intake questions, in source order, with the same
 * required/allowSkip/writesTo/choices fields
 * BOOKING_CONTEXT_INTAKE_SURFACE_TEMPLATE declares (schema defaults applied
 * explicitly rather than left implicit, since this file doesn't run through
 * zod).
 */
export const INTAKE_QUESTIONS = [
  {
    id: "q_intake_mode",
    title: "What are we configuring?",
    body: "Are we creating a recurring venue schedule, a one-time event, or a hybrid event with bookable sub-inventory?",
    whyThisMatters: "This controls which manifest fields and command previews become relevant later.",
    answerType: "choice_cards",
    required: true,
    allowSkip: false,
    skipValue: "unknown",
    writesTo: "/manifest/intakeMode",
    minSelections: 0,
    choices: [
      { value: "venue_schedule", label: "Venue schedule", description: "Recurring inventory such as tee times, tables, rooms, classes, rentals, or appointments." },
      { value: "event", label: "Event", description: "A specific time-bound experience such as a concert, dinner, workshop, or tournament." },
      { value: "hybrid", label: "Hybrid", description: "An event that also has bookable sub-inventory such as VIP tables, sessions, rooms, or add-ons." },
    ],
  },
  {
    id: "q_inventory_core",
    title: "What can customers book, reserve, buy, or request?",
    body: "List the core inventory in plain language. Examples: tee times, dinner reservations, VIP tables, private lessons, rooms, sessions, rentals, tickets, or add-ons.",
    answerType: "long_text",
    required: true,
    allowSkip: false,
    skipValue: "unknown",
    writesTo: "/manifest/inventory/coreDescription",
    minSelections: 0,
    choices: [],
  },
  {
    id: "q_business_name",
    title: "What should this venue or context be called?",
    body: "Use the operator-facing name customers and staff should recognize. Example: Dan's Club, Main Course Dining Room, or Summer Jazz Night.",
    whyThisMatters: "The approved command preview uses this as the booking context name. If it is missing, the system may fall back to a generic inventory label.",
    answerType: "short_text",
    required: false,
    allowSkip: true,
    skipValue: "unknown",
    writesTo: "/manifest/business/name",
    minSelections: 0,
    choices: [],
  },
  {
    id: "q_open_days",
    title: "Which days are open for reservations?",
    body: "Select every day this venue accepts reservations. If hours differ by day, note the exceptions in the operating hours question next.",
    whyThisMatters: "Open days drive the schedule rules and prevent the agent from inventing recurring availability.",
    answerType: "multi_choice",
    required: false,
    allowSkip: true,
    skipValue: "unknown",
    writesTo: "/manifest/schedule/openDays",
    minSelections: 0,
    choices: [
      { value: "monday", label: "Monday" },
      { value: "tuesday", label: "Tuesday" },
      { value: "wednesday", label: "Wednesday" },
      { value: "thursday", label: "Thursday" },
      { value: "friday", label: "Friday" },
      { value: "saturday", label: "Saturday" },
      { value: "sunday", label: "Sunday" },
    ],
  },
  {
    id: "q_operating_hours",
    title: "What are the operating hours?",
    body: "Describe the reservation window in plain language, including exceptions if any. Example: Tuesday through Sunday, 9am to 5pm.",
    answerType: "long_text",
    required: false,
    allowSkip: true,
    skipValue: "unknown",
    writesTo: "/manifest/schedule/operatingHoursDescription",
    minSelections: 0,
    choices: [],
  },
  {
    id: "q_table_layout",
    title: "What tables, rooms, or resources can be reserved?",
    body: "Describe the table/resource layout and capacities. Example: tables 1-10 are 2-tops, 11-20 are 4-tops, 21-25 are 6-tops.",
    whyThisMatters: "This becomes the capacity and resource map before any booking context can be created.",
    answerType: "long_text",
    required: false,
    allowSkip: true,
    skipValue: "unknown",
    writesTo: "/manifest/inventory/tableLayoutDescription",
    minSelections: 0,
    choices: [],
  },
  {
    id: "q_service_periods",
    title: "Do different service periods need different rules or menus?",
    body: "List service periods such as breakfast, lunch, dinner, brunch, or special seatings, with their times. Example: breakfast 9-11, lunch 11-4, dinner 4-5.",
    answerType: "long_text",
    required: false,
    allowSkip: true,
    skipValue: "unknown",
    writesTo: "/manifest/schedule/servicePeriodsDescription",
    minSelections: 0,
    choices: [],
  },
  {
    id: "q_menu_requirements",
    title: "Which menus or offer sets are needed?",
    body: "Select menus that need separate copy, pricing, or fulfillment rules. Add details later if any menu needs review.",
    answerType: "multi_choice",
    required: false,
    allowSkip: true,
    skipValue: "unknown",
    writesTo: "/manifest/menus/required",
    minSelections: 0,
    choices: [
      { value: "breakfast", label: "Breakfast" },
      { value: "lunch", label: "Lunch" },
      { value: "dinner", label: "Dinner" },
      { value: "brunch", label: "Brunch" },
      { value: "drinks", label: "Drinks" },
      { value: "special_event", label: "Special event" },
    ],
  },
  {
    id: "q_confirmation_mode",
    title: "How should bookings be confirmed?",
    body: "Should customers receive instant confirmation, require manual approval, join a waitlist, or submit a request before staff confirms?",
    whyThisMatters: "This prevents the agent from inventing approval, waitlist, or payment behavior.",
    answerType: "single_choice",
    required: false,
    allowSkip: true,
    skipValue: "unknown",
    writesTo: "/manifest/inventory/confirmationMode",
    minSelections: 0,
    choices: [
      { value: "instant_confirm", label: "Instant confirmation", description: "Customer can book immediately if inventory is available." },
      { value: "manual_approval", label: "Manual approval", description: "Staff must approve before the booking is confirmed." },
      { value: "deposit_then_confirm", label: "Deposit then confirm", description: "Customer pays a deposit, then confirmation happens by policy." },
      { value: "request_to_book", label: "Request to book", description: "Customer submits a request without immediate confirmation." },
      { value: "waitlist", label: "Waitlist", description: "Customer joins a waitlist when capacity is unavailable." },
    ],
  },
];

const QUESTION_IDS = INTAKE_QUESTIONS.map((question) => question.id);

/** Every question id the corpus record answers must cover. */
export function requiredAnswerIds() {
  return [...QUESTION_IDS];
}

function normalizeRenderedMaxSelections(answerType, minSelections, maxSelections) {
  if (answerType === "single_choice" || answerType === "choice_cards" || answerType === "confirmation") return 1;
  if (answerType !== "multi_choice") return null;
  if (typeof maxSelections === "number" && Number.isInteger(maxSelections) && maxSelections > 0) return Math.max(maxSelections, minSelections);
  return minSelections > 0 ? minSelections : null;
}

function createTrustedIntakeControllerActionElements(elements) {
  elements["action-rail"] = {
    type: "ActionRail",
    props: {
      title: "Trusted workflow actions",
      emptyMessage: null,
      lastReceipt: { $bindState: "/lastActionReceipt" },
      actions: [
        { id: "saveDraft", label: "Save draft", description: "Persist the current artifact state without running tools.", status: "ready", commandId: null, effect: "artifact_state", approval: "not_required" },
        { id: "editDraft", label: "Edit draft", description: "Return to draft editing; no command preview or write is requested.", status: "ready", commandId: null, effect: "renderer_state", approval: "not_required" },
        { id: "submitToAgent", label: "Submit to agent", description: "Send the saved artifact state back into chat for the next step.", status: "ready", commandId: null, effect: "chat_turn", approval: "not_required" },
        { id: "reviseWithAgent", label: "Revise with agent", description: "Ask the agent to propose targeted changes from the saved draft state.", status: "ready", commandId: null, effect: "chat_turn", approval: "not_required" },
        { id: "requestApproval", label: "Request approval", description: "Ask the agent to validate and show a typed command preview before any write.", status: "requires_confirmation", commandId: "booking.create.context", effect: "preview_write", approval: "required" },
        { id: "cancelApproval", label: "Cancel approval", description: "Cancel the pending approval path and keep the manifest as a saved draft.", status: "ready", commandId: "booking.create.context", effect: "approval_cancelled", approval: "not_required" },
        { id: "approveAndRun", label: "Approve & run", description: "Submit an explicit approval turn; execution still requires trusted host/session approval.", status: "requires_confirmation", commandId: "booking.create.context", effect: "trusted_write_request", approval: "host_required" },
      ],
    },
    children: [],
  };

  const buttons = [
    { id: "action-save-draft", label: "Save draft", variant: "secondary", action: "saveDraft", commandId: null },
    { id: "action-edit-draft", label: "Edit draft", variant: "secondary", action: "editDraft", commandId: null },
    { id: "action-submit-to-agent", label: "Submit to agent", variant: "default", action: "submitToAgent", commandId: null },
    { id: "action-revise-agent", label: "Revise", variant: "outline", action: "reviseWithAgent", commandId: null },
    { id: "action-request-approval", label: "Request approval", variant: "outline", action: "requestApproval", commandId: "booking.create.context" },
    { id: "action-cancel-approval", label: "Cancel", variant: "secondary", action: "cancelApproval", commandId: "booking.create.context" },
    { id: "action-approve-run", label: "Approve & run", variant: "default", action: "approveAndRun", commandId: "booking.create.context" },
  ];

  for (const button of buttons) {
    elements[button.id] = {
      type: "Button",
      props: { label: button.label, variant: button.variant, size: "sm", disabled: false },
      on: { press: { action: button.action, params: { source: "intake_action_rail", commandId: button.commandId ?? null } } },
      children: [],
    };
  }

  elements["action-buttons"] = {
    type: "Stack",
    props: { direction: "horizontal", gap: "sm", wrap: true },
    children: buttons.map((button) => button.id),
  };

  return ["action-rail", "action-buttons"];
}

/**
 * Build the draft (unanswered) json-render artifact spec for a fresh
 * booking.context.intake surface, matching
 * apps/standalone-sveltekit/src/lib/server/intake-artifacts.ts's
 * createIntakeSurfaceSpec output shape exactly (element types, bound state
 * pointers, manifest scaffold). `contextName` seeds the manifest business
 * name and card title/description; `intakeMode` seeds the initial
 * manifest.manifestType.
 */
export function buildDraftIntakeSpec({ contextName, intakeMode = "venue_schedule", artifactId, skillId = BOOKING_CONTEXT_INTAKE_SKILL_ID } = {}) {
  if (!contextName) throw new Error("buildDraftIntakeSpec requires contextName");
  const questionIds = INTAKE_QUESTIONS.map((question, index) => stableQuestionElementId(question.id, index));
  const elements = {
    main: {
      type: "Stack",
      props: { direction: "vertical", gap: "md", wrap: null },
      children: ["surface-header", ...questionIds, "missing-fields"],
    },
    "surface-header": {
      type: "Card",
      props: { title: `${contextName} intake`, description: "Collect the operational facts needed to draft a bookable venue schedule, resource, and service-period manifest." },
      children: [],
    },
    "missing-fields": {
      type: "MissingFieldsList",
      props: {
        title: "Still needed",
        questions: INTAKE_QUESTIONS.map((question) => ({ id: question.id, label: question.title, required: question.required === true })),
        questionStates: { $bindState: "/questionStates" },
        emptyMessage: "All required details are filled in.",
      },
      children: [],
    },
  };

  const actionElementIds = createTrustedIntakeControllerActionElements(elements);
  elements.main.children = [...elements.main.children, "manifest-preview", ...actionElementIds];
  elements["manifest-preview"] = {
    type: "ManifestPreview",
    props: { title: "Manifest draft", manifest: { $bindState: "/manifest" }, emptyMessage: "No manifest draft yet." },
    children: [],
  };

  const draftAnswers = {};
  const questionStates = {};
  for (const [index, question] of INTAKE_QUESTIONS.entries()) {
    const questionIdSegment = escapeJsonPointerSegment(question.id);
    draftAnswers[question.id] = null;
    questionStates[question.id] = "draft";
    elements[questionIds[index]] = {
      type: "QuestionCard",
      props: {
        questionId: question.id,
        title: question.title,
        body: question.body,
        whyThisMatters: question.whyThisMatters ?? null,
        answerType: question.answerType,
        choices: question.choices,
        value: { $bindState: `/draftAnswers/${questionIdSegment}` },
        lifecycleState: { $bindState: `/questionStates/${questionIdSegment}` },
        errorMessage: { $bindState: `/questionErrors/${questionIdSegment}` },
        required: question.required,
        allowSkip: question.allowSkip,
        skipValue: question.skipValue,
        writesTo: question.writesTo ?? null,
        minSelections: question.minSelections,
        maxSelections: normalizeRenderedMaxSelections(question.answerType, question.minSelections, question.maxSelections),
        confidence: null,
        reviewRequired: false,
        submitLabel: "Continue",
        skipLabel: "Skip for now",
      },
      on: {
        submit: { action: "submitAnswer", params: { questionId: question.id, value: { $state: `/draftAnswers/${questionIdSegment}` }, skipped: false, writesTo: question.writesTo ?? null } },
        skip: { action: "submitAnswer", params: { questionId: question.id, value: { $state: `/draftAnswers/${questionIdSegment}` }, skipped: true, writesTo: question.writesTo ?? null } },
      },
      children: [],
    };
  }

  return {
    root: "main",
    elements,
    state: {
      surface: { id: `${artifactId ?? "booking-context-intake"}`, kind: "question_group", title: `${contextName} intake`, skillId, artifactId: artifactId ?? null },
      manifest: {
        manifestType: intakeMode,
        status: "draft",
        source: { createdBy: "demo-seed-batch", skill: skillId },
        business: {},
        inventory: {},
      },
      draftAnswers,
      answers: {},
      questionStates,
      questionErrors: {},
      questionSubmissions: {},
      answerWrites: {},
    },
  };
}

/**
 * Build the JSON-Pointer state-patch `changes` array for answering one
 * question with a curated value, matching
 * packages/tool-contracts/src/index.ts's createQuestionAnswerStateUpdates
 * paths exactly (/answers/<id>, /questionStates/<id>,
 * /questionSubmissions/<id>, /lastQuestionSubmission, /answerWrites/<id>,
 * and the writesTo manifest pointer), PLUS /draftAnswers/<id> so the
 * QuestionCard's bound `value` prop (see buildDraftIntakeSpec) also shows the
 * answer, exactly as it would after a real user typed it in and the
 * controller persisted the submission.
 */
export function buildAnswerStateChanges({ question, value, artifactId, sessionId, now = new Date().toISOString() }) {
  const segment = escapeJsonPointerSegment(question.id);
  const writesTo = question.writesTo;
  const submission = {
    version: "sonik-agent-ui.question-answer-submission.v1",
    questionId: question.id,
    value,
    skipped: false,
    ...(writesTo ? { writesTo } : {}),
    artifactId,
    ...(sessionId ? { sessionId } : {}),
    answeredAt: now,
    metadata: { controller: "sonik-agent-ui.question-answer-state.v1", execution: "none", approval: "not_granted" },
  };

  const changes = [
    { path: `/draftAnswers/${segment}`, value },
    { path: `/answers/${segment}`, value },
    { path: `/questionStates/${segment}`, value: "answered" },
    { path: `/questionSubmissions/${segment}`, value: submission },
    { path: "/lastQuestionSubmission", value: { questionId: question.id, lifecycle: "answered", answeredAt: now, ...(writesTo ? { writesTo } : {}) } },
  ];
  if (writesTo) {
    changes.push({ path: `/answerWrites/${segment}`, value: { questionId: question.id, writesTo, value, answeredAt: now } });
    if (writesTo.startsWith("/")) changes.push({ path: writesTo, value });
  }
  return { changes, submission };
}

export function findQuestion(questionId) {
  const question = INTAKE_QUESTIONS.find((candidate) => candidate.id === questionId);
  if (!question) throw new Error(`Unknown intake question id: ${questionId}`);
  return question;
}

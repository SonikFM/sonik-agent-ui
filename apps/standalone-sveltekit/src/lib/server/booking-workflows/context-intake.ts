import { createInteractiveSurfaceSpec, type InteractiveSurfaceSpec } from "@sonik-agent-ui/tool-contracts";

export const BOOKING_CONTEXT_INTAKE_SURFACE_TEMPLATE: InteractiveSurfaceSpec = createInteractiveSurfaceSpec({
  id: "booking-context-intake-lite",
  kind: "question_group",
  title: "Create booking context",
  description: "Collect the minimum operational facts needed to draft a bookable context manifest.",
  skillId: "booking.context.intake",
  state: {
    manifest: {
      manifestType: "venue_schedule",
      status: "draft",
      source: { createdBy: "agent", skill: "booking.context.intake" },
    },
  },
  questions: [
    {
      id: "q_intake_mode",
      title: "What are we configuring?",
      body: "Are we creating a recurring venue schedule, a one-time event, or a hybrid event with bookable sub-inventory?",
      whyThisMatters: "This controls which manifest fields and command previews become relevant later.",
      answerType: "choice_cards",
      required: true,
      allowSkip: false,
      writesTo: "/manifest/intakeMode",
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
      writesTo: "/manifest/inventory/coreDescription",
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
      choices: [
        { value: "instant_confirm", label: "Instant confirmation", description: "Customer can book immediately if inventory is available." },
        { value: "manual_approval", label: "Manual approval", description: "Staff must approve before the booking is confirmed." },
        { value: "deposit_then_confirm", label: "Deposit then confirm", description: "Customer pays a deposit, then confirmation happens by policy." },
        { value: "request_to_book", label: "Request to book", description: "Customer submits a request without immediate confirmation." },
        { value: "waitlist", label: "Waitlist", description: "Customer joins a waitlist when capacity is unavailable." },
      ],
    },
  ],
});

export const BOOKING_CONTEXT_INTAKE_WORKFLOW = {
  id: "booking.context.intake",
  title: "Create booking context intake",
  description: "Guide an agent through source copy analysis, structured questions, and draft manifest state for a reusable booking context.",
  intentAliases: [
    "create booking context",
    "create bookable context",
    "set up booking context",
    "build intake manifest",
    "configure venue schedule",
    "create event context",
  ],
  requiredTools: ["ask_user_question", "create_or_update_intake_artifact"],
  optionalTools: ["copy_analyze_retrofit", "manifest_validate", "manifest_export"],
  workflowSteps: [
    "Inspect donated page context and any pasted source copy before asking broad questions.",
    "Create or update a JSON-render intake artifact using the interactiveSurfaceTemplate.",
    "Ask only the next highest-impact missing question; preserve unknowns rather than inventing policy.",
    "Write answers into artifact state through the trusted question-answer controller only.",
    "Keep command execution as preview-only until a later validation/export/confirmation phase maps answers to trusted ORPC commands.",
  ],
  questionPolicy: {
    mode: "progressive_disclosure",
    askStyle: "one_high_impact_question_at_a_time",
    confidenceRequiredForAutofill: 0.75,
    neverInvent: ["pricing", "refund_policy", "cancellation_policy", "capacity", "payment_required", "legal_terms", "guest_access_rules"],
  },
  successEvidence: [
    "searchSkillCatalog returns booking.context.intake for booking context creation intent",
    "learnSkill returns question policy and an interactiveSurfaceTemplate with no executable command payload",
    "tool.askUserQuestion/tool.submitQuestionAnswer telemetry can be emitted by the controller when the UI flow runs",
    "artifact.intake.created/artifact.intake.version_created telemetry can be emitted by the artifact persistence seam when wired",
  ],
  telemetryEvents: [
    "tool.searchSkillCatalog",
    "tool.learnSkill",
    "tool.askUserQuestion",
    "tool.submitQuestionAnswer",
    "artifact.intake.created",
    "artifact.intake.version_created",
  ],
  forbiddenUnlessExplicit: [
    "booking.create.booking",
    "booking.create.hold",
    "booking.create.schedule.rule",
    "booking.create.pricing.rule",
  ],
  negativeRules: [
    "Do not turn an intake answer into approval for a booking write command.",
    "Do not call executeCommand or commitCommand from the JSON renderer or ask-user component.",
    "Do not invent pricing, refund, cancellation, capacity, payment, or legal policy when source material is thin.",
  ],
} as const;

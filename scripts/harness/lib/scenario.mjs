// Scenario definitions for the headless driver. P1 ships exactly one
// built-in scenario (booking-context-intake, the workflow named in the task)
// as a hand-authored json-render Spec with unanswered QuestionCard elements —
// the combinatorial scenario *generator* (phrasing/persona x answer-strategy
// x host-context) is explicitly P2 scope per
// docs/plans/high-volume-agent-harness-testing-2026-07-07.md.
//
// Why the driver authors the QuestionCards itself instead of waiting for the
// model to emit them via createBookingIntakeArtifact: in `--target local`
// with the mock stream (SONIK_AGENT_UI_SMOKE_STREAM), /api/generate always
// returns the same canned three-bullet text (see
// apps/standalone-sveltekit/src/lib/server/dev-smoke-stream.ts) — there is no
// live model to author a spec. Seeding the artifact directly via POST
// /api/artifact (exactly as scripts/agent-ui-booking-context-pipeb-smoke.mjs
// already does for its pre-filled fixture) lets the driver exercise the real
// question-answer loop machinery end to end without a live LLM. Against
// `--target deployed`, the same seeded artifact is a legitimate starting
// point too: the real model is asked to continue the intake from it.

export const BOOKING_CONTEXT_INTAKE_SCENARIO_ID = "booking-context-intake";

function questionCard(props, children = []) {
  return { type: "QuestionCard", props, children };
}

export function buildBookingContextIntakeScenario(input = {}) {
  const contextName = input.contextName ?? `Harness Cafe ${Date.now()}`;
  const artifactId = input.artifactId ?? `booking-context-intake-harness-${Date.now()}`;

  const spec = {
    root: "main",
    elements: {
      main: {
        type: "Card",
        props: { title: `${contextName} intake`, description: "Headless workflow harness intake draft." },
        children: ["q_intake_mode", "q_business_name", "q_inventory_description"],
      },
      q_intake_mode: questionCard({
        questionId: "q_intake_mode",
        title: "What kind of setup is this?",
        body: "Choose the booking manifest type for this context.",
        answerType: "single_choice",
        required: true,
        allowSkip: false,
        writesTo: "/manifest/intakeMode",
        choices: [
          { value: "venue_schedule", label: "Venue with a recurring schedule" },
          { value: "event", label: "Single event" },
        ],
      }),
      q_business_name: questionCard({
        questionId: "q_business_name",
        title: "What is the business name?",
        answerType: "short_text",
        required: true,
        allowSkip: false,
        writesTo: "/manifest/business/name",
      }),
      q_inventory_description: questionCard({
        questionId: "q_inventory_description",
        title: "Describe the bookable inventory.",
        body: "A short description of what guests are reserving (tables, courts, rooms, etc).",
        answerType: "long_text",
        required: true,
        allowSkip: false,
        writesTo: "/manifest/inventory/coreDescription",
      }),
    },
    state: {
      surface: { skillId: "booking.context.intake", id: BOOKING_CONTEXT_INTAKE_SCENARIO_ID },
      manifest: {
        manifestType: "venue_schedule",
        status: "draft",
        source: { createdBy: "agent-ui-harness", skill: "booking.context.intake" },
        business: {},
        inventory: {},
      },
      answers: {},
      questionStates: {},
      questionErrors: {},
      questionSubmissions: {},
    },
  };

  return { artifactId, contextName, spec };
}

/**
 * Resolve a --scenario CLI value into a scenario descriptor. Accepts:
 *   - omitted/"default"/the built-in scenario id -> the built-in scenario
 *   - a path to a .json file containing {artifactId?, contextName?, spec}
 *   - an inline JSON string with the same shape
 */
export async function resolveScenario(value, { readFile = defaultReadFile } = {}) {
  if (!value || value === "default" || value === BOOKING_CONTEXT_INTAKE_SCENARIO_ID) {
    return buildBookingContextIntakeScenario();
  }
  const trimmed = value.trim();
  if (trimmed.startsWith("{")) {
    return normalizeScenarioInput(JSON.parse(trimmed));
  }
  const text = await readFile(trimmed, "utf8");
  return normalizeScenarioInput(JSON.parse(text));
}

function normalizeScenarioInput(raw) {
  if (!raw || typeof raw !== "object" || !raw.spec) {
    throw new Error("Scenario file/inline JSON must be an object with a `spec` field (a json-render Spec).");
  }
  return {
    artifactId: raw.artifactId ?? `booking-context-intake-harness-${Date.now()}`,
    contextName: raw.contextName ?? "Harness scenario",
    spec: raw.spec,
  };
}

async function defaultReadFile(path, encoding) {
  const { readFile } = await import("node:fs/promises");
  return readFile(path, encoding);
}

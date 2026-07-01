import assert from "node:assert/strict";
import { createInteractiveSurfaceJsonRenderSpec } from "../../packages/json-ui-runtime/src/intake.ts";
import { explorerCatalog } from "../../apps/standalone-sveltekit/src/lib/render/catalog.ts";
import { createQuestionStateUpdateRecord } from "../../apps/standalone-sveltekit/src/lib/render/question-state.ts";
import {
  createAskUserQuestionSpec,
  createInteractiveSurfaceSpec,
} from "../../packages/tool-contracts/src/index.ts";

const surface = createInteractiveSurfaceSpec({
  id: "surface_booking_context_intake_lite",
  kind: "question_group",
  title: "Create booking context",
  description: "Ask one operational question at a time.",
  questions: [
    createAskUserQuestionSpec({
      id: "q_mode",
      title: "What are we configuring?",
      body: "Choose the intake mode.",
      answerType: "choice_cards",
      choices: [
        { value: "venue_schedule", label: "Venue schedule", description: "Recurring inventory." },
        { value: "event", label: "Event", description: "Time-bound experience." },
      ],
      writesTo: "/manifest/intakeMode",
    }),
  ],
});

const spec = createInteractiveSurfaceJsonRenderSpec(surface);
const validation = explorerCatalog.validate(spec);
assert.equal(validation.success, true, validation.success ? "" : JSON.stringify(validation.errors, null, 2));
assert.equal(explorerCatalog.componentNames.includes("QuestionCard"), true, "QuestionCard must be part of the AI-visible component catalog");
assert.equal(explorerCatalog.componentNames.includes("ManifestPreview"), true, "ManifestPreview must be part of the AI-visible component catalog");
assert.equal(explorerCatalog.componentNames.includes("ActionRail"), true, "ActionRail must be part of the AI-visible component catalog");
assert.deepEqual(explorerCatalog.actionNames, [], "intake renderer catalog should not add executable actions");

assert.throws(() => createInteractiveSurfaceSpec({
  id: "unsafe_surface",
  kind: "question_group",
  title: "Unsafe surface",
  questions: [{
    id: "__proto__",
    title: "Unsafe id",
    body: "Unsafe id",
    answerType: "short_text",
  }],
}), /prototype-polluting/, "interactive surfaces must reject unsafe question ids before renderer state paths exist");

const collisionSurface = createInteractiveSurfaceSpec({
  id: "surface_collision_free_questions",
  kind: "question_group",
  title: "Collision-free questions",
  questions: [
    { id: "a/b", title: "A slash B", body: "First", answerType: "short_text" },
    { id: "a-b", title: "A dash B", body: "Second", answerType: "short_text" },
  ],
});
const collisionSpec = createInteractiveSurfaceJsonRenderSpec(collisionSurface);
const collisionQuestionElementIds = Object.entries(collisionSpec.elements)
  .filter(([, element]) => element.type === "QuestionCard")
  .map(([id]) => id);
assert.equal(collisionQuestionElementIds.length, 2, "distinct safe question ids must produce distinct renderer elements");
assert.equal(new Set(collisionQuestionElementIds).size, 2, "question element ids must be collision-free after renderer normalization");
assert.notEqual(collisionQuestionElementIds[0], collisionQuestionElementIds[1], "a/b and a-b must not collapse into the same element id");
assert.deepEqual(collisionSpec.elements.main.children.slice(1), collisionQuestionElementIds, "main children should reference every collision-free question element");

const question = surface.questions[0];
const updates = createQuestionStateUpdateRecord({
  question,
  value: "venue_schedule",
  now: "2026-06-30T12:00:00.000Z",
});
assert.equal(updates["/answers/q_mode"], "venue_schedule");
assert.equal(updates["/manifest/intakeMode"], "venue_schedule");
assert.equal(updates["/questionStates/q_mode"], "answered");
assert.equal(updates["/questionSubmissions/q_mode"].metadata.execution, "none", "question submissions must not execute commands");
assert.equal(updates["/questionSubmissions/q_mode"].metadata.approval, "not_granted", "question submissions must not grant approvals");

assert.throws(() => createQuestionStateUpdateRecord({
  question: { ...question, writesTo: "/questionStates/q_mode" },
  value: "venue_schedule",
  now: "2026-06-30T12:02:00.000Z",
}), /unsafe_writes_to/, "Svelte adapter state controller must reject writes outside the manifest draft namespace");

const skipped = createQuestionStateUpdateRecord({
  question,
  skipped: true,
  now: "2026-06-30T12:01:00.000Z",
});
assert.equal(skipped["/answers/q_mode"], "unknown", "skips should preserve an explicit unknown answer value");
assert.equal(skipped["/questionStates/q_mode"], "skipped");

console.log("json-render intake adapter tests passed");

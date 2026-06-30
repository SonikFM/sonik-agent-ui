import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { BOOKING_RESERVATION_CREATE_RECIPE } from "../../apps/standalone-sveltekit/src/lib/server/booking-workflows/reservation-create.ts";

const bookingArtifacts = JSON.parse(await readFile("tests/fixtures/generated/sonik-booking-command-artifacts.generated.json", "utf8"));
const globalRegistry = JSON.parse(await readFile("tests/fixtures/generated/sonik-global-command-registry.generated.json", "utf8"));
const regression = JSON.parse(await readFile("tests/fixtures/sonik-booking/reservation-workflow-regression.json", "utf8"));

const recipe = BOOKING_RESERVATION_CREATE_RECIPE;
const expectedPath = ["booking.get.availability", "booking.create.guest", "booking.create.booking"];
const bookingCommands = new Map(bookingArtifacts.catalog.commands.map((command) => [command.id, command]));
const globalCommands = new Map(globalRegistry.catalog.commands.map((command) => [command.id, command]));

assert.equal(recipe.id, "booking.reservation.create");
assert.equal(recipe.canonicalRegressionPrompt, "Create a reservation for Dan at 1pm July 1 for 3.");
assert.deepEqual(recipe.commandSequence, expectedPath, "reservation recipe encodes the durable booking command path");
assert.deepEqual(recipe.steps.map((step) => step.commandId), expectedPath, "steps mirror the canonical command path");
assert.deepEqual(recipe.steps.map((step) => step.action), ["execute", "commit", "commit"], "reservation flow reads first, then writes with approval");
assert.ok(recipe.forbiddenUnlessExplicit.includes("booking.create.hold"), "hold creation is forbidden for reservation intent unless explicit");
assert.ok(recipe.actorFields.includes("userId"), "recipe marks actor/principal fields as identity-sensitive");
assert.ok(recipe.guestFields.includes("guestId"), "recipe keeps guest/customer identity separate from host actor identity");
assert.ok(recipe.trustedActorRules.some((rule) => /Do not create a guest\/customer record to satisfy a trusted host principal/i.test(rule)), "recipe blocks the observed host-principal-as-guest regression");
assert.ok(recipe.successEvidence.some((line) => /Pipe B telemetry/i.test(line)), "recipe requires Pipe B proof, not only local metadata");
assert.equal(recipe.negativeTranscriptRegression.prompt, recipe.canonicalRegressionPrompt, "negative regression uses the exact failed manual prompt");
assert.deepEqual(recipe.negativeTranscriptRegression.expectedCommandPath, expectedPath);
assert.ok(recipe.negativeTranscriptRegression.failIfCommandIds.includes("booking.create.hold"));

for (const commandId of [...expectedPath, ...recipe.forbiddenUnlessExplicit]) {
  const bookingCommand = bookingCommands.get(commandId);
  const globalCommand = globalCommands.get(commandId);
  assert.ok(bookingCommand, `booking artifact contains ${commandId}`);
  assert.ok(globalCommand, `global registry contains ${commandId}`);
  assert.equal(bookingCommand.id, globalCommand.id, `${commandId} id matches across registries`);
}

const availability = bookingCommands.get("booking.get.availability");
const guestCreate = bookingCommands.get("booking.create.guest");
const bookingCreate = bookingCommands.get("booking.create.booking");
const holdCreate = bookingCommands.get("booking.create.hold");
assert.equal(availability.effect, "read");
assert.equal(availability.approval, "none");
assert.equal(guestCreate.effect, "write");
assert.equal(guestCreate.approval, "required");
assert.equal(bookingCreate.effect, "write");
assert.equal(bookingCreate.approval, "required");
assert.equal(holdCreate.effect, "write");
assert.equal(holdCreate.approval, "required");
assert.equal(recipe.commandSequence.includes("booking.create.hold"), false, "reservation recipe never silently downgrades into a temporary hold");
assert.equal(bookingCreate.auth.orgScoped, true, "booking creation remains org scoped");
assert.equal(bookingCreate.auth.required, true, "booking creation requires authenticated host context");

function classifyReservationTranscript(transcript, recipe) {
  const reasons = [];
  const calls = Array.isArray(transcript.toolCalls) ? transcript.toolCalls : [];
  const commandIds = calls.map((call) => call.commandId).filter(Boolean);
  for (const forbiddenId of recipe.negativeTranscriptRegression.failIfCommandIds) {
    if (commandIds.includes(forbiddenId)) reasons.push(`forbidden_command:${forbiddenId}`);
  }
  const normalizedText = String(transcript.assistantText ?? "").toLowerCase();
  for (const phrase of recipe.negativeTranscriptRegression.failIfRationalesContain) {
    if (normalizedText.includes(phrase.toLowerCase())) reasons.push(`bad_rationale:${phrase}`);
  }
  for (const call of calls) {
    const parsed = parseInput(call.inputJson ?? call.input ?? {});
    if (call.commandId === "booking.create.guest" && hasAny(parsed, recipe.negativeTranscriptRegression.failIfActorFieldsMutated)) {
      reasons.push("guest_creation_mutates_actor_fields");
    }
    const userId = typeof parsed.userId === "string" ? parsed.userId : "";
    if (/CURRENT_HOST_PRINCIPAL_ID|179b55fd-179b-77c3-aff1-8a53359b07bf/i.test(userId)) {
      reasons.push("trusted_actor_user_id_leaked_into_booking_identity");
    }
  }
  const path = commandIds.filter((id) => recipe.commandSequence.includes(id));
  if (path.join(" > ") !== recipe.commandSequence.join(" > ")) {
    reasons.push(`wrong_command_path:${path.join(">") || "none"}`);
  }
  return { ok: reasons.length === 0, reasons, commandIds };
}

function parseInput(input) {
  if (typeof input === "string") {
    try { return JSON.parse(input); } catch { return {}; }
  }
  return input && typeof input === "object" && !Array.isArray(input) ? input : {};
}

function hasAny(record, fields) {
  return fields.some((field) => Object.hasOwn(record, field));
}

const badResult = classifyReservationTranscript(regression.badTranscript, recipe);
assert.equal(badResult.ok, false, "observed weak-model reservation transcript must fail the regression gate");
assert.ok(badResult.reasons.includes("forbidden_command:booking.create.hold"), "regression catches accidental hold usage");
assert.ok(badResult.reasons.includes("guest_creation_mutates_actor_fields"), "regression catches guest creation used to provision actor fields");
assert.ok(badResult.reasons.includes("trusted_actor_user_id_leaked_into_booking_identity"), "regression catches trusted host principal leakage");

const goodResult = classifyReservationTranscript(regression.goodTranscript, recipe);
assert.equal(goodResult.ok, true, `canonical availability -> guest -> booking transcript passes: ${goodResult.reasons.join(",")}`);
assert.deepEqual(goodResult.commandIds, expectedPath);

console.log(JSON.stringify({
  ok: true,
  recipeId: recipe.id,
  canonicalPrompt: recipe.canonicalRegressionPrompt,
  commandSequence: recipe.commandSequence,
  forbiddenUnlessExplicit: recipe.forbiddenUnlessExplicit,
  badTranscriptReasons: badResult.reasons,
}));

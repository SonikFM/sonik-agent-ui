import assert from "node:assert/strict";
import { createWorkflowSuggestions } from "../../apps/standalone-sveltekit/src/lib/agent-workflows/suggestions.ts";

const defaultSuggestions = createWorkflowSuggestions(null);
assert.deepEqual(defaultSuggestions.map((entry) => entry.label), [
  "Set up a venue",
  "Create an event",
  "Create reservation",
  "Create campaign template",
]);
assert.deepEqual(defaultSuggestions.map((entry) => entry.skillId), [
  "booking.context.intake",
  "booking.event.create",
  "booking.reservation.create",
  "amplify.campaign.template.create",
]);
for (const suggestion of defaultSuggestions) {
  assert.match(suggestion.prompt, /searchSkillCatalog/);
  assert.match(suggestion.prompt, /learnSkill/);
  assert.equal(suggestion.prompt.includes("Weather"), false);
  assert.equal(suggestion.prompt.includes("GitHub"), false);
  assert.equal(suggestion.prompt.includes("Crypto"), false);
  assert.equal(suggestion.prompt.includes("Hacker News"), false);
}

const bookingDetailSuggestions = createWorkflowSuggestions({
  surface: "booking-console",
  pageType: "event-booking-detail",
  skillFamilies: ["booking-reservation", "booking-ops"],
  commandFamilies: ["booking-reservations"],
});
assert.equal(bookingDetailSuggestions[0].skillId, "booking.reservation.create");
assert.match(bookingDetailSuggestions[0].prompt, /booking\.get\.availability/);
assert.match(bookingDetailSuggestions[0].prompt, /booking\.create\.guest/);
assert.match(bookingDetailSuggestions[0].prompt, /booking\.create\.booking/);
assert.match(bookingDetailSuggestions[0].prompt, /Do not use booking\.create\.hold/);

const campaignSuggestions = createWorkflowSuggestions({
  surface: "amplify-campaign-wizard",
  pageType: "campaign-template",
  skillFamilies: ["amplify-campaign-template"],
  commandFamilies: ["amplify-campaigns"],
});
assert.equal(campaignSuggestions[0].skillId, "amplify.campaign.template.create");
assert.match(campaignSuggestions[0].prompt, /do not send|Do not send/i);

const eventSuggestions = createWorkflowSuggestions({
  surface: "event-console",
  pageType: "event-create",
  skillFamilies: ["booking-event"],
});
assert.equal(eventSuggestions[0].skillId, "booking.event.create");

const venueSuggestions = createWorkflowSuggestions({
  surface: "booking-context-intake",
  pageType: "venue-schedule",
  skillFamilies: ["booking-context-intake"],
});
assert.equal(venueSuggestions[0].skillId, "booking.context.intake");
assert.match(venueSuggestions[0].prompt, /Do not execute booking mutations/);

const filteredBookingSuggestions = createWorkflowSuggestions({
  surface: "booking-console",
  pageType: "event-booking-detail",
  skillFamilies: ["booking-reservation"],
}, { mode: "filtered" });
assert.deepEqual(filteredBookingSuggestions.map((entry) => entry.skillId), ["booking.reservation.create"]);

const filteredUnknownSuggestions = createWorkflowSuggestions({
  surface: "chat",
  pageType: "standalone-agent-workspace",
  skillFamilies: ["chat"],
}, { mode: "filtered" });
assert.deepEqual(filteredUnknownSuggestions, []);

console.log("workflow-suggestions tests passed");

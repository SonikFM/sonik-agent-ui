import assert from "node:assert/strict";
import {
  filterComposerSuggestions,
  findComposerTrigger,
  replaceComposerTrigger,
} from "../../packages/chat-surface/src/composer-context.ts";

const items = [
  { id: "booking.reservation.create", label: "Create reservation", kind: "skill" },
  { id: "booking.list", label: "List bookings", kind: "command" },
];

assert.deepEqual(findComposerTrigger("plan $reserv"), { marker: "$", query: "reserv", start: 5 });
assert.deepEqual(filterComposerSuggestions(items, findComposerTrigger("$reserv")).map((item) => item.kind), ["skill"]);
assert.deepEqual(filterComposerSuggestions(items, findComposerTrigger("/book")).map((item) => item.kind), ["skill", "command"]);
assert.equal(replaceComposerTrigger("please /book", findComposerTrigger("please /book"), "/booking.list "), "please /booking.list ");
assert.equal(findComposerTrigger("plain text"), null);
assert.deepEqual(filterComposerSuggestions(items, findComposerTrigger("#venue")), [], "knowledge stays honest until its data source exists");

console.log("composer-context-tools.test.mjs: all assertions passed");

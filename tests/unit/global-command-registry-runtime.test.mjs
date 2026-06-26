import assert from "node:assert/strict";
import {
  getGlobalCommandRegistryArtifact,
  getGlobalCommandRegistrySummary,
  learnGlobalCommand,
  parseCommandLearnAspects,
  parseGlobalCommandRegistryContextFromSearchParams,
  searchGlobalCommandRegistry,
} from "../../apps/standalone-sveltekit/src/lib/server/global-command-registry.ts";

const summary = getGlobalCommandRegistrySummary();
assert.equal(summary.version, "sonik-agent-ui.global-command-registry.v1");
assert.equal(summary.provider, "sonik-global-command-registry");
assert.equal(summary.summary.commandCount, 71, "global registry exposes generated booking command count");
assert.equal(summary.providers[0].provider, "sonik-booking-openapi-fixture");
assert.equal(JSON.stringify(summary).includes("/Users/"), false, "runtime summary must not leak local paths");

const registry = getGlobalCommandRegistryArtifact({ startupLimit: 20 });
assert.equal(registry.startupIndex.version, "sonik-agent-ui.command-index.v1");
assert.deepEqual(registry.startupIndex.commands.map((command) => command.id).sort(), [
  "booking.get.organizer.template",
  "booking.list.organizer.templates",
  "booking.ping",
]);
assert.equal(JSON.stringify(registry.startupIndex).includes("inputSchema"), false, "startup index remains schema-free");
assert.equal(registry.registry.familyCount, 12);

const bookingContext = parseGlobalCommandRegistryContextFromSearchParams(new URLSearchParams({
  surface: "booking-admin",
  commandFamilies: "booking,event",
  skillFamilies: "sonik-booking",
  authenticated: "true",
  organizationId: "org_booking",
  scopes: "booking:read",
}));
assert.equal(bookingContext.authenticated, true);
assert.equal(bookingContext.organizationId, "org_booking");
assert.deepEqual(bookingContext.commandFamilies, ["booking", "event"]);

const surfaceSearch = searchGlobalCommandRegistry({ query: "booking context", limit: 8, context: bookingContext });
assert.equal(surfaceSearch.kind, "global-command-registry-search");
assert.equal(surfaceSearch.provider, "sonik-global-command-registry");
assert.equal(surfaceSearch.commands.length <= 8, true);
assert.equal(surfaceSearch.commands.some((command) => command.id === "booking.create.context"), true, "search finds create context command");
assert.equal(surfaceSearch.commands.find((command) => command.id === "booking.create.context")?.contextLoaded, true, "booking surface marks matching generated command as context-loaded");
assert.equal(surfaceSearch.commands.every((command) => !Object.hasOwn(command, "input") && !Object.hasOwn(command, "inputSchemaJson")), true, "search summaries stay schema-free");
assert.equal(surfaceSearch.contextIndex.totalMatches, 71, "booking surface can expose all generated booking commands as summaries");

const lazySearch = searchGlobalCommandRegistry({ query: "reservation", limit: 5 });
assert.equal(lazySearch.commands.length <= 5, true);
assert.equal(lazySearch.commands.some((command) => command.id.includes("booking")), true, "lazy search finds booking commands outside surface context");

const learned = learnGlobalCommand({ commandId: "booking.create.booking", aspects: ["schema", "policy", "transport", "auth"] });
assert.equal(learned.ok, true);
assert.equal(learned.commandId, "booking.create.booking");
assert.equal(learned.transport.runtimeStatus, "shadow", "generated command remains shadow until runtime adapter mount");
assert.equal(learned.auth.orgScoped, true);
assert.equal(learned.policy.readOnly, false);
assert.ok(learned.inputSchema, "learn endpoint returns schema only after command selection");

const unknown = learnGlobalCommand({ commandId: "missing.command" });
assert.equal(unknown.ok, false);
assert.equal(unknown.error, "UNKNOWN_COMMAND");

assert.deepEqual(parseCommandLearnAspects("schema,transport,invalid,auth"), ["schema", "transport", "auth"]);
assert.equal(parseCommandLearnAspects(null), undefined);

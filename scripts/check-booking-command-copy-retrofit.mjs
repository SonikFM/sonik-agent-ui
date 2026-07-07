import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const methodNames = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);
const expectedSdkRegistryDrift = {
  missingFromCopiedSdkRegistry: [
    "booking.create.guest",
    "booking.get.media.asset.variant",
    "booking.search.guests",
  ],
  staleInCopiedSdkRegistry: [
    "booking.create.customer",
    "booking.search.customers",
  ],
};

const paths = {
  copiedOpenApi: "docs/upstream-proofs/booking-service/packages/sonik-sdk/docs/booking-openapi.generated.json",
  copiedRegistry: "docs/upstream-proofs/booking-service/packages/sonik-sdk/docs/sonik-command-registry.generated.json",
  copiedSdkConstants: "docs/upstream-proofs/booking-service/packages/sonik-sdk/src/agent-command-registry.ts",
  copiedRegistryCheck: "docs/upstream-proofs/booking-service/packages/sonik-sdk/scripts/check-agent-command-registry.mjs",
  fixtureOpenApi: "tests/fixtures/sonik-booking/booking-openapi.fixture.json",
  bookingGenerated: "tests/fixtures/generated/sonik-booking-command-artifacts.generated.json",
  globalGenerated: "tests/fixtures/generated/sonik-global-command-registry.generated.json",
  bookingManifest: "manifests/copy-retrofit/booking-service-generated-command-registry.json",
  mcpManifest: "manifests/copy-retrofit/sonik-mcp-command-doctrine.json",
};

const [
  copiedOpenApiText,
  copiedRegistryText,
  copiedSdkConstantsText,
  copiedRegistryCheckText,
  fixtureOpenApi,
  bookingGenerated,
  globalGenerated,
  bookingManifest,
  mcpManifest,
] = await Promise.all([
  readText(paths.copiedOpenApi),
  readText(paths.copiedRegistry),
  readText(paths.copiedSdkConstants),
  readText(paths.copiedRegistryCheck),
  readJson(paths.fixtureOpenApi),
  readJson(paths.bookingGenerated),
  readJson(paths.globalGenerated),
  readJson(paths.bookingManifest),
  readJson(paths.mcpManifest),
]);

const copiedOpenApi = JSON.parse(copiedOpenApiText);
const copiedRegistry = JSON.parse(copiedRegistryText);
const provenance = fixtureOpenApi["x-fixture-provenance"];

assert.equal(provenance.sourceRevision, bookingManifest.upstream.revision, "fixture provenance must cite copied booking-service revision");
assert.equal(provenance.sourceSha256, sha256(copiedOpenApiText), "fixture provenance must cite copied full OpenAPI hash");
assert.equal(provenance.sourcePath, "packages/sonik-sdk/docs/booking-openapi.generated.json");
assert.equal(provenance.sourceOperationCount, countOpenApiOperations(copiedOpenApi), "fixture provenance records full source OpenAPI operation count");
assert.equal(provenance.extractedOperationCount, countOpenApiOperations(fixtureOpenApi), "fixture provenance records command-generation operation count");
assert.equal(provenance.extractedOperationCount, bookingGenerated.summary.operationCount, "generator input operation count matches fixture operation count");
assert.deepEqual(withoutFixtureProvenance(fixtureOpenApi), copiedOpenApi, "booking OpenAPI fixture must be a direct full-source copy plus x-fixture-provenance only");

assert.equal(countOpenApiOperations(copiedOpenApi), 72, "copied full booking OpenAPI currently has 72 operations");
assert.equal(bookingGenerated.summary.operationCount, 72, "generator fixture exposes the full copied booking OpenAPI command surface");
assert.equal(bookingGenerated.summary.commandCount, 72, "Agent UI generated booking commands remain one command per copied OpenAPI operation");
assert.equal(bookingGenerated.summary.familyCount, 12, "booking family taxonomy remains stable");
assertGeneratedCommandsMapToCopiedOpenApi(bookingGenerated.catalog.commands, copiedOpenApi);

const copiedRegistryIds = copiedRegistry.catalog.commands.map((command) => command.id).sort();
const generatedIds = bookingGenerated.catalog.commands.map((command) => command.id).sort();
const missingFromCopiedSdkRegistry = generatedIds.filter((id) => !copiedRegistryIds.includes(id));
const staleInCopiedSdkRegistry = copiedRegistryIds.filter((id) => !generatedIds.includes(id));
assert.deepEqual(missingFromCopiedSdkRegistry, expectedSdkRegistryDrift.missingFromCopiedSdkRegistry, "copied booking SDK command registry drift must stay explicit and reviewed");
assert.deepEqual(staleInCopiedSdkRegistry, expectedSdkRegistryDrift.staleInCopiedSdkRegistry, "stale copied booking SDK command ids must stay explicit and reviewed");
assert.equal(copiedRegistry.summary.familyCount, bookingGenerated.summary.familyCount, "copied SDK registry and generated Agent UI fixture agree on family count");

assert.equal(globalGenerated.summary.commandCount, bookingGenerated.summary.commandCount, "global registry promotes all booking commands");
assert.equal(globalGenerated.providers[0].source.sourceRepo, "sonik-booking-service", "global registry normalizes local source repo path");
assert.equal(globalGenerated.providers[0].source.sourceSha256, provenance.sourceSha256, "global registry preserves copied source hash provenance");
assert.equal(JSON.stringify(globalGenerated).includes("/Users/"), false, "global registry does not leak absolute local paths");

assert.ok(copiedSdkConstantsText.includes("sonikCommandRegistryArtifactVersion"), "copied SDK constants include registry artifact version seam");
assert.ok(copiedRegistryCheckText.includes("sonik-command-registry.generated.json"), "copied SDK check script documents booking-side deterministic registry gate");

for (const manifest of [bookingManifest, mcpManifest]) {
  assert.equal(Array.isArray(manifest.entries), true);
  assert.equal(manifest.allowedLocalModifications.length, 0, `${manifest.name} must remain direct-copy only`);
  for (const entry of manifest.entries) {
    assert.equal(typeof entry.integrity?.files?.[0]?.sha256, "string", `${manifest.name}:${entry.destination} has integrity hash`);
  }
}

console.log(JSON.stringify({
  ok: true,
  copiedOpenApiOperations: countOpenApiOperations(copiedOpenApi),
  generatedBookingCommands: bookingGenerated.summary.commandCount,
  globalCommands: globalGenerated.summary.commandCount,
  bookingSourceRevision: provenance.sourceRevision,
  bookingSourceSha256: provenance.sourceSha256,
  copiedSdkRegistryKnownDrift: expectedSdkRegistryDrift,
}));

async function readText(path) {
  return readFile(path, "utf8");
}

async function readJson(path) {
  return JSON.parse(await readText(path));
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function countOpenApiOperations(document) {
  return Object.values(document.paths ?? {}).reduce((count, pathItem) => count + Object.keys(pathItem ?? {}).filter((method) => methodNames.has(method.toLowerCase())).length, 0);
}

function withoutFixtureProvenance(document) {
  const clone = structuredClone(document);
  delete clone["x-fixture-provenance"];
  return clone;
}

function assertGeneratedCommandsMapToCopiedOpenApi(commands, openApi) {
  const operations = new Map();
  for (const [path, pathItem] of Object.entries(openApi.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      const normalizedMethod = method.toLowerCase();
      if (!methodNames.has(normalizedMethod)) continue;
      operations.set(`${normalizedMethod.toUpperCase()} ${path}`, operation.operationId);
    }
  }

  for (const command of commands) {
    const method = command.transport?.method;
    const path = command.transport?.path;
    const operationId = command.metadata?.sourceOperationId;
    assert.equal(typeof method, "string", `${command.id} records transport method`);
    assert.equal(typeof path, "string", `${command.id} records transport path`);
    assert.equal(typeof operationId, "string", `${command.id} records source operation id`);
    const key = `${method.toUpperCase()} ${path}`;
    assert.equal(operations.has(key), true, `${command.id} maps to copied OpenAPI operation ${key}`);
    assert.equal(operations.get(key), operationId, `${command.id} source operation id matches copied OpenAPI`);
  }
}

import assert from "node:assert/strict";

const moduleUrl = new URL("../../apps/standalone-sveltekit/src/lib/artifacts/artifact-warehouse.ts", import.meta.url).href;
const { createInMemoryArtifactWarehouse } = await import(moduleUrl);

function specWithCity(city) {
  return {
    root: "main",
    elements: {
      main: {
        type: "Card",
        props: { title: `${city} Weather`, description: `Current city: ${city}` },
        children: [],
      },
    },
    state: { city },
  };
}

function jsonArtifact({ id = "artifact-weather", title = "Weather", version = 1, city = "NYC", now = `2026-06-21T00:00:0${version}.000Z` } = {}) {
  return {
    id,
    kind: "json-render",
    title,
    version,
    content: specWithCity(city),
    createdAt: "2026-06-21T00:00:00.000Z",
    updatedAt: now,
  };
}

const warehouse = createInMemoryArtifactWarehouse();
const first = warehouse.commitJsonRenderArtifact({ sessionId: "session-a", artifact: jsonArtifact({ city: "NYC" }), source: "agent", now: "2026-06-21T00:00:01.000Z" });
assert.equal(first.record.artifactId, "artifact-weather");
assert.equal(first.record.sessionId, "session-a");
assert.equal(first.record.kind, "json-render");
assert.equal(first.record.currentVersionId, "artifact-weather:v1");
assert.equal(first.artifact.version, 1);
assert.equal(first.artifact.content.state.city, "NYC");
assert.equal(first.versions.length, 1);

const second = warehouse.commitJsonRenderArtifact({ sessionId: "session-a", artifact: jsonArtifact({ version: 2, city: "Tokyo" }), source: "agent", now: "2026-06-21T00:00:02.000Z" });
assert.equal(second.record.currentVersionId, "artifact-weather:v2");
assert.equal(second.artifact.version, 2);
assert.equal(second.artifact.content.state.city, "Tokyo");
assert.deepEqual(second.versions.map((entry) => entry.version), [1, 2]);
assert.deepEqual(second.versions.map((entry) => entry.source), ["agent", "agent"]);

const selectedFirst = warehouse.selectJsonRenderArtifactVersion({ sessionId: "session-a", artifactId: "artifact-weather", version: 1 });
assert.ok(selectedFirst);
assert.equal(selectedFirst.artifact.version, 1);
assert.equal(selectedFirst.artifact.content.state.city, "NYC");
assert.equal(warehouse.getActiveJsonRenderArtifact("session-a")?.artifact.content.state.city, "NYC");

const manualEdit = warehouse.commitJsonRenderArtifact({ sessionId: "session-a", artifact: jsonArtifact({ version: 3, city: "Paris" }), source: "user-edit", now: "2026-06-21T00:00:03.000Z" });
assert.equal(manualEdit.artifact.version, 3);
assert.equal(manualEdit.artifact.content.state.city, "Paris");
assert.deepEqual(manualEdit.versions.map((entry) => entry.source), ["agent", "agent", "user-edit"]);

const noDuplicate = warehouse.commitJsonRenderArtifact({ sessionId: "session-a", artifact: jsonArtifact({ version: 4, city: "Paris" }), source: "agent", now: "2026-06-21T00:00:04.000Z" });
assert.equal(noDuplicate.versions.length, 3, "same payload should not create duplicate versions");
assert.equal(noDuplicate.artifact.version, 3);

warehouse.clearActiveArtifact("session-a");
assert.equal(warehouse.getActiveJsonRenderArtifact("session-a"), null);
warehouse.commitJsonRenderArtifact({ sessionId: "session-a", artifact: jsonArtifact({ version: 5, city: "Lisbon" }), source: "agent", now: "2026-06-21T00:00:05.000Z" });
assert.equal(warehouse.getActiveJsonRenderArtifact("session-a")?.artifact.content.state.city, "Lisbon");
warehouse.deleteSession("session-a");
assert.equal(warehouse.getActiveJsonRenderArtifact("session-a"), null);

const collisionWarehouse = createInMemoryArtifactWarehouse();
collisionWarehouse.commitJsonRenderArtifact({ sessionId: "session-a", artifact: jsonArtifact({ id: "same-id", city: "A" }), source: "agent" });
collisionWarehouse.commitJsonRenderArtifact({ sessionId: "session-b", artifact: jsonArtifact({ id: "same-id", city: "B" }), source: "agent" });
assert.equal(collisionWarehouse.getActiveJsonRenderArtifact("session-a")?.artifact.content.state.city, "A", "same public artifact id in session B must not overwrite session A");
assert.equal(collisionWarehouse.getActiveJsonRenderArtifact("session-b")?.artifact.content.state.city, "B");
assert.equal(collisionWarehouse.selectJsonRenderArtifactVersion({ sessionId: "session-a", artifactId: "same-id", version: 1 })?.artifact.content.state.city, "A");
assert.equal(collisionWarehouse.selectJsonRenderArtifactVersion({ sessionId: "session-b", artifactId: "same-id", version: 1 })?.artifact.content.state.city, "B");

console.log("artifact-warehouse tests passed");

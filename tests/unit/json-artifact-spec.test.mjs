import assert from "node:assert/strict";
import { normalizeJsonArtifactSpec } from "../../apps/standalone-sveltekit/src/lib/artifacts/json-artifact-spec.ts";

const empty = normalizeJsonArtifactSpec({ root: "main", elements: {}, state: {} }, "My Capabilities");
assert.equal(empty.recovered, true);
assert.equal(empty.reason, "empty_elements");
assert.equal(empty.spec.root, "main");
assert.ok(empty.spec.elements.main, "empty spec recovery should create a renderable root element");
assert.equal(empty.spec.elements.main.type, "Card");

const missingRoot = normalizeJsonArtifactSpec({ root: "main", elements: { card: { type: "Card", props: { title: "OK" } } } }, "Fallback");
assert.equal(missingRoot.recovered, true);
assert.equal(missingRoot.reason, "missing_root_element");
assert.equal(missingRoot.spec.root, "card");

const valid = normalizeJsonArtifactSpec({ root: "main", elements: { main: { type: "Text", props: { content: "Hello" }, children: [] } }, state: { ok: true } }, "Valid");
assert.equal(valid.recovered, false);
assert.equal(valid.spec.root, "main");
assert.deepEqual(valid.spec.state, { ok: true });

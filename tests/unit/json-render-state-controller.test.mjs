import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const controller = await import("../../apps/standalone-sveltekit/src/lib/render/json-render-state-controller.ts");

const {
  applyJsonRenderStateChanges,
  buildJsonRenderStatePatchPayload,
  createJsonRenderStateSignature,
  createJsonRenderStateStore,
  normalizeJsonRenderStateChanges,
} = controller;

const spec = {
  root: "main",
  elements: {
    main: { type: "Card", props: { title: "Stateful" }, children: [] },
  },
  state: {
    schedule: { days: ["tuesday"], open: "09:00" },
    tables: [{ label: "2-top", count: 10 }],
  },
};

const store = createJsonRenderStateStore(spec);
assert.equal(store.get("/schedule/open"), "09:00");
store.set("/schedule/close", "17:00");
assert.equal(store.get("/schedule/close"), "17:00");
assert.equal(spec.state.schedule.close, undefined, "store should not mutate the original spec state");

const updated = applyJsonRenderStateChanges(spec, [
  { path: "/schedule/days/1", value: "wednesday" },
  { path: "/servicePeriods/0/name", value: "Breakfast" },
]);
assert.deepEqual(updated.state.schedule.days, ["tuesday", "wednesday"]);
assert.equal(updated.state.servicePeriods[0].name, "Breakfast");
assert.equal(spec.state.servicePeriods, undefined, "state patches should be immutable");
assert.notEqual(createJsonRenderStateSignature(spec), createJsonRenderStateSignature(updated));

assert.deepEqual(
  buildJsonRenderStatePatchPayload({ artifactId: "artifact-1", baseVersion: 2, changes: [{ path: "/x", value: 1 }], requestId: "req-1" }),
  { artifactId: "artifact-1", baseVersion: 2, changes: [{ path: "/x", value: 1 }], requestId: "req-1", summary: "JSON-render state patch" },
);

assert.throws(() => normalizeJsonRenderStateChanges([{ path: "", value: 1 }]), /non-root JSON Pointer/);
assert.throws(() => normalizeJsonRenderStateChanges([{ path: "/", value: 1 }]), /non-root JSON Pointer/);
assert.throws(() => buildJsonRenderStatePatchPayload({ artifactId: "artifact-1", baseVersion: 0, changes: [{ path: "/x", value: 1 }] }), /baseVersion/);

const pageSource = await readFile("apps/standalone-sveltekit/src/routes/+page.svelte", "utf8");
const stateRouteSource = await readFile("apps/standalone-sveltekit/src/routes/api/artifact/[id]/state/+server.ts", "utf8");
const stateProviderSource = await readFile("packages/svelte/src/contexts/StateProvider.svelte", "utf8");
assert.equal(pageSource.includes("store={activeArtifactStateStore}"), true, "active canvas renderer should receive the controlled artifact state store");
assert.equal(pageSource.includes("onStateChange={handleActiveArtifactStateChange}"), true, "active canvas renderer should persist state changes through the host controller");
assert.equal(pageSource.includes("/api/artifact/${encodeURIComponent(payload.artifactId)}/state"), true, "state patches should use the trusted artifact state endpoint");
assert.equal(stateRouteSource.includes("json_render.state_patch.persisted"), true, "artifact state endpoint should emit persisted telemetry");
assert.equal(stateRouteSource.includes("artifact-version-conflict"), true, "artifact state endpoint should expose recoverable version conflicts");
assert.equal(stateProviderSource.includes("if (next !== prev)"), true, "StateProvider should report writes in controlled and uncontrolled modes");

console.log("json-render state controller tests passed");

import assert from "node:assert/strict";
import { repairSpec } from "../../packages/json-ui-runtime/src/spec-repair.ts";
import { validateSpec } from "../../packages/core/dist/index.mjs";

// (a) Lossless-fixable: `visible` was emitted inside props instead of at the
// element level. autoFixSpec relocates it without touching children, so a
// single lossless pass is enough and the spec renders/validates after repair.
{
  const spec = {
    root: "root",
    elements: {
      root: {
        type: "Card",
        props: { visible: { $state: "/showCard", eq: true } },
        children: ["text"],
      },
      text: { type: "Text", props: { text: "hi" }, children: [] },
    },
  };
  assert.equal(validateSpec(spec).valid, false, "fixture should start invalid (visible_in_props)");

  const result = repairSpec(spec, { streamComplete: true });
  assert.ok(result, "repair should attempt on a spec-shaped candidate");
  assert.equal(result.repaired, true, "lossless fix should be applied");
  assert.equal(result.lossy, false, "relocating a misplaced field is not lossy");
  assert.equal(result.validation.valid, true, "spec should validate cleanly after lossless repair");
  assert.equal(result.spec.elements.root.visible?.$state, "/showCard", "visible should move to element level");
  assert.equal("visible" in result.spec.elements.root.props, false, "visible should be removed from props");
}

// (b) Dangling children: only fixable once lossy pruning is allowed. A
// lossless-only attempt (streamComplete: false skips the loop entirely per
// the mid-stream gate, so this exercises the terminal path explicitly) must
// leave the dangling reference in place; the terminal (streamComplete: true)
// pass prunes it.
{
  const spec = {
    root: "root",
    elements: {
      root: { type: "Card", props: {}, children: ["text", "ghost"] },
      text: { type: "Text", props: { text: "hi" }, children: [] },
    },
  };
  assert.equal(validateSpec(spec).valid, false, "fixture should start invalid (missing_child)");

  const terminal = repairSpec(spec, { streamComplete: true });
  assert.ok(terminal, "repair should attempt on a spec-shaped candidate");
  assert.equal(terminal.repaired, true, "lossy fix should be applied on the terminal attempt");
  assert.equal(terminal.lossy, true, "pruning a dangling child is a lossy fix");
  assert.equal(terminal.validation.valid, true, "spec should validate cleanly after lossy repair");
  assert.deepEqual(terminal.spec.elements.root.children, ["text"], "dangling child should be pruned");
}

// (c) Unrepairable garbage: a repeat container with only a dangling child
// template. autoFixSpec deliberately refuses to prune a repeat container down
// to zero children (that would only trade "missing_child" for
// "repeat_without_children"), so even the terminal lossy pass cannot fix it
// and it must still reach the degraded/rejection path.
{
  const spec = {
    root: "list",
    state: { items: [{ id: "1" }] },
    elements: {
      list: {
        type: "Stack",
        props: {},
        repeat: { statePath: "/items" },
        children: ["ghost"],
      },
    },
  };
  assert.equal(validateSpec(spec).valid, false, "fixture should start invalid (missing_child on repeat template)");

  const result = repairSpec(spec, { streamComplete: true });
  assert.ok(result, "repair should attempt on a spec-shaped candidate");
  assert.equal(result.validation.valid, false, "unrepairable spec should still fail validation after repair");
  assert.equal(
    result.validation.issues.some((issue) => issue.code === "missing_child"),
    true,
    "the real problem (missing repeat template) should remain visible for the degraded path",
  );
}

// (d) Partial/streaming spec must never be repaired: the loop is gated on
// streamComplete, and a spec with a dangling child that hasn't finished
// streaming yet must pass through untouched.
{
  const spec = {
    root: "root",
    elements: {
      root: { type: "Card", props: {}, children: ["text", "not-yet-streamed"] },
      text: { type: "Text", props: { text: "hi" }, children: [] },
    },
  };
  const result = repairSpec(spec, { streamComplete: false });
  assert.equal(result, null, "repair must be a no-op (null) while the stream is incomplete");
}

// Garbage that isn't even minimally spec-shaped (no elements map) must not
// throw and must be treated as "no repair attempted" rather than crashing
// the caller.
{
  const result = repairSpec({ notASpec: true }, { streamComplete: true });
  assert.equal(result, null, "non-spec-shaped candidates should not be repaired or throw");
}

console.log("spec autofix repair loop tests passed");

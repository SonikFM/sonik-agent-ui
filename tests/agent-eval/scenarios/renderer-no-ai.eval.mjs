#!/usr/bin/env node
// Node-level conformance check for the json-render fork's spec-resolution
// APIs, in the spirit of json-render/examples/no-ai (a static spec fixture
// with no AI generation involved — just $bindState/$cond/$template resolved
// against hand-authored state).
//
// CHOICE: this scenario exercises `resolveElementProps` / `resolveBindings` /
// `evaluateVisibility` directly (packages/core/src/{props,visibility}.ts)
// rather than mounting packages/svelte's Renderer.svelte in a browser.
// Browser-mounting a Svelte 5 component tree standalone (outside the
// standalone-sveltekit app's own build/route pipeline) would require a
// throwaway Vite/SvelteKit harness just for this eval bundle — infrastructure
// this task's file-scope constraints don't include, and which would be
// redundant with the app's own component tests
// (packages/svelte/src/renderer.test.ts). The core spec-resolution functions
// are the actual "no AI" contract surface: they're what turns a static JSON
// spec + state object into resolved props, independent of any renderer.
// Exercising them directly at the node level is deterministic, fast, and
// requires no new dependency (uses Node's --experimental-strip-types to
// import the package's .ts source directly, the same pattern the repo's own
// tests/unit/*.test.mjs already use for packages/core).
//
// Run directly: node --experimental-strip-types scenarios/renderer-no-ai.eval.mjs
// (normally invoked by scripts/agent-eval-gate.mjs)

import assert from "node:assert/strict";
import { getByPath, setByPath } from "../../../packages/core/src/types.ts";
import { resolveElementProps, resolveBindings, resolvePropValue } from "../../../packages/core/src/props.ts";
import { evaluateVisibility } from "../../../packages/core/src/visibility.ts";

const NAME = "renderer-no-ai";
const checks = {};

function record(name, fn) {
  try {
    fn();
    checks[name] = { ok: true };
  } catch (error) {
    checks[name] = { ok: false, detail: error?.message ?? String(error) };
  }
}

// A static spec fixture in the shape of json-render/examples/no-ai's
// "Registration Form" / "Cascading Selects" examples: a $bindState-driven
// input, a $cond-driven alert, and a $template preview string. No `elements`
// tree traversal or renderer is involved — this fixture only needs the
// `props` + `visible` blocks a renderer would resolve per element.
const state = {
  form: { name: "", email: "", accountType: "personal" },
  result: null,
};

const nameInputProps = {
  label: "Full Name",
  value: { $bindState: "/form/name" },
};

const previewProps = {
  text: { $template: "Welcome, ${/form/name}! Your email: ${/form/email}" },
};
const previewVisible = { $state: "/form/name", neq: "" };

const companyInputVisible = { $state: "/form/accountType", eq: "business" };

const statusTextProps = {
  message: {
    $cond: { $state: "/result/valid", eq: true },
    $then: "All fields are valid -- ready to submit!",
    $else: "Please fix the errors above before submitting.",
  },
  type: {
    $cond: { $state: "/result/valid", eq: true },
    $then: "success",
    $else: "error",
  },
};

// --- 1. $bindState resolves the current value AND exposes a write-back path ---
record("bindState_resolves_empty_value", () => {
  const resolved = resolveElementProps(nameInputProps, { stateModel: state });
  assert.equal(resolved.value, "");
});
record("bindState_exposes_writeback_path", () => {
  const bindings = resolveBindings(nameInputProps, { stateModel: state });
  assert.deepEqual(bindings, { value: "/form/name" });
});

// --- 2. $state visibility is hidden when the bound field is empty ---
record("cond_visibility_hidden_when_empty", () => {
  assert.equal(evaluateVisibility(previewVisible, { stateModel: state }), false);
});
record("cond_visibility_hidden_for_business_gate_when_personal", () => {
  assert.equal(evaluateVisibility(companyInputVisible, { stateModel: state }), false);
});

// --- 3. Simulate user input via setByPath (what a real `$bindState` write-back does) ---
record("state_mutation_round_trip", () => {
  setByPath(state, "/form/name", "Ada Lovelace");
  setByPath(state, "/form/email", "ada@example.com");
  setByPath(state, "/form/accountType", "business");
  assert.equal(getByPath(state, "/form/name"), "Ada Lovelace");
});

// --- 4. Same expressions now resolve differently against the mutated state ---
record("bindState_resolves_updated_value", () => {
  const resolved = resolveElementProps(nameInputProps, { stateModel: state });
  assert.equal(resolved.value, "Ada Lovelace");
});
record("cond_visibility_shown_when_filled", () => {
  assert.equal(evaluateVisibility(previewVisible, { stateModel: state }), true);
});
record("cond_visibility_shown_for_business", () => {
  assert.equal(evaluateVisibility(companyInputVisible, { stateModel: state }), true);
});
record("template_interpolates_multiple_paths", () => {
  const resolved = resolveElementProps(previewProps, { stateModel: state });
  assert.equal(resolved.text, "Welcome, Ada Lovelace! Your email: ada@example.com");
});

// --- 5. $cond/$then/$else picks branches based on a nested, initially-null path ---
record("cond_then_else_picks_else_when_null", () => {
  const resolved = resolveElementProps(statusTextProps, { stateModel: state });
  assert.equal(resolved.type, "error");
  assert.equal(resolved.message, "Please fix the errors above before submitting.");
});
record("cond_then_else_picks_then_when_true", () => {
  setByPath(state, "/result", { valid: true });
  const resolved = resolveElementProps(statusTextProps, { stateModel: state });
  assert.equal(resolved.type, "success");
  assert.equal(resolved.message, "All fields are valid -- ready to submit!");
});

// --- 6. Bare-name $template interpolation resolves against a repeat item, not just absolute state paths ---
record("template_bare_name_resolves_against_repeat_item", () => {
  const resolved = resolvePropValue(
    { $template: "${name} <${/form/email}>" },
    { stateModel: state, repeatItem: { name: "Item Name" } },
  );
  assert.equal(resolved, "Item Name <ada@example.com>");
});

const startedAt = Date.now();
const failing = Object.entries(checks).filter(([, v]) => v.ok !== true);
const status = failing.length === 0 ? "PASS" : "FAIL";
const result = {
  name: NAME,
  status,
  durationMs: Date.now() - startedAt,
  checks,
  failingChecks: failing.map(([k]) => k),
  approach: "node-level spec-resolution conformance (resolveElementProps/resolveBindings/evaluateVisibility) against packages/core/src, not a mounted Svelte renderer",
};
console.log(JSON.stringify(result));
process.exit(status === "FAIL" ? 1 : 0);

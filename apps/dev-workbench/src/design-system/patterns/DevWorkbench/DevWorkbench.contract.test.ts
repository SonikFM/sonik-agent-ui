import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { adaptDevWorkbenchA2ui } from "./a2ui-adapter";
import { createDevWorkbenchCapability } from "./capability";
import { devWorkbenchReadyFixture, devWorkbenchStartingFixture } from "./fixtures";

test("A2UI adapter accepts fixtures and rejects unknown fields", () => {
  assert.equal(adaptDevWorkbenchA2ui(devWorkbenchStartingFixture).ok, true);
  const invalid = adaptDevWorkbenchA2ui({ ...devWorkbenchStartingFixture, secret: "must-not-pass" });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.match(invalid.issues.join("\n"), /Unrecognized key/);
});

test("capability reports actual terminal and preview readiness", () => {
  const starting = createDevWorkbenchCapability(devWorkbenchStartingFixture);
  assert.equal(starting.assertions.terminalReady, false);
  assert.equal(starting.assertions.previewReady, false);
  assert.equal(starting.assertions.browserContextIsDisplayOnly, true);

  const ready = createDevWorkbenchCapability(devWorkbenchReadyFixture);
  assert.equal(ready.assertions.terminalReady, true);
  assert.equal(ready.assertions.previewReady, true);
  assert.equal(ready.assertions.visualSourceDiscovered, true);
  assert.equal(devWorkbenchReadyFixture.actions.captureSnapshot.enabled, true, "page-context sync remains independent");
  assert.equal(devWorkbenchReadyFixture.actions.pickVisualTarget.enabled, true);
  assert.equal(devWorkbenchReadyFixture.actions.captureVisualContext.enabled, true);
  assert.match(devWorkbenchReadyFixture.actions.pairVisualExtension.disabledReason ?? "", /Host source/);
});

test("visual source controls remain native, distinct, and compact", () => {
  const component = readFileSync(new URL("./DevWorkbench.svelte", import.meta.url), "utf8");
  assert.match(component, /aria-label="Visual context source"/);
  assert.match(component, /onPickVisualTarget/);
  assert.match(component, /onCaptureVisualContext/);
  assert.match(component, /onSetupVisualBrowser/);
  assert.match(component, /onPairVisualExtension/);
  assert.doesNotMatch(component, /role="radio"/, "the native select owns keyboard behavior without a custom radio implementation");
});

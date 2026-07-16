import assert from "node:assert/strict";
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
});

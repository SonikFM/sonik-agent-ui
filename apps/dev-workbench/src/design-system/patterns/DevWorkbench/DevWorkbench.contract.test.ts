import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { adaptDevWorkbenchA2ui } from "./a2ui-adapter";
import { runEnabledAction } from "./actions";
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
  const styles = readFileSync(new URL("./DevWorkbench.css", import.meta.url), "utf8");
  assert.match(component, /aria-label="Visual context source"/);
  assert.match(component, /onPickVisualTarget/);
  assert.match(component, /onCaptureVisualContext/);
  assert.match(component, /onSetupVisualBrowser/);
  assert.match(component, /onPairVisualExtension/);
  assert.doesNotMatch(component, /role="radio"/, "the native select owns keyboard behavior without a custom radio implementation");
  assert.match(component, /aria-disabled=\{!actions\.captureVisualContext\.enabled\}[\s\S]*?aria-describedby=\{!actions\.captureVisualContext\.enabled \? "workbench-action-readiness" : undefined\}/);
  assert.match(component, /aria-disabled=\{!actions\.setupVisualBrowser\.enabled\}[\s\S]*?aria-describedby=\{!actions\.setupVisualBrowser\.enabled \? "workbench-action-readiness" : undefined\}/);
  assert.doesNotMatch(component, /\sdisabled=\{!actions\.(?:captureVisualContext|setupVisualBrowser)\.enabled\}/);
  assert.match(component, /runEnabledAction\(actions\.captureVisualContext\.enabled, onCaptureVisualContext\)/);
  assert.match(component, /runEnabledAction\([\s\S]*?actions\.setupVisualBrowser\.enabled,[\s\S]*?runMenuAction\(event, onSetupVisualBrowser\)/);
  assert.match(styles, /button\[aria-disabled="true"\][\s\S]*?cursor: not-allowed;[\s\S]*?opacity: 0\.55;/);
});

test("terminal embed keeps context and layout controls reachable and persistent", () => {
  const component = readFileSync(new URL("./DevWorkbench.svelte", import.meta.url), "utf8");
  const styles = readFileSync(new URL("./DevWorkbench.css", import.meta.url), "utf8");

  assert.doesNotMatch(styles, /data-terminal-only="true"[^}]*__toolbar[^}]*display:\s*none/);
  assert.match(styles, /data-terminal-only="true"[^}]*__toolbar[^}]*grid-template-columns/);
  assert.doesNotMatch(component, /terminalOnly \|\| terminalDock === "fullscreen"/);
  assert.match(component, /terminalFocused = terminalOnly && storedPreference === null/);
  assert.match(component, /function setTerminalDock[^}]*terminalFocused = false;[^}]*persistLayout\(\)/);
  assert.match(component, /role="group" aria-label="Terminal position"/);
});

test("unavailable focusable actions do not activate", () => {
  let activations = 0;
  const activate = () => activations++;

  runEnabledAction(false, activate);
  assert.equal(activations, 0);
  runEnabledAction(true, activate);
  assert.equal(activations, 1);
});

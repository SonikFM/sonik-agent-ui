import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TERMINAL_LAYOUT,
  MAX_TERMINAL_SIZE,
  MIN_TERMINAL_SIZE,
  parseTerminalLayoutPreference,
  serializeTerminalLayoutPreference,
} from "./layout-preference";

test("terminal layout preference fails closed and clamps persisted sizes", () => {
  assert.deepEqual(parseTerminalLayoutPreference(null), DEFAULT_TERMINAL_LAYOUT);
  assert.deepEqual(parseTerminalLayoutPreference("not-json"), DEFAULT_TERMINAL_LAYOUT);
  assert.deepEqual(parseTerminalLayoutPreference('{"dock":"left","size":0.9}'), {
    dock: "right",
    size: MAX_TERMINAL_SIZE,
  });
  assert.deepEqual(parseTerminalLayoutPreference('{"dock":"bottom","size":0.1}'), {
    dock: "bottom",
    size: MIN_TERMINAL_SIZE,
  });
});

test("terminal layout preference round-trips supported modes", () => {
  const preference = { dock: "fullscreen" as const, size: 0.44 };
  assert.deepEqual(parseTerminalLayoutPreference(serializeTerminalLayoutPreference(preference)), preference);
});

import assert from "node:assert/strict";
import {
  MIN_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  clamp,
  pxToPct,
  pctToPx,
  clampPositionPx,
  clampSize,
  pxPositionToPct,
  pctPositionToPx,
  resizeRect,
} from "../../packages/workspace-core/src/lib/window-geometry.ts";

// clamp
assert.equal(clamp(5, 0, 10), 5);
assert.equal(clamp(-5, 0, 10), 0, "clamp floors below min");
assert.equal(clamp(15, 0, 10), 10, "clamp ceilings above max");

// percentage <-> px round trip
assert.equal(pxToPct(200, 1000), 20);
assert.equal(pctToPx(20, 1000), 200);
assert.equal(pxToPct(100, 0), 0, "pxToPct guards a zero viewport instead of dividing by zero");

// clampPositionPx keeps a window fully on screen
assert.deepEqual(clampPositionPx(-50, -50, 400, 300, 1000, 800), { left: 0, top: 0 }, "negative position clamps to the top-left corner");
assert.deepEqual(
  clampPositionPx(900, 700, 400, 300, 1000, 800),
  { left: 600, top: 500 },
  "position past the far edge clamps so the window stays fully visible",
);
assert.deepEqual(clampPositionPx(100, 100, 400, 300, 1000, 800), { left: 100, top: 100 }, "in-bounds position is unchanged");

// clampSize enforces the 480x360 minimum from the task spec
assert.deepEqual(clampSize(100, 100, 1920, 1080), { width: MIN_WINDOW_WIDTH, height: MIN_WINDOW_HEIGHT });
assert.deepEqual(clampSize(720, 560, 1920, 1080), { width: 720, height: 560 });
assert.equal(clampSize(5000, 5000, 1920, 1080).width, 1920, "size clamps to the viewport when larger than it");

// px <-> pct position round trip
const pct = pxPositionToPct(200, 100, 1000, 500);
assert.deepEqual(pct, { xPct: 20, yPct: 20 });
assert.deepEqual(pctPositionToPx(pct, 1000, 500), { left: 200, top: 100 });

// resizeRect: dragging the right/bottom edge grows without moving the origin
const start = { left: 100, top: 100, width: 600, height: 400 };
assert.deepEqual(resizeRect(start, "se", 50, 30, 1920, 1080), { left: 100, top: 100, width: 650, height: 430 });

// resizeRect: dragging the left edge keeps the right edge anchored
assert.deepEqual(resizeRect(start, "w", -40, 0, 1920, 1080), { left: 60, top: 100, width: 640, height: 400 });

// resizeRect: shrinking past the minimum clamps size and re-anchors the opposite edge
const shrunkFromLeft = resizeRect(start, "w", 550, 0, 1920, 1080);
assert.equal(shrunkFromLeft.width, MIN_WINDOW_WIDTH, "width never drops below the min");
assert.equal(shrunkFromLeft.left, start.left + (start.width - MIN_WINDOW_WIDTH), "left re-anchors so the right edge stays put");

// resizeRect: never grows the window off the bottom/right of the viewport
const clampedToViewport = resizeRect(start, "se", 5000, 5000, 1920, 1080);
assert.equal(clampedToViewport.width, 1920 - start.left);
assert.equal(clampedToViewport.height, 1080 - start.top);

console.log("canvas-window-geometry.test.mjs passed");

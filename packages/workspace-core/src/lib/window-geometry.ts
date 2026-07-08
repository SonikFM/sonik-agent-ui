// Pure position/size math for the floating canvas window (CanvasViewport).
// Kept dependency-free and rune-free on purpose so it can be unit-tested
// directly with plain Node, without going through the Svelte compiler.
//
// Behavior distilled from apps/standalone-sveltekit/static/vendor/odysseus's
// windowDrag.js / windowResize.js (reference only, no code copied): position
// is stored as page-percentage so a floated window stays proportionally
// placed across viewport resizes, size is stored in px with a min clamp,
// and resize keeps the opposite edge anchored when pulling from the left/top.

export const MIN_WINDOW_WIDTH = 480;
export const MIN_WINDOW_HEIGHT = 360;

export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export interface PxRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PctPosition {
  xPct: number;
  yPct: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function pxToPct(px: number, viewportSize: number): number {
  return viewportSize > 0 ? (px / viewportSize) * 100 : 0;
}

export function pctToPx(pct: number, viewportSize: number): number {
  return (pct / 100) * viewportSize;
}

/** Clamp a top-left position (in px) so the rect stays fully on screen. */
export function clampPositionPx(
  left: number,
  top: number,
  width: number,
  height: number,
  viewportW: number,
  viewportH: number,
): { left: number; top: number } {
  const maxLeft = Math.max(0, viewportW - width);
  const maxTop = Math.max(0, viewportH - height);
  return { left: clamp(left, 0, maxLeft), top: clamp(top, 0, maxTop) };
}

export function clampSize(
  width: number,
  height: number,
  viewportW: number,
  viewportH: number,
): { width: number; height: number } {
  return {
    width: clamp(width, MIN_WINDOW_WIDTH, Math.max(MIN_WINDOW_WIDTH, viewportW)),
    height: clamp(height, MIN_WINDOW_HEIGHT, Math.max(MIN_WINDOW_HEIGHT, viewportH)),
  };
}

export function pxPositionToPct(left: number, top: number, viewportW: number, viewportH: number): PctPosition {
  return { xPct: pxToPct(left, viewportW), yPct: pxToPct(top, viewportH) };
}

export function pctPositionToPx(position: PctPosition, viewportW: number, viewportH: number): { left: number; top: number } {
  return { left: pctToPx(position.xPct, viewportW), top: pctToPx(position.yPct, viewportH) };
}

/**
 * Resize `start` by dragging `edge` by (dx, dy), clamped to the min size and
 * kept on screen. Mirrors Odysseus windowResize.js's move(): pulling the
 * left/top edge keeps the opposite edge anchored instead of the rect
 * jumping.
 */
export function resizeRect(
  start: PxRect,
  edge: ResizeEdge,
  dx: number,
  dy: number,
  viewportW: number,
  viewportH: number,
): PxRect {
  let { left, top, width, height } = start;

  if (edge.includes("e")) width = start.width + dx;
  if (edge.includes("s")) height = start.height + dy;
  if (edge.includes("w")) {
    width = start.width - dx;
    left = start.left + dx;
  }
  if (edge.includes("n")) {
    height = start.height - dy;
    top = start.top + dy;
  }

  if (width < MIN_WINDOW_WIDTH) {
    if (edge.includes("w")) left = start.left + (start.width - MIN_WINDOW_WIDTH);
    width = MIN_WINDOW_WIDTH;
  }
  if (height < MIN_WINDOW_HEIGHT) {
    if (edge.includes("n")) top = start.top + (start.height - MIN_WINDOW_HEIGHT);
    height = MIN_WINDOW_HEIGHT;
  }

  if (edge.includes("w") && left < 0) {
    width += left;
    left = 0;
  }
  if (edge.includes("n") && top < 0) {
    height += top;
    top = 0;
  }
  if (left + width > viewportW) width = Math.max(MIN_WINDOW_WIDTH, viewportW - left);
  if (top + height > viewportH) height = Math.max(MIN_WINDOW_HEIGHT, viewportH - top);

  return { left, top, width, height };
}

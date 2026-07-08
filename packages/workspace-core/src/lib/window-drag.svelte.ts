// Floating-window controller for CanvasViewport: pointer-drag reposition +
// edge/corner resize, translated to Svelte 5 runes from the behavior in
// apps/standalone-sveltekit/static/vendor/odysseus's windowDrag.js /
// windowResize.js (reference only — no JSX/DOM-string code copied). Pure
// clamp/percentage math lives in ./window-geometry.ts so it stays unit
// testable without the Svelte compiler.
//
// Dropped from the Odysseus reference on purpose (out of Phase 3.5 scope):
// edge-proximity hit-testing (this module uses explicit resize handles
// instead), top-edge fullscreen snap and left/right edge docking, and touch
// event wiring.

import {
  MIN_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  clamp,
  clampPositionPx,
  clampSize,
  pctPositionToPx,
  pxPositionToPct,
  resizeRect,
  type PctPosition,
  type ResizeEdge,
} from "./window-geometry.js";

export interface CanvasWindowRect {
  xPct: number;
  yPct: number;
  width: number;
  height: number;
}

export interface CanvasWindowControllerOptions {
  /** localStorage key (already namespaced by the caller) for persistence. */
  storageKey: string;
  defaultSize?: { width: number; height: number };
  /** Default top-left, as page-percentage, used until the window is dragged. */
  defaultPosition?: PctPosition;
  /** Drag/resize is a no-op while this returns true (e.g. fullscreen mode). */
  isLocked?: () => boolean;
}

const DEFAULT_SIZE = { width: 720, height: 560 };
const DEFAULT_POSITION: PctPosition = { xPct: 8, yPct: 8 };
const NUDGE_PX = 24;

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function viewportSize(): { w: number; h: number } {
  return isBrowser() ? { w: window.innerWidth, h: window.innerHeight } : { w: 0, h: 0 };
}

function loadRect(storageKey: string): CanvasWindowRect | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CanvasWindowRect>;
    if (
      typeof parsed.xPct !== "number" ||
      typeof parsed.yPct !== "number" ||
      typeof parsed.width !== "number" ||
      typeof parsed.height !== "number"
    ) {
      return null;
    }
    return { xPct: parsed.xPct, yPct: parsed.yPct, width: parsed.width, height: parsed.height };
  } catch {
    return null;
  }
}

function isInteractiveTarget(event: PointerEvent | KeyboardEvent): boolean {
  const target = event.target;
  return target instanceof Element && Boolean(target.closest("button, input, select, textarea, a"));
}

/**
 * Creates floating drag/resize state for CanvasViewport. `docked` is true
 * (default) until the user drags/resizes/nudges the window; while docked the
 * caller should render its normal in-grid layout instead of applying `style`.
 */
export function createCanvasWindowController(options: CanvasWindowControllerOptions) {
  const defaultSize = options.defaultSize ?? DEFAULT_SIZE;
  const defaultPosition = options.defaultPosition ?? DEFAULT_POSITION;
  const isLocked = options.isLocked ?? (() => false);

  const persisted = loadRect(options.storageKey);
  let rect = $state<CanvasWindowRect>(
    persisted ?? { xPct: defaultPosition.xPct, yPct: defaultPosition.yPct, width: defaultSize.width, height: defaultSize.height },
  );
  let docked = $state<boolean>(persisted === null);

  let dragOrigin: { pointerId: number; startX: number; startY: number; startLeft: number; startTop: number } | null = null;
  let resizeOrigin: { pointerId: number; edge: ResizeEdge; startX: number; startY: number; startRect: { left: number; top: number; width: number; height: number } } | null = null;

  function persist(): void {
    if (!isBrowser()) return;
    try {
      window.localStorage.setItem(options.storageKey, JSON.stringify(rect));
    } catch {
      // Storage unavailable (private mode, quota) — floating state just won't survive reload.
    }
  }

  function currentPx(): { left: number; top: number; width: number; height: number } {
    const { w, h } = viewportSize();
    const { left, top } = pctPositionToPx(rect, w, h);
    return { left, top, width: rect.width, height: rect.height };
  }

  function applyPx(left: number, top: number, width: number, height: number): void {
    const { w, h } = viewportSize();
    const size = clampSize(width, height, w, h);
    const position = clampPositionPx(left, top, size.width, size.height, w, h);
    rect = { ...pxPositionToPct(position.left, position.top, w, h), width: size.width, height: size.height };
  }

  function onDragPointerDown(event: PointerEvent): void {
    if (isLocked() || event.button !== 0 || isInteractiveTarget(event)) return;
    event.preventDefault();
    const px = currentPx();
    dragOrigin = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startLeft: px.left, startTop: px.top };
    docked = false;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onDragPointerMove(event: PointerEvent): void {
    if (!dragOrigin || event.pointerId !== dragOrigin.pointerId) return;
    const dx = event.clientX - dragOrigin.startX;
    const dy = event.clientY - dragOrigin.startY;
    applyPx(dragOrigin.startLeft + dx, dragOrigin.startTop + dy, rect.width, rect.height);
  }

  function onDragPointerUp(event: PointerEvent): void {
    if (!dragOrigin || event.pointerId !== dragOrigin.pointerId) return;
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    dragOrigin = null;
    persist();
  }

  function onDragKeyDown(event: KeyboardEvent): void {
    if (isLocked()) return;
    const deltas: Record<string, [number, number]> = {
      ArrowUp: [0, -NUDGE_PX],
      ArrowDown: [0, NUDGE_PX],
      ArrowLeft: [-NUDGE_PX, 0],
      ArrowRight: [NUDGE_PX, 0],
    };
    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault();
    const px = currentPx();
    docked = false;
    applyPx(px.left + delta[0], px.top + delta[1], rect.width, rect.height);
    persist();
  }

  function onResizePointerDown(edge: ResizeEdge) {
    return (event: PointerEvent): void => {
      if (isLocked() || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      resizeOrigin = { pointerId: event.pointerId, edge, startX: event.clientX, startY: event.clientY, startRect: currentPx() };
      docked = false;
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    };
  }

  function onResizePointerMove(event: PointerEvent): void {
    if (!resizeOrigin || event.pointerId !== resizeOrigin.pointerId) return;
    const { w, h } = viewportSize();
    const dx = event.clientX - resizeOrigin.startX;
    const dy = event.clientY - resizeOrigin.startY;
    const next = resizeRect(resizeOrigin.startRect, resizeOrigin.edge, dx, dy, w, h);
    rect = { ...pxPositionToPct(next.left, next.top, w, h), width: next.width, height: next.height };
  }

  function onResizePointerUp(event: PointerEvent): void {
    if (!resizeOrigin || event.pointerId !== resizeOrigin.pointerId) return;
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    resizeOrigin = null;
    persist();
  }

  function reset(): void {
    docked = true;
    rect = { xPct: defaultPosition.xPct, yPct: defaultPosition.yPct, width: defaultSize.width, height: defaultSize.height };
    if (isBrowser()) {
      try {
        window.localStorage.removeItem(options.storageKey);
      } catch {
        // Ignore.
      }
    }
  }

  const style = $derived(
    `left: ${rect.xPct}%; top: ${rect.yPct}%; width: ${clamp(rect.width, MIN_WINDOW_WIDTH, Number.MAX_SAFE_INTEGER)}px; height: ${clamp(rect.height, MIN_WINDOW_HEIGHT, Number.MAX_SAFE_INTEGER)}px;`,
  );

  return {
    get rect() {
      return rect;
    },
    get docked() {
      return docked;
    },
    get style() {
      return style;
    },
    onDragPointerDown,
    onDragPointerMove,
    onDragPointerUp,
    onDragKeyDown,
    onResizePointerDown,
    onResizePointerMove,
    onResizePointerUp,
    reset,
  };
}

export type CanvasWindowController = ReturnType<typeof createCanvasWindowController>;

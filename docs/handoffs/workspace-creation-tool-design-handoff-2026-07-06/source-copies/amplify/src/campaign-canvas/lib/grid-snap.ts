let gridSize = 20;

/**
 * Sets the global grid step used by {@link snapToGrid} and {@link snapPosition}.
 *
 * @param size - Grid spacing in pixels; clamped to at least 1.
 */
export function setGridSize(size: number): void {
	gridSize = Math.max(1, size);
}

/**
 * Returns the current grid spacing in pixels.
 *
 * @returns Active grid size used for snapping.
 */
export function getGridSize(): number {
	return gridSize;
}

/**
 * Rounds a scalar to the nearest multiple of the current grid size.
 * Use as `end` for GSAP InertiaPlugin, e.g.
 * `gsap.to(el, { inertia: { x: { end: snapToGrid }, y: { end: snapToGrid } } })`.
 *
 * @param value - Coordinate or delta before snapping.
 * @returns Nearest grid-aligned value.
 */
export function snapToGrid(value: number): number {
	return Math.round(value / gridSize) * gridSize;
}

/**
 * Snaps both axes of a 2D position to the current grid.
 *
 * @param x - Horizontal coordinate.
 * @param y - Vertical coordinate.
 * @returns Position with `x` and `y` snapped via {@link snapToGrid}.
 */
export function snapPosition(x: number, y: number): { x: number; y: number } {
	return {
		x: snapToGrid(x),
		y: snapToGrid(y),
	};
}

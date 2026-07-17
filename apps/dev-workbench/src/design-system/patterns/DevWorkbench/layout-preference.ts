export const TERMINAL_LAYOUT_STORAGE_KEY = "sonik.dev-workbench.terminal-layout.v1";
export const DEFAULT_TERMINAL_SIZE = 0.38;
export const MIN_TERMINAL_SIZE = 0.25;
export const MAX_TERMINAL_SIZE = 0.7;

export type TerminalDock = "right" | "bottom" | "fullscreen";

export type TerminalLayoutPreference = {
  dock: TerminalDock;
  size: number;
};

export const DEFAULT_TERMINAL_LAYOUT: TerminalLayoutPreference = {
  dock: "right",
  size: DEFAULT_TERMINAL_SIZE,
};

export function clampTerminalSize(value: number): number {
  return Math.min(MAX_TERMINAL_SIZE, Math.max(MIN_TERMINAL_SIZE, value));
}

export function parseTerminalLayoutPreference(value: string | null): TerminalLayoutPreference {
  if (!value) return { ...DEFAULT_TERMINAL_LAYOUT };
  try {
    const parsed = JSON.parse(value) as { dock?: unknown; size?: unknown };
    const dock = parsed.dock === "right" || parsed.dock === "bottom" || parsed.dock === "fullscreen"
      ? parsed.dock
      : DEFAULT_TERMINAL_LAYOUT.dock;
    const size = typeof parsed.size === "number" && Number.isFinite(parsed.size)
      ? clampTerminalSize(parsed.size)
      : DEFAULT_TERMINAL_LAYOUT.size;
    // ponytail: one ratio serves both dock axes; store per-axis ratios only if users need distinct remembered sizes.
    return { dock, size };
  } catch {
    return { ...DEFAULT_TERMINAL_LAYOUT };
  }
}

export function serializeTerminalLayoutPreference(preference: TerminalLayoutPreference): string {
  return JSON.stringify({
    dock: preference.dock,
    size: clampTerminalSize(preference.size),
  });
}

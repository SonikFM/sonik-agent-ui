export type InteractiveStartInput = {
  command: string;
  args?: string[];
  cwd: string;
  cols: number;
  rows: number;
  env?: Record<string, string>;
};

export type InteractiveControlMessage =
  | {
      type: "start";
      command: string;
      args: string[];
      env: string[];
      cwd: string;
      cols: number;
      rows: number;
    }
  | { type: "resize"; cols: number; rows: number };

export function createInteractiveWebSocketUrl(url: string, token: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== "wss:" && !(parsed.protocol === "ws:" && isLoopback(parsed.hostname))) {
    throw new Error("Interactive terminals require WSS outside local development.");
  }
  parsed.searchParams.set("token", token);
  return parsed.toString();
}

export function createInteractiveStartMessage(input: InteractiveStartInput): InteractiveControlMessage {
  return {
    type: "start",
    command: input.command,
    args: input.args ?? [],
    env: Object.entries({ TERM: "xterm-256color", ...input.env }).map(([key, value]) => `${key}=${value}`),
    cwd: input.cwd,
    cols: positiveInteger(input.cols, "cols"),
    rows: positiveInteger(input.rows, "rows"),
  };
}

export function createInteractiveResizeMessage(cols: number, rows: number): InteractiveControlMessage {
  return {
    type: "resize",
    cols: positiveInteger(cols, "cols"),
    rows: positiveInteger(rows, "rows"),
  };
}

export function parseInteractiveControlFrame(value: string): { type: "exit"; code: number | null } | null {
  try {
    const parsed = JSON.parse(value) as { type?: unknown; code?: unknown };
    if (parsed.type !== "exit") return null;
    return { type: "exit", code: typeof parsed.code === "number" ? parsed.code : null };
  } catch {
    return null;
  }
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer.`);
  return value;
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

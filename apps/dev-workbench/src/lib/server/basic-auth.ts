import { timingSafeEqual } from "node:crypto";

export type DevWorkbenchAccessDecision =
  | { allowed: true }
  | { allowed: false; status: 401 | 503; message: string };

export function authorizeDevWorkbenchRequest(input: {
  enabled: boolean;
  username?: string;
  password?: string;
  authorization?: string | null;
  protocol: string;
  hostname: string;
}): DevWorkbenchAccessDecision {
  if (!input.enabled) return { allowed: true };

  const username = input.username?.trim();
  const password = input.password;
  if (!username || !password || username.includes(":")) {
    return { allowed: false, status: 503, message: "Dev Workbench access control is not configured." };
  }
  if (input.protocol !== "https:" && !isLoopback(input.hostname)) {
    return { allowed: false, status: 503, message: "Dev Workbench requires HTTPS." };
  }

  const credentials = parseBasicAuthorization(input.authorization);
  if (!credentials || !constantTimeEqual(credentials.username, username) || !constantTimeEqual(credentials.password, password)) {
    return { allowed: false, status: 401, message: "Authentication is required." };
  }
  return { allowed: true };
}

function parseBasicAuthorization(value: string | null | undefined): { username: string; password: string } | null {
  if (!value || value.length > 4_096 || !value.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(value.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 1) return null;
    return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

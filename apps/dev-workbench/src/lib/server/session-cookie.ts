export const DEV_WORKBENCH_SESSION_COOKIE = "sonik-dev-workbench-session";
export const DEV_WORKBENCH_SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function devWorkbenchSessionCookieOptions(url: URL) {
  const secure = url.protocol === "https:";
  return {
    httpOnly: true,
    sameSite: secure ? "none" as const : "lax" as const,
    secure,
    partitioned: secure,
    path: "/",
    maxAge: DEV_WORKBENCH_SESSION_COOKIE_MAX_AGE_SECONDS,
  };
}

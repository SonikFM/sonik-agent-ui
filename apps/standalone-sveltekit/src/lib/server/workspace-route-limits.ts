import { error } from "@sveltejs/kit";

export const WORKSPACE_TITLE_MAX_CHARS = 240;
export const WORKSPACE_LANGUAGE_MAX_CHARS = 80;
export const WORKSPACE_CONTENT_MAX_CHARS = 500_000;
export const WORKSPACE_SESSION_ID_MAX_CHARS = 160;

export function routeString(value: unknown, field: string, maxChars: number, defaultValue = ""): string {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value !== "string") error(400, `${field} must be a string`);
  if (value.length > maxChars) error(413, `${field} exceeds ${maxChars} characters`);
  return value;
}

export function optionalRouteString(value: unknown, field: string, maxChars: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  return routeString(value, field, maxChars);
}

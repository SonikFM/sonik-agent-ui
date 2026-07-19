export interface DateDisplayOptions extends Intl.DateTimeFormatOptions {
  locale?: Intl.LocalesArgument;
  fallback?: string | null;
}

/**
 * Formats an ISO-like date for presentation without changing the source value.
 * Callers may inject locale and timeZone for deterministic tests; browser-facing
 * callers can omit both to honestly use the viewer's local date and time.
 */
export function formatDateDisplay(
  value: string | null | undefined,
  { locale, fallback = null, ...formatOptions }: DateDisplayOptions,
): string | null {
  if (!value?.trim()) return fallback;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;

  try {
    return new Intl.DateTimeFormat(locale, formatOptions).format(date);
  } catch {
    return fallback;
  }
}

export type SessionOptionTitleOptions = Pick<DateDisplayOptions, "locale" | "timeZone">;

/** Adds compact historical context to a stored session title for display only. */
export function formatSessionOptionTitle(
  title: string,
  value: string | null | undefined,
  { locale, timeZone }: SessionOptionTitleOptions = {},
): string {
  const timestamp = formatDateDisplay(value, {
    locale,
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return timestamp ? `${title} · ${timestamp}` : title;
}

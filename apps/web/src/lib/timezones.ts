/**
 * Time-zone choices for the user dialogs. The browser can enumerate the full
 * IANA list; the short fallback only exists for older runtimes and for tests.
 */

export const TIMEZONE_FALLBACK = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "Europe/London", "Europe/Berlin", "Asia/Singapore", "Australia/Sydney", "UTC",
];

export function timezoneOptions(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  try {
    const list = intl.supportedValuesOf?.("timeZone");
    if (list?.length) return list;
  } catch { /* fall through to the short list */ }
  return TIMEZONE_FALLBACK;
}

/** The zone the person is sitting in, used as the default on a new user. */
export function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
}

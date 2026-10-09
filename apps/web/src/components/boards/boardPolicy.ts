/**
 * Reading a board's policy out loud.
 *
 * `ServiceBoard` stores a promise in minutes and an interval in hours because that is what the
 * scheduler needs. The screens that show a promise are read by people, and the words for it live here
 * so the board's own page and the settings list cannot say two different things about one column —
 * which is how "SLA 30 / 240 min" and "30 minutes" came to be the same fact on two screens.
 */

/**
 * Minutes as a person reads them. Hours win over days, so 1440 is "24 hours" — the unit the policy
 * itself is written in. `null` means the column has no positive value: callers omit the figure rather
 * than print the absence as a zero.
 */
export function minutesInWords(minutes: number | null | undefined): string | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return null;
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/** An interval in hours, for the follow-up column, which is stored in hours rather than minutes. */
export function hoursInWords(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return `${value} hour${value === 1 ? "" : "s"}`;
}

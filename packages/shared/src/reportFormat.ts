/**
 * Value formatting for reports (PLAN-020).
 *
 * Kept in `shared` because two very different renderers need the same answers: the section kit
 * (`apps/web/.../reportKit.tsx`) that draws the standard reports, and the banded layout engine
 * (`reportLayout.ts`) that draws a designed template. A number formatted as money must read the same
 * in a table and in a band, and a date must not be printed two ways in one product.
 */

export type ValueFormat = "text" | "number" | "money" | "percent" | "minutes" | "hours" | "date" | "yesno";

export const VALUE_FORMATS: ValueFormat[] = ["text", "number", "money", "percent", "minutes", "hours", "date", "yesno"];

export const FORMAT_LABELS: Record<ValueFormat, string> = {
  text: "Text",
  number: "Number",
  money: "Money",
  percent: "Percent",
  minutes: "Duration (minutes)",
  hours: "Hours",
  date: "Date",
  yesno: "Yes / No",
};

export const money = (value: unknown): string =>
  `$${Number(value ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const number = (value: unknown): string => Number(value ?? 0).toLocaleString();

/** "6h 15m" — a duration a person reads at a glance rather than a decimal. */
export function duration(minutes: unknown): string {
  const total = Math.round(Number(minutes ?? 0));
  if (!total) return "0m";
  const sign = total < 0 ? "-" : "";
  const abs = Math.abs(total);
  const hours = Math.floor(abs / 60);
  const rest = abs % 60;
  if (!hours) return `${sign}${rest}m`;
  return rest ? `${sign}${hours}h ${rest}m` : `${sign}${hours}h`;
}

const humanise = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

/**
 * A key as a heading: camelCase and snake_case both become words, and each word is capitalised, so a
 * row key of `ticketNumber` reads as "Ticket Number" on screen and in a file.
 */
export function labelFor(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * A cell's value as a scalar. Rows carry relation values as objects (a ticket's client is
 * `{ name: "Acme" }`), which used to print as "[object Object]" — a single-value object is unwrapped
 * to that value instead, and anything genuinely structured is written out as JSON.
 */
export function unwrapValue(value: unknown): unknown {
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  if (Array.isArray(value)) return value.length === 1 ? unwrapValue(value[0]) : value.map(v => unwrapValue(v)).join(", ");
  const scalars = Object.values(value as Record<string, unknown>).filter(v => v !== null && v !== undefined && typeof v !== "object");
  if (scalars.length === 1) return scalars[0];
  const named = (value as { name?: unknown }).name ?? (value as { title?: unknown }).title ?? (value as { label?: unknown }).label;
  return named ?? JSON.stringify(value);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2})?/;

/** The date parts of a value, or null when it is not a date at all. */
export function asDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") return new Date(value);
  if (typeof value === "string" && ISO_DATE.test(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

const two = (n: number) => String(n).padStart(2, "0");

/**
 * A date as a calendar day for a reader. A `YYYY-MM-DD` value is printed as written rather than
 * through the local timezone, because the date in the database is a day and rendering it in a
 * timezone west of Greenwich is how 1 August becomes 31 July.
 */
export function formatDate(value: unknown, withTime = false): string {
  if (typeof value === "string") {
    const dayOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (dayOnly) {
      if (!withTime) return value;
      return `${value} 00:00`;
    }
  }
  const date = asDate(value);
  if (!date) return "";
  const day = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
  if (!withTime) return day;
  return `${day} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** A cell or band value as text, in the format the element asked for. */
export function formatValue(value: unknown, format: ValueFormat = "text"): string {
  const unwrapped = unwrapValue(value);
  if (unwrapped === null || unwrapped === undefined || unwrapped === "") return "—";
  switch (format) {
    case "money": return money(unwrapped);
    case "number": return number(unwrapped);
    case "percent": return `${Number(unwrapped).toLocaleString()}%`;
    case "minutes": return duration(unwrapped);
    case "hours": return `${Number(unwrapped).toLocaleString()}h`;
    case "date": return formatDate(unwrapped) || "—";
    case "yesno": return unwrapped ? "Yes" : "No";
    default: {
      const text = String(unwrapped);
      // A status or priority code reads as a label; anything already written stays as it is.
      return /^[a-z0-9]+(_[a-z0-9]+)*$/.test(text) && text.length < 40 ? humanise(text) : text;
    }
  }
}

/** The format a field is most likely to want, so a fresh element is rarely misaligned or mis-scaled. */
export function suggestFormat(fieldType: string | undefined): ValueFormat {
  switch (fieldType) {
    case "number": return "number";
    case "money": return "money";
    case "date": return "date";
    case "boolean": return "yesno";
    case "minutes": return "minutes";
    default: return "text";
  }
}

/** Right-aligning numbers is what makes a column of them readable, so the default follows the format. */
export function suggestAlign(format: ValueFormat): "left" | "center" | "right" {
  return format === "number" || format === "money" || format === "percent" || format === "minutes" || format === "hours"
    ? "right"
    : "left";
}

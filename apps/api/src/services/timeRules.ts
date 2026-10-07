/**
 * Time rules (PLAN-015 Phase A #1).
 *
 * Three rules, all decided here rather than in the route so they can be reasoned about and
 * tested on their own:
 *
 *   · **Midnight split** — work that crosses midnight becomes two entries, the second linked
 *     back to the first through `splitFrom`. A timesheet that says "23:00–01:00 Tuesday" hides
 *     two different days of labour, and every downstream report wants them apart.
 *   · **Overtime** — minutes after the agreement's cut-off (18:00 by default) are overtime.
 *   · **Weighting** — overtime counts at the agreement's multiplier (1.5 by default) towards
 *     billing and, for block and Cyber Care agreements, towards the hours deducted from the
 *     allowance. This is the "1.5:1" rule: two hours of evening work consume three.
 *
 * Everything here is pure; the caller decides whether to run it (`TIME_RULES_ENABLED`).
 */

/** Defaults match the plan's specification; an agreement may override each of them. */
export const TIME_RULE_DEFAULTS = {
  overtimeEnabled: true,
  overtimeAfter: "18:00",
  overtimeMultiplier: 1.5,
} as const;

/** Spot-rate tiers the plan names, pending confirmation of the values (PLAN-015 §7 #2). */
export const SPOT_RATE_TIERS = [
  { code: "standard", label: "Standard", hourlyRate: 100 },
  { code: "advanced", label: "Advanced", hourlyRate: 250 },
  { code: "specialist", label: "Specialist", hourlyRate: 275 },
  { code: "emergency", label: "Emergency", hourlyRate: 400 },
] as const;

export const AGREEMENT_TYPES = ["service", "block", "cyberCare", "spot"] as const;
export type AgreementType = typeof AGREEMENT_TYPES[number];

/** Agreements whose hours come out of an allowance rather than being invoiced per hour. */
export function drawsFromBlock(type: string | null | undefined): boolean {
  return type === "block" || type === "cyberCare";
}

export function timeRulesEnabled(): boolean {
  return process.env.TIME_RULES_ENABLED === "true";
}

export interface TimeRuleSettings {
  overtimeEnabled: boolean;
  /** "HH:MM" in the server's local time. */
  overtimeAfter: string;
  overtimeMultiplier: number;
}

export const DEFAULT_SETTINGS: TimeRuleSettings = { ...TIME_RULE_DEFAULTS };

export function settingsFrom(agreement: {
  overtimeEnabled?: boolean | null;
  overtimeAfter?: string | null;
  overtimeMultiplier?: number | null;
} | null | undefined): TimeRuleSettings {
  return {
    overtimeEnabled: agreement?.overtimeEnabled ?? DEFAULT_SETTINGS.overtimeEnabled,
    overtimeAfter: normaliseClock(agreement?.overtimeAfter) ?? DEFAULT_SETTINGS.overtimeAfter,
    overtimeMultiplier: Number(agreement?.overtimeMultiplier) > 0 ? Number(agreement?.overtimeMultiplier) : DEFAULT_SETTINGS.overtimeMultiplier,
  };
}

function normaliseClock(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

const sameLocalDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const midnightAfter = (start: Date): Date =>
  new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1, 0, 0, 0, 0);

export interface TimeSegment {
  startTime: Date;
  endTime: Date;
  /** Local work date for the segment. */
  date: Date;
  minutes: number;
  /** 1 for the stretch before midnight, 2 for the stretch after it. */
  part: number;
}

/** A window is split at midnight; a window inside one day comes back as a single segment. */
export function splitAcrossMidnight(start: Date, end: Date): TimeSegment[] {
  if (end.getTime() <= start.getTime()) return [];
  if (sameLocalDay(start, end)) return [segmentOf(start, end, 1)];

  const segments: TimeSegment[] = [];
  let cursor = start;
  let part = 1;
  while (cursor.getTime() < end.getTime()) {
    const boundary = midnightAfter(cursor);
    const sliceEnd = boundary.getTime() < end.getTime() ? boundary : end;
    const segment = segmentOf(cursor, sliceEnd, part);
    if (segment.minutes > 0) segments.push(segment);
    cursor = sliceEnd;
    part += 1;
    if (part > 24) break; // a window longer than a day is a data error, not a timesheet
  }
  return segments;
}

function segmentOf(start: Date, end: Date, part: number): TimeSegment {
  return {
    startTime: start,
    endTime: end,
    date: new Date(start.getFullYear(), start.getMonth(), start.getDate()),
    minutes: Math.round((end.getTime() - start.getTime()) / 60000),
    part,
  };
}

/** Minutes of `start → end` that fall at or after the cut-off, on local time. */
export function overtimeMinutesBetween(start: Date, end: Date, settings: TimeRuleSettings): number {
  if (!settings.overtimeEnabled || end.getTime() <= start.getTime()) return 0;
  const [hours, minutes] = settings.overtimeAfter.split(":").map(Number);
  const cutOff = new Date(start.getFullYear(), start.getMonth(), start.getDate(), hours, minutes, 0, 0);
  if (end.getTime() <= cutOff.getTime()) return 0;
  const from = start.getTime() > cutOff.getTime() ? start : cutOff;
  return Math.max(0, Math.round((end.getTime() - from.getTime()) / 60000));
}

export interface ComputedEntry {
  minutes: number;
  overtimeMinutes: number;
  /** Minutes weighted for billing: plain minutes plus overtime at the multiplier. */
  billedMinutes: number;
}

export function billedMinutesFor(minutes: number, overtimeMinutes: number, settings: TimeRuleSettings): number {
  const plain = Math.max(0, minutes - overtimeMinutes);
  return Math.round(plain + overtimeMinutes * settings.overtimeMultiplier);
}

/**
 * The result for a whole entry. When the work crosses midnight the caller gets one computed
 * row per calendar day, the first of which keeps the original entry's identity.
 *
 * Overtime is worked out for the window as a whole and then falls on its **last** minutes, so
 * a job that starts at 23:00 and finishes at 01:00 is overtime for both hours. Charging the
 * hour after midnight as plain time would halve the cost of the same out-of-hours job simply
 * because the clock rolled over.
 */
export function computeEntry(
  input: { startTime?: Date | null; endTime?: Date | null; minutes?: number | null },
  settings: TimeRuleSettings,
): { segments: (TimeSegment & ComputedEntry)[]; overtimeMinutes: number; billedMinutes: number; minutes: number; split: boolean } {
  const { startTime, endTime } = input;
  if (startTime && endTime && endTime.getTime() > startTime.getTime()) {
    const windows = splitAcrossMidnight(startTime, endTime);
    let overtimeLeft = overtimeMinutesBetween(startTime, endTime, settings);
    const segments = windows.map((segment, index) => ({ ...segment, overtimeMinutes: 0, billedMinutes: segment.minutes, part: index + 1 }));

    for (let i = segments.length - 1; i >= 0 && overtimeLeft > 0; i -= 1) {
      const segment = segments[i];
      if (!segment) continue;
      const take = Math.min(segment.minutes, overtimeLeft);
      segment.overtimeMinutes = take;
      segment.billedMinutes = billedMinutesFor(segment.minutes, take, settings);
      overtimeLeft -= take;
    }

    return {
      segments,
      minutes: segments.reduce((sum, s) => sum + s.minutes, 0),
      overtimeMinutes: segments.reduce((sum, s) => sum + s.overtimeMinutes, 0),
      billedMinutes: segments.reduce((sum, s) => sum + s.billedMinutes, 0),
      split: segments.length > 1,
    };
  }

  // No usable window (an entry recorded as a bare number of minutes): nothing to weight,
  // because there is no clock to compare the cut-off against.
  const minutes = Math.max(0, Math.round(Number(input.minutes) || 0));
  return { segments: [], minutes, overtimeMinutes: 0, billedMinutes: minutes, split: false };
}

/** Hours to deduct from a block or Cyber Care allowance, rounded like the invoice would be. */
export function blockHoursFor(billedMinutes: number): number {
  return Math.round((billedMinutes / 60) * 100) / 100;
}

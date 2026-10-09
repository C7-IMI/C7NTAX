/**
 * The delivery log, resolved into rows a screen can draw — and the shape of what is *not* there yet.
 *
 * `GET /api/email/log` answers with `{ data, total, counts: { sent, failed, test } }`, and one row is one
 * send: the message key, the recipients, the subject, the template and its version, the provider's id,
 * `sent` or `failed`, the error, whether it was a test, when, and who sent it.
 *
 * Three things the *design* asks for are not in that payload, and this file is where the difference is
 * handled rather than papered over:
 *
 *   · **`skipped`** — a third outcome, for an address a rule suppressed. Nothing suppresses anything yet,
 *     so the API has two outcomes and the screen shows two, with a chip that says what is missing;
 *   · **the four-line reason** — the API records the error. The other three lines (why, what to do,
 *     evidence) have no source, so a row's reason is filled from what exists and the screen says which
 *     lines are proposed rather than inventing them;
 *   · **resend** — there is no route. See `NO_RESEND_ROUTE`.
 *
 * Nothing is fabricated. A delivery log is evidence, and a made-up row in one is the worst lie available
 * on the screen whose entire job is to be trustworthy.
 */
import { normaliseList, type ApiLogResponse, type ApiLogRow, type Read } from "./emailApi";

export type LogOutcome = "delivered" | "failed" | "unknown";

/** The four lines of a non-delivery, as a stable set of ids rather than a free string. */
export type ReasonLineId = "what" | "why" | "whatToDo" | "evidence";

/** The four lines, in the order every non-delivery carries them. */
export const REASON_LINES: { id: ReasonLineId; label: string; proposed: boolean }[] = [
  { id: "what", label: "What happened", proposed: false },
  { id: "why", label: "Why", proposed: true },
  { id: "whatToDo", label: "What to do", proposed: true },
  { id: "evidence", label: "Evidence", proposed: false },
];

/** One row's four lines: what exists, and `null` where the log carries nothing. */
export type LogReason = Record<ReasonLineId, string | null>;

export function reasonValue(reason: LogReason, id: ReasonLineId): string | null {
  return reason[id];
}

export interface LogRowView {
  id: string;
  at: string | null;
  key: string;
  to: string[];
  cc: string[];
  subject: string | null;
  templateKey: string | null;
  templateVersion: number | null;
  outcome: LogOutcome;
  providerMessageId: string | null;
  error: string | null;
  test: boolean;
  sentByName: string | null;
  /** What the API does carry, in the four lines' order. `why` and `whatToDo` are proposals. */
  reason: LogReason;
}

export interface LogView {
  rows: LogRowView[];
  counts: { total: number; sent: number; failed: number; test: number };
  /** True when the API answered with a `counts` object, so the figures are the whole log's. */
  countsAreWholeLog: boolean;
}

function strings(value: string | null | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function outcomeOf(result: string | undefined): LogOutcome {
  if (result === "sent") return "delivered";
  if (result === "failed") return "failed";
  return "unknown";
}

export function resolveLog(read: Read<unknown>): LogView {
  if (read.status !== "ok") {
    return { rows: [], counts: { total: 0, sent: 0, failed: 0, test: 0 }, countsAreWholeLog: false };
  }
  const payload = (read.data ?? {}) as ApiLogResponse;
  const rows: LogRowView[] = normaliseList<ApiLogRow>(payload, "data").map((row, index) => {
    const apiReason = row.reason;
    return {
      id: row.id ?? `row-${index}`,
      at: row.at ?? null,
      key: row.key ?? "not stated by the API",
      to: strings(row.to),
      cc: strings(row.cc),
      subject: row.subject ?? null,
      templateKey: row.templateKey ?? row.key ?? null,
      templateVersion: row.templateVersion ?? null,
      outcome: outcomeOf(row.result),
      providerMessageId: row.providerMessageId ?? null,
      error: row.error ?? null,
      test: row.test === true,
      sentByName: row.sentByName ?? null,
      reason: {
        what: apiReason?.what ?? row.error ?? null,
        why: null,
        whatToDo: null,
        evidence: apiReason?.evidence ?? row.providerMessageId ?? null,
      },
    };
  });
  const apiCounts = payload.counts;
  return {
    rows,
    counts: {
      total: payload.total ?? rows.length,
      sent: apiCounts?.sent ?? rows.filter((row) => row.outcome === "delivered").length,
      failed: apiCounts?.failed ?? rows.filter((row) => row.outcome === "failed").length,
      test: apiCounts?.test ?? rows.filter((row) => row.test).length,
    },
    countsAreWholeLog: Boolean(apiCounts),
  };
}

export const OUTCOME_LABEL: Record<LogOutcome, string> = {
  delivered: "delivered",
  failed: "failed",
  unknown: "not stated by the API",
};

/**
 * What exists instead of a log today — read from this working copy, and the reason the screen was asked
 * for rather than described.
 */
export const LOG_TODAY =
  "Until the log above, nothing recorded a send. The closest thing was a TicketComment the composer writes after a send, and nothing at all when the send fails — so the record of a message and the message itself could disagree. The MFA code, the portal sign-in code, the invitation, the follow-up and the overdue reminder were not recorded anywhere.";

export function formatWhen(at: string | null): string {
  if (!at) return "time not stated";
  const parsed = new Date(at);
  if (Number.isNaN(parsed.getTime())) return at;
  return parsed.toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Everything both arrangements of the log need: the read, the words, and why the write is not offered. */
export interface EmailLogProps {
  rows: LogRowView[];
  counts: LogView["counts"];
  countsAreWholeLog: boolean;
  status: "loading" | "ok" | "unavailable";
  message: string | null;
  reload: () => void;
  /** The proposed retention, which no setting stores yet. */
  retentionDays: number;
  canManage: boolean;
  /**
   * Why a resend is not offered, in the words the button's helper prints. There is no route that
   * resends a logged message, so this is set from `NO_RESEND_ROUTE` and never `null` today — which is
   * the point: a disabled button with a reason beats a button that cannot do what it says.
   */
  resendBlockedBecause: string;
}

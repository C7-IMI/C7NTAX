/**
 * The trigger matrix, from whichever of its two sources is telling the truth.
 *
 * `GET /api/email/messages` wins outright when it answers — it is the registry the Studio edits, so the
 * matrix has to show what it says rather than a second opinion kept in the browser. When it does not
 * answer, the screen falls back to the catalogue read from the code — `emailCatalogue.ts`, the same file
 * the Studio's list reads, plus the extra columns in `emailFacts.ts` — **and says which of the two it is
 * drawing**, because "what is this system actually sending out" is a question the screen must answer on
 * the day the endpoint is missing and must not answer with a guess.
 *
 * One column is *always* read from the code, because the API does not carry it, and the screen says so
 * above the table rather than pretending it came over the wire: **can it be turned off** — a fact about
 * which switch exists and whether a sender reads it.
 *
 * The status of a row is grounded in the registry's own vocabulary rather than in a guess: `live` comes
 * over the wire, and the difference between "written, never sent" and "proposed" is the difference
 * between a sender the code has (`packages/email — sendInvoice (no caller)`) and a key nothing sends at
 * all (`nothing — a reserved key`).
 */
import { normaliseList, type ApiMessage, type ApiMessagesResponse, type Read } from "./emailApi";
import { EMAIL_FACTS_BY_KEY } from "./emailCatalogue";
import {
  BATCH_EXEMPT, GROUP_ORDER, MATRIX_EXTRAS, PLAIN_BY_RULE_KEYS, STATUS_LABEL,
  type MessageStatus,
} from "./emailFacts";

export interface MatrixRow {
  key: string;
  name: string;
  group: string;
  trigger: string;
  recipients: string;
  customerVisible: boolean | null;
  canBeTurnedOff: string;
  template: string;
  templateVersion: number | null;
  /** `default` | `customised` | `overridden` — which wording is in force for this key. */
  state: string | null;
  status: MessageStatus;
  locked: boolean;
  /** The address it leaves from, as the registry states it. */
  from: string | null;
  replyTo: string | null;
  /** The function or route that sends it today. */
  sentBy: string | null;
  note: string | null;
}

export interface MatrixView {
  rows: MatrixRow[];
  source: "api" | "code";
}

const NEVER_HELD = new Set(BATCH_EXEMPT.map((entry) => entry.key));
const PLAIN_BY_RULE = new Set(PLAIN_BY_RULE_KEYS);

function groupRank(group: string): number {
  const index = GROUP_ORDER.indexOf(group);
  return index < 0 ? GROUP_ORDER.length : index;
}

/** Group by group, and inside a group the order the registry lists them in. */
export function sortMatrix(rows: MatrixRow[]): MatrixRow[] {
  return [...rows].sort((a, b) => groupRank(a.group) - groupRank(b.group));
}

/** The groups actually present, in the registry's order — so the filter cannot invent an empty one. */
export function groupsIn(rows: MatrixRow[]): string[] {
  const present = new Set(rows.map((row) => row.group));
  return [...GROUP_ORDER.filter((group) => present.has(group)), ...[...present].filter((group) => !GROUP_ORDER.includes(group))];
}

function fromApi(payload: ApiMessagesResponse): MatrixRow[] {
  return normaliseList<ApiMessage>(payload, "messages")
    .filter((row) => Boolean(row.key))
    .map((row) => {
      const key = row.key as string;
      const extra = MATRIX_EXTRAS[key];
      const catalogue = EMAIL_FACTS_BY_KEY[key];
      const senderText = (row.sender ?? "").toLowerCase();
      const status: MessageStatus = row.live === true
        ? "live"
        : senderText.includes("(no caller)")
          ? "written-never-sent"
          : "proposed";
      const template = row.template;
      return {
        key,
        name: row.name ?? catalogue?.name ?? key,
        group: row.group ?? extra?.group ?? "Other",
        trigger: row.trigger ?? catalogue?.trigger ?? "not stated by the API",
        recipients: row.recipients ?? catalogue?.reader ?? "not stated by the API",
        customerVisible: row.audience === undefined ? null : row.audience === "customer",
        canBeTurnedOff: extra?.canBeTurnedOff ?? "not stated by the API, and the sender code has no fact for it",
        template: template?.subject ?? extra?.template ?? "—",
        /* Version 0 is the registry's default, which is not a saved version — see `templateDto`. */
        templateVersion: template?.version && template.version > 0 ? template.version : null,
        state: template?.state ?? null,
        status,
        locked: row.editingClass === "security" || NEVER_HELD.has(key),
        from: row.from ?? extra?.from ?? null,
        replyTo: row.replyTo ?? extra?.replyTo ?? null,
        sentBy: row.sender ?? extra?.sender ?? null,
        note: extra?.note ?? null,
      };
    });
}

function fromCode(): MatrixRow[] {
  return Object.entries(MATRIX_EXTRAS).map(([key, extra]) => {
    const catalogue = EMAIL_FACTS_BY_KEY[key];
    const status: MessageStatus = catalogue
      ? catalogue.live
        ? "live"
        : extra.sender.includes("(no caller)")
          ? "written-never-sent"
          : "proposed"
      : "proposed";
    return {
      key,
      name: catalogue?.name ?? key,
      group: extra.group,
      trigger: catalogue?.trigger ?? "not stated by the code",
      recipients: catalogue?.reader ?? "not stated by the code",
      customerVisible: catalogue ? catalogue.audience === "customer" : null,
      canBeTurnedOff: extra.canBeTurnedOff,
      template: extra.template,
      templateVersion: null,
      state: null,
      status,
      locked: PLAIN_BY_RULE.has(key) || NEVER_HELD.has(key),
      from: extra.from,
      replyTo: extra.replyTo,
      sentBy: extra.sender,
      note: extra.note,
    };
  });
}

export function resolveMatrix(read: Read<unknown>): MatrixView {
  if (read.status === "ok") {
    const rows = fromApi((read.data ?? {}) as ApiMessagesResponse);
    if (rows.length > 0) return { rows: sortMatrix(rows), source: "api" };
  }
  return { rows: sortMatrix(fromCode()), source: "code" };
}

/**
 * The sentence the matrix prints about where it came from.
 *
 * A reader has to be able to tell a reading from a fallback, so it says so above the table rather than
 * in a footnote — and it names the one column the API does not carry, so nobody reads that column as a
 * reading.
 */
export function matrixSourceSentence(view: MatrixView, readMessage: string | null): string {
  const codeColumn =
    "\"Can be turned off\" is read from the sender code for every row: the API states when a message fires, who receives it and what sends it, but it does not carry that switch.";
  if (view.source === "api") {
    return `Read from GET /api/email/messages: ${view.rows.length} messages, each with the template in force and its version. ${codeColumn}`;
  }
  const because = readMessage ? ` ${readMessage}` : " The endpoint did not answer.";
  return `Read from the sender code, not from the API:${because} What follows is what the registry in apps/api/src/services/emailMessages.ts declares and what its senders do, read from this working copy on 9 October 2026; the API's answer replaces it the moment /api/email/messages answers. ${codeColumn}`;
}

/** The footer line that accounts for every row, so the count can be checked. */
export function matrixCountSentence(view: MatrixView): string {
  const counts: Record<MessageStatus, number> = { live: 0, "written-never-sent": 0, proposed: 0 };
  for (const row of view.rows) counts[row.status] += 1;
  const locked = view.rows.filter((row) => row.locked).length;
  const plain = view.rows.filter((row) => PLAIN_BY_RULE.has(row.key)).length;
  const origin = view.source === "api" ? "the API's registry" : "the sender code";
  return [
    `${view.rows.length} messages · ${counts.live} ${STATUS_LABEL.live} · ${counts["written-never-sent"]} ${STATUS_LABEL["written-never-sent"]} · ${counts.proposed} ${STATUS_LABEL.proposed}`,
    `${locked} locked: ${plain} are security class and wear no brand kit at all, and the rest are never batched or held`,
    `counted from ${origin}`,
  ].join(" · ") + ".";
}

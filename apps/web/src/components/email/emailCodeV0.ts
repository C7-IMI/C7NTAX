/**
 * The code's own body for each message, expressed in the block vocabulary — **v0**.
 *
 * This is not invented copy. Every block below is a transcription of the HTML the matching template
 * function in `packages/email/src/EmailService.ts` returns today, so `default` means what the
 * interface says it means: the body is exactly what the code writes, and *reset to default* always
 * has somewhere to go. The API's `GET /api/email/templates/:key` imports the same bodies read-only the
 * first time the Studio is opened; this file is what the screen draws when that read has not answered,
 * and it says so on the screen rather than presenting a transcription as a record.
 *
 * `REQUIRED_SENTENCES` lists the sentences whose **presence** is a mechanism rather than copy. Two of
 * them do something: the closure line is what reopens a ticket when the client replies, and the
 * follow-up line is the promise the auto-close worker acts on. Their wording is editable; their
 * presence is not. The wording is matched rather than an index, so the marker survives a reorder.
 * `emailTemplate.ts` has no `required` field on `EmailBlock`, and rather than change a union two other
 * agents are also holding, the requirement is kept here and drawn from it.
 */
import type { EmailBlock, EmailMessageKey } from "@C7NTAX/shared";

export const CODE_V0_BLOCKS: Record<EmailMessageKey, EmailBlock[]> = {
  "ticket.note": [
    { kind: "paragraph", html: "<p>{{note.body}}</p>" },
    { kind: "divider" },
    {
      kind: "note",
      tone: "neutral",
      text: "Ticket: {{ticket.number}} — {{ticket.title}}\nClient: {{client.name}}",
    },
  ],
  "ticket.activity": [
    { kind: "heading", level: 1, text: "Ticket Update" },
    { kind: "paragraph", html: "<p>Hi {{contact.firstName}},</p>" },
    { kind: "paragraph", html: "<p>Ticket <strong>{{ticket.number}}</strong> — <em>{{ticket.title}}</em></p>" },
    { kind: "paragraph", html: "<p><strong>{{event.label}}</strong></p>" },
    {
      kind: "conditional",
      when: "ticket.hasNote",
      blocks: [{ kind: "quote", html: "{{note.body}}" }],
    },
    { kind: "paragraph", html: "<p>If you have any questions, simply reply to this email.</p>" },
    { kind: "paragraph", html: "<p>{{client.name}}</p>" },
  ],
  "ticket.closure": [
    { kind: "heading", level: 1, text: "Ticket Closed" },
    { kind: "paragraph", html: "<p>Ticket <strong>{{ticket.number}}</strong> — <em>{{ticket.title}}</em></p>" },
    { kind: "paragraph", html: "<p>This ticket was automatically closed due to inactivity.</p>" },
    {
      kind: "note",
      tone: "neutral",
      text: "If this is not resolved, reply to this email — the reply reopens the ticket and puts it back in the queue.",
    },
  ],
  "ticket.follow_up": [
    { kind: "heading", level: 1, text: "Action Required" },
    { kind: "paragraph", html: "<p>Ticket <strong>{{ticket.number}}</strong> — <em>{{ticket.title}}</em></p>" },
    { kind: "paragraph", html: "<p>We are waiting on your response. This ticket has been idle for several days.</p>" },
    {
      kind: "note",
      tone: "warn",
      text: "If no response is received within the timeframe, this ticket may be automatically closed.",
    },
    { kind: "button", label: "Respond Now", href: "{{portal.url}}" },
  ],
  "ticket.reopened_internal": [
    { kind: "heading", level: 1, text: "Reopened by the client" },
    { kind: "paragraph", html: "<p>Ticket <strong>{{ticket.number}}</strong> — <em>{{ticket.title}}</em></p>" },
    {
      kind: "quote",
      title: "{{contact.fullName}} replied to the closing email",
      source: "the client's own words, so the technician can decide without opening the ticket first",
      html: "Thanks — this is happening again this morning. Same error as before.",
    },
    { kind: "button", label: "Open the ticket", href: "{{ticket.url}}" },
  ],
  "invoice.send": [
    { kind: "heading", level: 1, text: "Invoice {{invoice.number}}" },
    {
      kind: "facts",
      items: [
        { label: "Amount due", value: "{{invoice.total}}" },
        { label: "Due date", value: "{{invoice.dueDate}}" },
        { label: "Client", value: "{{client.name}}" },
      ],
    },
    { kind: "button", label: "View & Pay Invoice", href: "{{portal.url}}" },
    { kind: "attachment", name: "invoice-{{invoice.number}}.pdf", note: "the invoice as generated" },
  ],
  "invoice.overdue": [
    { kind: "heading", level: 1, text: "Payment Overdue" },
    {
      kind: "facts",
      items: [
        { label: "Outstanding balance", value: "{{invoice.total}}" },
        { label: "Due date", value: "{{invoice.dueDate}}" },
      ],
    },
    { kind: "paragraph", html: "<p>Invoice {{invoice.number}} is <strong>{{invoice.daysOverdue}} days overdue</strong>.</p>" },
    { kind: "button", label: "Pay Now", href: "{{portal.url}}" },
  ],
  "auth.mfa_code": [
    { kind: "heading", level: 1, text: "Verification Code" },
    { kind: "paragraph", html: "<p>Use this code to complete your sign-in. It expires in 10 minutes.</p>" },
    { kind: "note", tone: "neutral", text: "{{portal.code}}" },
    { kind: "paragraph", html: "<p>If you did not request this code, please ignore this email.</p>" },
    { kind: "footer" },
  ],
  "user.invite": [
    { kind: "heading", level: 1, text: "Your account is ready" },
    { kind: "paragraph", html: "<p>An account has been created for you in C7NTAX.</p>" },
    {
      kind: "note",
      tone: "neutral",
      text: "Sign-in address: {{contact.email}}\nTemporary password: the credential generated for this account",
    },
    { kind: "paragraph", html: "<p>You will be asked to choose your own password the first time you sign in.</p>" },
    { kind: "footer" },
  ],
  "portal.login_code": [
    { kind: "heading", level: 1, text: "Your sign-in code" },
    { kind: "paragraph", html: "<p>Enter this code to sign in to the customer portal.</p>" },
    { kind: "note", tone: "neutral", text: "{{portal.code}}" },
    { kind: "footer" },
  ],
  "report.scheduled": [],
  "quote.send": [],
};

/**
 * Sentences whose presence is a mechanism. Matched by wording, because the sentence is what a person
 * would edit and an index would be wrong the moment a block moved.
 */
export const REQUIRED_SENTENCES: Partial<Record<EmailMessageKey, string[]>> = {
  "ticket.closure": [
    "If this is not resolved, reply to this email — the reply reopens the ticket and puts it back in the queue.",
  ],
  "ticket.follow_up": [
    "If no response is received within the timeframe, this ticket may be automatically closed.",
  ],
  "ticket.note": [
    "Ticket: {{ticket.number}} — {{ticket.title}}",
  ],
  "user.invite": [
    "Temporary password: the credential generated for this account",
  ],
};

/** Does this block carry a sentence whose presence is not optional? */
export function blockIsRequired(key: EmailMessageKey, block: EmailBlock): boolean {
  const sentences = REQUIRED_SENTENCES[key];
  if (!sentences || sentences.length === 0) return false;
  const haystack =
    block.kind === "note" || block.kind === "heading"
      ? block.text
      : block.kind === "paragraph" || block.kind === "quote"
        ? block.html
        : "";
  return sentences.some((sentence) => haystack.includes(sentence));
}

/** A fresh copy of the code's body, so an edit never mutates the default. */
export function codeBlocksFor(key: EmailMessageKey): EmailBlock[] {
  return structuredClone(CODE_V0_BLOCKS[key] ?? []);
}

/** The "what gets sent" switches, each reading as a sentence with its consequence beside it. */
export interface ContentSwitch {
  id: string;
  label: string;
  /** What turning it on does, and what turning it off costs. */
  say: string;
  on: boolean;
  /** Counted by the panel: "4 of 9 ticket facts". */
  counts?: "facts" | "quote" | null;
}

export const CONTENT_SWITCHES: ContentSwitch[] = [
  {
    id: "greeting",
    label: "Name the person it is addressed to",
    say: "Adds the greeting. When off, the message opens with the ticket line and the reader has to work out who they are from the address bar.",
    on: true,
    counts: null,
  },
  {
    id: "ticket-line",
    label: "Show the ticket number and title",
    say: "On for every customer-facing ticket message today, because the number is the reference a client quotes back.",
    on: true,
    counts: "facts",
  },
  {
    id: "quote-note",
    label: "Quote what was said",
    say: "On for a note. Off for a status change, where there is nothing to quote — which is exactly the conditional drawn on the canvas.",
    on: true,
    counts: "quote",
  },
  {
    id: "quote-thread",
    label: "Quote the whole thread, not just this note",
    say: "Off. Turning it on puts every previous note in the message; on a ticket with 12 comments that is a long email to somebody who asked one question.",
    on: false,
    counts: "quote",
  },
  {
    id: "time-entries",
    label: "Include time entries",
    say: "Off. Time logged is a customer-visible activity today and does notify the contact; making it a line in the message body as well would tell the client how long the work took on every update.",
    on: false,
    counts: "facts",
  },
  {
    id: "status-history",
    label: "Include the status history",
    say: "Off. The current status is a fact pair; the history is a report, and a report belongs in a report.",
    on: false,
    counts: "facts",
  },
  {
    id: "technician",
    label: "Name the technician",
    say: "On. A named person is a person the client can ask for.",
    on: true,
    counts: "facts",
  },
  {
    id: "client-name",
    label: "Show the client's own name in the footer",
    say: "On — and this is the paragraph the composer writes as a string literal today. Here it is a block with a switch behind it.",
    on: true,
    counts: null,
  },
];

/** How many of the nine ticket facts the switches currently put in the message. */
export const TOTAL_TICKET_FACTS = 9;

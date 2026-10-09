/**
 * What the code itself says about each message, and the vocabulary the Studio shares with the API.
 *
 * The Studio's list is not an invention and not a database read: every message this product can send
 * is written in `packages/email/src/EmailService.ts` today, and its subject, its trigger, its reader
 * and its sender are all in that file and the six callers of it. `packages/shared/src/emailTemplate.ts`
 * names the key set; the facts beside each key here are the ones the mockup read out of the working
 * copy, so the screen can show the list even when the API's `GET /api/email/messages` has not answered
 * — which is the state this screen has to be *honest* about rather than silent about.
 *
 * Two rules this file follows, both of them the mockup's:
 *
 *  · **Nothing is invented to fill a group.** `report.scheduled` and `quote.send` have no sender
 *    anywhere in the repository. They are listed as *reserved* and say so, because a plausible-looking
 *    message drawn to fill the Reports group would be the one lie in the room.
 *  · **`live` is a fact about the code, not a preference.** A sender nothing calls is `live: false`,
 *    and the row says "never sent" rather than looking like a delivered one.
 *
 * The API is the authority for everything that is *state* — whether somebody has edited the template,
 * how many clients hold an override, what the versions are. Those are read, never guessed, and where
 * the read fails the screen says which read failed.
 */
import {
  EMAIL_MESSAGE_KEYS,
  type EmailAudience,
  type EmailEditingClass,
  type EmailMessageKey,
} from "@C7NTAX/shared";

/** A group is "what a person is doing when the message goes", which is how the list is read. */
export type EmailGroupId = "ticket" | "money" | "access" | "portal" | "reserved";

export interface EmailGroup {
  id: EmailGroupId;
  label: string;
  /** One sentence: who is doing what when these go out. */
  say: string;
  tone: "cyber" | "green" | "amber" | "neutral";
}

export const EMAIL_GROUPS: EmailGroup[] = [
  {
    id: "ticket",
    label: "Ticket activity",
    say: "Written while somebody is working a ticket: a note, a time entry, a status, a reply, a reminder.",
    tone: "cyber",
  },
  {
    id: "money",
    label: "Money",
    say: "Written while somebody is collecting: an invoice and a reminder about one.",
    tone: "green",
  },
  {
    id: "access",
    label: "Access & security",
    say: "Written while somebody is getting in — or being let in. Both are security-class.",
    tone: "amber",
  },
  {
    id: "portal",
    label: "Portal",
    say: "Written while a customer is signing themselves in.",
    tone: "cyber",
  },
  {
    id: "reserved",
    label: "Reserved — no sender yet",
    say: "Keys the vocabulary holds for messages nothing sends. Listed so the set is complete, and labelled so nobody mistakes one for a message that goes out.",
    tone: "neutral",
  },
];

export interface EmailMessageFact {
  key: EmailMessageKey;
  name: string;
  group: EmailGroupId;
  audience: EmailAudience;
  editingClass: EmailEditingClass;
  /** False when no code path reaches the sender. */
  live: boolean;
  /** True when there is no sender at all — only a key the vocabulary reserves. */
  reserved: boolean;
  /** The subject *as written* — the template literal, not a resolved example. `null` when none exists. */
  subject: string | null;
  /** What fires it, named at the file and line a person can go and read. */
  trigger: string;
  /** Who receives it. */
  reader: string;
  /** What the body is today, in the code's own vocabulary. */
  body: string;
  /** What it may carry, or `null` when it carries nothing. */
  attachments: string | null;
  /** A sentence whose *presence* is a mechanism rather than copy. */
  requiredLine?: string;
}

/**
 * The twelve keys, in the order the shared vocabulary lists them, each with the facts the code holds.
 * Read from `packages/email/src/EmailService.ts` and its callers in the working copy.
 */
export const EMAIL_MESSAGE_FACTS: EmailMessageFact[] = [
  {
    key: "ticket.note",
    name: "Email from the ticket",
    group: "ticket",
    audience: "customer",
    editingClass: "full",
    live: true,
    reserved: false,
    subject: "[{{ticket.number}}] <the technician's subject, up to 200 characters>",
    trigger: "a technician writes and sends an email from the ticket composer — routes/tickets/index.ts:515.",
    reader: "the primary contact unless removed, plus anyone picked; the ticket's cc contacts copied; ad-hoc bcc allowed.",
    body: "the technician's own body, then a hard-coded <hr> and \"Ticket: … — … / Client: …\". These words are in a string literal today — exactly the paragraph a template should own.",
    attachments: "the ticket's own files (up to 10) and pasted images as inline cid: parts",
  },
  {
    key: "ticket.activity",
    name: "Ticket update",
    group: "ticket",
    audience: "customer",
    editingClass: "full",
    live: true,
    reserved: false,
    subject: "[{{ticket.number}}] {{event.label}} — {{ticket.title}}",
    trigger: "a customer-visible event happens — a non-internal note is added, time is logged, or the status changes. notifyTicketContact, services/ticketNotifications.ts:87.",
    reader: "the primary contact in To; every cc contact copied; an additional contact only for a note, and only while their own notifyOnNote switch is on.",
    body: "ticketActivityTemplate — a header, a greeting when the ticket has a contact name, the ticket line, the event label, the detail in a panel, and \"If you have any questions, simply reply to this email.\"",
    attachments: null,
  },
  {
    key: "ticket.closure",
    name: "Ticket closed",
    group: "ticket",
    audience: "customer",
    editingClass: "proposed",
    live: false,
    reserved: false,
    subject: "[{{ticket.number}}] Ticket Closed — {{ticket.title}}",
    trigger: "nothing. A grep across the repository finds no caller of sendTicketAutoClose. The closure a client actually receives is notifyTicketClosure, which goes out as ticket.activity with the label \"Ticket closed\", \"Ticket resolved\" or \"Ticket cancelled\".",
    reader: "—",
    body: "autoCloseTemplate: a header reading Ticket Closed, then \"This ticket was automatically closed due to inactivity.\" Redundant as well as dead: closing a ticket rides on ticket.activity already.",
    attachments: null,
    requiredLine: "If this is not resolved, reply to this email — the reply reopens the ticket and puts it back in the queue.",
  },
  {
    key: "ticket.follow_up",
    name: "Waiting on you",
    group: "ticket",
    audience: "customer",
    editingClass: "full",
    live: true,
    reserved: false,
    subject: "[{{ticket.number}}] Action Required — {{ticket.title}}",
    trigger: "the background worker, every 24 hours a ticket sits waiting_on_client, until the board's autoCloseDays — worker.ts:80, startWorkers() inside the API process.",
    reader: "company.email || company.billingEmail — the company's address, never the contact's.",
    body: "followUpTemplate — an amber header reading Action Required, the days idle, and the sentence \"If no response is received within the timeframe, this ticket may be automatically closed.\"",
    attachments: null,
    requiredLine: "If no response is received within the timeframe, this ticket may be automatically closed.",
  },
  {
    key: "ticket.reopened_internal",
    name: "Reopened by the client",
    group: "ticket",
    audience: "internal",
    editingClass: "internal",
    live: true,
    reserved: false,
    subject: "[{{ticket.number}}] Reopened by the client — {{ticket.title}}",
    trigger: "a client replies to a ticket that was closed — notifyTicketReopenedByClient, services/ticketNotifications.ts:198, from emailToTicket.ts:587.",
    reader: "the assignee; with nobody assigned, whoever raised the ticket. Never the client.",
    body: "a header, who replied, what they said in a quoted panel, and a button to open the ticket — an internal message that asked somebody to reply by email would put the answer in the wrong place.",
    attachments: null,
  },
  {
    key: "invoice.send",
    name: "Invoice",
    group: "money",
    audience: "customer",
    editingClass: "proposed",
    live: false,
    reserved: false,
    subject: "Invoice {{invoice.number}} — Due {{invoice.dueDate}}",
    trigger: "nothing. No route, worker or service calls sendInvoice, so an invoice marked \"sent\" today is a row in a table rather than a message that left the building.",
    reader: "invoice.company.email",
    body: "invoiceTemplate: a header reading Invoice {n}, the amount due large, the due date, a View & Pay Invoice button, and the PDF attached.",
    attachments: "invoice-{{invoice.number}}.pdf, generated",
  },
  {
    key: "invoice.overdue",
    name: "Invoice overdue reminder",
    group: "money",
    audience: "customer",
    editingClass: "full",
    live: true,
    reserved: false,
    subject: "Overdue Invoice {{invoice.number}} — Payment Required",
    trigger: "the worker, while an invoice is overdue and the days overdue are a multiple of 7 — worker.ts:195, sendOverdueReminder.",
    reader: "invoice.company.email.",
    body: "overdueTemplate — a header reading Payment Overdue, the outstanding balance, the invoice number and days overdue, and a Pay Now button pointing at the portal.",
    attachments: null,
  },
  {
    key: "auth.mfa_code",
    name: "Sign-in verification code",
    group: "access",
    audience: "internal",
    editingClass: "security",
    live: true,
    reserved: false,
    subject: "C7NTAX — Your Verification Code",
    trigger: "a password sign-in needs the emailed code — routes/auth.ts:398, sendMfaCode.",
    reader: "the person signing in, at their own address.",
    body: "mfaTemplate — a header, \"Verification Code\", \"It expires in 10 minutes\", and the code itself. Fixed for a reason: it is read once, in a hurry, possibly on a phone in a bad signal area.",
    attachments: null,
  },
  {
    key: "user.invite",
    name: "Your account is ready",
    group: "access",
    audience: "internal",
    editingClass: "security",
    live: true,
    reserved: false,
    subject: "C7NTAX — Your account is ready",
    trigger: "an administrator creates an account with credentialMode: \"invite\", or ticks email it — routes/users.ts:99 (sendWelcomeEmail).",
    reader: "the new account's own address. The temporary password is never shown to the administrator.",
    body: "Six <p> elements joined by newlines — no header, no footer, no brand element at all. Also used for a password reset, so a reset arrives saying \"An account has been created for you in C7NTAX.\"",
    attachments: null,
    requiredLine: "the credential line — the reason the message was sent.",
  },
  {
    key: "portal.login_code",
    name: "Portal sign-in code",
    group: "portal",
    audience: "customer",
    editingClass: "security",
    live: true,
    reserved: false,
    subject: "Your C7NTAX portal sign-in code",
    trigger: "somebody asks for a portal sign-in code — routes/portal.ts:146. The route answers 202 whatever happens, so the message is the only evidence a request was made.",
    reader: "the contact's address, and only if that contact belongs to a client with the portal enabled.",
    body: "A single <p> with the code letterspaced, plus a plain-text alternative built in the same call — one of only two messages in the product that already sends a text part.",
    attachments: null,
  },
  {
    key: "report.scheduled",
    name: "A scheduled report",
    group: "reserved",
    audience: "internal",
    editingClass: "proposed",
    live: false,
    reserved: true,
    subject: null,
    trigger: "nothing renders or mails it. A reportSchedule row is real — weekly · Monday · 06:00 · ops@example.com · pdf — and no code produces the PDF.",
    reader: "reportSchedule.recipients.",
    body: "Not written. The key is reserved so a schedule has somewhere to send from when a renderer exists.",
    attachments: "the report PDF — no renderer exists yet",
  },
  {
    key: "quote.send",
    name: "A quote",
    group: "reserved",
    audience: "customer",
    editingClass: "proposed",
    live: false,
    reserved: true,
    subject: null,
    trigger: "nothing. Quotes are real rows and convert to invoices; nothing emails one.",
    reader: "the client's address on the quote.",
    body: "Not written. The key is reserved so \"send this quote\" has somewhere to go.",
    attachments: "the quote PDF, presumably — nothing generates or sends one",
  },
];

/** The facts by key, so a row can be found without a scan. */
export const EMAIL_FACTS_BY_KEY: Record<string, EmailMessageFact> = Object.fromEntries(
  EMAIL_MESSAGE_FACTS.map((fact) => [fact.key, fact]),
);

/** Every key the vocabulary holds must have facts here, or the list would silently lose a message. */
export const EMAIL_KEYS_WITHOUT_FACTS: EmailMessageKey[] = EMAIL_MESSAGE_KEYS.filter(
  (key) => !EMAIL_FACTS_BY_KEY[key],
);

export function groupFor(id: EmailGroupId): EmailGroup {
  return EMAIL_GROUPS.find((group) => group.id === id) ?? EMAIL_GROUPS[EMAIL_GROUPS.length - 1]!;
}

/** A one-line label for the editing class, used by the chips and the tables. */
export const EDITING_CLASS_LABEL: Record<EmailEditingClass, string> = {
  full: "Full editor",
  security: "Security — body locked",
  internal: "Internal — no brand kit",
  proposed: "Proposed — nothing calls it",
};

/** What may be edited, in the words the class chip is explained with. */
export const EDITING_CLASS_MEANING: Record<EmailEditingClass, string> = {
  full: "Everything: subject, blocks, fields, conditionals, attachments and the brand kit's inheritance.",
  security:
    "Sender and footer only. The body is a fixed, plain sentence plus the code or the credential — a one-time code is read once, in a hurry, often on a poor connection, and decorating it is how a legitimate message comes to look like a phishing attempt.",
  internal:
    "Fully editable, but the brand kit is not applied and cannot be: no logo, no marketing footer, no unsubscribe. It is read by a technician, not by a customer.",
  proposed:
    "Shown and labelled, not editable. The sender is written and nothing calls it, so nobody should mistake a well-formed preview for a delivered message.",
};

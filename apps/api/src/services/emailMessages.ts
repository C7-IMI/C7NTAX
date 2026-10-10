/**
 * The message registry — what every message this product can send says, who reads it, and what fires it.
 *
 * **The default blocks are the migration.** Each key's `defaultBlocks` reproduces the words its
 * hard-coded sender produced before there was a template table, so an instance with no `EmailTemplate`
 * row renders exactly the message it has always sent: the Studio's "default" state *is* the code, and
 * `POST /templates/:key/reset` is a delete rather than a restored copy of something somebody could have
 * edited into disagreement with the code.
 *
 * The migration is word for word but not byte for byte: **markup may differ, the words may not.** The
 * meta line carries a `<br>` after the dash and the ticket number carries `white-space: nowrap`, so that
 * line breaks between the identifier and the subject rather than mid-phrase at 375px.
 * `EmailService` mirrors both, which is why the probe's line-for-line comparison still holds — the two
 * move together or the check says so.
 *
 * Two rows are deliberately *not* live. `ticket.closure` and `invoice.send` are well-formed senders
 * with no caller anywhere in the repository (`sendTicketAutoClose`, `sendInvoice`), and the closure a
 * client actually receives rides on `ticket.activity` through `notifyTicketClosure` — which carries the
 * one line that matters, that a reply reopens the ticket. They are in the list, marked `proposed`, so
 * nobody mistakes a written email for a delivered one. `report.scheduled` and `quote.send` are the same
 * case with no sender at all: keys the shared vocabulary reserves.
 *
 * The fields are `EMAIL_FIELDS` tokens wherever one exists. A message also has a few **system values**
 * (`message.*`): blanks whose absence would change a sentence's meaning rather than leave a visible
 * gap — a greeting, a pluralised count, the credential line — are supplied by the caller as whole
 * fragments, so the sentence is either there or the block is not sent at all. They are listed here so
 * the editor can name them instead of showing an opaque token.
 */
import { EMAIL_FIELDS, EMAIL_MESSAGE_KEYS, type EmailAudience, type EmailBlock, type EmailEditingClass, type EmailMessageKey } from "@C7NTAX/shared";

export interface EmailMessageField {
  token: string;
  label: string;
  sample: string;
}

export interface EmailMessageDefinition {
  key: EmailMessageKey;
  /** What a person calls it. */
  name: string;
  /** The group they look for it in. */
  group: string;
  audience: EmailAudience;
  editingClass: EmailEditingClass;
  /** False when no code path reaches the sender. Shown, not hidden: "never sent" is a state. */
  live: boolean;
  /** What fires it, in the caller's own terms. */
  trigger: string;
  /** Who receives it, as the code enforces it today — read-only in the Studio, because who reads a
   *  message is a fact about the ticket rather than a word in the template. */
  recipients: string;
  /** The address it leaves from. Today: one `SMTP_FROM` for every send. */
  from: string;
  /** How a reply is answered. Null when a reply goes nowhere in particular. */
  replyTo: string | null;
  /** The files it may carry, or null. */
  attachments: string | null;
  /** The merge fields it may use. */
  fields: EmailMessageField[];
  /**
   * Tokens without which the message stops being the message it exists to be — the code somebody is
   * waiting for, the credential. A save that drops one is refused rather than stored.
   */
  requiredTokens: string[];
  /**
   * True for `ticket.note` only: the technician's own message goes above the blocks, because the
   * composer's body is written per ticket and the template owns the footer under it.
   */
  bodyFromComposer?: boolean;
  /** The function or route that sends it today, so the matrix can point at it. */
  sender: string;
  defaultSubject: string;
  defaultBlocks: EmailBlock[];
}

/** The instance's brand as the renderer needs it. Stored in `EmailBrandKit`, defaulted here. */
export interface EmailBrandValues {
  productName: string;
  companyName: string;
  wordmark: string;
  primaryColor: string;
  accentColor: string;
  footerText: string;
  legalText: string;
}

/**
 * The brand kit's defaults, which are the values the senders write into their markup today:
 * `#c00000` is the banner crimson and `#00c0f4` the accent, the same pair
 * `apps/web/src/lib/documentBrand.ts` gives the printed documents.
 */
export const DEFAULT_BRAND: EmailBrandValues = {
  productName: "C7NTAX",
  companyName: "Cyber 7 Group, LLC",
  wordmark: "C7NTAX",
  primaryColor: "#c00000",
  accentColor: "#00c0f4",
  footerText: "Sent by C7NTAX on behalf of Cyber 7 Group, LLC.",
  legalText: "",
};

/** A merge field of this message: a shared field, or a value the sender computes. */
function field(token: string): EmailMessageField {
  const known = EMAIL_FIELDS.find((entry) => entry.token === token);
  if (known) return { token: known.token, label: known.label, sample: known.sample };
  const system: Record<string, EmailMessageField> = {
    "message.subject": { token: "message.subject", label: "The subject you typed", sample: "Replacement licence assigned" },
    "message.greeting": { token: "message.greeting", label: "Greeting (blank when there is no name)", sample: "Hi David," },
    "message.clientLine": { token: "message.clientLine", label: "Client line (blank when there is none)", sample: "Acme Corporation" },
    "message.reopenedBy": { token: "message.reopenedBy", label: "Who replied", sample: "David Chen" },
    "message.code": { token: "message.code", label: "The one-time code", sample: "482913" },
    "message.credential": { token: "message.credential", label: "The temporary password", sample: "7fKq-2mRt-9xZp" },
    "message.passwordNote": { token: "message.passwordNote", label: "The instruction about the password", sample: "You will be asked to choose your own password the first time you sign in." },
    "message.portalLine": { token: "message.portalLine", label: "Where to sign in (blank when the deployment has no address)", sample: "Sign in at https://portal.example.com." },
    "message.idleFor": { token: "message.idleFor", label: "How long it has been idle", sample: "3 days" },
    "message.overdueFor": { token: "message.overdueFor", label: "How long it is overdue", sample: "15 days overdue" },
    "message.reportName": { token: "message.reportName", label: "The report", sample: "Monthly Ticket Volume" },
    "message.reportLine": { token: "message.reportLine", label: "The sentence about the report", sample: "Your scheduled report is attached." },
    "message.frequency": { token: "message.frequency", label: "How often it runs", sample: "weekly · Monday · 06:00" },
    "message.format": { token: "message.format", label: "The format", sample: "PDF" },
    "message.fileName": { token: "message.fileName", label: "The file's name", sample: "monthly-ticket-volume.pdf" },
    "message.quoteNumber": { token: "message.quoteNumber", label: "Quotation number", sample: "QUO-2026-014" },
    "message.quoteLine": { token: "message.quoteLine", label: "The sentence about the quotation", sample: "Quotation QUO-2026-014 is attached, valid for 30 days." },
    "message.quoteTotal": { token: "message.quoteTotal", label: "Quotation total", sample: "$4,120.00" },
    "message.quoteValidUntil": { token: "message.quoteValidUntil", label: "Valid until", sample: "8 November 2026" },
    "message.quoteUrl": { token: "message.quoteUrl", label: "Quotation link", sample: "https://…/quotes/…" },
  };
  return system[token] ?? { token, label: token, sample: "" };
}

function fieldsFor(tokens: string[]): EmailMessageField[] {
  return tokens.map(field);
}

const TICKET_ACTIVITY: EmailBlock[] = [
  { kind: "heading", level: 1, text: "Ticket Update" },
  { kind: "paragraph", html: "{{message.greeting}}" },
  { kind: "paragraph", html: 'Ticket <strong style="color:#ffffff;white-space:nowrap">{{ticket.number}}</strong> —<br><em>{{ticket.title}}</em>' },
  { kind: "paragraph", html: '<strong style="color:#ffffff">{{event.label}}</strong>' },
  { kind: "quote", html: "{{note.body}}" },
  { kind: "paragraph", html: "If you have any questions, simply reply to this email." },
  { kind: "paragraph", html: "{{message.clientLine}}" },
];

export const EMAIL_MESSAGES: EmailMessageDefinition[] = [
  {
    key: "ticket.note",
    name: "Email from the ticket",
    group: "Ticket activity",
    audience: "customer",
    editingClass: "full",
    live: true,
    trigger: "A technician writes and sends an email from the ticket composer (POST /api/tickets/:id/email).",
    recipients:
      "The ticket's primary contact unless the composer removed them, plus anyone picked; the ticket's cc contacts copied; ad-hoc bcc allowed.",
    from: "SMTP_FROM, one address for every message",
    replyTo: null,
    attachments: "The ticket's own files (up to 10) and pasted images as inline cid: parts",
    fields: fieldsFor(["ticket.number", "ticket.title", "client.name", "message.subject"]),
    requiredTokens: [],
    bodyFromComposer: true,
    sender: "routes/tickets/index.ts — POST /tickets/:id/email",
    defaultSubject: "[{{ticket.number}}] {{message.subject}}",
    // The typed body, then <hr> and the two lines that are in a string literal today.
    defaultBlocks: [
      { kind: "divider" },
      {
        kind: "paragraph",
        html: "Ticket: {{ticket.number}} — {{ticket.title}}<br>Client: {{client.name}}",
      },
    ],
  },
  {
    key: "ticket.activity",
    name: "Ticket update",
    group: "Ticket activity",
    audience: "customer",
    editingClass: "full",
    live: true,
    trigger:
      "A customer-visible event: a non-internal note is added, time is logged, or the status changes — and the closure notice, which is this message with the label Ticket closed, Ticket resolved or Ticket cancelled.",
    recipients:
      "The primary contact in To; every cc contact copied; an additional contact only for a note, and only while their own notifyOnNote switch is on.",
    from: "SMTP_FROM, one address for every message",
    replyTo: null,
    attachments: null,
    fields: fieldsFor(["ticket.number", "ticket.title", "event.label", "note.body", "message.greeting", "message.clientLine"]),
    requiredTokens: [],
    sender: "services/ticketNotifications.ts — notifyTicketContact, notifyTicketClosure",
    defaultSubject: "[{{ticket.number}}] {{event.label}} — {{ticket.title}}",
    defaultBlocks: TICKET_ACTIVITY,
  },
  {
    key: "ticket.closure",
    name: "Ticket closed",
    group: "Ticket activity",
    audience: "customer",
    editingClass: "proposed",
    live: false,
    trigger: "Nothing. The sender is written (sendTicketAutoClose) and no code path reaches it.",
    recipients: "Nobody today. The closure a client receives goes out as ticket.activity.",
    from: "SMTP_FROM, one address for every message",
    replyTo: null,
    attachments: null,
    fields: fieldsFor(["ticket.number", "ticket.title"]),
    requiredTokens: [],
    sender: "packages/email — sendTicketAutoClose (no caller)",
    defaultSubject: "[{{ticket.number}}] Ticket Closed — {{ticket.title}}",
    defaultBlocks: [
      { kind: "heading", level: 1, text: "Ticket Closed" },
      { kind: "paragraph", html: 'Ticket <strong style="color:#ffffff;white-space:nowrap">{{ticket.number}}</strong> —<br><em>{{ticket.title}}</em>' },
      {
        kind: "paragraph",
        html: "This ticket was automatically closed due to inactivity. If this issue persists, please open a new ticket.",
      },
    ],
  },
  {
    key: "ticket.follow_up",
    name: "Waiting on you",
    group: "Ticket activity",
    audience: "customer",
    editingClass: "full",
    live: true,
    trigger:
      "The background worker, every 24 hours a ticket sits waiting_on_client, until the board's autoCloseDays (worker.ts, processTicketFollowUps).",
    recipients: "The client's company email or billing email — never the contact's own address.",
    from: "SMTP_FROM, one address for every message",
    replyTo: null,
    attachments: null,
    fields: fieldsFor(["ticket.number", "ticket.title", "ticket.url", "message.idleFor"]),
    requiredTokens: [],
    sender: "worker.ts — EmailService.sendTicketFollowUp",
    defaultSubject: "[{{ticket.number}}] Action Required — {{ticket.title}}",
    defaultBlocks: [
      { kind: "heading", level: 1, text: "Action Required" },
      { kind: "paragraph", html: 'Ticket <strong style="color:#ffffff;white-space:nowrap">{{ticket.number}}</strong> —<br><em>{{ticket.title}}</em>' },
      { kind: "paragraph", html: "We are waiting on your response. This ticket has been idle for <strong>{{message.idleFor}}</strong>." },
      { kind: "paragraph", html: "If no response is received within the timeframe, this ticket may be automatically closed." },
      { kind: "button", label: "Respond Now", href: "{{ticket.url}}" },
    ],
  },
  {
    key: "ticket.reopened_internal",
    name: "Reopened by the client",
    group: "Ticket activity",
    audience: "internal",
    editingClass: "internal",
    live: true,
    trigger: "A client replies to a ticket that was closed (notifyTicketReopenedByClient, from the mail-to-ticket connector).",
    recipients: "The assignee; with nobody assigned, whoever raised the ticket. Never the client.",
    from: "SMTP_FROM, one address for every message",
    replyTo: null,
    attachments: null,
    fields: fieldsFor(["ticket.number", "ticket.title", "ticket.url", "note.body", "message.reopenedBy"]),
    requiredTokens: [],
    sender: "services/ticketNotifications.ts — notifyTicketReopenedByClient",
    defaultSubject: "[{{ticket.number}}] Reopened by the client — {{ticket.title}}",
    defaultBlocks: [
      { kind: "heading", level: 1, text: "Reopened by the client" },
      { kind: "paragraph", html: 'Ticket <strong style="color:#ffffff;white-space:nowrap">{{ticket.number}}</strong> —<br><em>{{ticket.title}}</em>' },
      {
        kind: "paragraph",
        html: '{{message.reopenedBy}} replied to the closing email, so this ticket is back in the queue as <strong style="color:#ffffff">Customer reopened</strong>.',
      },
      { kind: "quote", html: "{{note.body}}" },
      { kind: "button", label: "Open the ticket", href: "{{ticket.url}}" },
      { kind: "paragraph", html: "Sent to the ticket's owner because the client answered a ticket that had been closed." },
    ],
  },
  {
    key: "invoice.send",
    name: "Invoice",
    group: "Money",
    audience: "customer",
    editingClass: "proposed",
    live: false,
    trigger: "Nothing. The sender is written (sendInvoice) and no code path reaches it; marking an invoice sent is a status change, not a message.",
    recipients: "Nobody today. The invoice's client contact is who it would go to.",
    from: "SMTP_FROM, one address for every message",
    replyTo: null,
    attachments: "invoice-{number}.pdf, generated",
    fields: fieldsFor(["invoice.number", "invoice.total", "invoice.dueDate", "invoice.url"]),
    requiredTokens: [],
    sender: "packages/email — sendInvoice (no caller)",
    defaultSubject: "Invoice {{invoice.number}} — Due {{invoice.dueDate}}",
    defaultBlocks: [
      { kind: "heading", level: 1, text: "Invoice {{invoice.number}}" },
      { kind: "paragraph", html: "Amount Due:" },
      { kind: "paragraph", html: '<span style="font-size:28px;font-weight:700;color:#ff5c5c">{{invoice.total}}</span>' },
      { kind: "paragraph", html: 'Due Date: <strong style="color:#ffffff">{{invoice.dueDate}}</strong>' },
      { kind: "button", label: "View & Pay Invoice", href: "{{invoice.url}}" },
    ],
  },
  {
    key: "invoice.overdue",
    name: "Invoice overdue reminder",
    group: "Money",
    audience: "customer",
    editingClass: "full",
    live: true,
    trigger: "The worker, while an invoice is overdue and the days overdue are a multiple of 7 (worker.ts, processInvoiceReminders).",
    recipients: "The client's company email — the company address, not a contact's.",
    from: "SMTP_FROM, one address for every message",
    replyTo: null,
    attachments: null,
    fields: fieldsFor(["invoice.number", "invoice.total", "invoice.url", "message.overdueFor"]),
    requiredTokens: [],
    sender: "worker.ts — EmailService.sendOverdueReminder",
    defaultSubject: "Overdue Invoice {{invoice.number}} — Payment Required",
    defaultBlocks: [
      { kind: "heading", level: 1, text: "Payment Overdue" },
      { kind: "paragraph", html: "Outstanding Balance:" },
      { kind: "paragraph", html: '<span style="font-size:28px;font-weight:700;color:#ef4444">{{invoice.total}}</span>' },
      {
        kind: "paragraph",
        html: 'Invoice {{invoice.number}} is <strong style="color:#ef4444">{{message.overdueFor}}</strong>.',
      },
      { kind: "button", label: "Pay Now", href: "{{invoice.url}}" },
    ],
  },
  {
    key: "auth.mfa_code",
    name: "Sign-in verification code",
    group: "Access & security",
    audience: "internal",
    editingClass: "security",
    live: true,
    trigger: "A password sign-in needs the emailed code (POST /api/auth/send-mfa-email).",
    recipients: "The person signing in, at their own address.",
    from: "SMTP_FROM, one address for every message",
    replyTo: null,
    attachments: null,
    fields: fieldsFor(["message.code", "instance.name"]),
    requiredTokens: ["message.code"],
    sender: "routes/auth.ts — EmailService.sendMfaCode",
    defaultSubject: "{{instance.name}} — Your Verification Code",
    defaultBlocks: [
      { kind: "heading", level: 1, text: "{{instance.name}}" },
      { kind: "heading", level: 2, text: "Verification Code" },
      { kind: "paragraph", html: "Use this code to complete your sign-in. It expires in 10 minutes." },
      { kind: "paragraph", html: '<span style="font-size:32px;font-weight:700;color:#ff5c5c">{{message.code}}</span>' },
      { kind: "paragraph", html: "If you did not request this code, please ignore this email." },
    ],
  },
  {
    key: "user.invite",
    name: "Your account is ready",
    group: "Access & security",
    audience: "internal",
    editingClass: "security",
    live: true,
    trigger:
      "An administrator creates an account with credentialMode invite, or ticks 'email it' (routes/users.ts, sendWelcomeEmail). Also the password-reset path, which reuses this message.",
    recipients: "The new account's own address. The temporary password is never shown to the administrator on the invite path.",
    from: "SMTP_FROM, one address for every message",
    replyTo: null,
    attachments: null,
    fields: fieldsFor(["contact.firstName", "contact.email", "instance.name", "instance.signInUrl", "message.credential", "message.passwordNote"]),
    requiredTokens: ["message.credential"],
    sender: "routes/users.ts — sendWelcomeEmail",
    defaultSubject: "{{instance.name}} — Your account is ready",
    defaultBlocks: [
      { kind: "paragraph", html: "Hello {{contact.firstName}}," },
      { kind: "paragraph", html: "An account has been created for you in {{instance.name}}." },
      {
        kind: "paragraph",
        // The one raw link in any default, and the reason it carries a colour: a client draws an
        // unstyled link in its own blue, which on this card is nearly invisible. The accent is the
        // brand kit's own (`documentBrand.ts`), and it is written into the markup rather than a
        // `<style>` block because the sanitiser drops one with its content.
        html:
          '<strong>Sign in:</strong> <a href="{{instance.signInUrl}}" style="color:#00c0f4">{{instance.signInUrl}}</a><br>' +
          "<strong>Email:</strong> {{contact.email}}<br>" +
          "<strong>Temporary password:</strong> {{message.credential}}",
      },
      { kind: "paragraph", html: "{{message.passwordNote}}" },
    ],
  },
  {
    key: "portal.login_code",
    name: "Portal sign-in code",
    group: "Portal",
    audience: "customer",
    editingClass: "security",
    live: true,
    trigger:
      "Somebody asks for a portal sign-in code (POST /api/portal/auth/request). The route answers 202 whatever happens, so this message is the only evidence a request was made.",
    recipients: "The contact's address, and only if that contact belongs to a client with the portal enabled.",
    from: "SMTP_FROM, one address for every message",
    replyTo: null,
    attachments: null,
    fields: fieldsFor(["portal.code", "instance.name", "message.portalLine"]),
    requiredTokens: ["portal.code"],
    sender: "routes/portal.ts — POST /api/portal/auth/request",
    defaultSubject: "Your {{instance.name}} portal sign-in code",
    defaultBlocks: [
      { kind: "paragraph", html: 'Your sign-in code is <strong style="font-size:18px">{{portal.code}}</strong>.' },
      { kind: "paragraph", html: "{{message.portalLine}}" },
      { kind: "paragraph", html: "It expires in 10 minutes. If you did not ask for it, ignore this message." },
    ],
  },
  {
    key: "report.scheduled",
    name: "Scheduled report",
    group: "Reports",
    audience: "internal",
    editingClass: "proposed",
    live: false,
    trigger:
      "Nothing. A report schedule is a real row (weekly · Monday · 06:00 · ops@example.com · pdf) and no code renders the PDF or mails it.",
    recipients: "would be the report schedule's own recipients list.",
    from: "SMTP_FROM, one address for every message",
    replyTo: null,
    attachments: "the report PDF — no renderer exists yet",
    fields: fieldsFor(["instance.name", "message.reportName", "message.reportLine", "message.frequency", "message.format", "message.fileName"]),
    requiredTokens: [],
    sender: "nothing — a reserved key",
    defaultSubject: "{{instance.name}} — {{message.reportName}}",
    defaultBlocks: [
      { kind: "heading", level: 1, text: "Scheduled report" },
      { kind: "paragraph", html: "{{message.reportLine}}" },
      {
        kind: "facts",
        title: "The run",
        items: [
          { label: "Report", value: "{{message.reportName}}" },
          { label: "Schedule", value: "{{message.frequency}}" },
          { label: "Format", value: "{{message.format}}" },
        ],
      },
      { kind: "attachment", name: "{{message.fileName}}", note: "generated when the report runs" },
    ],
  },
  {
    key: "quote.send",
    name: "Quotation",
    group: "Money",
    audience: "customer",
    editingClass: "proposed",
    live: false,
    trigger: "Nothing. Quotes are real rows and convert to invoices; no code sends one.",
    recipients: "would be the quote's client contact.",
    from: "SMTP_FROM, one address for every message",
    replyTo: null,
    attachments: "the quotation PDF — nothing generates one yet",
    fields: fieldsFor(["message.quoteNumber", "message.quoteLine", "message.quoteTotal", "message.quoteValidUntil", "message.quoteUrl"]),
    requiredTokens: [],
    sender: "nothing — a reserved key",
    defaultSubject: "Quotation {{message.quoteNumber}}",
    defaultBlocks: [
      { kind: "heading", level: 1, text: "Your quotation" },
      { kind: "paragraph", html: "{{message.quoteLine}}" },
      {
        kind: "facts",
        title: "The quotation",
        items: [
          { label: "Quotation", value: "{{message.quoteNumber}}" },
          { label: "Total", value: "{{message.quoteTotal}}" },
          { label: "Valid until", value: "{{message.quoteValidUntil}}" },
        ],
      },
      { kind: "button", label: "View the quotation", href: "{{message.quoteUrl}}" },
    ],
  },
];

const BY_KEY = new Map<string, EmailMessageDefinition>(EMAIL_MESSAGES.map((entry) => [entry.key, entry]));

/** The definition for a key, or undefined if the key is not one this build knows. */
export function emailMessage(key: string): EmailMessageDefinition | undefined {
  return BY_KEY.get(key);
}

/** The definition, or a thrown error — for the routes, which answer 404 on an unknown key. */
export function requireEmailMessage(key: string): EmailMessageDefinition {
  const entry = BY_KEY.get(key);
  if (!entry) throw new Error(`Unknown email message key: ${key}`);
  return entry;
}

/** Every key the shared vocabulary declares has exactly one entry here, and nothing extra. */
export function registryCoverage(): { missing: string[]; extra: string[] } {
  const declared = new Set<string>(EMAIL_MESSAGE_KEYS);
  return {
    missing: [...declared].filter((key) => !BY_KEY.has(key)),
    extra: EMAIL_MESSAGES.map((entry) => entry.key as string).filter((key) => !declared.has(key)),
  };
}

/** The groups in the order the list shows them, with what is in each. */
export function emailMessageGroups(): { name: string; keys: string[]; live: number; dead: number }[] {
  const order: string[] = [];
  for (const entry of EMAIL_MESSAGES) if (!order.includes(entry.group)) order.push(entry.group);
  return order.map((name) => {
    const keys = EMAIL_MESSAGES.filter((entry) => entry.group === name).map((entry) => entry.key as string);
    return {
      name,
      keys,
      live: EMAIL_MESSAGES.filter((entry) => entry.group === name && entry.live).length,
      dead: EMAIL_MESSAGES.filter((entry) => entry.group === name && !entry.live).length,
    };
  });
}

/** A default template for a key — what renders when no `EmailTemplate` row exists. */
export function defaultTemplate(key: EmailMessageKey): { subject: string; blocks: EmailBlock[]; text: null } {
  const entry = requireEmailMessage(key);
  return { subject: entry.defaultSubject, blocks: entry.defaultBlocks, text: null };
}

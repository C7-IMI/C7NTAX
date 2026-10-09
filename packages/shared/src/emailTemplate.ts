/**
 * Email templates — the vocabulary, shared by the API that renders and sends a message and the web
 * app that edits and previews it.
 *
 * The types live here rather than beside either implementation because the two must never disagree
 * about what a block is: a block the editor can draw and the renderer does not understand is a block
 * that silently disappears from a customer's email, and the failure is invisible until somebody
 * complains. **Rendering, however, lives on the server** (`apps/api/src/services/emailTemplateRender.ts`)
 * and is reached over `POST /api/email/preview` — there is one HTML renderer and one plain-text
 * renderer, so the preview a person approves is literally the message that goes out.
 */

/** Every message this instance can send. The key is stable: it is what a stored template is filed under. */
export const EMAIL_MESSAGE_KEYS = [
  "ticket.note",
  "ticket.activity",
  "ticket.closure",
  "ticket.follow_up",
  "ticket.reopened_internal",
  "invoice.send",
  "invoice.overdue",
  "auth.mfa_code",
  "user.invite",
  "portal.login_code",
  // Reserved: named in the interface so the set is complete, with no sender behind them yet.
  "report.scheduled",
  "quote.send",
] as const;

export type EmailMessageKey = (typeof EMAIL_MESSAGE_KEYS)[number];

/** Who reads it. An internal message is deliberately *not* the customer template with different words. */
export type EmailAudience = "customer" | "internal";

/**
 * How much of a message may be edited.
 *
 * - `full` — the whole body, subject and layout.
 * - `security` — a code somebody is waiting for: the sender, the footer and one line of wording, with
 *   the body itself locked. A one-time code is read once, in a hurry, often on a poor connection, and
 *   decorating it is how a legitimate message comes to look like a phishing attempt.
 * - `internal` — a message to a member of staff: no brand kit, and the fields it needs are the
 *   ticket's, not the customer's.
 * - `proposed` — the sender exists in code but nothing calls it (`sendInvoice`, `sendTicketAutoClose`).
 *   The Studio shows it and says so rather than pretending it is a live message.
 */
export type EmailEditingClass = "full" | "security" | "internal" | "proposed";

/**
 * A block of a message.
 *
 * Deliberately a small set: every one of these is something that survives being sent as plain text,
 * which is the constraint that matters (see `text` below). A block that cannot be said in words — a
 * two-column layout, a hover state — is not in the set.
 */
export type EmailBlock =
  | { kind: "heading"; text: string; level?: 1 | 2 }
  | { kind: "paragraph"; html: string }
  | { kind: "button"; label: string; href: string }
  | { kind: "facts"; title?: string; items: { label: string; value: string }[] }
  | { kind: "quote"; title?: string; source?: string; html: string }
  | { kind: "table"; title?: string; columns: string[]; rows: string[][] }
  | { kind: "image"; src: string; alt: string; href?: string }
  | { kind: "divider" }
  | { kind: "note"; text: string; tone?: "neutral" | "warn" | "good" }
  | { kind: "attachment"; name: string; note?: string }
  /**
   * Blocks that are present only when a condition holds — "only when there is a note to quote".
   * The condition is one of `EMAIL_CONDITIONS`, so the editor can offer them by name and the renderer
   * can answer them from the same record the fields came from.
   */
  | { kind: "conditional"; when: EmailCondition; blocks: EmailBlock[] }
  /** The brand kit's sign-off and legal footer, drawn from one place so a change is one change. */
  | { kind: "signature" }
  | { kind: "footer" };

export type EmailCondition =
  | "ticket.hasNote"
  | "ticket.hasTimeEntries"
  | "ticket.hasAttachments"
  | "ticket.isClosed"
  | "invoice.isOverdue"
  | "message.hasAttachments";

/** Label and meaning for each condition, so the editor's picker and the renderer cannot disagree. */
export const EMAIL_CONDITIONS: { key: EmailCondition; label: string }[] = [
  { key: "ticket.hasNote", label: "there is a note to quote" },
  { key: "ticket.hasTimeEntries", label: "time was logged on the ticket" },
  { key: "ticket.hasAttachments", label: "the ticket has attachments" },
  { key: "ticket.isClosed", label: "the ticket is closed" },
  { key: "invoice.isOverdue", label: "the invoice is past its due date" },
  { key: "message.hasAttachments", label: "this message carries an attachment" },
];

/**
 * A merge field, as the editor offers it: `{{ticket.number}}`.
 *
 * Grouped by the record it comes from, because that is how somebody looks for one. `sample` is what
 * the editor shows when no real record is chosen — never rendered into a real message.
 */
export interface EmailFieldDef {
  token: string;
  label: string;
  group: "Ticket" | "Client" | "Contact" | "Technician" | "Invoice" | "Portal" | "Instance";
  sample: string;
}

export const EMAIL_FIELDS: EmailFieldDef[] = [
  { token: "ticket.number", label: "Ticket number", group: "Ticket", sample: "TKT-1042" },
  { token: "ticket.title", label: "Subject", group: "Ticket", sample: "Office 365 licence assignment" },
  { token: "ticket.status", label: "Status", group: "Ticket", sample: "In progress" },
  { token: "ticket.priority", label: "Priority", group: "Ticket", sample: "High" },
  { token: "ticket.updated", label: "Last activity", group: "Ticket", sample: "9 October 2026, 14:05" },
  { token: "ticket.url", label: "Ticket link (technicians)", group: "Ticket", sample: "https://…/tickets/…" },
  { token: "client.name", label: "Client", group: "Client", sample: "Globex Industries" },
  { token: "contact.firstName", label: "Contact first name", group: "Contact", sample: "Sarah" },
  { token: "contact.fullName", label: "Contact full name", group: "Contact", sample: "Sarah Lee" },
  { token: "contact.email", label: "Contact email", group: "Contact", sample: "sarah.lee@globexind.com" },
  { token: "technician.fullName", label: "Technician", group: "Technician", sample: "John Smith" },
  { token: "event.label", label: "What changed", group: "Ticket", sample: "A note was added" },
  { token: "note.body", label: "The note", group: "Ticket", sample: "We have reassigned the licence…" },
  { token: "invoice.number", label: "Invoice number", group: "Invoice", sample: "INV-2026-002" },
  { token: "invoice.total", label: "Amount due", group: "Invoice", sample: "$8,680.00" },
  { token: "invoice.dueDate", label: "Due date", group: "Invoice", sample: "6 September 2026" },
  { token: "invoice.daysOverdue", label: "Days overdue", group: "Invoice", sample: "33" },
  { token: "portal.url", label: "Customer portal", group: "Portal", sample: "https://portal.example.com" },
  { token: "portal.code", label: "Sign-in code", group: "Portal", sample: "482913" },
  { token: "instance.name", label: "Instance name", group: "Instance", sample: "C7NTAX" },
  { token: "instance.company", label: "Your company", group: "Instance", sample: "Cyber 7 Group, LLC" },
];

/** `default` — never edited. `customised` — edited here. `overridden` — one or more clients differ. */
export type EmailTemplateState = "default" | "customised" | "overridden";

/** A stored template as the API hands it to the editor. */
export interface EmailTemplate {
  key: EmailMessageKey;
  name: string;
  group: string;
  audience: EmailAudience;
  editingClass: EmailEditingClass;
  /** Live, or written-but-never-called. `proposed` messages are shown and labelled, not hidden. */
  live: boolean;
  subject: string;
  blocks: EmailBlock[];
  /**
   * The plain-text part.
   *
   * `null` means "derive it from the blocks" — the default, and the only setting that cannot drift.
   * A string means somebody edited it, and the interface must then show both parts side by side and
   * warn when the information they carry differs, because a message read in a client that strips HTML
   * has to be the same message.
   */
  text: string | null;
  /** Derived from the blocks and always sent; shown so the two can be compared. */
  derivedText: string;
  state: EmailTemplateState;
  version: number;
  updatedAt: string | null;
  updatedByName: string | null;
}

/** One saved version, for the history panel and its diff against the default. */
export interface EmailTemplateVersion {
  version: number;
  subject: string;
  blocks: EmailBlock[];
  text: string | null;
  savedAt: string;
  savedByName: string | null;
  note: string | null;
}

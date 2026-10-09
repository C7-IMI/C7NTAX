/**
 * The real records a preview is drawn against, and the values a merge field resolves to.
 *
 * Read out of the seeded development instance on 9 October 2026, not chosen for looks:
 *
 *  · `MSP-02-2013` "Office 365 license assignment" — Globex Industries, Sarah Lee
 *    (`slee@globexind.com`), Mike Wilson, in progress, critical, on MSP Service Desk. It has a
 *    customer-visible note, two time entries and no attachments, so it is the record that answers
 *    "does the quote block appear?" with a yes and "does the attachment block appear?" with a no.
 *  · `MSP-01-2002` "New user onboarding for marketing team" — Acme Corporation, David Chen
 *    (`david@acmecorp.com`), John Smith, new, low.
 *  · `INV-2026-002` — Globex Industries, **$8,680.00**, issued 7 August 2026, due 6 September 2026,
 *    `overdue`, and therefore **33 days overdue** on the day this was read. Subtotal $8,000.00 plus
 *    tax at 8.5% ($680.00).
 *
 * **Why a real id matters.** `POST /api/email/preview` takes `{ kind, id }` and resolves the fields
 * from the record — so the recipient rule and every figure in the preview come from the database
 * rather than from a sample. A preview against a made-up record would prove nothing about what a
 * client receives, which is the only question the preview exists to answer.
 *
 * The recipient rules are the code's, not this file's: `apps/api/src/services/ticketContacts.ts`
 * sends to the primary contact, copies every `cc` contact, and reaches an `additional` contact for a
 * note only while that contact's own `notifyOnNote` field is on. That field is a stored column
 * (`ticket_contacts.notify_on_note`), so the switch is real and saves.
 */
import { EMAIL_FIELDS, type EmailFieldDef } from "@C7NTAX/shared";
import { registeredField } from "./emailFieldRegistry";

export type EmailRecordKind = "ticket" | "invoice" | "sample";

export interface EmailRecordOption {
  id: string;
  kind: EmailRecordKind;
  label: string;
  /** The one figure that makes the record recognisable while choosing it. */
  foot: string;
}

export const EMAIL_RECORDS: EmailRecordOption[] = [
  {
    id: "MSP-02-2013",
    kind: "ticket",
    label: "MSP-02-2013 · Globex Industries",
    foot: "Office 365 license assignment · in progress · critical · has a note, no attachments",
  },
  {
    id: "MSP-01-2002",
    kind: "ticket",
    label: "MSP-01-2002 · Acme Corporation",
    foot: "New user onboarding for marketing team · new · low",
  },
  {
    id: "INV-2026-002",
    kind: "invoice",
    label: "INV-2026-002 · Globex Industries",
    foot: "$8,680.00 · due 6 September 2026 · 33 days overdue",
  },
  {
    id: "INV-2026-004",
    kind: "invoice",
    label: "INV-2026-004 · Stark Enterprises",
    foot: "$13,050.00 · due 9 September 2026 · still a draft",
  },
];

export const EMAIL_SAMPLE_RECORD: EmailRecordOption = {
  id: "sample",
  kind: "sample",
  label: "No record — the fields' own samples",
  foot: "what the editor shows before a record is chosen; never sent",
};

/**
 * Values a field resolves to **for the record being previewed**, so a field that is empty on this
 * ticket reads as empty here rather than silently showing a sample. Anything not listed falls back
 * to `EMAIL_FIELDS`' own sample, and the studio says which of the two it used.
 */
export const EMAIL_RECORD_VALUES: Record<string, Record<string, string>> = {
  "MSP-02-2013": {
    "ticket.number": "MSP-02-2013",
    "ticket.title": "Office 365 license assignment",
    "ticket.status": "In progress",
    "ticket.priority": "Critical",
    "ticket.updated": "9 October 2026, 17:22",
    "ticket.url": "https://c7ntax.example.com/tickets/fc781390",
    "client.name": "Globex Industries",
    "contact.firstName": "Sarah",
    "contact.fullName": "Sarah Lee",
    "contact.email": "slee@globexind.com",
    "technician.fullName": "Mike Wilson",
    "event.label": "New note added",
    "note.body":
      "Root cause found: an outdated conditional access policy was still scoped to the old group. Applying the fix now.",
    "instance.name": "C7NTAX",
    "instance.company": "Cyber 7 Group, LLC",
    "portal.url": "https://portal.c7ntax.example.com",
  },
  "MSP-01-2002": {
    "ticket.number": "MSP-01-2002",
    "ticket.title": "New user onboarding for marketing team",
    "ticket.status": "New",
    "ticket.priority": "Low",
    "ticket.updated": "9 October 2026, 16:04",
    "ticket.url": "https://c7ntax.example.com/tickets/msp-01-2002",
    "client.name": "Acme Corporation",
    "contact.firstName": "David",
    "contact.fullName": "David Chen",
    "contact.email": "david@acmecorp.com",
    "technician.fullName": "John Smith",
    "event.label": "Ticket created",
    "note.body": "Account created; waiting on the mailbox to finish provisioning.",
    "instance.name": "C7NTAX",
    "instance.company": "Cyber 7 Group, LLC",
    "portal.url": "https://portal.c7ntax.example.com",
  },
  "INV-2026-002": {
    "invoice.number": "INV-2026-002",
    "invoice.total": "$8,680.00",
    "invoice.dueDate": "6 September 2026",
    "invoice.daysOverdue": "33",
    "client.name": "Globex Industries",
    "contact.fullName": "Sarah Lee",
    "contact.email": "slee@globexind.com",
    "instance.name": "C7NTAX",
    "instance.company": "Cyber 7 Group, LLC",
    "portal.url": "https://portal.c7ntax.example.com",
  },
  "INV-2026-004": {
    "invoice.number": "INV-2026-004",
    "invoice.total": "$13,050.00",
    "invoice.dueDate": "9 September 2026",
    "invoice.daysOverdue": "0",
    "client.name": "Stark Enterprises",
    "contact.fullName": "Tony Stark",
    "contact.email": "accounts@stark.example.com",
    "instance.name": "C7NTAX",
    "instance.company": "Cyber 7 Group, LLC",
    "portal.url": "https://portal.c7ntax.example.com",
  },
};

/** The fields as the editor offers them, grouped the way the contract groups them. */
export const EMAIL_FIELD_GROUPS: EmailFieldDef["group"][] = [
  "Ticket", "Client", "Contact", "Technician", "Invoice", "Portal", "Instance",
];

/**
 * What a field group is *about* on the chosen record — the ticket's number for the Ticket group, the
 * client's name for Client, and so on.
 *
 * Shown beside the group's heading, because a group headed only "Client" makes the reader hunt for which
 * client the values belong to — and the point of every chip carrying a value is that a person can see
 * what the field holds *for this record*.
 */
const GROUP_SUBJECT: Record<EmailFieldDef["group"], string> = {
  Ticket: "ticket.number",
  Client: "client.name",
  Contact: "contact.fullName",
  Technician: "technician.fullName",
  Invoice: "invoice.number",
  Portal: "portal.url",
  Instance: "instance.name",
};

export function groupCaption(group: EmailFieldDef["group"], recordId: string | null | undefined): string {
  if (!recordId) return "no record chosen — the fields' own samples";
  const { value, from } = fieldValue(GROUP_SUBJECT[group], recordId);
  if (!value) return "empty on this record";
  return from === "record" ? value : `${value} (sample)`;
}

export function fieldsInGroup(group: EmailFieldDef["group"]): EmailFieldDef[] {
  return EMAIL_FIELDS.filter((field) => field.group === group);
}

/**
 * The value a field shows. `recordId` is the record being previewed; with no record chosen the
 * contract's own `sample` is used, and the caller says so, because a sample that looked like data is
 * how somebody comes to believe a message says something it does not.
 */
export function fieldValue(token: string, recordId: string | null | undefined): { value: string; from: "record" | "sample" | "empty" } {
  const def = EMAIL_FIELDS.find((field) => field.token === token);
  if (!def) {
    /*
     * A field the shared vocabulary does not name, but the API's registry does — `message.greeting` and
     * friends, which the sender computes. Its own sample is shown, marked as a sample, because only the
     * renderer can resolve it and a drawing is not the renderer.
     */
    const registered = registeredField(token);
    if (registered) return { value: registered.sample, from: "sample" };
    return { value: "", from: "empty" };
  }
  const values = recordId ? EMAIL_RECORD_VALUES[recordId] : undefined;
  const resolved = values?.[token];
  if (resolved !== undefined) return { value: resolved, from: "record" };
  return { value: def.sample, from: "sample" };
}

/** Every `{{token}}` in a piece of text, in the order they appear. */
export function tokensIn(value: string): string[] {
  return [...value.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g)].map((match) => match[1] ?? "");
}

/** Resolve the fields in a string for a record, so the editor's canvas can draw the real sentence. */
export function resolveFields(value: string, recordId: string | null | undefined): string {
  return value.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_whole, token: string) => fieldValue(token, recordId).value);
}

/**
 * The sample records and the small formatters a merge field needs.
 *
 * Deliberately free of the database: the renderer and this file can be exercised without a Prisma
 * client, which is what lets `probe:email` prove the two parts of a message carry the same facts
 * without a running PostgreSQL. `emailTemplateSend.ts` re-exports all of it, so nothing that used to
 * import it from the send path has to change.
 *
 * The samples are the named records from the seed — tickets `MSP-1001-1001` at Acme Corporation,
 * invoices `INV-2026-004` of Stark Enterprises — because a preview that says "Sample Client" teaches
 * nobody anything, and these are never rendered into a message that is actually sent.
 */
import type { EmailMessageKey } from "@C7NTAX/shared";
import type { EmailBrandValues } from "./emailMessages";

/** Where links in a message point. The same origin the ticket composer already uses. */
export function webOrigin(): string {
  return (process.env.WEB_ORIGIN || process.env.WEB_PUBLIC_URL || process.env.APP_URL || "http://localhost:3010").replace(/\/$/, "");
}

export function formatDateLong(value: Date): string {
  return value.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export function formatDateTime(value: Date): string {
  return value.toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatMoney(amount: number): string {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** Instance-wide values every message may use, whatever the record. */
export function instanceFields(values: EmailBrandValues): Record<string, string | null | undefined> {
  return {
    "instance.name": values.productName,
    "instance.company": values.companyName,
    "instance.signInUrl": `${webOrigin()}/sign-in`,
  };
}

/** The sample values, per message, for the preview with no real record chosen. */
export const SAMPLE_FIELDS: Record<EmailMessageKey, Record<string, string | null | undefined>> = {
  "ticket.note": {
    "ticket.number": "MSP-1001-1001",
    "ticket.title": "Email server not sending outbound messages",
    "client.name": "Acme Corporation",
    "message.subject": "Replacement licence assigned",
  },
  "ticket.activity": {
    "ticket.number": "MSP-1001-1001",
    "ticket.title": "Email server not sending outbound messages",
    "client.name": "Acme Corporation",
    "contact.firstName": "David",
    "contact.fullName": "David Chen",
    "contact.email": "david@acmecorp.com",
    "event.label": "New note added",
    "note.body": "Mail flow from the on-premises connector is queueing. I have re-issued the receive connector certificate and the queue is draining.",
    "message.greeting": "Hi David,",
    "message.clientLine": "Acme Corporation",
  },
  "ticket.closure": {
    "ticket.number": "MSP-1005-1002",
    "ticket.title": "Printer on the second floor will not scan",
  },
  "ticket.follow_up": {
    "ticket.number": "MSP-1003-1001",
    "ticket.title": "VPN connection drops every 15 minutes",
    "ticket.url": "https://demo.c7ntax.example/tickets/MSP-1003-1001",
    "message.idleFor": "3 days",
  },
  "ticket.reopened_internal": {
    "ticket.number": "MSP-1001-1001",
    "ticket.title": "Email server not sending outbound messages",
    "ticket.url": "https://demo.c7ntax.example/tickets/MSP-1001-1001",
    "message.reopenedBy": "David Chen",
    "note.body": "This is still happening — the queue built up again overnight.",
  },
  "invoice.send": {
    "invoice.number": "INV-2026-004",
    "invoice.total": "$13,050.00",
    "invoice.dueDate": "6 November 2026",
    "invoice.url": "https://demo.c7ntax.example/billing?invoice=INV-2026-004",
  },
  "invoice.overdue": {
    "invoice.number": "INV-2026-003",
    "invoice.total": "$3,788.75",
    "invoice.url": "https://demo.c7ntax.example/billing?invoice=INV-2026-003",
    "message.overdueFor": "15 days overdue",
  },
  "auth.mfa_code": { "message.code": "482913" },
  "user.invite": {
    "contact.firstName": "Sarah",
    "contact.email": "sarah.lee@globexind.com",
    "instance.signInUrl": "https://demo.c7ntax.example/sign-in",
    "message.credential": "7fKq-2mRt-9xZp",
    "message.passwordNote": "You will be asked to choose your own password the first time you sign in.",
  },
  "portal.login_code": {
    "portal.code": "482913",
    "message.portalLine": "Sign in at https://portal.example.com.",
  },
  "report.scheduled": {
    "message.reportName": "Monthly Ticket Volume",
    "message.reportLine": "Your weekly report is attached.",
    "message.frequency": "weekly · Monday · 06:00",
    "message.format": "PDF",
    "message.fileName": "monthly-ticket-volume.pdf",
  },
  "quote.send": {
    "client.name": "Initech Solutions",
    "message.quoteNumber": "QUO-2026-014",
    "message.quoteLine": "Quotation QUO-2026-014 is attached and is valid for 30 days.",
    "message.quoteTotal": "$4,120.00",
    "message.quoteValidUntil": "8 November 2026",
    "message.quoteUrl": "https://demo.c7ntax.example/quotes/QUO-2026-014",
  },
};

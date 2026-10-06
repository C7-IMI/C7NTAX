/**
 * Customer notifications for ticket activity.
 *
 * The ticket's primary contact is emailed whenever customer-visible activity
 * happens: a non-internal note is added, a time entry is logged, or the status
 * changes. Anyone added to the ticket as a **cc** contact is copied on all of
 * it; an **additional** contact is only emailed notes, and only while their
 * "email this contact notes" switch is on.
 *
 * Delivery is best-effort — failures are logged and never thrown, so callers
 * (route handlers, background workers) are never blocked or broken by SMTP.
 */
import { prisma } from "../index";
import { EmailService } from "@C7NTAX/email";
import { logger } from "./logger";
import { ticketCcEmails, ticketNoteRecipients } from "./ticketContacts";

const emailService = new EmailService();

export function ticketStatusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Case-insensitive de-duplication that keeps the first spelling and order. */
function dedupe(addresses: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of addresses) {
    const email = raw?.trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

export interface TicketActivity {
  eventLabel: string;
  details: string;
  /** A note: additional contacts who asked for notes are included too. */
  isNote?: boolean;
  /** Addresses to add to the "to" list, e.g. contacts ticked on a note. */
  extraTo?: string[];
  /** Addresses to copy, e.g. ad-hoc CCs typed into the composer. */
  extraCc?: string[];
}

export async function notifyTicketContact(ticketId: string | undefined, activity: TicketActivity): Promise<void> {
  if (!ticketId) return;
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        ticketNumber: true,
        title: true,
        contact: { select: { firstName: true, lastName: true, email: true } },
        company: { select: { name: true } },
      },
    });
    if (!ticket) return;

    const primary = ticket.contact?.email?.trim();
    const noteExtras = activity.isNote ? await ticketNoteRecipients(ticketId) : { to: [] as string[], cc: [] as string[] };
    const cc = await ticketCcEmails(ticketId, primary);

    const to = dedupe([primary, ...noteExtras.to, ...(activity.extraTo ?? [])]);
    if (!to.length) return;
    const toKeys = new Set(to.map((e) => e.toLowerCase()));
    const copy = dedupe([...cc, ...noteExtras.cc, ...(activity.extraCc ?? [])]).filter((e) => !toKeys.has(e.toLowerCase()));

    const contactName = [ticket.contact?.firstName, ticket.contact?.lastName].filter(Boolean).join(" ").trim();
    await emailService.sendTicketActivity(to, {
      ticketNumber: ticket.ticketNumber,
      ticketTitle: ticket.title,
      clientName: ticket.company.name,
      contactName: contactName || undefined,
      eventLabel: activity.eventLabel,
      details: activity.details,
      cc: copy.length ? copy : undefined,
    });
  } catch (err) {
    logger.warn("tickets.notifyContact", "Failed to email ticket contact", {
      ticketId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Notify the contact that a ticket's status changed from `oldStatus` to `newStatus`. */
export async function notifyTicketStatusChange(
  ticketId: string | undefined,
  oldStatus: string,
  newStatus: string,
): Promise<void> {
  if (oldStatus === newStatus) return;
  await notifyTicketContact(ticketId, {
    eventLabel: "Status updated",
    details: `Status changed from "${ticketStatusLabel(oldStatus)}" to "${ticketStatusLabel(newStatus)}".`,
  });
}

/** Notify the customer of a non-internal note, copying anyone the author picked. */
export async function notifyTicketNote(
  ticketId: string | undefined,
  note: { body: string; extraTo?: string[]; extraCc?: string[] },
): Promise<void> {
  await notifyTicketContact(ticketId, {
    eventLabel: "New note added",
    details: note.body,
    isNote: true,
    extraTo: note.extraTo,
    extraCc: note.extraCc,
  });
}

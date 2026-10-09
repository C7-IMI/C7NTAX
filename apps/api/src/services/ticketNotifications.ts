/**
 * Customer notifications for ticket activity.
 *
 * The ticket's primary contact is emailed whenever customer-visible activity
 * happens: a non-internal note is added, a time entry is logged, or the status
 * changes. Anyone added to the ticket as a **cc** contact is copied on all of
 * it; an **additional** contact is only emailed notes, and only while their
 * "email this contact notes" switch is on.
 *
 * A status that *ends* the ticket is written as a closure rather than as a field changing
 * (`notifyTicketClosure`): it carries the closing note and it tells the contact that a reply brings the
 * ticket back. Every caller that settles a ticket — the route, the batch action, the auto-close
 * worker — goes through that one function so the invitation to reply cannot go missing.
 *
 * Delivery is best-effort — failures are logged and never thrown, so callers
 * (route handlers, background workers) are never blocked or broken by SMTP.
 */
import { prisma } from "../index";
import { EmailService } from "@C7NTAX/email";
import { isSettledTicketStatus, TicketStatus } from "@C7NTAX/shared";
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
  /** Set false when the author unticked the ticket's own contact for this event. */
  includePrimary?: boolean;
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

    const to = dedupe([...(activity.includePrimary === false ? [] : [primary]), ...noteExtras.to, ...(activity.extraTo ?? [])]);
    const toKeys = new Set(to.map((e) => e.toLowerCase()));
    let copy = dedupe([...cc, ...noteExtras.cc, ...(activity.extraCc ?? [])]).filter((e) => !toKeys.has(e.toLowerCase()));
    // "Cc only" sends are fine to write but not to transmit — a mail client needs a To.
    if (!to.length && copy.length) {
      to.push(copy[0]!);
      copy = copy.slice(1);
    }
    if (!to.length) return;

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
  // A ticket that is finished with says so as closing, not as a status field changing: the same
  // event, written for the person it happens to, with the one instruction that matters afterwards.
  if (isSettledTicketStatus(newStatus)) {
    await notifyTicketClosure(ticketId, { status: newStatus });
    return;
  }
  await notifyTicketContact(ticketId, {
    eventLabel: "Status updated",
    details: `Status changed from "${ticketStatusLabel(oldStatus)}" to "${ticketStatusLabel(newStatus)}".`,
  });
}

/** The wording for a status that ends the ticket, and how to get it back. */
function closureLabel(status: string): string {
  switch (status) {
    case TicketStatus.Resolved: return "Ticket resolved";
    case TicketStatus.Cancelled: return "Ticket cancelled";
    default: return "Ticket closed";
  }
}

/**
 * Tell the contact the ticket is finished with — the one notification that carries an instruction
 * rather than a report.
 *
 * `notes` is the closing note (the reason it is being closed, whatever the technician typed), and it
 * is the whole body of the email when it is there. The last line is not decoration: the reply it
 * invites is what reopens the ticket (see `appendEmailToTicket`), so an email without it would be a
 * closed door with no handle on it.
 */
export async function notifyTicketClosure(
  ticketId: string | undefined,
  options: { status: string; notes?: string; includePrimary?: boolean; extraTo?: string[] },
): Promise<void> {
  const notes = options.notes?.trim();
  const details = [
    notes ? `Closing note: ${notes}` : "Your ticket has been closed and the work is finished.",
    "If this is not resolved, reply to this email — the reply reopens the ticket and puts it back in the queue.",
  ].join("\n\n");
  await notifyTicketContact(ticketId, {
    eventLabel: closureLabel(options.status),
    details,
    includePrimary: options.includePrimary,
    extraTo: options.extraTo,
  });
}

/**
 * Tell the ticket's owner that the client has reopened it.
 *
 * The owner is the assignee; with nobody assigned it goes to whoever raised the ticket, because a
 * reopened ticket with no reader is exactly the failure this exists to prevent. The channel is email:
 * it is the only staff channel this application actually delivers to — the WebSocket push in `ws.ts`
 * has no consumer in the interface, so a notification that only pushed would reach nobody.
 *
 * Failure is logged, never thrown: the reply is already on the ticket, and losing that would be worse
 * than a technician hearing about it from the queue instead of from an inbox.
 */
export async function notifyTicketReopenedByClient(
  ticketId: string | undefined,
  options: { fromEmail: string; reply: string },
): Promise<void> {
  if (!ticketId) return;
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        ticketNumber: true,
        title: true,
        assignedToId: true,
        createdById: true,
        company: { select: { name: true } },
        contact: { select: { firstName: true, lastName: true } },
      },
    });
    if (!ticket) return;
    const recipientId = ticket.assignedToId ?? ticket.createdById;
    if (!recipientId) return;
    const recipient = await prisma.user.findUnique({
      where: { id: recipientId },
      select: { email: true, isActive: true },
    });
    if (!recipient?.email || recipient.isActive === false) return;

    const contactName = [ticket.contact?.firstName, ticket.contact?.lastName].filter(Boolean).join(" ").trim();
    const excerpt = options.reply.replace(/\s+/g, " ").trim().slice(0, 1200) || "(no message body)";
    const base = (process.env.WEB_PUBLIC_URL || process.env.APP_URL || "").replace(/\/$/, "");
    await emailService.sendTicketReopened(recipient.email, {
      ticketNumber: ticket.ticketNumber,
      ticketTitle: ticket.title,
      clientName: ticket.company?.name,
      contactName: contactName || options.fromEmail,
      replyExcerpt: excerpt,
      ticketUrl: base ? `${base}/tickets/${ticketId}` : undefined,
    });
  } catch (err) {
    logger.warn("tickets.notifyReopened", "Failed to tell the ticket's owner it was reopened", {
      ticketId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Notify the customer of a non-internal note, copying anyone the author picked. */
export async function notifyTicketNote(
  ticketId: string | undefined,
  note: { body: string; extraTo?: string[]; extraCc?: string[]; includePrimary?: boolean },
): Promise<void> {
  await notifyTicketContact(ticketId, {
    eventLabel: "New note added",
    details: note.body,
    isNote: true,
    extraTo: note.extraTo,
    extraCc: note.extraCc,
    includePrimary: note.includePrimary,
  });
}

/**
 * Customer notifications for ticket activity.
 *
 * The ticket's contact is emailed whenever customer-visible activity happens:
 * a non-internal note is added, a time entry is logged, or the status changes.
 * Delivery is best-effort — failures are logged and never thrown, so callers
 * (route handlers, background workers) are never blocked or broken by SMTP.
 */
import { prisma } from "../index";
import { EmailService } from "@C7NTAX/email";
import { logger } from "./logger";

const emailService = new EmailService();

export function ticketStatusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function notifyTicketContact(
  ticketId: string | undefined,
  activity: { eventLabel: string; details: string },
): Promise<void> {
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
    const recipient = ticket?.contact?.email.trim();
    if (!ticket || !recipient) return;
    const contactName = [ticket.contact?.firstName, ticket.contact?.lastName].filter(Boolean).join(" ").trim();
    await emailService.sendTicketActivity(recipient, {
      ticketNumber: ticket.ticketNumber,
      ticketTitle: ticket.title,
      clientName: ticket.company.name,
      contactName: contactName || undefined,
      ...activity,
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

import { prisma } from "../../index";
import { TicketStatus, TicketPriority } from "@c7-overwatch/shared";

/**
 * When a ticket transitions to "waiting_on_client", record that so the
 * background job can check for staleness and send follow-ups.
 */
export async function onTicketStatusChange(
  ticketId: string,
  newStatus: TicketStatus,
  oldStatus: TicketStatus | null
): Promise<void> {
  if (newStatus === TicketStatus.WaitingOnClient) {
    await prisma.ticket.update({
      where: { id: ticketId },
      data: {
        waitingSince: new Date(),
        followUpCount: 0,
      },
    });
  }

  // Clear waiting state when client responds
  if (
    oldStatus === TicketStatus.WaitingOnClient &&
    newStatus !== TicketStatus.WaitingOnClient &&
    newStatus !== TicketStatus.Closed &&
    newStatus !== TicketStatus.Resolved
  ) {
    await prisma.ticket.update({
      where: { id: ticketId },
      data: {
        waitingSince: null,
        followUpCount: 0,
      },
    });
  }
}

/**
 * Extract a priority from keywords in ticket title/description.
 */
export function extractPriority(
  title: string,
  description: string
): TicketPriority {
  const text = (title + " " + description).toLowerCase();
  const criticalKeywords = ["down", "outage", "critical", "emergency", "all users", "p1"];
  const highKeywords = ["error", "broken", "failed", "urgent", "p2"];

  if (criticalKeywords.some((k) => text.includes(k))) return TicketPriority.Critical;
  if (highKeywords.some((k) => text.includes(k))) return TicketPriority.High;
  return TicketPriority.Medium;
}

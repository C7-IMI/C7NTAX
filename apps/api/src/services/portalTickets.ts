/**
 * The ticket queries the portal is allowed to make.
 *
 * Its own module because two callers have to agree exactly: the portal itself, and the
 * Administration → Customer Portal preview, whose whole point is that an administrator sees what
 * the customer would see. A second implementation of "which tickets are mine" would be a preview
 * that lies, which is worse than no preview.
 *
 * Two rules live here and nowhere else:
 *   · **scope** — a ticket this contact raised, is the contact on, or was added to; widened to
 *     every ticket at the client only when the policy in force says so;
 *   · **internal notes never cross the boundary** — filtered in the query, so no caller can
 *     forget to.
 */
import { prisma } from "../index";
import { AppError } from "../middleware/errorHandler";
import type { PortalVisibility } from "./portalPolicy";

const STATUS_LABELS: Record<string, string> = {
  new: "New", open: "Open", in_progress: "In Progress", waiting_on_client: "Waiting on You",
  waiting_on_vendor: "Waiting on Vendor", resolved: "Resolved", closed: "Closed",
};

export interface PortalScope {
  contactId: string;
  companyId: string;
  visibility: PortalVisibility;
}

export function portalTicketWhere(scope: PortalScope) {
  return {
    OR: [
      { contactId: scope.contactId },
      { additionalContacts: { some: { contactId: scope.contactId } } },
      ...(scope.visibility === "company" ? [{ companyId: scope.companyId }] : []),
    ],
  };
}

export interface PortalTicketSummaryInput {
  id: string; ticketNumber: string; title: string; status: string; priority: string;
  createdAt: Date; updatedAt: Date;
}

export function portalTicketSummary(ticket: PortalTicketSummaryInput) {
  return {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    title: ticket.title,
    status: ticket.status,
    statusLabel: STATUS_LABELS[ticket.status] ?? ticket.status,
    priority: ticket.priority,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}

/** The list, capped and newest first, exactly as the portal's own list route returns it. */
export async function listPortalTickets(scope: PortalScope, options: { status?: string; limit?: number } = {}) {
  const where = {
    ...portalTicketWhere(scope),
    ...(options.status ? { status: options.status } : {}),
  };
  const [tickets, total] = await Promise.all([
    prisma.ticket.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: Math.min(options.limit ?? 50, 100),
      select: {
        id: true, ticketNumber: true, title: true, status: true, priority: true,
        createdAt: true, updatedAt: true,
      },
    }),
    prisma.ticket.count({ where }),
  ]);
  return { data: tickets.map(portalTicketSummary), total };
}

/** One ticket, if this scope may see it at all. Throws the portal's own 404 when it may not. */
export async function loadPortalTicket(ticketId: string, scope: PortalScope, viewerEmail?: string) {
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, ...portalTicketWhere(scope) },
    select: {
      id: true, ticketNumber: true, title: true, description: true, status: true, priority: true,
      createdAt: true, updatedAt: true, resolvedAt: true, closedAt: true,
      dueDate: true,
      assignedTo: { select: { firstName: true, lastName: true } },
      company: { select: { id: true, name: true } },
      comments: {
        where: { isInternal: false },
        orderBy: { createdAt: "asc" },
        select: { id: true, body: true, createdAt: true, fromEmail: true, author: { select: { firstName: true, lastName: true } } },
      },
    },
  });
  if (!ticket) throw new AppError("Ticket not found", 404);

  return {
    ...portalTicketSummary(ticket),
    description: ticket.description,
    company: { name: ticket.company.name },
    assignedToName: ticket.assignedTo ? `${ticket.assignedTo.firstName} ${ticket.assignedTo.lastName}`.trim() : null,
    resolvedAt: ticket.resolvedAt,
    closedAt: ticket.closedAt,
    comments: ticket.comments.map(c => ({
      id: c.id,
      // A comment the customer wrote is theirs; anything else is the provider's answer.
      fromCustomer: !!c.fromEmail && !!viewerEmail && c.fromEmail.toLowerCase() === viewerEmail.toLowerCase(),
      body: c.body,
      createdAt: c.createdAt,
      authorName: `${c.author.firstName} ${c.author.lastName}`.trim(),
    })),
  };
}

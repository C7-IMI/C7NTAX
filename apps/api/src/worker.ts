import { prisma } from "./index";
import { TicketStatus, InvoiceStatus } from "@C7NTAX/shared";
import { notifyUser } from "./ws";
import { EmailService } from "@C7NTAX/email";
import { logger } from "./services/logger";

const emailService = new EmailService();

/**
 * Background job runner for ticket and invoice automations.
 * In production this would use BullMQ with Redis.
 * For now, a simple setInterval-based scheduler.
 */

// ── Ticket Past-Due Auto-Update ──
// Periodically flags tickets where dueDate has passed as overdue.

async function processPastDueTickets(): Promise<void> {
  try {
    const pastDue = await prisma.ticket.findMany({
      where: {
        dueDate: { lt: new Date() },
        isOverdue: false,
        status: { notIn: [TicketStatus.Resolved, TicketStatus.Closed, TicketStatus.Cancelled] },
      },
      include: { assignedTo: true, company: true },
    });

    for (const ticket of pastDue) {
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { isOverdue: true },
      });

      // Notify assigned tech
      if (ticket.assignedToId) {
        notifyUser(ticket.assignedToId, {
          type: "ticket_overdue",
          payload: {
            ticketId: ticket.id,
            ticketNumber: ticket.ticketNumber,
            title: ticket.title,
            dueDate: ticket.dueDate?.toISOString(),
          },
        });
      }

      logger.info("worker.pastDue", `Ticket ${ticket.ticketNumber} marked overdue (due: ${ticket.dueDate?.toISOString()})`);
    }
  } catch (err) {
    logger.error("worker.pastDue", err instanceof Error ? err : new Error(String(err)));
  }
}

// ── Ticket Auto-Follow-Up ──
// Sends daily emails for tickets stuck in "waiting_on_client" status.

async function processTicketFollowUps(): Promise<void> {
  try {
    const waitingTickets = await prisma.ticket.findMany({
      where: {
        status: TicketStatus.WaitingOnClient,
        waitingSince: { not: null },
      },
      include: { company: true, assignedTo: true },
    });

    for (const ticket of waitingTickets) {
      if (!ticket.waitingSince) continue;
      const hoursWaiting = (Date.now() - ticket.waitingSince.getTime()) / 3600000;

      // Send follow-up every 24 hours
      if (hoursWaiting >= (ticket.followUpCount + 1) * 24) {
        const contactEmail = ticket.company?.email || ticket.company?.billingEmail;
        if (contactEmail) {
          await emailService.sendTicketFollowUp({
            to: contactEmail,
            ticketNumber: ticket.ticketNumber,
            ticketTitle: ticket.title,
            ticketId: ticket.id,
            daysWaiting: Math.floor(hoursWaiting / 24),
            clientName: ticket.company?.name || "Client",
          });

          // Notify assigned tech
          if (ticket.assignedToId) {
            notifyUser(ticket.assignedToId, {
              type: "follow_up_sent",
              payload: { ticketId: ticket.id, ticketNumber: ticket.ticketNumber },
            });
          }
        }

        await prisma.ticket.update({
          where: { id: ticket.id },
          data: { followUpCount: { increment: 1 } },
        });
      }
    }
  } catch (err) {
    logger.error("worker.ticketFollowUp", err instanceof Error ? err : new Error(String(err)));
  }
}

// ── Ticket Auto-Close ──
// Closes tickets that have been waiting on client beyond the threshold.

async function processAutoClose(): Promise<void> {
  try {
    const boards = await prisma.serviceBoard.findMany({
      where: { isActive: true },
      select: { id: true, autoCloseDays: true },
    });

    for (const board of boards) {
      const cutoff = new Date(Date.now() - (board.autoCloseDays || 14) * 86400000);

      const staleTickets = await prisma.ticket.findMany({
        where: {
          boardId: board.id,
          status: TicketStatus.WaitingOnClient,
          waitingSince: { lte: cutoff },
        },
      });

      for (const ticket of staleTickets) {
        await prisma.ticket.update({
          where: { id: ticket.id },
          data: {
            status: TicketStatus.Closed,
            resolvedAt: new Date(),
          },
        });

        // Add auto-close comment
        await prisma.ticketComment.create({
          data: {
            ticketId: ticket.id,
            body: `Ticket automatically closed after ${board.autoCloseDays || 14} days without client response.`,
            isInternal: true,
            authorId: ticket.assignedToId || ticket.createdById,
          },
        });

        if (ticket.assignedToId) {
          notifyUser(ticket.assignedToId, {
            type: "ticket_auto_closed",
            payload: { ticketId: ticket.id, ticketNumber: ticket.ticketNumber },
          });
        }
      }
    }
  } catch (err) {
    logger.error("worker.autoClose", err instanceof Error ? err : new Error(String(err)));
  }
}

// ── Invoice Follow-Up ──
// Sends reminders for overdue invoices.

async function processInvoiceReminders(): Promise<void> {
  try {
    const overdueInvoices = await prisma.invoice.findMany({
      where: {
        status: { in: [InvoiceStatus.Sent, InvoiceStatus.Overdue] },
        dueDate: { lt: new Date() },
      },
      include: { company: true },
    });

    for (const invoice of overdueInvoices) {
      const daysOverdue = Math.floor(
        (Date.now() - invoice.dueDate.getTime()) / 86400000
      );

      // Mark as overdue if sent but past due
      if (invoice.status === InvoiceStatus.Sent) {
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { status: InvoiceStatus.Overdue },
        });
      }

      // Send reminder every 7 days when overdue
      if (daysOverdue > 0 && daysOverdue % 7 === 0 && invoice.company?.email) {
        await emailService.sendInvoiceReminder({
          to: invoice.company.email,
          invoiceNumber: invoice.invoiceNumber,
          amount: invoice.total,
          dueDate: invoice.dueDate,
          daysOverdue,
          clientName: invoice.company.name,
        });
      }
    }
  } catch (err) {
    logger.error("worker.invoiceReminder", err instanceof Error ? err : new Error(String(err)));
  }
}

// ── Scheduler ──

let pastDueInterval: ReturnType<typeof setInterval> | null = null;
let followUpInterval: ReturnType<typeof setInterval> | null = null;
let autoCloseInterval: ReturnType<typeof setInterval> | null = null;
let invoiceInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start all background workers.
 */
export function startWorkers(): void {
  console.log("[Worker] Starting background workers...");
  logger.info("worker", "Background workers started: pastDue(15m), ticketFollowUp(30m), autoClose(1h), invoiceReminder(6h)");

  // Every 15 minutes: check for past-due tickets
  pastDueInterval = setInterval(processPastDueTickets, 15 * 60 * 1000);
  // Every 30 minutes: check for follow-ups
  followUpInterval = setInterval(processTicketFollowUps, 30 * 60 * 1000);
  // Every hour: check for auto-close
  autoCloseInterval = setInterval(processAutoClose, 60 * 60 * 1000);
  // Every 6 hours: invoice reminders
  invoiceInterval = setInterval(processInvoiceReminders, 6 * 60 * 60 * 1000);

  // Run once immediately on startup
  void processPastDueTickets();
  void processTicketFollowUps();
  void processAutoClose();
  void processInvoiceReminders();
}

/**
 * Stop all background workers (for graceful shutdown).
 */
export function stopWorkers(): void {
  if (pastDueInterval) clearInterval(pastDueInterval);
  if (followUpInterval) clearInterval(followUpInterval);
  if (autoCloseInterval) clearInterval(autoCloseInterval);
  if (invoiceInterval) clearInterval(invoiceInterval);
}

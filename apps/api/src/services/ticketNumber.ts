/**
 * Ticket number generation shared by the ticket routes and the
 * email-to-ticket connector (ClientType-ClientID-Sequential, e.g. MSP-1001-1003).
 */
import { prisma } from "../index";
import { randomUUID } from "crypto";

export async function generateTicketNumber(companyId: string | null): Promise<string> {
  let ticketNumber = `C7-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 4).toUpperCase()}`;
  if (companyId) {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { clientId: true, clientType: true },
    });
    if (company?.clientId) {
      const ct = company.clientType || "MSP";
      const count = await prisma.ticket.count({ where: { companyId } });
      const seq = 1000 + count + 1;
      ticketNumber = `${ct}-${company.clientId}-${seq}`;
    }
  }
  return ticketNumber;
}

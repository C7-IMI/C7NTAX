/**
 * Ticket number generation shared by the ticket routes and the
 * email-to-ticket connector (ClientType-ClientID-Sequential, e.g. MSP-1001-1003).
 */
import { prisma } from "../index";
import { randomUUID } from "crypto";

/**
 * Next number for a client's sequential series.
 *
 * The sequence continues from the highest number that client already has rather
 * than from a row count: a count goes backwards when a ticket is deleted (and
 * seeded or imported rows need not be contiguous), which hands the same number
 * out twice and makes the insert fail on the unique constraint — most visibly
 * when the email connector files a burst of mail.
 *
 * `attempt` is a safety valve for a genuine race (two connectors, or a connector
 * and a person, inserting at the same moment): the caller retries with
 * attempt = 1, 2, … and gets the next number along.
 */
export async function generateTicketNumber(companyId: string | null, attempt = 0): Promise<string> {
  let ticketNumber = `C7-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 4).toUpperCase()}`;
  if (companyId) {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { clientId: true, clientType: true },
    });
    if (company?.clientId) {
      const ct = company.clientType || "MSP";
      const prefix = `${ct}-${company.clientId}-`;
      const existing = await prisma.ticket.findMany({
        where: { ticketNumber: { startsWith: prefix } },
        select: { ticketNumber: true },
      });
      let highest = 1000;
      for (const { ticketNumber: number } of existing) {
        const seq = Number(number.slice(prefix.length));
        if (Number.isFinite(seq) && seq > highest) highest = seq;
      }
      ticketNumber = `${prefix}${highest + 1 + attempt}`;
    }
  }
  return ticketNumber;
}

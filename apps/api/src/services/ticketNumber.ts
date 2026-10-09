/**
 * Ticket number generation, shared by the ticket routes, the customer portal and the
 * email-to-ticket connector.
 *
 * A number is `{board code}-{client}-{sequence}` — `MSP-04-1005` — and the three octets are three
 * different facts, which is the point of the shape:
 *
 * * **`MSP`** is the board's own `ticketCode`: the queue the work was raised on. A board with no code
 *   falls back to the client's type, which is what every number was built from before this scheme, so
 *   an un-coded board keeps working rather than failing.
 * * **`04`** is `Company.clientId` less the base this instance numbers clients from (1000 — its first
 *   client is 1001) — client 1004 reads `04`, the tenth client `10`, the hundredth `100`. It is
 *   deliberately *not* "the last two digits" of the id, which would make client 1104 collide with client
 *   1004; subtracting the base cannot collide, because `clientId` is unique.
 * * **`1005`** is how many tickets that client has had **on that board**. The series is scoped to the
 *   board and the client together, so one queue's growth never moves another queue's numbers.
 *
 * The sequence continues from the highest number the pair already has rather than from a row count: a
 * count goes backwards when a ticket is deleted (and seeded or imported rows need not be contiguous),
 * which hands the same number out twice and makes the insert fail on the unique constraint — most
 * visibly when the email connector files a burst of mail.
 *
 * It reads **both** shapes when it looks for that highest number, because numbers written under the
 * previous scheme put the client's four-digit id in the middle (`MSP-1001-1008`): without it, a client
 * with eight tickets would start again at `MSP-01-1001` and end up with two tickets their own records
 * read as the same number.
 */
import { prisma } from "../index";
import { randomUUID } from "crypto";

/** This instance numbers its clients from 1000: the first client is 1001 and its octet is `01`. */
const CLIENT_ID_BASE = 1000;

/** `1004` → `04`; `1010` → `10`; `1100` → `100`. */
export function clientOctet(clientId: number): string {
  const n = Math.max(1, Math.trunc(clientId) - CLIENT_ID_BASE);
  return n < 10 ? String(n).padStart(2, "0") : String(n);
}

export interface TicketNumberOptions {
  companyId: string | null;
  /** The board the ticket is raised on — its `ticketCode` becomes the first octet. */
  boardId?: string | null;
  /**
   * The retry, for a genuine race (two connectors, or a connector and a person, inserting in the same
   * instant). The caller retries with 1, 2, … and gets the next number along.
   */
  attempt?: number;
}

export async function generateTicketNumber(options: TicketNumberOptions): Promise<string> {
  const { companyId, boardId, attempt = 0 } = options;
  // A ticket with no client has nothing to key a series on, so it keeps the random reference the
  // connector can still quote back.
  let ticketNumber = `C7-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 4).toUpperCase()}`;
  if (!companyId) return ticketNumber;

  const [company, board] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId }, select: { clientId: true, clientType: true } }),
    boardId
      ? prisma.serviceBoard.findUnique({ where: { id: boardId }, select: { ticketCode: true } })
      : Promise.resolve(null),
  ]);
  if (!company?.clientId) return ticketNumber;

  const prefix = (board?.ticketCode?.trim() || company.clientType || "TKT").toUpperCase();
  const series = `${prefix}-${clientOctet(company.clientId)}-`;
  const previousScheme = `${prefix}-${company.clientId}-`;
  const existing = await prisma.ticket.findMany({
    where: {
      OR: [
        { ticketNumber: { startsWith: series } },
        { ticketNumber: { startsWith: previousScheme } },
      ],
    },
    select: { ticketNumber: true },
  });

  let highest = 1000;
  for (const { ticketNumber: number } of existing) {
    const seq = Number(number.slice(number.lastIndexOf("-") + 1));
    if (Number.isFinite(seq) && seq > highest) highest = seq;
  }
  return `${series}${highest + 1 + attempt}`;
}


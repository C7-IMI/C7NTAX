/**
 * The shape of a ticket number, without anything that talks to a database.
 *
 * Separate from `ticketNumber.ts` because that module imports the Prisma client, which starts the API
 * server as a side effect — fine for a route, wrong for a maintenance script that only wants to know how
 * a client's octet is written. The format lives here so `renumber-tickets.ts` can read it without
 * bringing a server up.
 */

/** This instance numbers its clients from 1000: the first client is 1001 and its octet is `01`. */
export const CLIENT_ID_BASE = 1000;

/** `1004` → `04`; `1010` → `10`; `1100` → `100`. */
export function clientOctet(clientId: number): string {
  const n = Math.max(1, Math.trunc(clientId) - CLIENT_ID_BASE);
  return n < 10 ? String(n).padStart(2, "0") : String(n);
}

/**
 * Can this string be a ticket number under the current scheme?
 *
 * `{board code}-{client octet}-{sequence}` — three segments, the middle one letters or digits (a client
 * without a `clientId` keeps the old numeric id in the middle), the last one digits. Used by the screens
 * that would otherwise have to assume every number has the same shape when they show it.
 */
export function looksLikeTicketNumber(value: string): boolean {
  return /^[A-Z][A-Z0-9]{1,7}-[A-Z0-9]{1,4}-\d{1,8}$/.test(value);
}

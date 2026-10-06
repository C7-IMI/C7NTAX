/**
 * Ticket contacts — the people beyond the ticket's single primary `contact`.
 *
 * Two roles, matching how the practice-management tools model this:
 *  - `cc`         copied on every customer-facing ticket email (status changes,
 *                 note notifications, time-entry notices, and manual sends).
 *  - `additional` an extra stakeholder recorded on the ticket who is not copied
 *                 automatically but can be picked as a recipient on any note.
 *
 * The same helpers serve ticket creation, the ticket detail screen, and note
 * submission, so a contact added from any of those places behaves identically.
 */
import { prisma } from "../index";
import { AppError } from "../middleware/errorHandler";

export type TicketContactRole = "cc" | "additional";

export interface TicketContactLink {
  id: string;
  contactId: string;
  role: string;
  notifyOnNote: boolean;
  contact: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
  };
}

const CONTACT_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
} as const;

/** Very small guard — enough to stop a typo becoming a bounced ticket email. */
export function isEmailAddress(value: unknown): value is string {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function normalizeRole(value: unknown): TicketContactRole {
  return value === "additional" ? "additional" : "cc";
}

/** Every extra contact on the ticket, primary contact excluded (that lives on `Ticket.contact`). */
export async function listTicketContacts(ticketId: string): Promise<TicketContactLink[]> {
  const links = await prisma.ticketContact.findMany({
    where: { ticketId },
    include: { contact: { select: CONTACT_SELECT } },
    orderBy: { createdAt: "asc" },
  });
  return links as TicketContactLink[];
}

/**
 * Link an existing client contact, or find/create one from a bare address.
 *
 * Adding an address that is not yet a contact of the ticket's client creates the
 * contact there first, so the person shows up in the client's contact list too
 * rather than living only inside the ticket.
 */
export async function addTicketContact(
  ticketId: string,
  input: {
    contactId?: unknown;
    email?: unknown;
    firstName?: unknown;
    lastName?: unknown;
    role?: unknown;
    notifyOnNote?: unknown;
  },
): Promise<TicketContactLink> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { id: true, companyId: true, contactId: true },
  });
  if (!ticket) throw new AppError("Ticket not found", 404);

  let contactId = typeof input.contactId === "string" && input.contactId ? input.contactId : "";

  if (contactId) {
    const contact = await prisma.contact.findUnique({ where: { id: contactId }, select: { id: true } });
    if (!contact) throw new AppError("Contact not found", 404);
  } else {
    if (!isEmailAddress(input.email)) throw new AppError("A valid email address is required", 400);
    const email = String(input.email).trim();
    const existing = await prisma.contact.findFirst({
      where: { companyId: ticket.companyId, email },
      select: { id: true },
    });
    if (existing) {
      contactId = existing.id;
    } else {
      const created = await prisma.contact.create({
        data: {
          companyId: ticket.companyId,
          email,
          firstName: typeof input.firstName === "string" && input.firstName.trim() ? input.firstName.trim() : (email.split("@")[0] || "Contact"),
          lastName: typeof input.lastName === "string" ? input.lastName.trim() : "",
        },
        select: { id: true },
      });
      contactId = created.id;
    }
  }

  if (ticket.contactId === contactId) throw new AppError("That contact is already the ticket's primary contact", 400);

  const link = await prisma.ticketContact.upsert({
    where: { ticketId_contactId: { ticketId, contactId } },
    create: {
      ticketId,
      contactId,
      role: normalizeRole(input.role),
      notifyOnNote: input.notifyOnNote === undefined ? true : Boolean(input.notifyOnNote),
    },
    update: {
      role: normalizeRole(input.role),
      ...(input.notifyOnNote === undefined ? {} : { notifyOnNote: Boolean(input.notifyOnNote) }),
    },
    include: { contact: { select: CONTACT_SELECT } },
  });
  return link as TicketContactLink;
}

/** Update the role / note-notification preference of an existing ticket contact. */
export async function updateTicketContact(
  ticketId: string,
  contactId: string,
  input: { role?: unknown; notifyOnNote?: unknown },
): Promise<TicketContactLink> {
  const existing = await prisma.ticketContact.findUnique({
    where: { ticketId_contactId: { ticketId, contactId } },
    select: { id: true },
  });
  if (!existing) throw new AppError("That contact is not on this ticket", 404);

  const link = await prisma.ticketContact.update({
    where: { id: existing.id },
    data: {
      ...(input.role === undefined ? {} : { role: normalizeRole(input.role) }),
      ...(input.notifyOnNote === undefined ? {} : { notifyOnNote: Boolean(input.notifyOnNote) }),
    },
    include: { contact: { select: CONTACT_SELECT } },
  });
  return link as TicketContactLink;
}

/** Remove someone from the ticket. The client contact itself is left alone. */
export async function removeTicketContact(ticketId: string, contactId: string): Promise<boolean> {
  const result = await prisma.ticketContact.deleteMany({ where: { ticketId, contactId } });
  return result.count > 0;
}

/**
 * Addresses that should be copied on anything the ticket emails the customer.
 * Primary contact first, deduplicated case-insensitively.
 */
export async function ticketCcEmails(ticketId: string, primaryEmail?: string | null): Promise<string[]> {
  const links = await prisma.ticketContact.findMany({
    where: { ticketId, role: "cc" },
    select: { contact: { select: { email: true } } },
  });
  const seen = new Set<string>();
  const primary = primaryEmail?.trim().toLowerCase();
  if (primary) seen.add(primary);
  const out: string[] = [];
  for (const link of links) {
    const email = link.contact?.email?.trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

/** Addresses a customer-facing note is emailed to by default: primary plus everyone flagged for notes. */
export async function ticketNoteRecipients(
  ticketId: string,
): Promise<{ to: string[]; cc: string[] }> {
  const links = await prisma.ticketContact.findMany({
    where: { notifyOnNote: true },
    select: { role: true, contact: { select: { email: true } } },
    orderBy: { createdAt: "asc" },
  });
  const to = links
    .filter((l) => l.role !== "cc")
    .map((l) => l.contact?.email?.trim())
    .filter(Boolean) as string[];
  const cc = links
    .filter((l) => l.role === "cc")
    .map((l) => l.contact?.email?.trim())
    .filter(Boolean) as string[];
  void ticketId;
  return { to, cc };
}

/**
 * Resolve the recipient payload the composer and the ticket screens send.
 * Unknown ids are ignored rather than failing the whole send.
 */
export async function resolveRecipients(
  input: unknown,
  options: { addToTicket?: string; saveToTicket?: boolean } = {},
): Promise<{ to: string[]; cc: string[]; added: string[] }> {
  const payload = (input ?? {}) as Record<string, unknown>;
  const contactIds = Array.isArray(payload.contactIds) ? payload.contactIds.filter((v): v is string => typeof v === "string") : [];
  const ccContactIds = Array.isArray(payload.ccContactIds) ? payload.ccContactIds.filter((v): v is string => typeof v === "string") : [];
  const emails = Array.isArray(payload.emails) ? payload.emails.filter(isEmailAddress).map((e) => String(e).trim()) : [];
  const ccEmails = Array.isArray(payload.ccEmails) ? payload.ccEmails.filter(isEmailAddress).map((e) => String(e).trim()) : [];

  const ids = [...contactIds, ...ccContactIds];
  const contacts = ids.length
    ? await prisma.contact.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } })
    : [];
  const byId = new Map(contacts.map((c) => [c.id, c.email.trim()]));
  const pick = (list: string[]) => list.map((id) => byId.get(id)).filter((e): e is string => Boolean(e));

  const added: string[] = [];
  if (options.addToTicket && options.saveToTicket !== false && ids.length) {
    const ticketId = options.addToTicket;
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { contactId: true } });
    const existing = await prisma.ticketContact.findMany({ where: { ticketId }, select: { contactId: true } });
    const linked = new Set(existing.map((l) => l.contactId));
    for (const id of new Set(ids)) {
      if (!byId.has(id) || linked.has(id) || id === ticket?.contactId) continue;
      // Someone picked while writing a note becomes an additional contact on the
      // ticket; promoting them to "cc" is a deliberate choice on the ticket itself.
      await addTicketContact(ticketId, { contactId: id, role: "additional" });
      added.push(id);
    }
  }

  return {
    to: [...pick(contactIds.filter((id) => !ccContactIds.includes(id))), ...emails],
    cc: [...pick(ccContactIds), ...ccEmails],
    added,
  };
}

/** A contact chosen for a ticket email, resolved to a display + address pair. */
export async function contactDisplay(contactId: string): Promise<{ name: string; email: string } | null> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { firstName: true, lastName: true, email: true },
  });
  if (!contact) return null;
  return {
    name: [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim(),
    email: contact.email.trim(),
  };
}

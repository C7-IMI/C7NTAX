/**
 * Email-to-ticket processing service (used by the email connector runtime).
 * Deduces ticket fields from the email (name, company, contact, subject,
 * description), creates tickets, and appends threaded replies as comments.
 */
import { prisma } from "../index";
import { generateTicketNumber } from "./ticketNumber";
import { TicketStatus } from "@C7NTAX/shared";
import {
  stripSubjectPrefixes,
  deduceName,
  extractDomain,
  stripQuotedReply,
  deducePriority,
  isAutoReply,
  type ParsedEmail,
} from "@C7NTAX/email";

const SYSTEM_USER_EMAIL = "connector@c7ntax.local";

/** Resolve (or lazily create) the system user that owns connector tickets. */
export async function resolveSystemUser(): Promise<{ id: string }> {
  const existing = await prisma.user.findUnique({ where: { email: SYSTEM_USER_EMAIL } });
  if (existing) return existing;
  const role = (await prisma.role.findFirst({ where: { systemRole: "admin" } })) || (await prisma.role.findFirst());
  if (!role) throw new Error("No role available for the email-connector system user");
  return prisma.user.create({
    data: {
      email: SYSTEM_USER_EMAIL,
      passwordHash: "!connector-disabled",
      firstName: "Email",
      lastName: "Connector",
      isActive: true,
      roleId: role.id,
    },
  });
}

/** Resolve contact + company for a sender email (lookup-first, then create). */
async function resolveSender(from: ParsedEmail["from"]) {
  const email = (from.email || "").trim().toLowerCase();
  const domain = extractDomain(email);

  let contact = await prisma.contact.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
  });

  let company = contact
    ? await prisma.company.findUnique({ where: { id: contact.companyId } })
    : null;

  if (!company) {
    company =
      (await prisma.company.findFirst({
        where: {
          OR: [
            { email: { contains: domain, mode: "insensitive" } },
            { website: { contains: domain, mode: "insensitive" } },
          ],
        },
      })) ||
      (await prisma.company.findFirst({ orderBy: { createdAt: "asc" } }));
  }

  if (!company) throw new Error("No company available to attach the email ticket (default company missing)");

  if (!contact) {
    const { firstName, lastName } = deduceName(from.name, from.email);
    contact = await prisma.contact.create({
      data: {
        firstName: firstName || "Unknown",
        lastName: lastName || "Sender",
        email: email || "unknown@unknown.local",
        companyId: company.id,
      },
    });
  }
  return { contact, company };
}

/** Create a ticket from an email; returns the new ticket id. */
export async function createTicketFromEmail(boardId: string, email: ParsedEmail): Promise<string> {
  if (isAutoReply(email.subject, email.bodyText)) return "";

  const title = stripSubjectPrefixes(email.subject) || `Email from ${email.from.email || "unknown"}`;
  const description = stripQuotedReply(email.bodyText).slice(0, 20000) || "(no message body)";
  const priority = deducePriority(email.subject, email.bodyText);
  const systemUser = await resolveSystemUser();
  const { contact, company } = await resolveSender(email.from);

  const ticket = await prisma.$transaction(async (tx) => {
    const ticketNumber = await generateTicketNumber(company.id);
    const created = await tx.ticket.create({
      data: {
        ticketNumber,
        title,
        description,
        boardId,
        companyId: company.id,
        contactId: contact.id,
        priority,
        source: "email",
        status: TicketStatus.New,
        createdById: systemUser.id,
        customFields: {
          email: {
            messageId: email.messageId,
            from: email.from.email,
            to: email.to,
            cc: email.cc,
            date: email.date,
          },
        },
      },
    });
    await tx.ticketComment.create({
      data: {
        ticketId: created.id,
        body: `Email received from ${email.from.email} (Message-ID: ${email.messageId})\n\n${description}`,
        authorId: systemUser.id,
        isInternal: false,
        isEmail: true,
        fromEmail: email.from.email || null,
      },
    });
    return created;
  });

  return ticket.id;
}

/** Append an email as a comment to an existing ticket (threaded reply). */
export async function appendEmailToTicket(ticketId: string, email: ParsedEmail): Promise<void> {
  const ticket = await prisma.ticket.findFirst({
    where: { OR: [{ id: ticketId }, { ticketNumber: { contains: ticketId } }] },
  });
  if (!ticket) return; // tag didn't resolve to a real ticket — ignore
  const systemUser = await resolveSystemUser();
  const body = stripQuotedReply(email.bodyText).slice(0, 20000) || "(no message body)";
  await prisma.ticketComment.create({
    data: {
      ticketId: ticket.id,
      body: `Email reply from ${email.from.email} (Message-ID: ${email.messageId})\n\n${body}`,
      authorId: systemUser.id,
      isInternal: false,
      isEmail: true,
      fromEmail: email.from.email || null,
    },
  });
}

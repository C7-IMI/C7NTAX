/**
 * Email-to-ticket processing service (used by the email connector runtime).
 * Deduces ticket fields from the email (name, company, contact, subject,
 * description), stores the email's attachments on the ticket, and appends
 * threaded replies as comments.
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
import { htmlToText } from "./emailHtml";
import { storeTicketAttachments, sanitizeAttachmentFilename, MAX_TICKET_ATTACHMENT_BYTES } from "./ticketAttachments";

const SYSTEM_USER_EMAIL = "connector@c7ntax.local";
const MAX_ATTACHMENTS_PER_EMAIL = 20;

/**
 * Per-connector ingestion rules, set on the connector row.
 * `defaultCompanyId` decides where a sender that matches nothing is filed;
 * without it (or with `autoCreateCompany`) the connector falls back to
 * auto-creating a client for the sender's domain, then to the oldest client.
 */
export interface EmailIngestOptions {
  defaultCompanyId?: string | null;
  autoCreateCompany?: boolean;
  autoCreateContact?: boolean;
  /** Out-of-office/auto-reply mail is skipped unless this is switched off. */
  ignoreAutoReplies?: boolean;
}

/**
 * Consumer mailbox domains. A sender at one of these has no company domain to
 * match on, so they must never be attributed to a client that happens to carry
 * "gmail.com" somewhere, and auto-creating a client called "Gmail" would be
 * nonsense — these fall through to the configured default instead.
 */
const CONSUMER_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "yahoo.com", "ymail.com", "aol.com", "icloud.com", "me.com", "mac.com",
  "proton.me", "protonmail.com", "gmx.com", "gmx.de", "mail.com", "zoho.com",
  "comcast.net", "verizon.net", "att.net", "sbcglobal.net", "shaw.ca", "bell.net",
]);

/** "initech.example" → "Initech"; "acme.co.uk" → "Acme". */
function companyNameFromDomain(domain: string): string {
  const label = domain.replace(/^www\./, "").split(".")[0] || domain;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

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

/** Resolve contact + company for a sender (lookup-first, then create). */
async function resolveSender(from: ParsedEmail["from"], options: EmailIngestOptions = {}) {
  const email = (from.email || "").trim().toLowerCase();
  const domain = extractDomain(email);
  const matchableDomain = domain && !CONSUMER_DOMAINS.has(domain) ? domain : "";

  let contact = await prisma.contact.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
  });

  let company = contact
    ? await prisma.company.findUnique({ where: { id: contact.companyId } })
    : null;

  // The connector's configured default wins over guessing when nothing matched.
  if (!company && options.defaultCompanyId) {
    company = await prisma.company.findUnique({ where: { id: options.defaultCompanyId } });
    if (!company) {
      console.warn(`[EmailConnector] Connector default company ${options.defaultCompanyId} no longer exists — falling back`);
    }
  }

  if (!company && matchableDomain) {
    company = await prisma.company.findFirst({
      where: {
        OR: [
          { email: { contains: matchableDomain, mode: "insensitive" } },
          { website: { contains: matchableDomain, mode: "insensitive" } },
        ],
      },
    });
  }

  if (!company && options.autoCreateCompany && matchableDomain) {
    company = await prisma.company.create({
      data: {
        name: companyNameFromDomain(matchableDomain),
        website: `https://${matchableDomain}`,
        notes: `Created automatically by the email connector from an inbound email (${matchableDomain}).`,
      },
    });
    console.log(`[EmailConnector] Created client "${company.name}" for domain ${matchableDomain}`);
  }

  if (!company) {
    company = await prisma.company.findFirst({ orderBy: { createdAt: "asc" } });
    if (company) {
      // Nothing matched, so the ticket is filed against a fallback client rather
      // than lost. Worth a line in the log: the fix is a Contact (or a Company
      // website/email) for that domain, or a default company on the connector.
      console.warn(`[EmailConnector] No client matched "${domain || email}" — filing the ticket under "${company.name}"; set a default company on the connector, enable auto-create, or add the contact/client domain`);
    }
  }

  if (!company) throw new Error("No company available to attach the email ticket (default company missing)");

  if (!contact && options.autoCreateContact !== false) {
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

/**
 * Plain text for the ticket body: the text part when there is one, otherwise
 * the HTML part flattened — an HTML-only email must not land as "(no message body)".
 */
function emailBody(email: ParsedEmail): string {
  const text = (email.bodyText || "").trim();
  if (text) return stripQuotedReply(text);
  const html = (email.bodyHtml || "").trim();
  return html ? stripQuotedReply(htmlToText(html)) : "";
}

/**
 * Store the email's own attachments on the ticket, size- and count-capped.
 * Deliberately not fatal: the ticket is already created, and failing here would
 * leave the message unread and raise a second ticket on the retry.
 */
async function attachEmailFiles(ticketId: string, email: ParsedEmail, uploadedById: string, commentId?: string): Promise<void> {
  const all = email.attachments || [];
  const files = all
    .filter((a) => a.content && a.content.length > 0 && (a.size || a.content.length) <= MAX_TICKET_ATTACHMENT_BYTES)
    .slice(0, MAX_ATTACHMENTS_PER_EMAIL)
    .map((a) => ({
      filename: sanitizeAttachmentFilename(a.filename) || "attachment",
      mimeType: a.contentType || "application/octet-stream",
      buffer: a.content,
    }));
  if (all.length > files.length) {
    console.warn(`[EmailConnector] ${all.length - files.length} attachment(s) on ${email.messageId} were skipped (empty, over ${Math.round(MAX_TICKET_ATTACHMENT_BYTES / 1024 / 1024)} MB, or more than ${MAX_ATTACHMENTS_PER_EMAIL})`);
  }
  if (files.length === 0) return;
  try {
    await storeTicketAttachments(files, { ticketId, uploadedById, commentId });
  } catch (e: any) {
    console.error(`[EmailConnector] Could not store ${files.length} attachment(s) on ticket ${ticketId}:`, e?.message || e);
  }
}

/** Create a ticket from an email; returns the new ticket id. */
export async function createTicketFromEmail(boardId: string, email: ParsedEmail, options: EmailIngestOptions = {}): Promise<string> {
  // Auto-replies are dropped by default; a connector can opt to file them.
  if (options.ignoreAutoReplies !== false && isAutoReply(email.subject, email.bodyText)) return "";

  const title = stripSubjectPrefixes(email.subject) || `Email from ${email.from.email || "unknown"}`;
  const description = emailBody(email).slice(0, 20000) || "(no message body)";
  const priority = deducePriority(email.subject, description);
  const systemUser = await resolveSystemUser();
  const { contact, company } = await resolveSender(email.from, options);

  const ticket = await createTicketWithNumber(boardId, email, company.id, contact?.id ?? null, title, description, priority, systemUser.id);

  await attachEmailFiles(ticket.id, email, systemUser.id);
  return ticket.id;
}

/**
 * Insert the ticket and its email comment, retrying on a ticket-number
 * collision. Two connectors (or a connector and a person) can pick the same next
 * number in the same instant; the retry is what keeps an email from being dropped
 * over a numbering race.
 */
async function createTicketWithNumber(
  boardId: string,
  email: ParsedEmail,
  companyId: string,
  contactId: string | null,
  title: string,
  description: string,
  priority: string,
  systemUserId: string,
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const ticketNumber = await generateTicketNumber(companyId, attempt);
        const created = await tx.ticket.create({
          data: {
            ticketNumber,
            title,
            description,
            boardId,
            companyId,
            contactId,
            priority,
            source: "email",
            status: TicketStatus.New,
            createdById: systemUserId,
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
            authorId: systemUserId,
            isInternal: false,
            isEmail: true,
            fromEmail: email.from.email || null,
          },
        });
        return created;
      });
    } catch (e: any) {
      if (e?.code !== "P2002" || attempt >= 4) throw e;
      console.warn(`[EmailConnector] Ticket number was taken for ${companyId} — retrying (attempt ${attempt + 2})`);
    }
  }
}

/** Append an email as a comment to an existing ticket. Returns false when the
 *  quoted reference does not resolve, so the caller can raise a new ticket
 *  instead of dropping the message. */
export async function appendEmailToTicket(ticketId: string, email: ParsedEmail): Promise<boolean> {
  const ticket = await prisma.ticket.findFirst({
    where: { OR: [{ id: ticketId }, { ticketNumber: { contains: ticketId } }] },
  });
  if (!ticket) return false; // tag didn't resolve to a real ticket
  const systemUser = await resolveSystemUser();
  const body = emailBody(email).slice(0, 20000) || "(no message body)";
  const comment = await prisma.ticketComment.create({
    data: {
      ticketId: ticket.id,
      body: `Email reply from ${email.from.email} (Message-ID: ${email.messageId})\n\n${body}`,
      authorId: systemUser.id,
      isInternal: false,
      isEmail: true,
      fromEmail: email.from.email || null,
    },
  });
  await attachEmailFiles(ticket.id, email, systemUser.id, comment.id);
  return true;
}

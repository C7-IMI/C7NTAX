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
  /**
   * What the user confirmed in the add-in's review step.
   *
   * These win over anything deduced here, which is the whole point of the review: the add-in shows
   * the same resolution this module performs, and a value the user changed is an instruction rather
   * than a hint. Absent or blank fields fall back to deduction exactly as before, so a caller that
   * does not know about the review behaves identically.
   */
  reviewed?: ReviewedEmailFields;
}

export type ReviewedEmailFields = {
  boardId?: string;
  companyId?: string | null;
  contactName?: string | null;
  title?: string;
  description?: string;
  priority?: string;
};

/**
 * The fields an email will produce, and whether the client and contact matched — read-only.
 *
 * Exists for the add-in's preview, and it is deliberately the same resolution the create path runs
 * rather than an approximation of it: a preview that guessed would be worse than no preview,
 * because it would be believed. This performs no writes at all, so previewing cannot create a
 * client, a contact or a ticket.
 */
export type EmailFieldPreview = {
  title: string;
  description: string;
  priority: string;
  /** The client the sender's domain matched, or null when nothing matched. */
  matchedCompany: { id: string; name: string } | null;
  /** The client the ticket would actually be filed under if nothing is chosen. */
  fallbackCompany: { id: string; name: string } | null;
  matchedContact: { id: string; name: string } | null;
  contactName: string;
};

export async function previewEmailFields(email: ParsedEmail): Promise<EmailFieldPreview> {
  const domain = extractDomain(email.from.email);
  const matchable = domain && !CONSUMER_DOMAINS.has(domain) ? domain : "";

  const matchedCompany = matchable
    ? await prisma.company.findFirst({
        where: {
          OR: [
            { email: { contains: matchable, mode: "insensitive" } },
            { website: { contains: matchable, mode: "insensitive" } },
          ],
        },
        select: { id: true, name: true },
      })
    : null;

  const fallbackCompany = matchedCompany
    ? null
    : await prisma.company.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true, name: true } });

  const existingContact = email.from.email
    ? await prisma.contact.findFirst({
        where: { email: { equals: email.from.email, mode: "insensitive" } },
        select: { id: true, firstName: true, lastName: true },
      })
    : null;

  const deduced = deduceName(email.from.name, email.from.email);
  const description = emailBody(email).slice(0, 20000) || "(no message body)";

  return {
    title: stripSubjectPrefixes(email.subject) || `Email from ${email.from.email || "unknown"}`,
    description,
    priority: deducePriority(email.subject, description),
    matchedCompany: matchedCompany ?? null,
    fallbackCompany: fallbackCompany ?? null,
    matchedContact: existingContact
      ? { id: existingContact.id, name: `${existingContact.firstName} ${existingContact.lastName}`.trim() }
      : null,
    contactName: existingContact
      ? `${existingContact.firstName} ${existingContact.lastName}`.trim()
      : `${deduced.firstName || "Unknown"} ${deduced.lastName || "Sender"}`.trim(),
  };
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

  // A client the user picked in the add-in's review wins over everything below: it is the one
  // value in the whole flow that cannot be inferred from the message, and the only reason the
  // review offers a picker at all.
  if (options.reviewed?.companyId) {
    const chosen = await prisma.company.findUnique({ where: { id: options.reviewed.companyId } });
    if (chosen) {
      const contact = email
        ? await prisma.contact.findFirst({ where: { email: { equals: email, mode: "insensitive" } } })
        : null;
      return { contact, company: chosen };
    }
    console.warn(`[EmailConnector] Reviewed client ${options.reviewed.companyId} no longer exists — matching the sender instead`);
  }

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

  const reviewed = options.reviewed ?? {};
  const title = reviewed.title?.trim() || stripSubjectPrefixes(email.subject) || `Email from ${email.from.email || "unknown"}`;
  const description = (reviewed.description?.trim() || emailBody(email)).slice(0, 20000) || "(no message body)";
  const priority = reviewed.priority?.trim() || deducePriority(email.subject, description);
  const systemUser = await resolveSystemUser();
  const { contact, company } = await resolveSender(email.from, options);

  // The review's contact name is applied rather than ignored. An editable field that quietly
  // does nothing is worse than one that is not offered: somebody who corrects "J. Doe" to
  // "Jane Doe" and watches the ticket come back as "J. Doe" stops trusting the screen.
  const reviewedContactId = await applyReviewedContactName(contact?.id ?? null, reviewed.contactName, email, company.id);

  const ticket = await createTicketWithNumber(
    reviewed.boardId?.trim() || boardId,
    email,
    company.id,
    reviewedContactId ?? contact?.id ?? null,
    title,
    description,
    priority,
    systemUser.id,
  );

  await attachEmailFiles(ticket.id, email, systemUser.id);
  return ticket.id;
}

/**
 * Rename the matched contact to what the user confirmed, when they changed it.
 *
 * Returns the contact id to use. Creates nothing: a sender with no contact yet already gets one
 * from `resolveSender`, and creating a second record here would file a duplicate for the same
 * address.
 */
async function applyReviewedContactName(
  contactId: string | null,
  reviewedName: string | null | undefined,
  email: ParsedEmail,
  companyId: string,
): Promise<string | null> {
  const wanted = reviewedName?.trim();
  if (!contactId || !wanted) return contactId;

  const current = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { firstName: true, lastName: true, companyId: true },
  });
  if (!current) return contactId;

  const existing = `${current.firstName} ${current.lastName}`.trim();
  if (existing === wanted) return contactId;

  const { firstName, lastName } = deduceName(wanted, email.from.email);
  await prisma.contact.update({
    where: { id: contactId },
    data: {
      firstName: firstName || current.firstName,
      lastName: lastName || current.lastName,
      // The contact follows the chosen client: a corrected name on a ticket filed under a client
      // the contact does not belong to is the beginning of a second, wrong record.
      ...(current.companyId !== companyId ? { companyId } : {}),
    },
  });
  console.log(`[OutlookAddIn] Contact ${contactId} renamed from "${existing}" to "${wanted}" during a reviewed ticket`);
  return contactId;
}

/**
 * Attach whole messages to a ticket, for the bundled submission.
 *
 * Each becomes a `.eml` — headers plus the plain-text body — rather than a re-rendered summary,
 * because the point of attaching the other messages is that somebody can open the original later.
 * Deliberately non-fatal, like the email connector's own attachments: the ticket exists, and
 * failing here would report a failure for work that was done.
 */
export async function attachEmailsToTicket(
  ticketId: string,
  emails: Array<{ email: ParsedEmail; subject: string }>,
  uploadedById: string,
): Promise<Array<{ subject: string; filename: string }>> {
  const written: Array<{ subject: string; filename: string }> = [];
  for (const item of emails) {
    const body = emailBody(item.email);
    const eml = [
      `From: ${item.email.from.name ? `${item.email.from.name} <${item.email.from.email}>` : item.email.from.email}`,
      `To: ${(item.email.to || []).join("; ")}`,
      item.email.cc?.length ? `Cc: ${item.email.cc.join("; ")}` : null,
      `Subject: ${item.email.subject || "(no subject)"}`,
      item.email.date ? `Date: ${new Date(item.email.date).toUTCString()}` : null,
      `Message-ID: ${item.email.messageId || ""}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      body || "(no message body)",
    ].filter((line) => line !== null).join("\r\n");

    const buffer = Buffer.from(eml, "utf8");
    if (buffer.length > MAX_TICKET_ATTACHMENT_BYTES) {
      console.warn(`[OutlookAddIn] "${item.subject}" is ${Math.round(buffer.length / 1024)} KB and was not attached (over the ${Math.round(MAX_TICKET_ATTACHMENT_BYTES / 1024 / 1024)} MB limit)`);
      continue;
    }

    const filename = `${sanitizeAttachmentFilename(item.subject || "message").slice(0, 120) || "message"}.eml`;
    try {
      await storeTicketAttachments(
        [{ filename, mimeType: "message/rfc822", buffer }],
        { ticketId, uploadedById },
      );
      written.push({ subject: item.subject, filename });
    } catch (e: any) {
      console.error(`[OutlookAddIn] Could not attach "${item.subject}" to ticket ${ticketId}:`, e?.message || e);
    }
  }
  return written;
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

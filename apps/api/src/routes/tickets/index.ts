import { Router } from "express";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../../index";
import { authenticate, requirePermission, type AuthRequest } from "../../middleware/auth";
import { Permission, TicketStatus } from "@C7NTAX/shared";
import { AppError } from "../../middleware/errorHandler";
import { onTicketStatusChange, extractPriority } from "./automations";
import { generateTicketNumber } from "../../services/ticketNumber";
import { EmailService } from "@C7NTAX/email";
import { notifyTicketContact, notifyTicketNote, notifyTicketStatusChange } from "../../services/ticketNotifications";
import { addTicketContact, listTicketContacts, removeTicketContact, resolveRecipients, ticketCcEmails, updateTicketContact, isEmailAddress, isValidEmail } from "../../services/ticketContacts";
import { v4 as uuid } from "uuid";
import { sanitizeEmailHtml, htmlToText, extractInlineImages } from "../../services/emailHtml";
import { logger } from "../../services/logger";
import {
  MAX_TICKET_ATTACHMENT_BYTES,
  sanitizeAttachmentFilename,
  resolveStoredAttachment,
  storeTicketAttachments,
  removeTicketAttachments,
  type PreparedAttachment,
} from "../../services/ticketAttachments";

export const ticketsRouter = Router();
ticketsRouter.use(authenticate);

const emailService = new EmailService();

function canAccessTicket(req: AuthRequest, companyId: string | null): boolean {
  return req.user!.permissions.includes(Permission.TicketViewAll) || !req.user!.companyId || req.user!.companyId === companyId;
}

/**
 * Validates a base64 upload (name, size, encoding) without touching disk, so a request can be
 * rejected before anything is sent or written.
 */
function prepareAttachment(filenameRaw: unknown, mimeTypeRaw: unknown, contentBase64: unknown): PreparedAttachment {
  const filename = sanitizeAttachmentFilename(filenameRaw);
  if (!filename || typeof contentBase64 !== "string") throw new AppError("filename and file content are required", 400);
  if (contentBase64.length > Math.ceil(MAX_TICKET_ATTACHMENT_BYTES / 3) * 4 + 4) throw new AppError("Attachment exceeds the 5 MB limit", 413);
  const buffer = Buffer.from(contentBase64, "base64");
  if (buffer.length > MAX_TICKET_ATTACHMENT_BYTES || buffer.toString("base64").replace(/=+$/, "") !== contentBase64.replace(/=+$/, "")) {
    throw new AppError("Invalid file content or attachment exceeds the 5 MB limit", 400);
  }
  return {
    filename,
    mimeType: typeof mimeTypeRaw === "string" && mimeTypeRaw.trim() ? mimeTypeRaw.slice(0, 150) : "application/octet-stream",
    buffer,
  };
}

/** Writes prepared files to disk and records them, cleaning up if any write or insert fails. */

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]!);
}

/**
 * Reject a malformed address instead of quietly dropping it — an address the
 * author typed is either sent to, or the request fails and says why.
 */
function assertValidAddresses(...lists: unknown[]): void {
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const value of list) {
      if (typeof value !== "string") continue;
      const email = value.trim();
      if (email && !isValidEmail(email)) throw new AppError(`"${email}" is not a valid email address`, 400);
    }
  }
}

/** Validate the free-form addresses inside a recipients payload. */
function assertValidRecipientPayload(input: unknown): void {
  const payload = (input ?? {}) as Record<string, unknown>;
  assertValidAddresses(payload.emails, payload.ccEmails);
}

function formatTimeEntryDetails(entry: { minutes: number; date: Date; description?: string | null; workType?: string | null; workRole?: string | null }): string {
  const hours = Math.round((entry.minutes / 60) * 100) / 100;
  const lines = [`${hours} hour${hours === 1 ? "" : "s"} logged on ${entry.date.toISOString().slice(0, 10)}.`];
  if (entry.workType) lines.push(`Work type: ${entry.workType}`);
  if (entry.workRole) lines.push(`Work role: ${entry.workRole}`);
  if (entry.description) lines.push("", entry.description);
  return lines.join("\n");
}

// ── List tickets ──
ticketsRouter.get("/", requirePermission(Permission.TicketView), async (req: AuthRequest, res, next) => {
  try {
    const { status, priority, boardId, companyId, assignedToId, search, limit = "50", offset = "0" } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};

    // Client users only see their company's tickets unless they have view_all
    if (!req.user!.permissions.includes(Permission.TicketViewAll) && req.user!.companyId) {
      where.companyId = req.user!.companyId;
    }
    if (status) {
      // Supports comma-separated multi-values (e.g. "waiting_on_client,waiting_on_third_party")
      // and the literal "open" for everything not closed/cancelled.
      if (status === "open") {
        where.status = { notIn: [TicketStatus.Closed, TicketStatus.Cancelled] };
      } else {
        const statuses = status.split(",").map(s => s.trim()).filter(Boolean);
        where.status = statuses.length > 1 ? { in: statuses } : statuses[0];
      }
    }
    if (priority) {
      const priorities = priority.split(",").map(p => p.trim()).filter(Boolean);
      where.priority = priorities.length > 1 ? { in: priorities } : priorities[0];
    }
    if (boardId) {
      where.boardId = boardId;
      // If the board has a ticketCode, prefix-filter ticket numbers
      const board = await prisma.serviceBoard.findUnique({ where: { id: boardId }, select: { ticketCode: true } });
      if (board?.ticketCode) {
        where.ticketNumber = { startsWith: `${board.ticketCode}-` };
      }
    }
    if (companyId && req.user!.permissions.includes(Permission.TicketViewAll)) where.companyId = companyId;
    if (assignedToId) where.assignedToId = assignedToId;
    if (search) {
      where.OR = [
        { title: { contains: search } },
        { ticketNumber: { contains: search } },
      ];
    }

    const [tickets, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        skip: Number(offset),
        take: Number(limit),
        orderBy: { updatedAt: "desc" },
        include: { company: { select: { id: true, name: true } }, assignedTo: { select: { id: true, firstName: true, lastName: true } }, board: { select: { id: true, name: true } } },
      }),
      prisma.ticket.count({ where }),
    ]);
    res.json({ data: tickets, total, limit: Number(limit), offset: Number(offset) });
  } catch (e) { next(e); }
});

// ── Get single ticket ──
ticketsRouter.get("/:id", requirePermission(Permission.TicketView), async (req: AuthRequest, res, next) => {
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: req.params.id },
      include: {
        company: true, contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } }, assignedTo: true, board: true,
        additionalContacts: {
          orderBy: { createdAt: "asc" },
          include: { contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } } },
        },
        comments: { orderBy: { createdAt: "desc" }, include: { author: { select: { id: true, firstName: true, lastName: true } } } },
        timeEntries: { orderBy: { date: "desc" }, include: { user: { select: { id: true, firstName: true, lastName: true } } } },
        attachments: { orderBy: { createdAt: "desc" } },
        serviceAgreement: { select: { id: true, name: true, billingPeriod: true, billingAmount: true } },
      },
    });
    if (!ticket) throw new AppError("Ticket not found", 404);
    // Client scope check
    if (!req.user!.permissions.includes(Permission.TicketViewAll) && req.user!.companyId && ticket.companyId !== req.user!.companyId) {
      throw new AppError("Not authorized", 403);
    }
    res.json(ticket);
  } catch (e) { next(e); }
});

// ── Ticket contacts (CC / additional) ──
ticketsRouter.get("/:id/contacts", requirePermission(Permission.TicketView), async (req: AuthRequest, res, next) => {
  try {
    const ticket = await prisma.ticket.findUnique({ where: { id: req.params.id }, select: { companyId: true } });
    if (!ticket) throw new AppError("Ticket not found", 404);
    if (!canAccessTicket(req, ticket.companyId)) throw new AppError("Not authorized", 403);
    res.json(await listTicketContacts(String(req.params.id)));
  } catch (e) { next(e); }
});

ticketsRouter.post("/:id/contacts", requirePermission(Permission.TicketEdit), async (req: AuthRequest, res, next) => {
  try {
    const ticket = await prisma.ticket.findUnique({ where: { id: req.params.id }, select: { id: true, companyId: true } });
    if (!ticket) throw new AppError("Ticket not found", 404);
    if (!canAccessTicket(req, ticket.companyId)) throw new AppError("Not authorized", 403);
    const link = await addTicketContact(ticket.id, {
      contactId: req.body?.contactId,
      email: req.body?.email,
      firstName: req.body?.firstName,
      lastName: req.body?.lastName,
      role: req.body?.role,
      notifyOnNote: req.body?.notifyOnNote,
    });
    res.status(201).json(link);
  } catch (e) { next(e); }
});

ticketsRouter.patch("/:id/contacts/:contactId", requirePermission(Permission.TicketEdit), async (req: AuthRequest, res, next) => {
  try {
    const ticket = await prisma.ticket.findUnique({ where: { id: req.params.id }, select: { id: true, companyId: true } });
    if (!ticket) throw new AppError("Ticket not found", 404);
    if (!canAccessTicket(req, ticket.companyId)) throw new AppError("Not authorized", 403);
    const link = await updateTicketContact(ticket.id, String(req.params.contactId), { role: req.body?.role, notifyOnNote: req.body?.notifyOnNote });
    res.json(link);
  } catch (e) { next(e); }
});

ticketsRouter.delete("/:id/contacts/:contactId", requirePermission(Permission.TicketEdit), async (req: AuthRequest, res, next) => {
  try {
    const ticket = await prisma.ticket.findUnique({ where: { id: req.params.id }, select: { id: true, companyId: true } });
    if (!ticket) throw new AppError("Ticket not found", 404);
    if (!canAccessTicket(req, ticket.companyId)) throw new AppError("Not authorized", 403);
    const removed = await removeTicketContact(ticket.id, String(req.params.contactId));
    if (!removed) throw new AppError("That contact is not on this ticket", 404);
    res.json({ removed: true });
  } catch (e) { next(e); }
});

// ── Create ticket ──
ticketsRouter.post("/", requirePermission(Permission.TicketCreate), async (req: AuthRequest, res, next) => {
  try {
    const { title, description, boardId, companyId, priority, source, startTime, endTime, contactId, assignedToId, additionalContactIds } = req.body;
    if (!title || !boardId) throw new AppError("title and boardId required");
    const board = await prisma.serviceBoard.findUnique({ where: { id: boardId } });
    if (!board) throw new AppError("Service board not found", 404);

    // Generate ticket number: ClientType-ClientID-Sequential (e.g. MSP-1001-1003)
    const ticketNumber = await generateTicketNumber(companyId || null);
    const autoPriority = priority || extractPriority(title, description || "");

    const ticket = await prisma.ticket.create({
      data: {
        ticketNumber, title, description: description || "", boardId, companyId: companyId || req.user!.companyId,
        priority: autoPriority, source: source || "portal",
        status: TicketStatus.New,
        createdById: req.user!.userId,
        startTime: startTime ? new Date(startTime) : null,
        endTime: endTime ? new Date(endTime) : null,
        contactId: contactId || null,
        assignedToId: assignedToId || null,
      },
    });

    // Extra contacts chosen while creating the ticket are linked straight away; a bad
    // id is skipped rather than failing the creation that already succeeded.
    const extraIds = Array.isArray(additionalContactIds) ? additionalContactIds.filter((v: unknown): v is string => typeof v === "string") : [];
    for (const extraId of new Set(extraIds)) {
      if (extraId === contactId) continue;
      try {
        await addTicketContact(ticket.id, { contactId: extraId, role: "additional" });
      } catch (err) {
        logger.warn("tickets.create", "Skipped additional contact", { ticketId: ticket.id, contactId: extraId, error: err instanceof Error ? err.message : String(err) });
      }
    }

    res.status(201).json(ticket);
  } catch (e) { next(e); }
});

// ── Update ticket ──
ticketsRouter.patch("/:id", requirePermission(Permission.TicketEdit), async (req: AuthRequest, res, next) => {
  try {
    const ticket = await prisma.ticket.findUnique({ where: { id: req.params.id } });
    if (!ticket) throw new AppError("Ticket not found", 404);
    const oldStatus = ticket.status;

    const allowed = ["title", "description", "status", "priority", "boardId", "assignedToId", "dueDate", "startTime", "endTime", "contactId", "companyId", "serviceAgreementId", "customFields"];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined && req.body[key] !== "") updates[key] = req.body[key];
    }
    // Handle date conversions
    if (req.body.startTime) updates.startTime = new Date(req.body.startTime);
    if (req.body.endTime) updates.endTime = new Date(req.body.endTime);
    if (req.body.dueDate) updates.dueDate = new Date(req.body.dueDate);

    const updated = await prisma.ticket.update({ where: { id: req.params.id }, data: updates });

    // ── Audit log: detect changes and create a comment ──
    const changedFields: string[] = [];
    const labels: Record<string, string> = { title: "Title", description: "Description", status: "Status", priority: "Priority", boardId: "Board", assignedToId: "Assigned To", dueDate: "Due Date", startTime: "Start Time", endTime: "End Time", contactId: "Contact", companyId: "Company", serviceAgreementId: "Service Agreement" };

    // Resolve raw values (IDs, ISO dates, enums) to human-friendly names
    const resolveValue = async (key: string, val: unknown): Promise<string> => {
      if (val === null || val === undefined || val === "") return "(empty)";
      if (val instanceof Date) {
        return val.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      }
      const s = String(val);
      try {
        if (key === "boardId") { const b = await prisma.serviceBoard.findUnique({ where: { id: s }, select: { name: true } }); if (b) return b.name; }
        else if (key === "assignedToId") { const u = await prisma.user.findUnique({ where: { id: s }, select: { firstName: true, lastName: true } }); if (u) return `${u.firstName || ""} ${u.lastName || ""}`.trim(); }
        else if (key === "contactId") { const c = await prisma.contact.findUnique({ where: { id: s }, select: { firstName: true, lastName: true } }); if (c) return `${c.firstName || ""} ${c.lastName || ""}`.trim(); }
        else if (key === "companyId") { const c = await prisma.company.findUnique({ where: { id: s }, select: { name: true } }); if (c) return c.name; }
        else if (key === "serviceAgreementId") { const a = await prisma.serviceAgreement.findUnique({ where: { id: s }, select: { name: true } }); if (a) return a.name; }
      } catch { /* fall through to raw */ }
      if (key === "status" || key === "priority") return s.replace(/_/g, " ").replace(/\b\w/g, m => m.toUpperCase());
      return s;
    };

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        if (key === "customFields") continue; // don't log raw tab data as a change comment
        const oldVal = (ticket as Record<string, unknown>)[key];
        const newVal = updates[key];
        const oldStr = await resolveValue(key, oldVal);
        const newStr = await resolveValue(key, newVal);
        if (oldStr !== newStr) {
          const label = labels[key] || key;
          changedFields.push(`${label}: ${oldStr} → ${newStr}`);
        }
      }
    }
    if (changedFields.length > 0) {
      await prisma.ticketComment.create({
        data: {
          ticketId: req.params.id,
          body: changedFields.join("\n"),
          authorId: req.user!.userId,
          isInternal: true,
        },
      });
    }

    if (updates.status && updates.status !== oldStatus) {
      await onTicketStatusChange(req.params.id, updates.status as TicketStatus, oldStatus);
    }

    // Add comment if provided
    if (req.body.note) {
      await prisma.ticketComment.create({
        data: { ticketId: req.params.id, body: req.body.note, authorId: req.user!.userId, isInternal: req.body.noteInternal || false },
      });
    }

    // Email the ticket contact about customer-visible changes (internal notes excluded)
    await notifyTicketStatusChange(ticket.id, oldStatus, updated.status);
    if (req.body.note && !req.body.noteInternal) {
      await notifyTicketContact(ticket.id, { eventLabel: "New note added", details: String(req.body.note) });
    }

    res.json(updated);
  } catch (e) { next(e); }
});

// ── Add comment to ticket ──
ticketsRouter.post("/:id/comments", requirePermission(Permission.TicketEdit), async (req: AuthRequest, res, next) => {
  try {
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!body) throw new AppError("Comment is required", 400);
    assertValidRecipientPayload(req.body?.recipients);
    const ticket = await prisma.ticket.findUnique({ where: { id: req.params.id }, select: { id: true, companyId: true } });
    if (!ticket) throw new AppError("Ticket not found", 404);
    if (!canAccessTicket(req, ticket.companyId)) throw new AppError("Not authorized", 403);
    const comment = await prisma.ticketComment.create({
      data: { ticketId: ticket.id, body, authorId: req.user!.userId, isInternal: Boolean(req.body.isInternal) },
      include: { author: { select: { id: true, firstName: true, lastName: true } } },
    });
    if (!comment.isInternal) {
      // People picked while writing the note are emailed with it and kept on the
      // ticket, so the next note can just tick them again.
      const recipients = await resolveRecipients(req.body?.recipients, {
        addToTicket: ticket.id,
        saveContacts: req.body?.saveRecipients !== false,
        saveEmails: req.body?.saveRecipients !== false,
      });
      await notifyTicketNote(ticket.id, {
        body,
        extraTo: recipients.to,
        extraCc: recipients.cc,
        includePrimary: req.body?.includePrimary !== false,
      });
      res.status(201).json({ ...comment, notified: [...recipients.to, ...recipients.cc], addedContacts: recipients.added });
      return;
    }
    res.status(201).json(comment);
  } catch (e) { next(e); }
});

ticketsRouter.post("/:id/notes", requirePermission(Permission.TicketEdit), async (req: AuthRequest, res, next) => {
  try {
    const { content, isInternal } = req.body;
    if (!content) throw new AppError("content required");
    const note = await prisma.ticketComment.create({
      data: { ticketId: req.params.id, body: content, authorId: req.user!.userId, isInternal: isInternal || false },
    });
    if (!note.isInternal) {
      const recipients = await resolveRecipients(req.body?.recipients, {
        addToTicket: note.ticketId,
        saveContacts: req.body?.saveRecipients !== false,
        saveEmails: req.body?.saveRecipients !== false,
      });
      await notifyTicketNote(note.ticketId, {
        body: String(content),
        extraTo: recipients.to,
        extraCc: recipients.cc,
        includePrimary: req.body?.includePrimary !== false,
      });
    }
    res.status(201).json(note);
  } catch (e) { next(e); }
});

// ── Email ticket contact ──
ticketsRouter.post("/:id/email", requirePermission(Permission.TicketEdit), async (req: AuthRequest, res, next) => {
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: req.params.id },
      include: { contact: { select: { email: true } }, company: { select: { name: true } } },
    });
    if (!ticket) throw new AppError("Ticket not found", 404);
    if (!canAccessTicket(req, ticket.companyId)) throw new AppError("Not authorized", 403);
    const subject = typeof req.body?.subject === "string" ? req.body.subject.trim().slice(0, 200) : "";
    const richHtml = typeof req.body?.html === "string" ? req.body.html.trim() : "";
    const plainBody = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!subject || (!richHtml && !plainBody)) throw new AppError("Subject and message are required", 400);
    if (plainBody.length > 20_000 || richHtml.length > 200_000) throw new AppError("Message is too long", 400);
    assertValidAddresses(req.body?.to, req.body?.cc, req.body?.bcc);
    assertValidRecipientPayload(req.body?.recipients);

    // Recipients: the primary contact unless the composer removed them, plus anyone
    // picked (client contacts and free addresses), with the ticket's CC contacts copied.
      const recipients = await resolveRecipients(req.body?.recipients, {
        addToTicket: ticket.id,
        saveContacts: req.body?.saveToTicket !== false,
        saveEmails: false,
      });
    const primary = ticket.contact?.email?.trim();
    const explicitTo = Array.isArray(req.body?.to) ? req.body.to.filter(isEmailAddress).map((e: string) => e.trim()) : [];
    const skipPrimary = req.body?.includePrimary === false;
    const to = [...new Set([...(skipPrimary ? [] : primary ? [primary] : []), ...explicitTo, ...recipients.to])];
    if (!to.length) throw new AppError("Add at least one recipient — this ticket has no contact email address", 400);
    const toKeys = new Set(to.map((e) => e.toLowerCase()));
    const ticketCc = await ticketCcEmails(ticket.id, primary);
    const explicitCc = Array.isArray(req.body?.cc) ? req.body.cc.filter(isEmailAddress).map((e: string) => e.trim()) : [];
    const cc = [...new Set([...ticketCc, ...explicitCc, ...recipients.cc])].filter((e) => !toKeys.has(e.toLowerCase()));
    const bcc: string[] = [...new Set((Array.isArray(req.body?.bcc) ? req.body.bcc.filter(isEmailAddress).map((e: string) => e.trim()) : []) as string[])].filter(
      (e) => !toKeys.has(e.toLowerCase()) && !cc.some((c) => c.toLowerCase() === e.toLowerCase()),
    );
    const recipient = primary || to[0];

    // Attachments are validated before anything is sent, so a bad upload cannot half-send.
    const incoming = Array.isArray(req.body?.attachments) ? req.body.attachments.slice(0, 10) : [];
    const files = incoming.map((a: { filename?: unknown; mimeType?: unknown; contentBase64?: unknown }) =>
      prepareAttachment(a?.filename, a?.mimeType, a?.contentBase64));

    const messageHtml = richHtml
      ? sanitizeEmailHtml(richHtml)
      : `<p>${escapeHtml(plainBody).replace(/\r?\n/g, "<br>")}</p>`;
    // Images pasted into the message travel as embedded parts rather than data URIs, which most
    // mail clients refuse to render.
    const inlined = extractInlineImages(messageHtml);
    const messageText = plainBody || htmlToText(inlined.html);

    let sent;
    try {
      sent = await emailService.send({
        to,
        cc: cc.length ? cc : undefined,
        bcc: bcc.length ? bcc : undefined,
        subject: `[${ticket.ticketNumber}] ${subject}`,
        html: `${inlined.html}<hr><p>Ticket: ${escapeHtml(ticket.ticketNumber)} — ${escapeHtml(ticket.title)}<br>Client: ${escapeHtml(ticket.company?.name || "")}</p>`,
        text: `${messageText}\n\n---\nTicket: ${ticket.ticketNumber} — ${ticket.title}\nClient: ${ticket.company?.name || ""}`,
        ...(files.length || inlined.images.length
          ? {
              attachments: [
                ...inlined.images.map((img) => ({ filename: img.filename, content: img.buffer, contentType: img.contentType, cid: img.cid, contentDisposition: "inline" as const })),
                ...files.map((f: PreparedAttachment) => ({ filename: f.filename, content: f.buffer, contentType: f.mimeType })),
              ],
            }
          : {}),
      });
    } catch (sendError) {
      // Nothing is recorded when the mail cannot leave: no phantom "sent" entry, no orphan files.
      logger.error("ticket.email", sendError instanceof Error ? sendError : new Error(String(sendError)));
      throw new AppError("The email could not be sent — check the SMTP configuration under Administration → System Settings", 502);
    }
    if (!sent) throw new AppError("The email could not be sent", 502);

    // Sent mail is recorded in activity; the files that went with it also join the attachments tab.
    const header = [
      `To: ${to.join(", ")}`,
      cc.length ? `Cc: ${cc.join(", ")}` : null,
      bcc.length ? `Bcc: ${bcc.join(", ")}` : null,
      `Subject: ${subject}`,
    ].filter(Boolean).join("\n");
    const comment = await prisma.ticketComment.create({
      data: {
        ticketId: ticket.id,
        body: `${header}\n\n${messageText}${files.length ? `\n\n(Attached: ${files.map((f: PreparedAttachment) => f.filename).join(", ")})` : ""}`,
        authorId: req.user!.userId,
        isEmail: true,
      },
    });
    const stored = await storeTicketAttachments(files, { ticketId: ticket.id, uploadedById: req.user!.userId, commentId: comment.id });
    res.json({ sent: true, recipient, to, cc, bcc, attachments: stored.length, commentId: comment.id, addedContacts: recipients.added });
  } catch (e) { next(e); }
});

// ── Attachments ──
ticketsRouter.post("/:id/attachments", requirePermission(Permission.TicketEdit), async (req: AuthRequest, res, next) => {
  try {
    const ticket = await prisma.ticket.findUnique({ where: { id: req.params.id }, select: { id: true, companyId: true } });
    if (!ticket) throw new AppError("Ticket not found", 404);
    if (!canAccessTicket(req, ticket.companyId)) throw new AppError("Not authorized", 403);
    const file = prepareAttachment(req.body?.filename, req.body?.mimeType, req.body?.contentBase64);
    const [attachment] = await storeTicketAttachments([file], { ticketId: ticket.id, uploadedById: req.user!.userId });
    res.status(201).json(attachment);
  } catch (e) { next(e); }
});

ticketsRouter.get("/:id/attachments/:attId/download", requirePermission(Permission.TicketView), async (req: AuthRequest, res, next) => {
  try {
    const attachment = await prisma.ticketAttachment.findFirst({
      where: { id: req.params.attId, ticketId: req.params.id },
      include: { ticket: { select: { companyId: true } } },
    });
    if (!attachment) throw new AppError("Attachment not found", 404);
    if (!canAccessTicket(req, attachment.ticket?.companyId || null)) throw new AppError("Not authorized", 403);
    const filePath = resolveStoredAttachment(attachment.storagePath);
    if (!filePath) throw new AppError("File content is not available for this attachment", 404);
    res.type(attachment.mimeType).download(filePath, attachment.filename, (e) => { if (e) next(e); });
  } catch (e) { next(e); }
});

ticketsRouter.delete("/:id/attachments/:attId", requirePermission(Permission.TicketEdit), async (req: AuthRequest, res, next) => {
  try {
    const att = await prisma.ticketAttachment.findFirst({
      where: { id: req.params.attId, ticketId: req.params.id },
      include: { ticket: { select: { companyId: true } } },
    });
    if (!att) throw new AppError("Attachment not found", 404);
    if (!canAccessTicket(req, att.ticket?.companyId || null)) throw new AppError("Not authorized", 403);
    await prisma.ticketAttachment.delete({ where: { id: att.id } });
    const filePath = resolveStoredAttachment(att.storagePath);
    if (filePath) await unlink(filePath).catch((e: NodeJS.ErrnoException) => { if (e.code !== "ENOENT") throw e; });
    res.json({ message: "Deleted" });
  } catch (e) { next(e); }
});

// ── Delete a ticket ──
// Comments, attachments and time entries cascade; notifications keep their row
// and lose the link (SetNull), so nothing else in the database dangles.
ticketsRouter.delete("/:id", requirePermission(Permission.TicketDelete), async (req: AuthRequest, res, next) => {
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, ticketNumber: true, title: true, companyId: true,
        _count: { select: { comments: true, attachments: true, timeEntries: true } },
      },
    });
    if (!ticket) throw new AppError("Ticket not found", 404);
    if (!canAccessTicket(req, ticket.companyId)) throw new AppError("Not authorized", 403);

    await prisma.ticket.delete({ where: { id: ticket.id } });
    await removeTicketAttachments(ticket.id);
    res.json({
      message: `Ticket ${ticket.ticketNumber} deleted`,
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      removed: ticket._count,
    });
  } catch (e) { next(e); }
});

// ── Add time entry ──
ticketsRouter.post("/:id/time", requirePermission(Permission.TicketEdit), async (req: AuthRequest, res, next) => {
  try {
    const { startTime, endTime, description, internalNotes, billable, noCharge, minutes, date, workType, workRole, rate, userId } = req.body;
    let mins = 0;
    if (minutes) {
      mins = Math.round(Number(minutes));
    } else if (startTime && endTime) {
      mins = Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000);
    }
    if (!mins || mins <= 0) throw new AppError("Valid time required");
    if (mins > 24 * 60) throw new AppError("Time entry cannot exceed 24 hours");
    // Interpret a bare YYYY-MM-DD work date in local time (not UTC midnight)
    const parseWorkDate = (d: unknown): Date => {
      if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) return new Date(`${d}T00:00:00`);
      return d ? new Date(d as string) : new Date();
    };
    const entry = await prisma.timeEntry.create({
      data: {
        ticketId: req.params.id,
        userId: typeof userId === "string" && userId ? userId : req.user!.userId,
        minutes: mins,
        date: parseWorkDate(date),
        startTime: startTime ? new Date(startTime) : null,
        endTime: endTime ? new Date(endTime) : null,
        description: description || "",
        internalNotes: typeof internalNotes === "string" ? internalNotes : null,
        workType: typeof workType === "string" && workType ? workType : null,
        workRole: typeof workRole === "string" && workRole ? workRole : null,
        rate: rate !== undefined && rate !== null && rate !== "" ? Number(rate) : null,
        billable: billable ?? true,
        noCharge: noCharge ?? false,
      },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    });
    await notifyTicketContact(entry.ticketId, { eventLabel: "Time entry added", details: formatTimeEntryDetails(entry) });
    res.status(201).json(entry);
  } catch (e) { next(e); }
});

// ── Batch update tickets ──
ticketsRouter.post("/batch", requirePermission(Permission.TicketEdit), async (req: AuthRequest, res, next) => {
  try {
    const { ticketIds, status, priority } = req.body;
    if (!ticketIds || !Array.isArray(ticketIds) || ticketIds.length === 0) throw new AppError("ticketIds array required", 400);
    const data: Record<string, unknown> = {};
    if (status) data.status = status;
    if (priority) data.priority = priority;
    if (Object.keys(data).length === 0) throw new AppError("status or priority required", 400);
    const previousStatuses = status
      ? await prisma.ticket.findMany({ where: { id: { in: ticketIds } }, select: { id: true, status: true } })
      : [];
    const result = await prisma.ticket.updateMany({ where: { id: { in: ticketIds } }, data });

    // Email each contact whose ticket status actually changed
    if (status) {
      const previous = new Map(previousStatuses.map((t) => [t.id, t.status] as const));
      for (const ticketId of ticketIds) {
        const oldStatus = previous.get(ticketId);
        if (oldStatus) await notifyTicketStatusChange(ticketId, oldStatus, String(status));
      }
    }

    res.json({ updated: result.count, ticketIds });
  } catch (e) { next(e); }
});


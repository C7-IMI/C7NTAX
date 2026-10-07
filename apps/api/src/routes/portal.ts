/**
 * Customer portal API (PLAN-013 #3).
 *
 * The rules this file exists to keep:
 *   1. A customer sees their own tickets and nothing else. Every read goes through
 *      `ticketWhereForContact`, so there is one definition of "mine" rather than one per route.
 *   2. Internal notes never cross this boundary, and neither does billing, time or the staff
 *      audit trail.
 *   3. Sign-in cannot be used to enumerate customers: requesting a code answers 202 whatever
 *      happens, and the code is only emailed to a contact of a client with the portal enabled.
 *
 * The whole surface is absent (`404`) unless the portal is switched on — the `portal.enabled`
 * setting or its `PORTAL_ENABLED` environment variable — consistent with the other phase flags:
 * a deployment that has not switched the portal on should not advertise it.
 */
import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { prisma } from "../index";
import { AppError } from "../middleware/errorHandler";
import { logger } from "../services/logger";
import { EmailService } from "@C7NTAX/email";
import { generateTicketNumber } from "../services/ticketNumber";
import {
  clearPortalCookies,
  consumeLoginCode,
  createPortalSession,
  issueLoginCode,
  portalEligibleContact,
  portalEnabled,
  requirePortalSession,
  requirePortalWrite,
  resolvePortalSession,
  setPortalCookies,
  type PortalContact,
} from "../services/portalAuth";
import { configFlag, configText } from "../services/appSettings";
import { resolvePortalBoardId } from "../services/portalBoard";

export const portalRouter = Router();
const emailService = new EmailService();

/** The portal's own actor: tickets raised from the portal are not raised by a staff member. */
const PORTAL_ACTOR_EMAIL = "portal@c7ntax.local";

const STATUS_LABELS: Record<string, string> = {
  new: "New", open: "Open", in_progress: "In Progress", waiting_on_client: "Waiting on You",
  waiting_on_vendor: "Waiting on Vendor", resolved: "Resolved", closed: "Closed",
};

/** Every portal route is behind the flag; the router is mounted unconditionally. */
portalRouter.use((_req: Request, res: Response, next: NextFunction) => {
  if (!portalEnabled()) {
    res.status(404).json({ error: "The customer portal is not enabled on this deployment" });
    return;
  }
  next();
});

/**
 * The portal's identity, available **before** sign-in so the sign-in page can wear the right
 * colours and say who is asking. Nothing here is a customer fact: it is the same for every
 * visitor, which is what makes it safe to answer without a session.
 */
portalRouter.get("/branding", (_req: Request, res: Response) => {
  res.json({
    name: configText("workspace", "companyName") || "Customer portal",
    accentColor: configText("portal", "accentColor") || null,
    logoUrl: configText("portal", "logoUrl") || null,
    welcomeText: configText("portal", "welcomeText") || "",
    supportEmail: configText("portal", "supportEmail") || "",
    allowTicketCreation: configFlag("portal", "allowTicketCreation"),
    allowReplies: configFlag("portal", "allowReplies"),
  });
});

/**
 * Which board a portal-raised ticket lands on: the configured one, else the environment's, else
 * the oldest active board. See `services/portalBoard`.
 */

async function resolvePortalActor(): Promise<{ id: string }> {
  const existing = await prisma.user.findUnique({ where: { email: PORTAL_ACTOR_EMAIL }, select: { id: true } });
  if (existing) return existing;
  const role = (await prisma.role.findFirst({ where: { systemRole: "admin" } })) || (await prisma.role.findFirst());
  if (!role) throw new AppError("Portal is not provisioned: no role available for its system user", 503);
  return prisma.user.create({
    data: {
      email: PORTAL_ACTOR_EMAIL,
      // Unusable hash: this account exists to own portal-written rows, not to be signed into.
      passwordHash: "!portal-disabled",
      firstName: "Customer",
      lastName: "Portal",
      isActive: true,
      roleId: role.id,
    },
    select: { id: true },
  });
}

/**
 * "Mine" for the portal. Contact scope — the default — is a ticket this contact raised, is the
 * contact on, or was added to as an additional contact. Company membership alone is deliberately
 * not enough: a client with three hundred employees should not have each of them reading the
 * others' tickets. A provider serving one-mailbox small businesses can open it up to the whole
 * client with the `portal.visibility` setting, knowing that is the trade it makes.
 */
function ticketWhereForContact(contactId: string, companyId?: string) {
  return {
    OR: [
      { contactId },
      { additionalContacts: { some: { contactId } } },
      ...(configText("portal", "visibility") === "company" && companyId ? [{ companyId }] : []),
    ],
  };
}

/** The same scope as a value, so the ticket-detail path can reuse it. */
function portalScope(principal: { contactId: string; companyId: string }) {
  return ticketWhereForContact(principal.contactId, principal.companyId);
}

async function loadPortalTicket(ticketId: string, principal: { contactId: string; companyId: string }) {
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, ...portalScope(principal) },
    select: {
      id: true, ticketNumber: true, title: true, description: true, status: true, priority: true,
      createdAt: true, updatedAt: true, resolvedAt: true, closedAt: true,
      dueDate: true,
      assignedTo: { select: { firstName: true, lastName: true } },
      company: { select: { id: true, name: true } },
      // Internal notes are filtered here, in the query, so no caller can forget to.
      comments: {
        where: { isInternal: false },
        orderBy: { createdAt: "asc" },
        select: { id: true, body: true, createdAt: true, fromEmail: true, author: { select: { firstName: true, lastName: true } } },
      },
    },
  });
  if (!ticket) throw new AppError("Ticket not found", 404);
  return ticket;
}

function portalTicketSummary(ticket: {
  id: string; ticketNumber: string; title: string; status: string; priority: string;
  createdAt: Date; updatedAt: Date;
}) {
  return {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    title: ticket.title,
    status: ticket.status,
    statusLabel: STATUS_LABELS[ticket.status] ?? ticket.status,
    priority: ticket.priority,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}

/** The branding the portal is allowed to know about, and nothing else from the client record. */
interface PortalBranding {
  name: string;
  portalAccentColor: string | null;
  portalLogoUrl: string | null;
}

function portalCompanySummary(company: PortalBranding) {
  return {
    name: company.name,
    // A client's own colour wins; otherwise the instance default, so a provider can brand every
    // portal once and still let one client override it.
    accentColor: company.portalAccentColor || configText("portal", "accentColor") || null,
    logoUrl: company.portalLogoUrl || configText("portal", "logoUrl") || null,
  };
}

// ── Sign-in ─────────────────────────────────────────────────────────

/**
 * Request a sign-in code. Always 202: answering differently for an unknown address would turn
 * this into a customer list, and the point of a portal code is that only the mailbox owner
 * can use it.
 */
portalRouter.post("/auth/request", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const email = String(req.body?.email ?? "").trim();
    if (email) {
      const contact = await portalEligibleContact(email);
      if (contact) {
        const code = await issueLoginCode(contact.id);
        if (code) {
          try {
            await emailService.send({
              to: contact.email,
              subject: "Your C7NTAX portal sign-in code",
              text: `Your sign-in code is ${code}. It expires in 10 minutes. If you did not ask for it, ignore this message.`,
              html: `<p>Your sign-in code is <strong style="font-size:18px;letter-spacing:2px">${code}</strong>.</p>
                     <p>It expires in 10 minutes. If you did not ask for it, ignore this message.</p>`,
            });
          } catch (err) {
            // The answer stays the same, but the operator needs to know mail did not leave.
            logger.warn("portal.code", "Could not email a portal sign-in code", {
              contactId: contact.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    }
    res.status(202).json({ message: "If that address belongs to a portal account, a sign-in code is on its way." });
  } catch (e) { next(e); }
});

portalRouter.post("/auth/verify", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const email = String(req.body?.email ?? "").trim();
    const code = String(req.body?.code ?? "").trim();
    if (!email || !code) throw new AppError("Email and code are required");

    const contact = await portalEligibleContact(email);
    // Same message for an unknown address and a wrong code: the difference is not the caller's
    // business, and the email must already have been received to be trying at all.
    if (!contact) throw new AppError("That code is not valid", 401);

    const result = await consumeLoginCode(contact.id, code);
    if (result === "too-many-attempts") throw new AppError("Too many attempts — request a new code", 429);
    if (result === "expired") throw new AppError("That code has expired — request a new one", 401);
    if (result !== "ok") throw new AppError("That code is not valid", 401);

    const session = await createPortalSession(contact.id, req);
    setPortalCookies(res, session);
    res.json({
      token: session.sessionToken,
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
      contact: { firstName: contact.firstName, lastName: contact.lastName, email: contact.email },
      company: portalCompanySummary(contact.company),
    });
  } catch (e) { next(e); }
});

portalRouter.post("/auth/logout", async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Deliberately resolved rather than required: signing out of an already-expired session
    // must clear the cookies and say so, not fail.
    const principal = await resolvePortalSession(req);
    if (principal) {
      await prisma.portalSession.updateMany({
        where: { id: principal.sessionId, invalidatedAt: null },
        data: { invalidatedAt: new Date() },
      });
    }
    clearPortalCookies(res);
    res.json({ message: "Signed out" });
  } catch (e) { next(e); }
});

// ── Account ─────────────────────────────────────────────────────────

portalRouter.get("/me", requirePortalSession, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const principal = req.portalContact!;
    const contact = await prisma.contact.findUnique({
      where: { id: principal.contactId },
      select: {
        firstName: true, lastName: true, email: true, phone: true,
        company: { select: { name: true, portalEnabled: true, portalAccentColor: true, portalLogoUrl: true } },
      },
    });
    if (!contact) throw new AppError("Ticket not found", 404);
    const open = await prisma.ticket.count({
      where: { ...portalScope(principal), status: { notIn: ["resolved", "closed"] } },
    });
    res.json({
      contact: { firstName: contact.firstName, lastName: contact.lastName, email: contact.email, phone: contact.phone },
      company: portalCompanySummary(contact.company),
      openTickets: open,
      // The portal's own rules travel with the identity, so a button that would be refused is
      // never drawn in the first place.
      portal: {
        welcomeText: configText("portal", "welcomeText") || "",
        supportEmail: configText("portal", "supportEmail") || "",
        allowTicketCreation: configFlag("portal", "allowTicketCreation"),
        allowReplies: configFlag("portal", "allowReplies"),
        visibility: configText("portal", "visibility") || "contact",
      },
    });
  } catch (e) { next(e); }
});

// ── Tickets ─────────────────────────────────────────────────────────

portalRouter.get("/tickets", requirePortalSession, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const principal = req.portalContact!;
    const status = typeof req.query.status === "string" ? req.query.status : "";
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const where = {
      ...portalScope(principal),
      ...(status ? { status } : {}),
    };
    const [tickets, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        take: limit,
        select: {
          id: true, ticketNumber: true, title: true, status: true, priority: true,
          createdAt: true, updatedAt: true,
        },
      }),
      prisma.ticket.count({ where }),
    ]);
    res.json({ data: tickets.map(portalTicketSummary), total });
  } catch (e) { next(e); }
});

portalRouter.get("/tickets/:id", requirePortalSession, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const principal = req.portalContact!;
    const ticket = await loadPortalTicket(String(req.params.id), principal);
    res.json({
      ...portalTicketSummary(ticket),
      description: ticket.description,
      company: { name: ticket.company.name },
      assignedToName: ticket.assignedTo ? `${ticket.assignedTo.firstName} ${ticket.assignedTo.lastName}`.trim() : null,
      resolvedAt: ticket.resolvedAt,
      closedAt: ticket.closedAt,
      comments: ticket.comments.map(c => ({
        id: c.id,
        // A comment the customer wrote is theirs; anything else is the provider's answer.
        fromCustomer: !!c.fromEmail && c.fromEmail.toLowerCase() === principal.email.toLowerCase(),
        body: c.body,
        createdAt: c.createdAt,
        authorName: `${c.author.firstName} ${c.author.lastName}`.trim(),
      })),
    });
  } catch (e) { next(e); }
});

portalRouter.post("/tickets", requirePortalWrite, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const principal = req.portalContact!;
    // A client that must go through the phone can have the form taken away; the refusal is
    // here as well as in the UI because a hidden button is not a permission.
    if (!configFlag("portal", "allowTicketCreation")) {
      throw new AppError("Your provider has not enabled raising tickets through the portal — please contact them directly", 403);
    }
    const title = String(req.body?.title ?? "").trim();
    const description = String(req.body?.description ?? "").trim();
    const priority = ["low", "medium", "high"].includes(String(req.body?.priority)) ? String(req.body.priority) : "medium";
    if (!title) throw new AppError("A short summary is required");
    if (title.length > 200) throw new AppError("Keep the summary under 200 characters");
    if (!description) throw new AppError("Please describe what you need help with");

    const [boardId, actor] = await Promise.all([resolvePortalBoardId(), resolvePortalActor()]);

    const created = await (async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await prisma.$transaction(async (tx) => {
            const ticketNumber = await generateTicketNumber(principal.companyId, attempt);
            const ticket = await tx.ticket.create({
              data: {
                ticketNumber,
                title,
                description: description.slice(0, 20000),
                boardId,
                companyId: principal.companyId,
                contactId: principal.contactId,
                priority,
                source: "portal",
                status: "new",
                createdById: actor.id,
              },
              select: { id: true, ticketNumber: true },
            });
            // The customer's own words belong in the thread, not only in the description field.
            await tx.ticketComment.create({
              data: {
                ticketId: ticket.id,
                body: description.slice(0, 20000),
                authorId: actor.id,
                isInternal: false,
                fromEmail: principal.email,
              },
            });
            return ticket;
          });
        } catch (e: unknown) {
          // Same numbering race the email connector guards against: two tickets can want the
          // same next number at the same instant.
          if ((e as { code?: string })?.code !== "P2002" || attempt >= 4) throw e;
        }
      }
    })();

    logger.info("portal.ticket", `ticket ${created.ticketNumber} raised from the portal by a contact of client ${principal.companyId}`);
    res.status(201).json({ id: created.id, ticketNumber: created.ticketNumber });
  } catch (e) { next(e); }
});

portalRouter.post("/tickets/:id/reply", requirePortalWrite, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const principal = req.portalContact!;
    if (!configFlag("portal", "allowReplies")) {
      throw new AppError("Replying through the portal is not enabled — please contact your provider directly", 403);
    }
    const body = String(req.body?.body ?? "").trim();
    if (!body) throw new AppError("Please write a message");
    if (body.length > 20000) throw new AppError("That message is too long");

    const ticket = await prisma.ticket.findFirst({
      where: { id: String(req.params.id), ...portalScope(principal) },
      select: { id: true, status: true },
    });
    if (!ticket) throw new AppError("Ticket not found", 404);

    const actor = await resolvePortalActor();
    // A customer replying to a closed ticket is reopening it: leaving it closed would hide the
    // reply from the queue that has to answer it.
    const reopened = ["resolved", "closed"].includes(ticket.status);
    await prisma.$transaction(async (tx) => {
      await tx.ticketComment.create({
        data: { ticketId: ticket.id, body, authorId: actor.id, isInternal: false, fromEmail: principal.email },
      });
      await tx.ticket.update({
        where: { id: ticket.id },
        data: {
          updatedAt: new Date(),
          ...(reopened ? { status: "new", resolvedAt: null, closedAt: null, waitingSince: null } : {}),
        },
      });
    });

    // Status changed, so the ticket's own contact notification applies — but the customer is
    // the author here, and emailing somebody their own message is how portals get a bad name.
    if (reopened) {
      const { notifyTicketContact } = await import("../services/ticketNotifications");
      await notifyTicketContact(ticket.id, {
        eventLabel: "Reopened by customer",
        details: "The customer replied through the portal and the ticket was reopened.",
        includePrimary: false,
      });
    }
    res.status(201).json({ message: reopened ? "Reply sent — the ticket has been reopened" : "Reply sent", reopened });
  } catch (e) { next(e); }
});

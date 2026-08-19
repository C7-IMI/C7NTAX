import { Router } from "express";
import { prisma } from "../index";
import { authenticate, type AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { createTicketFromEmail } from "../services/emailToTicket";
import crypto from "crypto";

// Backlog item 8 — Outlook add-in batch endpoint (gated by OUTLOOK_ADDIN_ENABLED).
export const outlookAddinRouter = Router();

outlookAddinRouter.use((_req, res, next) => {
  if (process.env.OUTLOOK_ADDIN_ENABLED === "false") return res.status(404).json({ error: "Outlook add-in disabled" });
  next();
});
outlookAddinRouter.use(authenticate);

outlookAddinRouter.post("/tickets", async (req: AuthRequest, res, next) => {
  try {
    const { boardId, emails = [] } = req.body;
    if (!boardId) throw new AppError("boardId required");
    if (!Array.isArray(emails) || emails.length === 0) throw new AppError("emails array required");
    const created: unknown[] = [];
    const skipped: string[] = [];
    for (const raw of emails) {
      const e = raw || {};
      const key = String(e.internetMessageId || `${e.from}-${e.subject}`).slice(0, 240);
      const digest = crypto.createHash("sha256").update(key).digest("hex");
      const existing = await prisma.ticket.findFirst({ where: { emailMessageId: digest } });
      if (existing) { skipped.push(e.subject || key); continue; }
      const t = await createTicketFromEmail({
        boardId, fromEmail: e.from || "", fromName: e.fromName, subject: e.subject || "(no subject)",
        bodyText: e.bodyText || "", bodyHtml: e.bodyHtml, emailMessageId: digest, receivedAt: e.receivedAt ? new Date(e.receivedAt) : undefined,
      });
      created.push(t);
    }
    res.status(201).json({ created: created.length, skipped, tickets: created });
  } catch (e) { next(e); }
});

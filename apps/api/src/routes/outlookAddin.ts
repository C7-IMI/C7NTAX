import { Router } from "express";
import { prisma } from "../index";
import { authenticate, type AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { createTicketFromEmail } from "../services/emailToTicket";
import type { ParsedEmail } from "@C7NTAX/email";
import crypto from "crypto";

// Backlog item 8 — Outlook add-in batch endpoint (gated by OUTLOOK_ADDIN_ENABLED).
export const outlookAddinRouter = Router();

const SEEN_KEY = "outlook-addin-seen";

async function getSeen(): Promise<string[]> {
  const row = await prisma.systemConfig.findUnique({ where: { key: SEEN_KEY } });
  const v = row?.value as { seen?: string[] } | null;
  return Array.isArray(v?.seen) ? v.seen : [];
}

async function recordSeen(ids: string[]): Promise<void> {
  const capped = ids.slice(-100);
  await prisma.systemConfig.upsert({
    where: { key: SEEN_KEY },
    update: { value: { seen: capped } },
    create: { key: SEEN_KEY, value: { seen: capped } },
  });
}

outlookAddinRouter.use((_req, res, next) => {
  if (process.env.OUTLOOK_ADDIN_ENABLED === "false") return res.status(404).json({ error: "Outlook add-in disabled" });
  next();
});
outlookAddinRouter.use(authenticate);

type AddinEmail = {
  internetMessageId?: string;
  from?: string;
  fromName?: string;
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
  receivedAt?: string;
};

outlookAddinRouter.post("/tickets", async (req: AuthRequest, res, next) => {
  try {
    const { boardId, emails = [] } = req.body as { boardId?: string; emails?: AddinEmail[] };
    if (!boardId) throw new AppError("boardId required");
    if (!Array.isArray(emails) || emails.length === 0) throw new AppError("emails array required");

    const seen = await getSeen();
    const created: string[] = [];
    const skipped: string[] = [];
    const newlySeen: string[] = [];

    for (const e of emails) {
      const messageId = e.internetMessageId
        || crypto.createHash("sha256").update(`${e.from}-${e.subject}-${e.receivedAt || ""}`).digest("hex");
      if (seen.includes(messageId)) { skipped.push(e.subject || messageId); continue; }
      const email: ParsedEmail = {
        messageId,
        from: { name: e.fromName || "", email: e.from || "" },
        to: [], cc: [],
        subject: e.subject || "(no subject)",
        bodyText: e.bodyText || "",
        bodyHtml: e.bodyHtml || "",
        attachments: [],
        date: e.receivedAt ? new Date(e.receivedAt) : new Date(),
        inReplyTo: null,
        references: [],
      };
      const ticketId = await createTicketFromEmail(boardId, email);
      if (ticketId) { created.push(ticketId); newlySeen.push(messageId); }
      else skipped.push(e.subject || messageId);
    }

    if (newlySeen.length > 0) await recordSeen([...seen, ...newlySeen]);

    res.status(201).json({ created: created.length, skipped, tickets: created });
  } catch (e) { next(e); }
});

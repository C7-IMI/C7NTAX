/**
 * The Outlook add-in's endpoints.
 *
 * Five, and the shape is the flow the pane draws:
 *
 *   GET  /options      what the pickers need — boards and clients, without demanding permissions
 *                      the ticket-creating role does not have
 *   POST /preview      what each selected message will become, **read-only**, so the review can be
 *                      shown before anything exists
 *   POST /tickets      create — one ticket per message, or one bundled ticket with the others attached
 *   GET  /preferences  the saved answers that let the questions stop being asked
 *   PATCH /preferences
 *
 * `POST /preview` is why the review is worth having. A client is matched from the sender's domain
 * and a contact from the sender's address, and the pane can know neither; asking the server what it
 * would do is the difference between a review and a guess.
 */
import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission } from "@C7NTAX/shared";
import { AppError } from "../middleware/errorHandler";
import {
  attachEmailsToTicket,
  createTicketFromEmail,
  previewEmailFields,
  resolveSystemUser,
  type ReviewedEmailFields,
} from "../services/emailToTicket";
import type { ParsedEmail } from "@C7NTAX/email";
import crypto from "crypto";
import { configFlag } from "../services/appSettings";
import { companyWhere } from "../middleware/companyScope";

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
  // The field moved from the `integrations` area to `apps` (Client Apps & Notifications) in
  // BuildNotes 2026.10.7.030. This read was left behind, and `configValue` answers "" for a field
  // the registry does not declare — so it failed closed and the endpoint returned 404 for every
  // request while the switch showed as on. `scripts/check-config-reads.mts` now guards this class
  // of drift, because a stale area fails silently and disabling a live feature looks like nothing.
  if (!configFlag("apps", "outlookAddin")) return res.status(404).json({ error: "Outlook add-in disabled" });
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
  /** The review: only the fields the user can change, and only when they changed them. */
  boardId?: string;
  companyId?: string | null;
  contactName?: string;
  priority?: string;
};

/** The pane's message shape as the ingest service expects it. */
function toParsedEmail(input: AddinEmail, fallbackId: string): ParsedEmail {
  return {
    messageId: input.internetMessageId || fallbackId,
    from: { name: input.fromName || "", email: (input.from || "").trim() },
    // The pane sends one body per message and no recipient lists: the ticket's own comment records
    // who sent it, and the recipients are still in the attached copy of the original.
    to: [],
    cc: [],
    subject: input.subject || "",
    date: input.receivedAt ? new Date(input.receivedAt) : new Date(),
    bodyText: input.bodyText || "",
    bodyHtml: input.bodyHtml || "",
    attachments: [],
    inReplyTo: null,
    references: [],
  };
}

/** Dedup key: the Internet Message-ID when the host gave us one, otherwise a stable hash. */
function dedupKey(email: AddinEmail): string {
  return (
    email.internetMessageId ||
    crypto.createHash("sha256").update(`${email.from}-${email.subject}-${email.receivedAt || ""}`).digest("hex")
  );
}

function reviewedFrom(email: AddinEmail): ReviewedEmailFields {
  return {
    boardId: email.boardId,
    companyId: email.companyId,
    contactName: email.contactName,
    priority: email.priority,
  };
}

/**
 * The reviewed fields, with the client pinned for a company-scoped account.
 *
 * The sender's domain is a hint and the request body is a request — neither is an authority — so an
 * account scoped to one client always files under that client. Without this, a client contact could
 * forward a message from another company and open a ticket against them, and the add-in's own
 * domain matching would do it without the body even naming a client.
 */
function scopedReviewed(user: AuthRequest["user"], email: AddinEmail): ReviewedEmailFields {
  const fields = reviewedFrom(email);
  if (user?.companyId) fields.companyId = user.companyId;
  return fields;
}

/**
 * Refuse a client a scoped account cannot file for, before anything is attempted.
 *
 * Checked across the whole request rather than per message: the per-message handler reports a
 * failure as "the ticket could not be created", which would tell the person a plausible story about
 * a broken connection instead of the truth about their permissions.
 */
function assertScopedCompanies(user: AuthRequest["user"], emails: AddinEmail[]): void {
  if (!user?.companyId) return;
  if (emails.some(e => e.companyId && e.companyId !== user.companyId)) {
    throw new AppError("That client is not one you can file tickets for", 403);
  }
}

/**
 * Boards and clients for the pane's pickers.
 *
 * Not `/api/boards` and `/api/clients`: filing a ticket does not require the permissions those
 * routes enforce, so a technician who can create a ticket would be shown an empty board list and
 * could not file anything. This returns only what the pickers need, and only to somebody who can
 * create a ticket.
 */
outlookAddinRouter.get("/options", requirePermission(Permission.TicketCreate), async (req: AuthRequest, res, next) => {
  try {
    // A company-scoped account is offered only its own client in the picker: filing against
    // another one is the write the scope exists to prevent, and offering it would only be an
    // invitation to try. Internal staff are unscoped, so their picker is unchanged.
    const scope = companyWhere(req.user);
    const [boards, clients] = await Promise.all([
      prisma.serviceBoard.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.company.findMany({
        where: scope.companyId ? { id: scope.companyId } : {},
        orderBy: { name: "asc" },
        take: 500,
        select: { id: true, name: true },
      }),
    ]);
    res.json({ boards, clients });
  } catch (e) {
    next(e);
  }
});

/**
 * What each selected message will become, without creating anything.
 *
 * Read-only by construction: it resolves the client, the contact and the derived fields exactly the
 * way creation will, and reports which messages already have a ticket so the pane can say so on the
 * row rather than at the end.
 */
outlookAddinRouter.post("/preview", requirePermission(Permission.TicketCreate), async (req: AuthRequest, res, next) => {
  try {
    const { emails = [] } = req.body as { emails?: AddinEmail[] };
    if (!Array.isArray(emails) || emails.length === 0) throw new AppError("emails array required");

    const seen = await getSeen();
    const messages = [];
    for (let i = 0; i < emails.length; i++) {
      const input = emails[i];
      if (!input) continue;
      const key = dedupKey(input);
      const fields = await previewEmailFields(toParsedEmail(input, `addin-${i}`));
      messages.push({
        key,
        subject: input.subject || "",
        alreadyHasTicket: seen.includes(key),
        ...fields,
      });
    }
    res.json({ messages });
  } catch (e) {
    next(e);
  }
});

outlookAddinRouter.post("/tickets", requirePermission(Permission.TicketCreate), async (req: AuthRequest, res, next) => {
  try {
    const {
      boardId,
      mode = "individual",
      parentMessageId,
      emails = [],
    } = req.body as {
      boardId?: string;
      mode?: "individual" | "bundled";
      parentMessageId?: string;
      emails?: AddinEmail[];
    };
    if (!boardId) throw new AppError("boardId required");
    if (!Array.isArray(emails) || emails.length === 0) throw new AppError("emails array required");
    if (mode !== "individual" && mode !== "bundled") throw new AppError("mode must be individual or bundled");
    assertScopedCompanies(req.user, emails);

    const seen = await getSeen();
    const created: string[] = [];
    const skipped: string[] = [];
    const newlySeen: string[] = [];
    // Per-message results, because the taskpane has to show which email produced which ticket —
    // "3 created" does not tell somebody which of their five messages was already done.
    const results: Array<{ subject: string; ticketId?: string; ticketNumber?: string; reason?: string; attached?: boolean }> = [];

    // ── Bundled: one ticket written from the parent, the rest attached ────────
    if (mode === "bundled") {
      const parent =
        emails.find((e) => dedupKey(e) === parentMessageId) ??
        emails.find((e) => e.internetMessageId === parentMessageId) ??
        emails[0]!;
      const parentKey = dedupKey(parent);

      if (seen.includes(parentKey)) {
        // The parent cannot become a ticket that already exists, and filing a second one would
        // defeat the dedup the whole flow relies on.
        skipped.push(parent.subject || parentKey);
        results.push({ subject: parent.subject || parentKey, reason: "already has a ticket" });
        res.status(200).json({ created: 0, skipped, tickets: [], results, bundled: true, attachments: [] });
        return;
      }

      const attachments = emails.filter((e) => dedupKey(e) !== parentKey);
      const systemUser = await resolveSystemUser();
      const ticketId = await createTicketFromEmail(boardId, toParsedEmail(parent, parentKey), {
        // A person selected this message and pressed Create, so an out-of-office reply is
        // something they meant to file rather than something a connector should filter.
        ignoreAutoReplies: false,
        reviewed: scopedReviewed(req.user, parent),
      });

      if (!ticketId) {
        skipped.push(parent.subject || parentKey);
        results.push({ subject: parent.subject || parentKey, reason: "the ticket could not be created" });
        res.status(201).json({ created: 0, skipped, tickets: [], results, bundled: true, attachments: [] });
        return;
      }

      const written = await attachEmailsToTicket(
        ticketId,
        attachments.map((e, i) => ({ email: toParsedEmail(e, `addin-bundle-${i}`), subject: e.subject || "message" })),
        systemUser.id,
      );

      const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { ticketNumber: true } });
      created.push(ticketId);
      newlySeen.push(parentKey, ...attachments.map(dedupKey));
      results.push({ subject: parent.subject || parentKey, ticketId, ticketNumber: ticket?.ticketNumber });
      for (const attached of attachments) {
        results.push({ subject: attached.subject || "", attached: true });
      }

      await recordSeen([...seen, ...newlySeen]);
      res.status(201).json({
        created: created.length,
        skipped,
        tickets: created,
        results,
        bundled: true,
        attachments: written.map((a) => ({ subject: a.subject, filename: a.filename })),
      });
      return;
    }

    // ── Individual: one ticket per message ────────────────────────────────────
    const recorded: string[] = [];
    for (let i = 0; i < emails.length; i++) {
      const input = emails[i];
      if (!input) continue;
      const key = dedupKey(input);

      if (seen.includes(key)) {
        skipped.push(input.subject || key);
        results.push({ subject: input.subject || key, reason: "already has a ticket" });
        continue;
      }

      try {
        const ticketId = await createTicketFromEmail(boardId, toParsedEmail(input, `addin-${i}`), {
          ignoreAutoReplies: false,
          reviewed: scopedReviewed(req.user, input),
        });
        if (!ticketId) {
          skipped.push(input.subject || key);
          results.push({ subject: input.subject || key, reason: "the ticket could not be created" });
          continue;
        }
        const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { ticketNumber: true } });
        created.push(ticketId);
        recorded.push(key);
        results.push({ subject: input.subject || key, ticketId, ticketNumber: ticket?.ticketNumber });
      } catch (e: any) {
        console.error("[OutlookAddIn] Could not create a ticket from a selected message:", e?.message || e);
        skipped.push(input.subject || key);
        results.push({ subject: input.subject || key, reason: "the ticket could not be created" });
      }
    }

    // Only messages that produced a ticket are marked seen. Marking a failure as seen would make
    // the next attempt report "already has a ticket" for a ticket that does not exist.
    if (recorded.length) await recordSeen([...seen, ...recorded]);
    res.status(201).json({ created: created.length, skipped, tickets: created, results, bundled: false });
  } catch (e) {
    next(e);
  }
});

/**
 * The saved answers, per user.
 *
 * On the user rather than on the device, which is the opposite of how the mockup stored them: the
 * taskpane's `localStorage` is scoped to the add-in's origin and therefore shared by every C7NTAX
 * account that signs in on that machine. A preference that made a ticket file without asking,
 * inherited by the next person to use Outlook on that PC, is not a preference.
 */
const PREFERENCE_DEFAULTS = {
  /** ask | individual — how several messages are handled. */
  mode: "ask" as "ask" | "individual",
  /** ask | always | never — whether the review is offered. */
  preview: "ask" as "ask" | "always" | "never",
  rememberBoard: true,
  lastBoardId: null as string | null,
};

function normalisePreferences(raw: unknown) {
  const value = (raw ?? {}) as Record<string, unknown>;
  return {
    mode: value.mode === "individual" ? ("individual" as const) : PREFERENCE_DEFAULTS.mode,
    preview: value.preview === "always" || value.preview === "never" ? value.preview : PREFERENCE_DEFAULTS.preview,
    rememberBoard: value.rememberBoard !== false,
    lastBoardId: typeof value.lastBoardId === "string" && value.lastBoardId ? value.lastBoardId : null,
  };
}

outlookAddinRouter.get("/preferences", requirePermission(Permission.TicketCreate), async (req: AuthRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { addinPreferences: true },
    });
    res.json(normalisePreferences(user?.addinPreferences));
  } catch (e) {
    next(e);
  }
});

outlookAddinRouter.patch("/preferences", requirePermission(Permission.TicketCreate), async (req: AuthRequest, res, next) => {
  try {
    const preferences = normalisePreferences(req.body);
    // A remembered board that has since been deleted would file tickets onto a board that no longer
    // exists, so the reference is checked here rather than trusted later.
    if (preferences.lastBoardId) {
      const board = await prisma.serviceBoard.findUnique({
        where: { id: preferences.lastBoardId },
        select: { id: true },
      });
      if (!board) preferences.lastBoardId = null;
    }
    await prisma.user.update({ where: { id: req.user!.userId }, data: { addinPreferences: preferences } });
    res.json(preferences);
  } catch (e) {
    next(e);
  }
});

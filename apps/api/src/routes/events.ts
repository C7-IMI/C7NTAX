/**
 * The event gateway — where another system tells C7NTAX that something happened.
 *
 * An RMM raises an alert, an SIEM reports a detection, a monitoring platform sees a service come
 * back. All of them are the same shape of message, so they share one endpoint rather than growing a
 * route per vendor, and the payload says which system it came from.
 *
 * The behaviour that matters is **not** creating a ticket:
 *
 *   · `(source, externalId)` is unique, so an alert polled every minute opens **one** ticket. A
 *     repeat attaches to the ticket the first one opened, as a comment with an occurrence count, so
 *     the thread shows the flap instead of the queue showing twenty tickets;
 *   · `kind: "recovery"` closes the ticket the alert opened rather than opening anything;
 *   · the whole payload is kept, on the event and in the ticket's own fields, because the reason a
 *     ticket exists is usually in the parts of the JSON nobody mapped.
 *
 * Reads need `ticket:view`; the ingest needs `ticket:create`. Both are satisfied by a session or by
 * an API key whose scopes include them, which is how an RMM is given the ability to raise tickets
 * and nothing else.
 */
import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission } from "@C7NTAX/shared";
import { AppError } from "../middleware/errorHandler";
import { generateTicketNumber } from "../services/ticketNumber";

export const eventsRouter = Router();
eventsRouter.use(authenticate);

const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
type Severity = typeof SEVERITIES[number];

/** Severity is the one field every vendor names differently, so it maps to a ticket priority. */
const PRIORITY_FOR_SEVERITY: Record<Severity, string> = {
  critical: "critical",
  high: "high",
  medium: "medium",
  low: "low",
  info: "low",
};

interface EventInput {
  source: string;
  externalId: string;
  kind: string;
  severity: Severity;
  title: string;
  description: string | null;
  companyId: string | null;
  boardId: string | null;
  ticketId: string | null;
  occurredAt: Date | null;
  data: Record<string, unknown>;
}

function readEvent(body: Record<string, unknown>): EventInput {
  const text = (value: unknown, limit: number): string => String(value ?? "").trim().slice(0, limit);

  const source = text(body.source, 60);
  if (!source) throw new AppError("source is required — it is the name of the system sending the event (\"rmm\", \"sentinelone\", \"splunk\"…)", 400);

  const externalId = text(body.externalId, 200);
  if (!externalId) throw new AppError("externalId is required — it is what makes a repeat of the same alert attach to the same ticket instead of opening another", 400);

  const title = text(body.title, 300);
  if (!title) throw new AppError("title is required", 400);

  const severity = text(body.severity || "info", 20).toLowerCase();
  if (!SEVERITIES.includes(severity as Severity)) throw new AppError(`severity must be one of ${SEVERITIES.join(", ")}`, 400);

  const ticketId = text(body.ticketId, 64) || null;
  const boardId = text(body.boardId, 64) || (body.boardId === null ? null : "");
  const client = (body.client ?? {}) as Record<string, unknown>;
  const companyId = text(client.companyId ?? body.companyId, 64) || null;

  let occurredAt: Date | null = null;
  if (body.occurredAt) {
    const parsed = new Date(String(body.occurredAt));
    if (Number.isNaN(parsed.getTime())) throw new AppError("occurredAt must be an ISO date", 400);
    occurredAt = parsed;
  }

  return {
    source,
    externalId,
    kind: text(body.kind || "alert", 40).toLowerCase(),
    severity: severity as Severity,
    title,
    description: body.description ? text(body.description, 8000) : null,
    companyId,
    boardId: boardId || null,
    ticketId,
    occurredAt,
    data: (body.data && typeof body.data === "object" ? body.data : {}) as Record<string, unknown>,
  };
}

/**
 * Which client the event belongs to: the one named by id, then the one whose name matches, then the
 * one on the ticket being appended to. A ticket needs a client, so an event that names none and
 * matches none is refused with the fix rather than filed against a guess.
 */
async function resolveCompany(event: EventInput, client: Record<string, unknown>): Promise<string | null> {
  if (event.companyId) {
    const byId = await prisma.company.findUnique({ where: { id: event.companyId }, select: { id: true } });
    if (!byId) throw new AppError(`client.companyId ${event.companyId} is not a client here`, 400);
    return byId.id;
  }
  const name = String(client.name ?? "").trim();
  if (name) {
    const matches = await prisma.company.findMany({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true }, take: 2 });
    if (matches.length === 1) return matches[0]!.id;
    if (matches.length > 1) throw new AppError(`More than one client is called "${name}" — send client.companyId instead`, 409);
  }
  return null;
}

/** Which board the ticket lands on: the one asked for, then the configured intake board, then none. */
async function resolveBoard(event: EventInput): Promise<string | null> {
  if (event.boardId) {
    const board = await prisma.serviceBoard.findUnique({ where: { id: event.boardId }, select: { id: true } });
    if (!board) throw new AppError(`boardId ${event.boardId} is not a board here`, 400);
    return board.id;
  }
  const configured = await prisma.systemConfig.findUnique({ where: { key: "eventIntakeBoardId" }, select: { value: true } });
  const configuredId = typeof configured?.value === "string" ? configured.value : (configured?.value as { boardId?: string } | null)?.boardId;
  if (configuredId) {
    const board = await prisma.serviceBoard.findUnique({ where: { id: configuredId }, select: { id: true } });
    if (board) return board.id;
  }
  const fallback = await prisma.serviceBoard.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  return fallback?.id ?? null;
}

/**
 * The event lands in the ticket's own thread as well as on the event row: the fields nobody mapped
 * are usually the reason the ticket exists, and a comment is where a technician will look.
 */
function describe(event: EventInput, occurrence: number, previousTicket: string | null): string {
  const lines = [
    `**${event.severity.toUpperCase()} · ${event.kind}** from **${event.source}**`,
    previousTicket ? `Repeated — this is occurrence ${occurrence} of \`${event.externalId}\`.` : `Event \`${event.externalId}\`${event.occurredAt ? ` at ${event.occurredAt.toISOString()}` : ""}.`,
  ];
  if (event.description) lines.push("", event.description);
  const detail = Object.keys(event.data).length > 0 ? JSON.stringify(event.data, null, 2) : "";
  if (detail) lines.push("", "```json", detail.slice(0, 6000), "```");
  return lines.join("\n");
}

/**
 * Receive one event.
 *
 * Idempotent by `(source, externalId)`. The answer says what happened rather than only that the
 * request was understood, because a sender needs to know whether it opened a ticket or joined one.
 */
eventsRouter.post("/", requirePermission(Permission.TicketCreate), async (req: AuthRequest, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const event = readEvent(body);
    const client = (body.client ?? {}) as Record<string, unknown>;

    const existing = await prisma.eventRecord.findUnique({
      where: { source_externalId: { source: event.source, externalId: event.externalId } },
    });

    // ── An explicit ticket wins: the sender knows where this belongs ──────────
    const targetTicketId = event.ticketId ?? existing?.ticketId ?? null;
    if (targetTicketId) {
      const ticket = await prisma.ticket.findUnique({ where: { id: targetTicketId }, select: { id: true, ticketNumber: true, status: true, companyId: true } });
      if (!ticket) throw new AppError(`ticketId ${targetTicketId} is not a ticket here`, 400);

      await prisma.ticketComment.create({
        data: {
          ticketId: ticket.id,
          authorId: req.user!.userId,
          isInternal: true,
          body: describe(event, (existing?.occurrences ?? 0) + 1, existing?.ticketId ? targetTicketId : null),
        },
      });

      const recovered = event.kind === "recovery";
      if (recovered && !["resolved", "closed"].includes(ticket.status)) {
        await prisma.ticket.update({ where: { id: ticket.id }, data: { status: "resolved", resolvedAt: new Date() } });
      }

      const payload = { ...event.data, description: event.description };
      const saved = await prisma.eventRecord.upsert({
        where: { source_externalId: { source: event.source, externalId: event.externalId } },
        create: {
          source: event.source, externalId: event.externalId, kind: event.kind, severity: event.severity,
          title: event.title, payload: payload as never, state: recovered ? "recovered" : "open",
          ticketId: ticket.id, companyId: ticket.companyId, apiKeyId: req.apiKey?.id ?? null,
        },
        update: {
          title: event.title, severity: event.severity, kind: event.kind, payload: payload as never,
          state: recovered ? "recovered" : "open",
          occurrences: { increment: existing ? 1 : 0 },
        },
      });

      res.status(existing ? 200 : 201).json({
        eventId: saved.id,
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        created: false,
        merged: Boolean(existing?.ticketId),
        recovered,
        occurrences: saved.occurrences,
      });
      return;
    }

    // ── A recovery with nothing to recover is recorded and nothing more ───────
    if (event.kind === "recovery") {
      const saved = await prisma.eventRecord.upsert({
        where: { source_externalId: { source: event.source, externalId: event.externalId } },
        create: {
          source: event.source, externalId: event.externalId, kind: event.kind, severity: event.severity,
          title: event.title, payload: event.data as never, state: "recovered", apiKeyId: req.apiKey?.id ?? null,
        },
        update: { state: "recovered", occurrences: { increment: existing ? 1 : 0 } },
      });
      res.status(existing ? 200 : 202).json({ eventId: saved.id, created: false, recovered: true, occurrences: saved.occurrences,
        note: "No open ticket was tied to this event, so nothing was closed." });
      return;
    }

    // ── A new event: it needs a client and a board ───────────────────────────
    const companyId = await resolveCompany(event, client);
    if (!companyId) {
      throw new AppError("The event names no client and no client matches it. Send client.companyId (or client.name, when exactly one client carries it) — a ticket has to belong to someone.", 400);
    }
    const boardId = await resolveBoard(event);
    if (!boardId) throw new AppError("No service board exists to file this against. Create one, or send boardId.", 400);

    const ticketNumber = await generateTicketNumber(companyId);
    const ticket = await prisma.ticket.create({
      data: {
        ticketNumber,
        title: event.title,
        description: event.description ?? `${event.severity} ${event.kind} from ${event.source}`,
        status: "new",
        priority: PRIORITY_FOR_SEVERITY[event.severity],
        source: event.source === "rmm" || event.source === "monitoring" ? "monitoring" : "api",
        boardId,
        companyId,
        createdById: req.user!.userId,
        tags: [`source:${event.source}`],
        customFields: {
          event: {
            source: event.source,
            externalId: event.externalId,
            kind: event.kind,
            severity: event.severity,
            occurredAt: event.occurredAt?.toISOString() ?? null,
            receivedAt: new Date().toISOString(),
          },
          data: event.data,
        } as never,
        comments: {
          create: {
            authorId: req.user!.userId,
            isInternal: true,
            body: describe(event, 1, null),
          },
        },
      },
      select: { id: true, ticketNumber: true },
    });

    const saved = await prisma.eventRecord.upsert({
      where: { source_externalId: { source: event.source, externalId: event.externalId } },
      create: {
        source: event.source, externalId: event.externalId, kind: event.kind, severity: event.severity,
        title: event.title, payload: event.data as never, state: "open", ticketId: ticket.id,
        companyId, apiKeyId: req.apiKey?.id ?? null,
      },
      update: {
        title: event.title, severity: event.severity, kind: event.kind, payload: event.data as never,
        state: "open", ticketId: ticket.id, companyId, apiKeyId: req.apiKey?.id ?? null,
        occurrences: { increment: existing ? 1 : 0 },
      },
    });

    res.status(201).json({
      eventId: saved.id,
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
      created: true,
      merged: false,
      recovered: false,
      occurrences: saved.occurrences,
    });
  } catch (e) { next(e); }
});

/** What has arrived recently, with the ticket each event became. */
eventsRouter.get("/", requirePermission(Permission.TicketView), async (req: AuthRequest, res, next) => {
  try {
    const { source, state, limit = "50", offset = "0" } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (source) where.source = source;
    if (state) where.state = state;
    const [rows, total] = await Promise.all([
      prisma.eventRecord.findMany({ where, orderBy: { receivedAt: "desc" }, skip: Number(offset), take: Math.min(Number(limit) || 50, 200) }),
      prisma.eventRecord.count({ where }),
    ]);
    const tickets = rows.some(row => row.ticketId)
      ? await prisma.ticket.findMany({ where: { id: { in: rows.map(row => row.ticketId!).filter(Boolean) } }, select: { id: true, ticketNumber: true, status: true } })
      : [];
    const ticketById = new Map(tickets.map(ticket => [ticket.id, ticket]));
    res.json({
      data: rows.map(row => ({
        ...row,
        ticket: row.ticketId ? ticketById.get(row.ticketId) ?? null : null,
      })),
      total,
      limit: Number(limit),
      offset: Number(offset),
    });
  } catch (e) { next(e); }
});

/** The sources that have sent events, with counts — what the gateway has been used by. */
eventsRouter.get("/sources", requirePermission(Permission.TicketView), async (_req: AuthRequest, res, next) => {
  try {
    const rows = await prisma.eventRecord.groupBy({
      by: ["source", "state"],
      _count: { _all: true },
      _max: { receivedAt: true },
    });
    const bySource = new Map<string, { source: string; total: number; open: number; recovered: number; lastSeenAt: Date | null }>();
    for (const row of rows) {
      const entry = bySource.get(row.source) ?? { source: row.source, total: 0, open: 0, recovered: 0, lastSeenAt: null };
      entry.total += row._count._all;
      if (row.state === "recovered") entry.recovered += row._count._all; else entry.open += row._count._all;
      if (!entry.lastSeenAt || (row._max.receivedAt && row._max.receivedAt > entry.lastSeenAt)) entry.lastSeenAt = row._max.receivedAt ?? null;
      bySource.set(row.source, entry);
    }
    res.json({ data: [...bySource.values()].sort((a, b) => b.total - a.total) });
  } catch (e) { next(e); }
});

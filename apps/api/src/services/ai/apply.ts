/**
 * The executor: what an approved action actually does.
 *
 * Until this existed, approving an AI action set a status and applied nothing. The proposals the
 * assistant raises were recorded, reviewed, approved — and never carried out, which meant the AI
 * Actions screen's promise ("nothing is written until a person approves it") was true only because
 * nothing was written at all. This is the missing half of that sentence.
 *
 * Two rules decide how it works.
 *
 * 1. **An action is applied by calling the route the screen calls, as the person who asked.** Not by
 *    re-implementing the write here. Validation, company scoping, ticket numbering, automations, the
 *    customer notifications and the audit entry all live in the route, and a second implementation
 *    would drift from them — the customer email rules alone are three files. So the executor mints a
 *    short-lived token for the requester and calls the API over loopback, which means the route's own
 *    `requirePermission` is still the authority: a payload that the requester may not perform is
 *    refused by the route, not by a check somebody remembered to add here.
 *
 * 2. **The tier decides who may skip the click, never who may do it** (PLAN-026 §8). Approving is a
 *    human click, so an approved action of any non-critical tier is applied. `critical` actions are
 *    never applied — they are proposals a person carries out themselves.
 *
 * A payload kind with no handler is refused rather than silently marked done: `unknownPayload()` is
 * what a caller gets when a proposal names a kind this build cannot perform, which is the one failure
 * that must never look like success.
 */
import jwt from "jsonwebtoken";
import type { PrismaClient } from "@prisma/client";
import { JWT_SECRET } from "../../middleware/auth";

/** The slice of Prisma this needs; structural, so a probe can pass its own client. */
export type ApplyDb = PrismaClient;

export interface ApplyAction {
  id: string;
  riskTier: string;
  payload: unknown;
  requestedById: string | null;
  status: string;
}

export interface ApplyOutcome {
  ok: boolean;
  /** `executed` on success, `failed` when the route refused or errored. */
  status: "executed" | "failed";
  /** What the action produced: a new ticket's id and number, a note's id. */
  result?: Record<string, unknown>;
  /** The rows as they were, for undo and for reading what changed. */
  before?: Record<string, unknown>;
  /** The route's own words, verbatim, when something went wrong. */
  error?: string;
}

interface ApiCall {
  (path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<{ status: number; data: any }>;
}

interface PayloadHandler {
  /** One sentence for a person, from the payload alone — the preview the screens show. */
  describe(payload: Record<string, unknown>, db: ApplyDb): Promise<string>;
  /** What the action is about to touch, recorded before it runs. */
  before?(payload: Record<string, unknown>, db: ApplyDb): Promise<Record<string, unknown>>;
  apply(payload: Record<string, unknown>, ctx: { db: ApplyDb; api: ApiCall }): Promise<Record<string, unknown>>;
}

/** A payload's fields, defensively read: a stored payload is JSON from an older build. */
const str = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : typeof value === "number" ? String(value) : fallback);
const bool = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);

/**
 * The payload kinds this build can carry out, by `payload.kind`.
 *
 * Two, because the assistant raises two. PLAN-026's manifest widens this to the whole application by
 * naming the route to call, which is why each handler here is written in terms of a route rather than
 * a Prisma call — the general case is the same shape as these.
 */
const HANDLERS: Record<string, PayloadHandler> = {
  ticket_note: {
    async describe(payload, db) {
      const ticket = await db.ticket.findUnique({
        where: { id: str(payload.ticketId) },
        select: { ticketNumber: true, title: true },
      });
      const visibility = bool(payload.internal, true) ? "an internal note" : "a note the client sees";
      const where = ticket ? `${ticket.ticketNumber} (${ticket.title})` : `ticket ${str(payload.ticketId) || "(none given)"}`;
      return `Add ${visibility} to ${where}`;
    },
    async before(payload, db) {
      const ticket = await db.ticket.findUnique({
        where: { id: str(payload.ticketId) },
        select: { _count: { select: { comments: true } } },
      });
      return { notes: ticket?._count.comments ?? null };
    },
    async apply(payload, { api }) {
      const ticketId = str(payload.ticketId);
      const note = str(payload.note);
      if (!ticketId || !note) throw new Error("The proposal has no ticket or no note text");
      const internal = bool(payload.internal, true);
      const { data } = await api(`/api/tickets/${ticketId}/notes`, "POST", { content: note, isInternal: internal });
      return {
        noteId: data?.id ?? null,
        ticketId,
        internal,
        // Said out loud because it is the difference between a note and a message to a customer.
        customerNotified: !internal,
      };
    },
  },

  create_ticket: {
    async describe(payload, db) {
      const client = payload.companyId
        ? await db.company.findUnique({ where: { id: str(payload.companyId) }, select: { name: true } })
        : null;
      const board = payload.boardId
        ? await db.serviceBoard.findUnique({ where: { id: str(payload.boardId) }, select: { name: true } })
        : null;
      const forClient = client ? ` for ${client.name}` : "";
      const onBoard = board ? ` on ${board.name}` : "";
      return `Create ticket${forClient}${onBoard}: ${str(payload.title) || "(no title)"}`;
    },
    async apply(payload, { db, api }) {
      const companyId = str(payload.companyId);
      const title = str(payload.title);
      if (!title) throw new Error("The proposal has no title");

      /*
       * A ticket needs a board, and the proposal may not name one. Resolved here rather than refused,
       * because "create a ticket for David Chen" is the sentence people actually type — and recorded
       * in the result, so the audit says which board was chosen rather than leaving it implied.
       */
      const boardId = str(payload.boardId) || (await db.serviceBoard.findFirst({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true },
      }))?.id;
      if (!boardId) throw new Error("No service board exists to file a ticket on");

      const { data } = await api("/api/tickets", "POST", {
        title,
        description: str(payload.description),
        boardId,
        companyId: companyId || undefined,
        contactId: str(payload.contactId) || undefined,
        priority: str(payload.priority, "medium"),
        // A ticket raised from a prompt says so, in the one field that carries provenance.
        source: "assistant",
      });
      return {
        ticketId: data?.id ?? null,
        ticketNumber: data?.ticketNumber ?? null,
        boardId,
        companyId: companyId || null,
      };
    },
  },
};

/** The kinds this build can carry out — for the screens, the probes and the model's own instructions. */
export function payloadKinds(): string[] {
  return Object.keys(HANDLERS);
}

export function canApplyPayload(payload: unknown): boolean {
  const kind = str((payload as Record<string, unknown> | null)?.kind);
  return !!kind && !!HANDLERS[kind];
}

/** The human sentence for a proposal, or null when this build cannot carry it out. */
export async function describeActionPayload(db: ApplyDb, payload: unknown): Promise<string | null> {
  const record = (payload ?? {}) as Record<string, unknown>;
  const handler = HANDLERS[str(record.kind)];
  if (!handler) return null;
  try {
    return await handler.describe(record, db);
  } catch {
    return null;
  }
}

/**
 * A token for the person who asked, so the route sees their permissions and not this module's.
 *
 * Deliberately short-lived and never returned to a client: it exists for one loopback call. The
 * permissions in it are a snapshot, but `authenticate` re-reads the user's role and overrides from
 * the database on every request, so a permission revoked between the proposal and the approval is
 * already gone by the time the route runs.
 */
function actorToken(user: {
  id: string; email: string; tokenVersion: number; companyId: string | null;
  role: { systemRole: string }; permissions: string[]; rolePermissions: string[];
}): string {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role.systemRole,
      companyId: user.companyId,
      permissions: user.permissions,
      tokenVersion: user.tokenVersion,
    },
    JWT_SECRET,
    { expiresIn: "60s" },
  );
}

/** Where the API answers itself. Overridable for a probe or a non-default port. */
function apiBase(): string {
  return process.env.C7NTAX_INTERNAL_API_BASE || `http://127.0.0.1:${process.env.PORT || 4000}`;
}

async function callApi(token: string, path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown) {
  const response = await fetch(`${apiBase()}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 400) }; }
  return { status: response.status, data };
}

/** The message a failed call should carry: the route's own, not a status code. */
function errorText(status: number, data: any): string {
  const message = data?.error?.message ?? data?.error ?? data?.message;
  if (typeof message === "string" && message.trim()) return message;
  return `The request was refused (HTTP ${status})`;
}

/**
 * Apply an approved action.
 *
 * Never throws: a failed apply is a *state* the screen has to show, with the route's own reason, so
 * the caller writes `failed` and moves on rather than turning an error into a 500 nobody can read.
 */
export async function applyAiAction(opts: {
  db: ApplyDb;
  action: ApplyAction;
  /** Who is applying it — the person who approved, or the connection in `act` mode. */
  actorId: string;
  /** Whether a person was asked. Recorded, never inferred. */
  mode?: "ask" | "act";
}): Promise<ApplyOutcome> {
  const { db, action } = opts;

  if (action.status !== "pending") {
    return { ok: false, status: "failed", error: "That action has already been decided" };
  }
  if (action.riskTier === "critical") {
    return { ok: false, status: "failed", error: "Critical actions are never carried out by a model" };
  }

  const payload = (action.payload ?? {}) as Record<string, unknown>;
  const handler = HANDLERS[str(payload.kind)];
  if (!handler) {
    return {
      ok: false,
      status: "failed",
      error: `This build cannot carry out a "${str(payload.kind) || "unknown"}" proposal (it knows: ${payloadKinds().join(", ")})`,
    };
  }

  const requesterId = action.requestedById || opts.actorId;
  const user = await db.user.findUnique({
    where: { id: requesterId },
    select: {
      id: true, email: true, tokenVersion: true, companyId: true, isActive: true,
      permissions: true,
      role: { select: { systemRole: true, permissions: true } },
    },
  });
  if (!user) return { ok: false, status: "failed", error: "The person who raised this no longer exists" };
  if (!user.isActive) return { ok: false, status: "failed", error: "The person who raised this is no longer active" };

  let before: Record<string, unknown> | undefined;
  try {
    before = await handler.before?.(payload, db);
  } catch { /* a preview that cannot be read must not stop the action */ }

  const token = actorToken({
    id: user.id,
    email: user.email,
    tokenVersion: user.tokenVersion,
    companyId: user.companyId,
    permissions: user.permissions as string[],
    rolePermissions: user.role.permissions as string[],
    role: { systemRole: user.role.systemRole },
  });

  try {
    const result = await handler.apply(payload, {
      db,
      api: (path, method, body) => callApi(token, path, method, body).then(call => {
        if (call.status >= 400) throw new Error(errorText(call.status, call.data));
        return call;
      }),
    });
    return { ok: true, status: "executed", result, before };
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      before,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

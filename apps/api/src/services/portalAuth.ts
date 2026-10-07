/**
 * Customer portal sessions (PLAN-013 #3).
 *
 * A portal visitor is a **Contact**, not a User: they hold no permissions, they see only
 * their own tickets, and the token they carry must never be accepted on a staff route.
 * So the portal gets its own table, its own cookie and its own CSRF token rather than a
 * `UserSession` row with a null user — the two audiences cannot be confused by accident.
 *
 * Sign-in is an emailed one-time code. The plan left the choice between that and an
 * SSO-lite flow open; the code wins because SSO needs an identity provider registration
 * that does not exist yet, whereas a code needs only the SMTP path the product already
 * uses for ticket notifications and MFA.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "../index";
import { logger } from "./logger";
import { configFlag, configNumber } from "./appSettings";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

export const PORTAL_COOKIE = "c7_portal";
export const PORTAL_CSRF_COOKIE = "c7_portal_csrf";
export const PORTAL_CSRF_HEADER = "x-portal-csrf";

/**
 * The portal's limits are configuration, not constants. Each was a plausible default when the
 * portal shipped and each is a judgement call a provider has to be able to make for itself —
 * how long a code lives, how many guesses it tolerates, how long a customer stays signed in.
 * They are read per call, so a change in Administration → Customer Portal takes effect on the
 * next sign-in rather than at the next restart.
 */
const codeTtlMs = (): number => Math.max(1, configNumber("portal", "codeExpiryMinutes", 10)) * MINUTE_MS;
const codeMaxAttempts = (): number => Math.max(1, configNumber("portal", "maxVerifyAttempts", 5));
/** At most this many codes per contact per window, so the endpoint cannot be used as a mail relay. */
const codeMaxPerWindow = (): number => Math.max(1, configNumber("portal", "codesPerWindow", 3));
const codeWindowMs = (): number => Math.max(1, configNumber("portal", "codeWindowMinutes", 15)) * MINUTE_MS;
/** A customer session is not an all-day credential. */
const sessionTtlMs = (): number => Math.max(1, configNumber("portal", "sessionHours", 8)) * HOUR_MS;
/** Devices a customer may keep signed in at once, oldest retired first. */
const maxActiveSessions = (): number => Math.max(1, configNumber("portal", "maxDevices", 5));

/** The portal is off unless a setting or the environment turns it on. */
export const portalEnabled = (): boolean => configFlag("portal", "enabled");
const isProduction = (): boolean => process.env.NODE_ENV === "production";

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

export interface PortalPrincipal {
  contactId: string;
  companyId: string;
  email: string;
  firstName: string;
  lastName: string;
  sessionId: string;
  csrfToken: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      portalContact?: PortalPrincipal;
    }
  }
}

/**
 * Whether a contact may use the portal at all: they must be an active contact of an active
 * client with the portal switched on. Anything less and no code is sent — and the caller
 * still answers with the same 202, so this cannot be used to enumerate customers.
 */
export async function portalEligibleContact(email: string) {
  const contact = await prisma.contact.findFirst({
    where: { email: { equals: email.trim(), mode: "insensitive" }, isActive: true },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      companyId: true,
      company: { select: { id: true, name: true, isActive: true, portalEnabled: true, portalAccentColor: true, portalLogoUrl: true } },
    },
  });
  if (!contact || !contact.company?.isActive || !contact.company.portalEnabled) return null;
  return contact;
}

export type PortalContact = NonNullable<Awaited<ReturnType<typeof portalEligibleContact>>>;

/**
 * Issues a one-time code for a contact, refusing (silently, to the caller) when the contact
 * has asked for too many recently. Returns the plain code to email, or null.
 */
export async function issueLoginCode(contactId: string): Promise<string | null> {
  const recent = await prisma.portalLoginCode.count({
    where: { contactId, createdAt: { gte: new Date(Date.now() - codeWindowMs()) } },
  });
  if (recent >= codeMaxPerWindow()) {
    logger.warn("portal.code", "Sign-in code request refused: too many recent codes", { contactId, recent });
    return null;
  }
  // Any older unused code dies with the new one: two live codes for one account is one too many.
  await prisma.portalLoginCode.updateMany({
    where: { contactId, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await prisma.portalLoginCode.create({
    data: { contactId, codeHash: hash(code), expiresAt: new Date(Date.now() + codeTtlMs()) },
  });
  return code;
}

export type CodeCheck = "ok" | "invalid" | "expired" | "too-many-attempts";

/**
 * Checks a code and, on success, spends it. Attempts are counted against the code itself so a
 * guesser burns their own budget; a consumed or expired code can never be replayed.
 */
export async function consumeLoginCode(contactId: string, code: string): Promise<CodeCheck> {
  const row = await prisma.portalLoginCode.findFirst({
    where: { contactId, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return "invalid";
  if (row.expiresAt.getTime() < Date.now()) return "expired";
  if (row.attempts >= codeMaxAttempts()) return "too-many-attempts";

  const candidate = Buffer.from(hash(code.trim()));
  const expected = Buffer.from(row.codeHash);
  const match = candidate.length === expected.length && timingSafeEqual(candidate, expected);
  if (!match) {
    await prisma.portalLoginCode.update({ where: { id: row.id }, data: { attempts: row.attempts + 1 } });
    return "invalid";
  }
  await prisma.portalLoginCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
  return "ok";
}

export interface CreatedPortalSession {
  sessionToken: string;
  csrfToken: string;
  expiresAt: Date;
}

export async function createPortalSession(contactId: string, req: Request): Promise<CreatedPortalSession> {
  const sessionToken = randomBytes(32).toString("hex");
  const csrfToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + sessionTtlMs());

  // Cap concurrent devices rather than allowing one, which would sign a customer out of their
  // phone every time they used their laptop.
  const live = await prisma.portalSession.findMany({
    where: { contactId, invalidatedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const excess = live.length - (maxActiveSessions() - 1);
  if (excess > 0) {
    await prisma.portalSession.updateMany({
      where: { id: { in: live.slice(0, excess).map(s => s.id) } },
      data: { invalidatedAt: new Date() },
    });
  }

  await prisma.portalSession.create({
    data: {
      sessionToken: hash(sessionToken),
      csrfToken,
      contactId,
      ipAddress: req.ip ?? null,
      userAgent: (req.headers["user-agent"] as string | undefined)?.slice(0, 300) ?? null,
      lastActivityAt: new Date(),
      expiresAt,
    },
  });

  logger.info("portal.session", `portal session opened for contact ${contactId} from ${req.ip ?? "unknown"}`);
  return { sessionToken, csrfToken, expiresAt };
}

export function setPortalCookies(res: Response, session: CreatedPortalSession): void {
  const maxAge = Math.max(1000, session.expiresAt.getTime() - Date.now());
  const base = { httpOnly: true, secure: isProduction(), sameSite: "strict" as const, path: "/" };
  res.cookie(PORTAL_COOKIE, session.sessionToken, { ...base, maxAge });
  // Readable by the portal page on purpose: the double-submit check compares it with the header.
  res.cookie(PORTAL_CSRF_COOKIE, session.csrfToken, { ...base, httpOnly: false, maxAge });
}

export function clearPortalCookies(res: Response): void {
  for (const name of [PORTAL_COOKIE, PORTAL_CSRF_COOKIE]) {
    res.clearCookie(name, { httpOnly: name === PORTAL_COOKIE, secure: isProduction(), sameSite: "strict", path: "/" });
  }
}

/** The cookie, else a bearer token — the same two paths a staff session accepts. */
export function readPortalToken(req: Request): string | undefined {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  const fromCookie = cookies?.[PORTAL_COOKIE];
  if (fromCookie) return fromCookie;
  const header = req.headers.cookie;
  if (header) {
    for (const part of header.split(";")) {
      const [name, ...rest] = part.trim().split("=");
      if (name === PORTAL_COOKIE) return decodeURIComponent(rest.join("="));
    }
  }
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim() || undefined;
  return undefined;
}

/**
 * Resolves the token to a live session and the contact behind it, refusing when the contact,
 * their client, or the portal itself has since been switched off — a session must not outlive
 * the access it was granted for.
 */
export async function resolvePortalSession(req: Request): Promise<PortalPrincipal | null> {
  const token = readPortalToken(req);
  if (!token) return null;
  const session = await prisma.portalSession.findUnique({
    where: { sessionToken: hash(token) },
    include: {
      contact: {
        select: {
          id: true, email: true, firstName: true, lastName: true, isActive: true, companyId: true,
          company: { select: { isActive: true, portalEnabled: true } },
        },
      },
    },
  });
  if (!session || session.invalidatedAt || session.expiresAt.getTime() < Date.now()) return null;
  if (!session.contact.isActive || !session.contact.company.isActive || !session.contact.company.portalEnabled) return null;

  // Sliding activity, but never past the absolute expiry the session was created with.
  await prisma.portalSession.update({ where: { id: session.id }, data: { lastActivityAt: new Date() } });

  return {
    contactId: session.contact.id,
    companyId: session.contact.companyId,
    email: session.contact.email,
    firstName: session.contact.firstName,
    lastName: session.contact.lastName,
    sessionId: session.id,
    csrfToken: session.csrfToken,
  };
}

/**
 * Double-submit CSRF check, in constant time, for the portal's own cookie-authenticated writes.
 * A bearer token is immune by construction — nothing else attaches it to a request.
 */
export function portalCsrfValid(req: Request, expected: string): boolean {
  const header = req.headers[PORTAL_CSRF_HEADER];
  if (typeof header !== "string" || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function invalidatePortalSessionsForContact(contactId: string): Promise<number> {
  const result = await prisma.portalSession.updateMany({
    where: { contactId, invalidatedAt: null },
    data: { invalidatedAt: new Date() },
  });
  return result.count;
}

/**
 * Gate for the read routes: a live session, or 401 with a reason the portal page can show.
 * Writes use `requirePortalWrite` so the CSRF token is always part of the check.
 */
export async function requirePortalSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const principal = await resolvePortalSession(req);
  if (!principal) {
    res.status(401).json({ error: "Please sign in to the portal again", code: "PORTAL_SESSION_INVALID" });
    return;
  }
  req.portalContact = principal;
  next();
}

export async function requirePortalWrite(req: Request, res: Response, next: NextFunction): Promise<void> {
  const principal = await resolvePortalSession(req);
  if (!principal) {
    res.status(401).json({ error: "Please sign in to the portal again", code: "PORTAL_SESSION_INVALID" });
    return;
  }
  // A cookie-authenticated write with no matching CSRF header is a cross-site request.
  const cookieAuth = typeof req.headers.authorization !== "string" || !req.headers.authorization.startsWith("Bearer ");
  if (cookieAuth && !portalCsrfValid(req, principal.csrfToken)) {
    res.status(403).json({ error: "Your portal session could not be verified — reload the page and try again" });
    return;
  }
  req.portalContact = principal;
  next();
}

/**
 * Session Authentication (PLAN-001)
 *
 * Browser clients get a server-side session: a random token in an HttpOnly cookie, with
 * only its SHA-256 hash stored, so a database leak cannot be replayed. The session slides
 * on activity and expires after an idle period that administrators are exempt from, which
 * is the behaviour Autotask, ConnectWise and HaloPSA all ship (see PLAN-001 §5.2).
 *
 * Two things this deliberately does NOT change:
 *   · Non-browser clients (desktop app, Outlook add-in, probes, integrations) still
 *     authenticate with `Authorization: Bearer`. They cannot hold a cookie, and the route
 *     stack is untouched — `authenticate` in middleware/auth.ts consults the session first
 *     and falls back to the token.
 *   · The shape of `req.user`. The session path resolves the same identity, through the
 *     same permission-refresh code as the token path, so every route's guards behave
 *     identically whichever way the caller signed in.
 *
 * Cookies are sent automatically by the browser, so any state-changing request that is
 * authenticated by cookie must also carry the CSRF token header; a header is not sent
 * automatically by a cross-site request, which is what makes the check meaningful.
 */
import type { Request, Response } from "express";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "../index";
import { isBypassAccount } from "../services/testBypass";
import { logger } from "../services/logger";
import { configFlag, configNumber } from "../services/appSettings";

export const SESSION_COOKIE = "c7_sid";
export const CSRF_COOKIE = "c7_csrf";
export const CSRF_HEADER = "x-csrf-token";

/** Admin and Super Admin sessions never expire from inactivity unless the setting turns that off. */
const DEFAULT_TIMEOUT_MINUTES = 30;
/** Longest a session may live without any activity check at all. */
const MAX_SESSION_HOURS = 12;

/**
 * Whether this account is excused from the inactivity timeout. Callers that tell the browser
 * about the timeout use this too, so an exempt session never shows a warning that will not fire.
 *
 * The authentication test-bypass account is always excused: it exists precisely to get into a
 * deployment that has just enforced authentication, so it cannot depend on a setting that an
 * ordinary administrator can turn off.
 */
export function idleTimeoutExempt(systemRole: string | null | undefined, email: string): boolean {
  if (isBypassAccount(email)) return true;
  if (!configFlag("sessions", "exemptAdministrators")) return false;
  return systemRole === "admin" || systemRole === "super_admin";
}

export const sessionAuthEnabled = (): boolean => configFlag("sessions", "sessionAuth");
const isProduction = (): boolean => process.env.NODE_ENV === "production";

const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

/**
 * Idle timeout in milliseconds, from the `sessions.sessionTimeout` setting — the stored
 * `session_timeout` row, which is what Administration → Configuration writes. Values outside
 * the permitted range are refused at write time, so a read only ever needs the default.
 */
export function getSessionTimeoutMs(): number {
  const minutes = configNumber("sessions", "sessionTimeout", DEFAULT_TIMEOUT_MINUTES);
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 480) return DEFAULT_TIMEOUT_MINUTES * 60 * 1000;
  return minutes * 60 * 1000;
}

/** The hard ceiling on a session's life, from configuration. */
function maxSessionMs(): number {
  const hours = configNumber("sessions", "maxSessionHours", MAX_SESSION_HOURS);
  const safe = Number.isFinite(hours) && hours >= 1 ? hours : MAX_SESSION_HOURS;
  return safe * 3600 * 1000;
}

export interface CreatedSession {
  sessionToken: string;
  csrfToken: string;
  expiresAt: Date;
}

/**
 * Creates a session for a user and invalidates their previous ones. One live session per
 * account is the ConnectWise behaviour (PLAN-001 §2.2 step 4): a new sign-in retires the
 * old one instead of leaving it to expire.
 */
export async function createSession(user: { id: string; email: string }, req: Request): Promise<CreatedSession> {
  const sessionToken = randomBytes(32).toString("hex");
  const csrfToken = randomBytes(32).toString("hex");
  const timeoutMs = getSessionTimeoutMs();
  const expiresAt = new Date(Date.now() + Math.min(timeoutMs * 4, maxSessionMs()));

  await prisma.userSession.updateMany({
    where: { userId: user.id, invalidatedAt: null },
    data: { invalidatedAt: new Date() },
  });

  await prisma.userSession.create({
    data: {
      sessionToken: hashToken(sessionToken),
      csrfToken,
      userId: user.id,
      ipAddress: req.ip ?? null,
      userAgent: (req.headers["user-agent"] as string | undefined)?.slice(0, 300) ?? null,
      lastActivityAt: new Date(),
      expiresAt,
    },
  });

  logger.info("session", `session opened for ${user.email} from ${req.ip ?? "unknown"}`);
  return { sessionToken, csrfToken, expiresAt };
}

export function setSessionCookies(res: Response, session: CreatedSession): void {
  const maxAge = Math.max(1000, session.expiresAt.getTime() - Date.now());
  const base = { httpOnly: true, secure: isProduction(), sameSite: "strict" as const, path: "/" };
  res.cookie(SESSION_COOKIE, session.sessionToken, { ...base, maxAge });
  // Readable by the SPA on purpose: the double-submit check compares it with the header.
  res.cookie(CSRF_COOKIE, session.csrfToken, { ...base, httpOnly: false, maxAge });
}

export function clearSessionCookies(res: Response): void {
  for (const name of [SESSION_COOKIE, CSRF_COOKIE]) {
    res.clearCookie(name, { httpOnly: name === SESSION_COOKIE, secure: isProduction(), sameSite: "strict", path: "/" });
  }
}

export function readSessionToken(req: Request): string | undefined {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  const fromParser = cookies?.[SESSION_COOKIE];
  if (fromParser) return fromParser;
  // Minimal fallback parser, so the session path still works if cookie-parser is not
  // mounted (for example a harness importing this module directly).
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export interface ResolvedSession {
  userId: string;
  email: string;
  sessionId: string;
  csrfToken: string;
  lastActivityAt: Date;
  /** True when this account is excused from the inactivity timeout. */
  idleTimeoutExempt: boolean;
}

/**
 * Resolves the cookie to a live session, applying absolute expiry and the inactivity
 * timeout. The status tells the caller what to answer; `none` means "no cookie at all",
 * which is not an error — the caller falls back to the bearer token.
 */
export async function resolveSession(req: Request): Promise<
  { status: "ok"; session: ResolvedSession } | { status: "none" | "invalid" | "expired" | "timeout" }
> {
  const token = readSessionToken(req);
  if (!token) return { status: "none" };

  const record = await prisma.userSession.findUnique({ where: { sessionToken: hashToken(token) } });
  if (!record || record.invalidatedAt) return { status: "invalid" };

  const user = await prisma.user.findUnique({
    where: { id: record.userId },
    select: { id: true, email: true, isActive: true, role: { select: { systemRole: true } } },
  });
  // A session for a deleted account is not a session.
  if (!user) return { status: "invalid" };

  if (record.expiresAt.getTime() <= Date.now()) return { status: "expired" };

  const exempt = idleTimeoutExempt(user.role?.systemRole, user.email);

  if (!exempt) {
    const timeoutMs = getSessionTimeoutMs();
    if (Date.now() - record.lastActivityAt.getTime() > timeoutMs) {
      await prisma.userSession.update({ where: { id: record.id }, data: { invalidatedAt: new Date() } });
      logger.info("session", `session for ${user.email} timed out after ${Math.round(timeoutMs / 60000)} minutes idle`);
      return { status: "timeout" };
    }
  }

  return {
    status: "ok",
    session: {
      userId: user.id,
      email: user.email,
      sessionId: record.id,
      csrfToken: record.csrfToken,
      lastActivityAt: record.lastActivityAt,
      idleTimeoutExempt: exempt,
    },
  };
}

/** Sliding expiry: any authenticated request counts as activity. */
export async function touchSession(sessionId: string): Promise<void> {
  await prisma.userSession.update({ where: { id: sessionId }, data: { lastActivityAt: new Date() } });
}

export async function invalidateSessionsForUser(userId: string): Promise<number> {
  const result = await prisma.userSession.updateMany({ where: { userId, invalidatedAt: null }, data: { invalidatedAt: new Date() } });
  return result.count;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Double-submit CSRF check for cookie-authenticated writes, compared in constant time.
 * Safe methods are skipped: a GET must not change state, so there is nothing to forge.
 */
export function csrfTokenValid(req: Request, expected: string): boolean {
  if (SAFE_METHODS.has(req.method)) return true;
  const supplied = req.headers[CSRF_HEADER];
  if (typeof supplied !== "string" || supplied.length === 0) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Response for a session that no longer exists: the SPA turns this into a sign-in prompt. */
export function sessionExpiredResponse(res: Response, status: "invalid" | "expired" | "timeout"): void {
  clearSessionCookies(res);
  if (status === "timeout") {
    res.status(440).json({ error: "Session expired due to inactivity", code: "SESSION_TIMEOUT" });
    return;
  }
  res.status(401).json({ error: "Session expired", code: "SESSION_EXPIRED" });
}

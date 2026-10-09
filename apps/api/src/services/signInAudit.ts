/**
 * The sign-in audit: one row per attempt, written by every way into the application.
 *
 * This is Entra's sign-in log in miniature, and the reason it exists is the question it answers that
 * nothing else does — *"did anybody try to get in, and did they?"* The audit middleware cannot help:
 * it skips `/api/auth/` on purpose (it would otherwise record a password change as a write), the
 * per-account counter on `User` only knows about the account it belongs to, and the server log knows
 * only what happened while somebody was watching it.
 *
 * Two decisions worth stating:
 *
 * - **Every write here is best-effort.** A sign-in must never fail because its audit row could not be
 *   written — that would turn a database hiccup into "nobody can sign in" — so failures are logged and
 *   swallowed. The trade is deliberate: an audit trail that can lock people out is worse than one with
 *   a gap in it, and the gap is reported.
 * - **The address typed is stored, not just the account it matched.** An attempt against an address
 *   that is not an account is exactly the row an investigation wants, so `userId` is nullable and the
 *   typed address is kept either way.
 */
import type { Request } from "express";
import { prisma } from "../index";
import { logger } from "./logger";

/** How an attempt ended. `signed_out` is here because "the session ended" belongs beside "it began". */
export type SignInResult = "success" | "failure" | "locked" | "mfa_failed" | "code_failed" | "signed_out";

/** How somebody proved who they were. The method is what distinguishes a passkey from a password. */
export type SignInMethod = "password" | "totp" | "email_code" | "passkey" | "sso" | "portal_code";

/**
 * A user agent, named the way a person would say it: "Chrome on Windows".
 *
 * Deliberately crude — no user-agent database, no version numbers. The screen is answering "was this
 * them, on a machine we recognise?" and "Chrome on Windows" answers it; a parser with a dependency
 * would answer it no better and would need updating every month. An agent it cannot read returns null
 * rather than a guess, because "unknown" is a truthful answer and "Firefox on Windows" for an
 * unrecognised string is not.
 */
export function describeDevice(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  const ua = userAgent;

  const browser =
    /Edg\//.test(ua) ? "Edge"
    : /OPR\/|Opera/.test(ua) ? "Opera"
    : /Chrome\//.test(ua) && !/Chromium/.test(ua) ? "Chrome"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Safari\//.test(ua) && !/Chrome/.test(ua) && !/Chromium/.test(ua) ? "Safari"
    : /Electron\//.test(ua) ? "Desktop app"
    : /okhttp|axios|node-fetch|curl|python|postman|insomnia/i.test(ua) ? "API client"
    : null;

  const platform =
    /Windows NT/.test(ua) ? "Windows"
    : /iPhone|iPad|iPod/.test(ua) ? "iOS"
    : /Android/.test(ua) ? "Android"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS"
    : /CrOS/.test(ua) ? "ChromeOS"
    : /Linux/.test(ua) ? "Linux"
    : null;

  if (browser && platform) return `${browser} on ${platform}`;
  return browser ?? platform ?? null;
}

/** The address the request arrived from, in the same terms the session row records it. */
export function requestIp(req: Request): string | null {
  return (req.ip || req.socket?.remoteAddress) ?? null;
}

export interface SignInAttempt {
  /** The address that was typed. Required: a row without it says nothing. */
  email: string;
  result: SignInResult;
  method: SignInMethod;
  /** The account, when one was matched. Null for an attempt at an address that is not an account. */
  userId?: string | null;
  reason?: string | null;
  /** The session this attempt opened, when it opened one. */
  sessionId?: string | null;
}

/**
 * Records an attempt. Never throws, never blocks the caller's answer: the result of a sign-in must not
 * depend on the audit trail's availability.
 */
export async function recordSignIn(req: Request, attempt: SignInAttempt): Promise<void> {
  try {
    const userAgent = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null;
    await prisma.signInEvent.create({
      data: {
        userId: attempt.userId ?? null,
        email: String(attempt.email ?? "").trim().toLowerCase().slice(0, 320),
        result: attempt.result,
        method: attempt.method,
        reason: attempt.reason ? String(attempt.reason).slice(0, 300) : null,
        ipAddress: requestIp(req),
        userAgent: userAgent?.slice(0, 500) ?? null,
        device: describeDevice(userAgent),
        sessionId: attempt.sessionId ?? null,
      },
    });
  } catch (error) {
    logger.warn("signin.audit", "Could not record a sign-in attempt — the audit trail has a gap", {
      email: attempt.email,
      result: attempt.result,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * The session a sign-in just opened, so the event can name it.
 *
 * The session row is created inside `startSession`, which does not return it — the caller only gets
 * the token. Rather than reshape that shared helper for the audit's benefit, the newest live session
 * for the user is read back: a sign-in happens once, in one request, and the row it just wrote is the
 * newest one.
 */
export async function newestSessionId(userId: string): Promise<string | null> {
  try {
    const row = await prisma.userSession.findFirst({
      where: { userId, invalidatedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    return row?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * "Remember this browser" — the one place a second factor may be skipped.
 *
 * A person who has proved a second factor on a machine they own should not be asked again every
 * morning, and the whole point of a second factor is that a *stolen password* is not enough. A
 * remembered browser does not weaken that: the cookie is bound to the account **and to the enrolment
 * that proved it**, so it is worthless without having already proved a factor on that machine.
 *
 * The binding is `User.mfaEnrolledAt`, carried in the token and compared at sign-in. That is what
 * makes an administrator's reset revoke trust: clearing an account's MFA clears the date, so every
 * cookie minted before the reset stops matching and the next sign-in on that browser asks again.
 * There is no table to keep in step, no counter to bump, and no way for the two to disagree —
 * the enrolment *is* the version.
 *
 * `mfa.rememberBrowser` set to zero turns the whole thing off, and the cookie is not issued at all
 * in that case rather than being issued with a zero lifetime.
 */
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../middleware/auth";
import { mfaRememberDays } from "./mfaPolicy";

const TRUST_COOKIE = "c7_mfa_trust";

/** What the cookie carries. `v` is the enrolment's timestamp, which is the revocation version. */
interface TrustPayload {
  userId: string;
  v: number;
  remember: true;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Read the cookie, tolerating a deployment without cookie-parser — the same fallback sessionAuth uses. */
function readTrustCookie(req: Request): string | undefined {
  const fromParser = (req as Request & { cookies?: Record<string, string> }).cookies?.[TRUST_COOKIE];
  if (fromParser) return fromParser;
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === TRUST_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

/**
 * Whether this browser may skip the second factor for this account.
 *
 * Fails closed on every axis: no enrolment date means no trust to grant, a token that does not verify
 * is not trust, and a token minted before the current enrolment is not trust. A signature check
 * failure is silent rather than an error, because the only correct response is to ask for the code.
 */
export function browserIsTrusted(req: Request, account: { id: string; mfaEnrolledAt: Date | null }): boolean {
  if (mfaRememberDays() <= 0) return false;
  const raw = readTrustCookie(req);
  if (!raw || !account.mfaEnrolledAt) return false;
  try {
    const payload = jwt.verify(raw, JWT_SECRET) as TrustPayload;
    if (!payload?.remember) return false;
    if (payload.userId !== account.id) return false;
    return payload.v === account.mfaEnrolledAt.getTime();
  } catch {
    return false;
  }
}

/**
 * Issue or renew the cookie after a second factor has just been proved.
 *
 * Renewed on each successful proof rather than only issued once, so somebody who signs in from the
 * same machine every day is never asked again, and somebody who returns after the window has closed
 * gets a fresh one by proving a factor once more.
 */
export function rememberBrowser(res: Response, account: { id: string; mfaEnrolledAt: Date | null }): void {
  const days = mfaRememberDays();
  if (days <= 0 || !account.mfaEnrolledAt) return;
  const maxAge = days * 24 * 60 * 60 * 1000;
  const token = jwt.sign(
    { userId: account.id, v: account.mfaEnrolledAt.getTime(), remember: true } satisfies TrustPayload,
    JWT_SECRET,
    { expiresIn: `${days}d` },
  );
  res.cookie(TRUST_COOKIE, token, { httpOnly: true, secure: isProduction(), sameSite: "strict", path: "/", maxAge });
}

/**
 * There is deliberately no `forgetBrowser`.
 *
 * Signing out does **not** revoke the trust, and that is the feature rather than an omission: the
 * point of remembering a browser is that the next sign-in on this machine is not asked again, so a
 * sign-out that revoked it would make the setting do nothing at all. Revocation happens where it
 * means something — an administrator resetting the account clears the enrolment date the cookie is
 * bound to, and every cookie minted before that stops matching on the next sign-in.
 */

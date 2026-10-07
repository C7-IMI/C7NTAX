/**
 * Sign-in plumbing shared by every way into the application (PLAN-001).
 *
 * There are four: the password form, the MFA step, a passkey, and the OIDC exchange. All
 * of them must end the same way — a session for browser clients, a token for the clients
 * that cannot hold a cookie (desktop app, Outlook add-in, integrations, probes) — so the
 * sequence lives here instead of being copied into each route.
 */
import type { Request, Response } from "express";
import { signToken, type SignTokenPayload } from "../middleware/auth";
import { createSession, invalidateSessionsForUser, sessionAuthEnabled, setSessionCookies } from "../middleware/sessionAuth";

export interface SignInUser {
  id: string;
  email: string;
  tokenVersion?: number;
}

/**
 * Issues the token, opens a session and sets the cookies. Returns the token so the caller
 * can put it in the response body: the browser will use the cookie, everything else uses
 * the token.
 */
export async function startSession(req: Request, res: Response, payload: SignTokenPayload): Promise<string> {
  const token = signToken(payload);
  if (sessionAuthEnabled()) {
    const session = await createSession({ id: payload.id, email: payload.email }, req);
    setSessionCookies(res, session);
  }
  return token;
}

/** Ends every live session for a user — used when a password changes or an account is disabled. */
export async function endSessionsForUser(userId: string): Promise<number> {
  if (!sessionAuthEnabled()) return 0;
  return invalidateSessionsForUser(userId);
}

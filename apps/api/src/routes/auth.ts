import { Router } from "express";
import bcrypt from "bcryptjs";
import speakeasy from "speakeasy";
import QRCode from "qrcode";
import { randomInt, timingSafeEqual } from "node:crypto";
import { prisma } from "../index";
import { authenticate, signToken, signMfaToken, JWT_SECRET, effectivePermissions, PERMISSION_SUBJECT_INCLUDE, type AuthRequest } from "../middleware/auth";
import { ROLE_PERMISSIONS, SystemRole, Permission, validatePassword, LANDING_PAGES, resolveLandingPagePath } from "@C7NTAX/shared";
import jwt from "jsonwebtoken";
import { EmailService } from "@C7NTAX/email";
import { rateLimiter, isLoopback } from "../middleware/rateLimiter";
import { isBypassAccount, isBypassLoginAttempt, logBypassSignIn } from "../services/testBypass";
import { startSession, endSessionsForUser } from "../services/signIn";
import { newestSessionId, recordSignIn } from "../services/signInAudit";
import {
  clearSessionCookies,
  getSessionTimeoutMs,
  invalidateSessionsForUser,
  resolveSession,
  sessionAuthEnabled,
  touchSession,
} from "../middleware/sessionAuth";

export const authRouter = Router();
const emailService = new EmailService();

/**
 * SOC 2 hardening: enforce the failed-attempt lockout the Security tab already
 * advertises. Off by default so behaviour only changes where hardening is on.
 */
const LOCKOUT_ENABLED = process.env.AUTH_HARDENING_ENABLED === "true";
const MAX_LOGIN_ATTEMPTS = 5;

/**
 * bcrypt cost the hardening pass writes, and the prefix test that recognises it.
 *
 * `bcryptjs` writes `$2a$12$` while native bcrypt writes `$2b$12$`, so testing for one variant
 * made every `$2a$12$` hash look stale: the account was re-hashed on **every** sign-in — a wasted
 * 300 ms and a password row written on the hot path. Match the cost and the algorithm, not the
 * vendor's letter. (`$2y$` is bcrypt's other spelling of the same thing.)
 */
const HARDENED_COST = 12;
const HARDENED_HASH_PATTERN = /^\$2[aby]\$12\$/;
const hashNeedsUpgrading = (hash: string): boolean => !HARDENED_HASH_PATTERN.test(hash);

/**
 * Brute-force limit for the credential endpoints. Deliberately generous: it is a
 * floor against hammering, not the primary control (per-account lockout is, and
 * that is off unless AUTH_HARDENING_ENABLED is set). Office NAT, the boot script's
 * health login and test scripts all share one IP bucket.
 */
const credentialLimiter = rateLimiter(300, 15 * 60 * 1000, (req) => {
  // Testing bypass: the exempt account is not limited, but only from this machine
  // (see isBypassLoginAttempt) or on requests it has already authenticated.
  const authed = (req as AuthRequest).user?.email;
  if (isBypassAccount(authed) || isBypassLoginAttempt(req.body?.email ?? req.body?.username, req.ip ?? req.socket.remoteAddress)) return true;
  // Development loopback is not limited either: test harnesses sign in dozens of times
  // from 127.0.0.1 and were tripping the bucket mid-suite. Production is untouched.
  return process.env.NODE_ENV !== "production" && isLoopback(req);
});

/** Constant-time comparison for short one-time codes. */
function codesMatch(a: string, b: string): boolean {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Where this sign-in should land.
 *
 * The person's own choice wins, then the instance default an administrator set in
 * Administration → Configuration → Workspace, then the dashboard. The personal choice lives on
 * the user record because it is not a fact about the deployment — before this existed the
 * personal screen wrote the instance-wide key, so one person's preference silently became
 * everyone's.
 *
 * `resolveLandingPagePath` applies the aliases for pages that have been renamed, which is what stops
 * a stored `/cloudconnect` from quietly falling back to the Dashboard now that the page is `/c7nc`.
 */
async function resolveLandingPage(user: { landingPage?: string | null }): Promise<{ path: string; label: string }> {
  const stored = resolveLandingPagePath(user.landingPage);
  if (stored) {
    const chosen = LANDING_PAGES.find(p => p.path === stored);
    if (chosen) return { path: chosen.path, label: chosen.label };
  }
  const config = await prisma.systemConfig.findUnique({ where: { key: "default_landing_page" } });
  if (config) {
    try {
      const parsed = JSON.parse(config.value as string) as { path?: string; label?: string };
      const configured = resolveLandingPagePath(parsed?.path);
      if (configured) {
        const chosen = LANDING_PAGES.find(p => p.path === configured);
        return { path: configured, label: chosen?.label || parsed.label || configured };
      }
    } catch { /* an unreadable default is not worth failing a sign-in over */ }
  }
  return { path: "/", label: "Today" };
}

// ── POST /api/auth/login ────────────────────────────────────────────
authRouter.post("/login", credentialLimiter, async (req, res, next) => {
  try {
    const { email, username, password } = req.body;
    if ((!email && !username) || !password) {
      res.status(400).json({ error: "Email/username and password required" });
      return;
    }

    // Allow login by email OR username — include role relation. The company comes with the role because
    // the effective set below cannot apply the client's console switch without it.
    const user = email
      ? await prisma.user.findUnique({ where: { email }, include: { ...PERMISSION_SUBJECT_INCLUDE } })
      : await prisma.user.findUnique({ where: { username }, include: { ...PERMISSION_SUBJECT_INCLUDE } });
    if (!user || !user.isActive) {
      // The row is written even though no account matched: an attempt at an address that is not a user
      // is exactly the row an investigation is looking for.
      await recordSignIn(req, {
        email: String(email || username || ""),
        result: "failure",
        method: "password",
        reason: user ? "The account is not active" : "No such account",
      });
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const bypass = isBypassAccount(user.email);

    if (LOCKOUT_ENABLED && user.isLocked && !bypass) {
      await recordSignIn(req, {
        email: user.email,
        userId: user.id,
        result: "locked",
        method: "password",
        reason: `Account locked after ${MAX_LOGIN_ATTEMPTS} failed attempts`,
      });
      res.status(423).json({ error: "Account locked after too many failed sign-in attempts — ask an administrator to unlock it" });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      let lockedNow = false;
      if (LOCKOUT_ENABLED && !bypass) {
        const attempts = user.loginAttempts + 1;
        lockedNow = attempts >= MAX_LOGIN_ATTEMPTS;
        await prisma.user.update({
          where: { id: user.id },
          data: { loginAttempts: attempts, ...(attempts >= MAX_LOGIN_ATTEMPTS ? { isLocked: true } : {}) },
        });
      }
      await recordSignIn(req, {
        email: user.email,
        userId: user.id,
        result: lockedNow ? "locked" : "failure",
        method: "password",
        // The count is what makes a pattern visible: four attempts is somebody mistyping, forty is not.
        reason: lockedNow
          ? `Account locked after ${MAX_LOGIN_ATTEMPTS} failed attempts`
          : `Wrong password (attempt ${(bypass || !LOCKOUT_ENABLED ? 0 : user.loginAttempts) + 1} of ${MAX_LOGIN_ATTEMPTS})`,
      });
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    // A successful sign-in clears the counter — and for the exempt account also any
    // lock or residue left behind by an earlier run, whatever the lockout setting is,
    // so a testing session can neither be blocked by one nor leave a stale locked row
    // behind in the UI.
    if (bypass ? (user.loginAttempts > 0 || user.isLocked) : (LOCKOUT_ENABLED && user.loginAttempts > 0)) {
      await prisma.user.update({ where: { id: user.id }, data: { loginAttempts: 0, isLocked: false } });
    }
    if (bypass) logBypassSignIn(user.email);

    // SOC 2 hardening (backlog item 11): rehash-on-login when enabled and the hash is below cost 12.
    if (process.env.AUTH_HARDENING_ENABLED === "true" && hashNeedsUpgrading(user.passwordHash)) {
      const upgraded = await bcrypt.hash(password, HARDENED_COST);
      await prisma.user.update({ where: { id: user.id }, data: { passwordHash: upgraded } });
    }

    // If MFA is enabled, send back a temporary token. Nothing is recorded yet: the sign-in has not
    // happened, and the MFA step writes its own row — success, or an outright failure.
    if (user.mfaEnabled) {
      const mfaToken = signMfaToken(user.id);
      res.json({ mfaRequired: true, mfaToken, mustChangePassword: user.mustChangePassword });
      return;
    }

    const token = await startSession(req, res, {
      id: user.id, email: user.email, role: user.role.systemRole as SystemRole,
      companyId: user.companyId, permissions: effectivePermissions(user),
      firstName: user.firstName, lastName: user.lastName,
      mfaEnabled: user.mfaEnabled, active: user.isActive,
      tokenVersion: user.tokenVersion,
    });

    await recordSignIn(req, {
      email: user.email,
      userId: user.id,
      result: "success",
      method: "password",
      sessionId: await newestSessionId(user.id),
    });

    // Update last login
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const landingPage = await resolveLandingPage(user);

    res.json({
      token,
      user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role },
      /*
       * The **effective** set, beside the user rather than inside it, matching `/auth/session`.
       *
       * It has to be sent here as well as there, and it has to be a sibling: `user.permissions` means the
       * individual *overrides* everywhere else in the API (it is what the user editor edits), while this
       * field means the assembled answer — role, plus overrides, minus removals, minus anything a
       * client's own switch takes away. Two meanings for one name is how a revocation gets quietly
       * undone by a client that unions the role back in.
       */
      permissions: effectivePermissions(user),
      landingPage,
      mustChangePassword: user.mustChangePassword,
    });
  } catch (e) { next(e); }
});

// ── POST /api/auth/change-password ──────────────────────────────────
// Self-service password change, and the step that clears mustChangePassword.
// A fresh token is returned because the old one predates passwordChangedAt.
authRouter.post("/change-password", authenticate, credentialLimiter, async (req: AuthRequest, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body ?? {};
    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: { message: "Your current password and a new password are required" } });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: req.user!.userId }, include: { ...PERMISSION_SUBJECT_INCLUDE } });
    if (!user) { res.status(404).json({ error: { message: "User not found" } }); return; }

    if (!(await bcrypt.compare(String(currentPassword), user.passwordHash))) {
      res.status(400).json({ error: { message: "Your current password is incorrect" } });
      return;
    }
    if (String(currentPassword) === String(newPassword)) {
      res.status(400).json({ error: { message: "The new password must be different from the current one" } });
      return;
    }

    const problem = validatePassword(String(newPassword), user);
    if (problem) { res.status(400).json({ error: { message: problem } }); return; }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(String(newPassword), 12),
        passwordChangedAt: new Date(),
        mustChangePassword: false,
        // Retires every token issued before this change.
        tokenVersion: { increment: 1 },
      },
    });

    // A fresh session as well as a fresh token: the old session is retired by the version
    // bump, and the caller should not have to sign in again to keep working.
    await endSessionsForUser(user.id);
    const token = await startSession(req, res, {
      id: user.id, email: user.email, role: user.role.systemRole as SystemRole,
      companyId: user.companyId, permissions: effectivePermissions(user),
      firstName: user.firstName, lastName: user.lastName,
      mfaEnabled: user.mfaEnabled, active: user.isActive,
      tokenVersion: (user.tokenVersion ?? 0) + 1,
    });

    res.json({ message: "Password changed", token });
  } catch (e) { next(e); }
});

// ── POST /api/auth/mfa/setup ────────────────────────────────────────
authRouter.post("/mfa/setup", authenticate, async (req: AuthRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const secret = speakeasy.generateSecret({ name: `C7NTAX (${user.email})` });

    await prisma.user.update({
      where: { id: user.id },
      data: { mfaSecret: secret.base32 },
    });

    const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url!);

    res.json({ secret: secret.base32, qrCode: qrDataUrl });
  } catch (e) { next(e); }
});

// ── POST /api/auth/mfa/verify-setup ─────────────────────────────────
authRouter.post("/mfa/verify-setup", authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { code } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user?.mfaSecret) { res.status(400).json({ error: "MFA not set up" }); return; }

    const verified = speakeasy.totp.verify({ secret: user.mfaSecret, encoding: "base32", token: code, window: 1 });
    if (!verified) { res.status(400).json({ error: "Invalid code" }); return; }

    await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });

    res.json({ verified: true });
  } catch (e) { next(e); }
});

// ── POST /api/auth/mfa/verify ───────────────────────────────────────
authRouter.post("/mfa/verify", credentialLimiter, async (req, res, next) => {
  try {
    const { code, mfaToken } = req.body;
    if (!code || !mfaToken) { res.status(400).json({ error: "Code and MFA token required" }); return; }

    let payload: { userId: string };
    try {
      payload = jwt.verify(mfaToken, JWT_SECRET) as { userId: string };
    } catch { res.status(401).json({ error: "MFA token expired" }); return; }

    const user = await prisma.user.findUnique({ where: { id: payload.userId }, include: { ...PERMISSION_SUBJECT_INCLUDE } });
    if (!user?.mfaSecret) { res.status(400).json({ error: "MFA not configured" }); return; }

    const verified = speakeasy.totp.verify({ secret: user.mfaSecret, encoding: "base32", token: code, window: 1 });
    if (!verified) {
      // Check backup codes
      const codes = (user.mfaBackupCodes as string[]) || [];
      const codeIndex = codes.indexOf(code);
      if (codeIndex === -1) {
        await recordSignIn(req, { email: user.email, userId: user.id, result: "mfa_failed", method: "totp", reason: "Wrong authenticator code" });
        res.status(400).json({ error: "Invalid MFA code" }); return;
      }
      // Remove used backup code
      codes.splice(codeIndex, 1);
      await prisma.user.update({ where: { id: user.id }, data: { mfaBackupCodes: codes } });
    }

    const token = await startSession(req, res, {
      id: user.id, email: user.email, role: user.role.systemRole as SystemRole,
      companyId: user.companyId, permissions: effectivePermissions(user),
      firstName: user.firstName, lastName: user.lastName,
      mfaEnabled: user.mfaEnabled, active: user.isActive,
      tokenVersion: user.tokenVersion,
    });

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    // The method, not just the result: this is the row that says a second factor was actually used.
    await recordSignIn(req, {
      email: user.email,
      userId: user.id,
      result: "success",
      method: "totp",
      sessionId: await newestSessionId(user.id),
    });

    res.json({ token, user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role }, mustChangePassword: user.mustChangePassword });
  } catch (e) { next(e); }
});

// ── POST /api/auth/send-mfa-email ───────────────────────────────────
authRouter.post("/send-mfa-email", credentialLimiter, async (req, res, next) => {
  try {
    const { mfaToken } = req.body;
    if (!mfaToken) { res.status(400).json({ error: "MFA token required" }); return; }

    let payload: { userId: string };
    try { payload = jwt.verify(mfaToken, JWT_SECRET) as { userId: string }; }
    catch { res.status(401).json({ error: "MFA token expired" }); return; }

    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    // Generate 6-digit code — CSPRNG, not Math.random
    const code = String(randomInt(100000, 1000000));
    // Store temporarily (15 min expiry)
    await prisma.user.update({
      where: { id: user.id },
      data: { mfaEmailCode: code, mfaEmailCodeExpires: new Date(Date.now() + 15 * 60_000) },
    });

    await emailService.sendMfaCode(user.email, code);

    res.json({ sent: true, message: "MFA code sent to your email" });
  } catch (e) { next(e); }
});

// ── POST /api/auth/mfa/verify-email ─────────────────────────────────
authRouter.post("/mfa/verify-email", credentialLimiter, async (req, res, next) => {
  try {
    const { code, mfaToken } = req.body;
    if (!code || !mfaToken) { res.status(400).json({ error: "Code and MFA token required" }); return; }

    let payload: { userId: string };
    try { payload = jwt.verify(mfaToken, JWT_SECRET) as { userId: string }; }
    catch { res.status(401).json({ error: "MFA token expired" }); return; }

    const user = await prisma.user.findUnique({ where: { id: payload.userId }, include: { ...PERMISSION_SUBJECT_INCLUDE } });
    if (!user?.mfaEmailCode || !user.mfaEmailCodeExpires || user.mfaEmailCodeExpires < new Date()) {
      res.status(400).json({ error: "Code expired or not requested" }); return;
    }

    if (!codesMatch(user.mfaEmailCode, String(code))) {
      await recordSignIn(req, { email: user.email, userId: user.id, result: "code_failed", method: "email_code", reason: "Wrong emailed code" });
      res.status(400).json({ error: "Invalid code" }); return;
    }

    // Clear code
    await prisma.user.update({ where: { id: user.id }, data: { mfaEmailCode: null, mfaEmailCodeExpires: null } });

    const token = await startSession(req, res, {
      id: user.id, email: user.email, role: user.role.systemRole as SystemRole,
      companyId: user.companyId, permissions: effectivePermissions(user),
      firstName: user.firstName, lastName: user.lastName,
      mfaEnabled: user.mfaEnabled, active: user.isActive,
      tokenVersion: user.tokenVersion,
    });

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    await recordSignIn(req, {
      email: user.email,
      userId: user.id,
      result: "success",
      method: "email_code",
      sessionId: await newestSessionId(user.id),
    });

    res.json({ token, user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role }, mustChangePassword: user.mustChangePassword });
  } catch (e) { next(e); }
});

// ── GET /api/auth/me ────────────────────────────────────────────────
authRouter.get("/me", authenticate, async (req: AuthRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, companyId: true, mfaEnabled: true, mustChangePassword: true, lastLoginAt: true, createdAt: true },
    });
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    res.json({ ...user, testBypass: isBypassAccount(user.email) });
  } catch (e) { next(e); }
});

/**
 * The signed-in person's own landing page.
 *
 * Self-service on purpose: the instance default belongs to an administrator, but where *you*
 * land is not a fact about the deployment. Choosing the dashboard clears the override rather
 * than storing one, so a later change to the instance default reaches anyone who never chose.
 */
authRouter.patch("/me/landing-page", authenticate, async (req: AuthRequest, res, next) => {
  try {
    const path = String(req.body?.path ?? "").trim();
    // A client that still offers the pre-merge path is not wrong, only old: `resolveLandingPagePath`
    // maps it rather than refusing it, so an open tab keeps working across the rename.
    const resolved = resolveLandingPagePath(path);
    const allowed = resolved ? LANDING_PAGES.find(p => p.path === resolved) : undefined;
    if (!allowed) { res.status(400).json({ error: "That page is not one of the available landing pages" }); return; }

    // Choosing the dashboard clears the override rather than storing one, so a later change to
    // the instance default reaches anyone who never chose a page of their own.
    const stored = allowed.path === "/" ? null : allowed.path;
    await prisma.user.update({ where: { id: req.user!.userId }, data: { landingPage: stored } });
    res.json({ landingPage: await resolveLandingPage({ landingPage: stored }) });
  } catch (e) { next(e); }
});

/**
 * Session state for the SPA (PLAN-001 §3.1/§3.2). Deliberately unauthenticated: it is how
 * the client finds out whether the cookie is still good before it renders a signed-in UI,
 * and it answers 401 rather than 403 so a caller can tell "not signed in" from "no rights".
 * It also carries the numbers the idle-timeout warning needs, so no second request is made.
 */
authRouter.get("/session", async (req, res) => {
  if (!sessionAuthEnabled()) {
    res.status(404).json({ error: { message: "Session authentication is disabled", code: "SESSION_AUTH_DISABLED" } });
    return;
  }
  const result = await resolveSession(req);
  if (result.status !== "ok") {
    if (result.status !== "none") clearSessionCookies(res);
    res.status(401).json({ error: { message: result.status === "timeout" ? "Session expired due to inactivity" : "Not signed in", code: result.status === "timeout" ? "SESSION_TIMEOUT" : "NO_SESSION" } });
    return;
  }
  const user = await prisma.user.findUnique({
    where: { id: result.session.userId },
    select: {
      id: true, email: true, firstName: true, lastName: true, role: true, companyId: true,
      mfaEnabled: true, mustChangePassword: true,
      // Needed to assemble the effective set below: a route that is deliberately unauthenticated still has
      // to answer "what does this session hold", and the answer depends on all four inputs.
      permissions: true, deniedPermissions: true,
      company: { select: { consoleEnabled: true } },
    },
  });
  if (!user) { clearSessionCookies(res); res.status(401).json({ error: { message: "Not signed in", code: "NO_SESSION" } }); return; }
  // An exempt session reports a zero timeout so the browser never warns about an expiry the
  // server will not enforce.
  const exempt = result.session.idleTimeoutExempt;
  const timeoutMs = exempt ? 0 : getSessionTimeoutMs();
  res.json({
    user,
    /*
     * Assembled here rather than taken from a middleware, because this route is deliberately
     * unauthenticated: it is how the client finds out what the cookie is worth *before* it renders a
     * signed-in interface, so there is no `req.user` to read. That makes this the one place the interface
     * learns its permissions on a page load, which is why it must be the effective set — including an
     * individual removal and a client's own switch — and not a union of the role's list with the grants.
     */
    permissions: effectivePermissions(user),
    timeoutMinutes: exempt ? 0 : Math.round(timeoutMs / 60000),
    idleTimeoutExempt: exempt,
    lastActivityAt: result.session.lastActivityAt,
  });
});

/**
 * The address the server sees this connection arriving from.
 *
 * Deliberately unauthenticated: the sign-in screen shows it *before* a session exists, which is the
 * moment it is worth anything — a VPN, a proxy or a client's site is the usual reason a sign-in
 * behaves oddly, and the first question is "which address am I arriving as?".
 *
 * It answers with the same value the session row and the audit trail record (`req.ip`, falling back
 * to the socket), so what a person reads on screen matches what the trail says about them. While
 * `trust proxy` is unset that value is the socket's, i.e. the address that actually reached us — the
 * truthful answer, and the one a reverse proxy must be configured around rather than papered over.
 * Nothing here is instance data: the caller is being handed their own address back.
 */
authRouter.get("/client-ip", (req, res) => {
  res.json({ ip: req.ip || req.socket.remoteAddress || null });
});

/**
 * "Stay logged in" (PLAN-001 §3.3). Extending is just activity, so the sliding window does
 * the work; the endpoint exists so the modal can be explicit and get the new deadline back.
 */
authRouter.post("/session/extend", async (req, res) => {
  const result = await resolveSession(req);
  if (result.status !== "ok") {
    if (result.status !== "none") clearSessionCookies(res);
    res.status(401).json({ error: { message: "Session expired — sign in again", code: "SESSION_TIMEOUT" } });
    return;
  }
  await touchSession(result.session.sessionId);
  const exempt = result.session.idleTimeoutExempt;
  const timeoutMs = exempt ? 0 : getSessionTimeoutMs();
  res.json({ extended: true, timeoutMinutes: exempt ? 0 : Math.round(timeoutMs / 60000), lastActivityAt: new Date().toISOString() });
});

/**
 * Logout ends the session server-side, not just in the browser: clearing a cookie alone
 * would leave a live session behind. Also accepts a bearer token, so the desktop app and
 * scripts can end a session too.
 */
authRouter.post("/logout", async (req: AuthRequest, res) => {
  let ended = 0;
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    try {
      const payload = jwt.verify(header.slice(7), JWT_SECRET) as { userId?: string };
      if (payload.userId) {
        ended += await invalidateSessionsForUser(payload.userId);
        await recordSignOut(req, payload.userId);
      }
    } catch { /* an expired token still gets its cookies cleared below */ }
  }
  const result = await resolveSession(req);
  if (result.status === "ok") {
    ended += await invalidateSessionsForUser(result.session.userId);
    await recordSignOut(req, result.session.userId);
  }
  clearSessionCookies(res);
  res.json({ message: "Signed out", sessionsEnded: ended });
});

/**
 * A sign-out is worth a row of its own.
 *
 * "Ended at 09:14" is what tells a reader whether a burst of failed attempts at 09:20 was somebody
 * mistyping after signing out or somebody else on the same account — the two look identical in a log
 * of attempts alone.
 */
async function recordSignOut(req: AuthRequest, userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  await recordSignIn(req, { email: user?.email ?? userId, userId, result: "signed_out", method: "password" });
}

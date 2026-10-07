import { Router } from "express";
import bcrypt from "bcryptjs";
import speakeasy from "speakeasy";
import QRCode from "qrcode";
import { randomInt, timingSafeEqual } from "node:crypto";
import { prisma } from "../index";
import { authenticate, signToken, signMfaToken, JWT_SECRET, computePermissions, type AuthRequest } from "../middleware/auth";
import { ROLE_PERMISSIONS, SystemRole, Permission, validatePassword } from "@C7NTAX/shared";
import jwt from "jsonwebtoken";
import { EmailService } from "@C7NTAX/email";
import { rateLimiter, isLoopback } from "../middleware/rateLimiter";
import { isBypassAccount, isBypassLoginAttempt, logBypassSignIn } from "../services/testBypass";
import { startSession, endSessionsForUser } from "../services/signIn";
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

// ── POST /api/auth/login ────────────────────────────────────────────
authRouter.post("/login", credentialLimiter, async (req, res, next) => {
  try {
    const { email, username, password } = req.body;
    if ((!email && !username) || !password) {
      res.status(400).json({ error: "Email/username and password required" });
      return;
    }

    // Allow login by email OR username — include role relation
    const user = email
      ? await prisma.user.findUnique({ where: { email }, include: { role: true } })
      : await prisma.user.findUnique({ where: { username }, include: { role: true } });
    if (!user || !user.isActive) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const bypass = isBypassAccount(user.email);

    if (LOCKOUT_ENABLED && user.isLocked && !bypass) {
      res.status(423).json({ error: "Account locked after too many failed sign-in attempts — ask an administrator to unlock it" });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      if (LOCKOUT_ENABLED && !bypass) {
        const attempts = user.loginAttempts + 1;
        await prisma.user.update({
          where: { id: user.id },
          data: { loginAttempts: attempts, ...(attempts >= MAX_LOGIN_ATTEMPTS ? { isLocked: true } : {}) },
        });
      }
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

    // If MFA is enabled, send back a temporary token
    if (user.mfaEnabled) {
      const mfaToken = signMfaToken(user.id);
      res.json({ mfaRequired: true, mfaToken, mustChangePassword: user.mustChangePassword });
      return;
    }

    const token = await startSession(req, res, {
      id: user.id, email: user.email, role: user.role.systemRole as SystemRole,
      companyId: user.companyId, permissions: computePermissions(user.role.systemRole as SystemRole, (user.role.permissions || []) as string[], (user.permissions || []) as string[]),
      firstName: user.firstName, lastName: user.lastName,
      mfaEnabled: user.mfaEnabled, active: user.isActive,
      tokenVersion: user.tokenVersion,
    });

    // Update last login
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    // Fetch default landing page
    const landingConfig = await prisma.systemConfig.findUnique({ where: { key: "default_landing_page" } });
    let landingPage = { path: "/", label: "Dashboard" };
    if (landingConfig) { try { landingPage = JSON.parse(landingConfig.value as string); } catch { /* use default */ } }

    res.json({ token, user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role }, landingPage, mustChangePassword: user.mustChangePassword });
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

    const user = await prisma.user.findUnique({ where: { id: req.user!.userId }, include: { role: true } });
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
      companyId: user.companyId, permissions: computePermissions(user.role.systemRole as SystemRole, (user.role.permissions || []) as string[], (user.permissions || []) as string[]),
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

    const user = await prisma.user.findUnique({ where: { id: payload.userId }, include: { role: true } });
    if (!user?.mfaSecret) { res.status(400).json({ error: "MFA not configured" }); return; }

    const verified = speakeasy.totp.verify({ secret: user.mfaSecret, encoding: "base32", token: code, window: 1 });
    if (!verified) {
      // Check backup codes
      const codes = (user.mfaBackupCodes as string[]) || [];
      const codeIndex = codes.indexOf(code);
      if (codeIndex === -1) { res.status(400).json({ error: "Invalid MFA code" }); return; }
      // Remove used backup code
      codes.splice(codeIndex, 1);
      await prisma.user.update({ where: { id: user.id }, data: { mfaBackupCodes: codes } });
    }

    const token = await startSession(req, res, {
      id: user.id, email: user.email, role: user.role.systemRole as SystemRole,
      companyId: user.companyId, permissions: computePermissions(user.role.systemRole as SystemRole, (user.role.permissions || []) as string[], (user.permissions || []) as string[]),
      firstName: user.firstName, lastName: user.lastName,
      mfaEnabled: user.mfaEnabled, active: user.isActive,
      tokenVersion: user.tokenVersion,
    });

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

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

    const user = await prisma.user.findUnique({ where: { id: payload.userId }, include: { role: true } });
    if (!user?.mfaEmailCode || !user.mfaEmailCodeExpires || user.mfaEmailCodeExpires < new Date()) {
      res.status(400).json({ error: "Code expired or not requested" }); return;
    }

    if (!codesMatch(user.mfaEmailCode, String(code))) { res.status(400).json({ error: "Invalid code" }); return; }

    // Clear code
    await prisma.user.update({ where: { id: user.id }, data: { mfaEmailCode: null, mfaEmailCodeExpires: null } });

    const token = await startSession(req, res, {
      id: user.id, email: user.email, role: user.role.systemRole as SystemRole,
      companyId: user.companyId, permissions: computePermissions(user.role.systemRole as SystemRole, (user.role.permissions || []) as string[], (user.permissions || []) as string[]),
      firstName: user.firstName, lastName: user.lastName,
      mfaEnabled: user.mfaEnabled, active: user.isActive,
      tokenVersion: user.tokenVersion,
    });

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

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
    select: { id: true, email: true, firstName: true, lastName: true, role: true, companyId: true, mfaEnabled: true, mustChangePassword: true },
  });
  if (!user) { clearSessionCookies(res); res.status(401).json({ error: { message: "Not signed in", code: "NO_SESSION" } }); return; }
  // An exempt session reports a zero timeout so the browser never warns about an expiry the
  // server will not enforce.
  const exempt = result.session.idleTimeoutExempt;
  const timeoutMs = exempt ? 0 : await getSessionTimeoutMs();
  res.json({
    user,
    permissions: computePermissions(user.role.systemRole as SystemRole, (user.role.permissions || []) as string[], []),
    timeoutMinutes: exempt ? 0 : Math.round(timeoutMs / 60000),
    idleTimeoutExempt: exempt,
    lastActivityAt: result.session.lastActivityAt,
  });
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
  const timeoutMs = exempt ? 0 : await getSessionTimeoutMs();
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
      if (payload.userId) ended += await invalidateSessionsForUser(payload.userId);
    } catch { /* an expired token still gets its cookies cleared below */ }
  }
  const result = await resolveSession(req);
  if (result.status === "ok") ended += await invalidateSessionsForUser(result.session.userId);
  clearSessionCookies(res);
  res.json({ message: "Signed out", sessionsEnded: ended });
});

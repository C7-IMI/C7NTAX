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
import { rateLimiter } from "../middleware/rateLimiter";

export const authRouter = Router();
const emailService = new EmailService();

/**
 * SOC 2 hardening: enforce the failed-attempt lockout the Security tab already
 * advertises. Off by default so behaviour only changes where hardening is on.
 */
const LOCKOUT_ENABLED = process.env.AUTH_HARDENING_ENABLED === "true";
const MAX_LOGIN_ATTEMPTS = 5;

/**
 * Brute-force limit for the credential endpoints. Deliberately generous: it is a
 * floor against hammering, not the primary control (per-account lockout is, and
 * that is off unless AUTH_HARDENING_ENABLED is set). Office NAT, the boot script's
 * health login and test scripts all share one IP bucket.
 */
const credentialLimiter = rateLimiter(300, 15 * 60 * 1000);

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

    if (LOCKOUT_ENABLED && user.isLocked) {
      res.status(423).json({ error: "Account locked after too many failed sign-in attempts — ask an administrator to unlock it" });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      if (LOCKOUT_ENABLED) {
        const attempts = user.loginAttempts + 1;
        await prisma.user.update({
          where: { id: user.id },
          data: { loginAttempts: attempts, ...(attempts >= MAX_LOGIN_ATTEMPTS ? { isLocked: true } : {}) },
        });
      }
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    // A successful sign-in clears the counter.
    if (LOCKOUT_ENABLED && user.loginAttempts > 0) {
      await prisma.user.update({ where: { id: user.id }, data: { loginAttempts: 0 } });
    }

    // SOC 2 hardening (backlog item 11): rehash-on-login when enabled and hash cost < 12.
    if (process.env.AUTH_HARDENING_ENABLED === "true" && !user.passwordHash.startsWith("$2b$12$")) {
      const upgraded = await bcrypt.hash(password, 12);
      await prisma.user.update({ where: { id: user.id }, data: { passwordHash: upgraded } });
    }

    // If MFA is enabled, send back a temporary token
    if (user.mfaEnabled) {
      const mfaToken = signMfaToken(user.id);
      res.json({ mfaRequired: true, mfaToken, mustChangePassword: user.mustChangePassword });
      return;
    }

    const token = signToken({
      id: user.id, email: user.email, role: user.role.systemRole as SystemRole,
      companyId: user.companyId, permissions: computePermissions(user.role.systemRole as SystemRole, (user.role.permissions || []) as string[], (user.permissions || []) as string[]),
      firstName: user.firstName, lastName: user.lastName,
      mfaEnabled: false, active: true,
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

    const token = signToken({
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

    const token = signToken({
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

    const token = signToken({
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
    res.json(user);
  } catch (e) { next(e); }
});

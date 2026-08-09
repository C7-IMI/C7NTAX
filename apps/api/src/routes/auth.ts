import { Router } from "express";
import bcrypt from "bcryptjs";
import speakeasy from "speakeasy";
import QRCode from "qrcode";
import { prisma } from "../index";
import { authenticate, signToken, signMfaToken, JWT_SECRET, computePermissions, type AuthRequest } from "../middleware/auth";
import { ROLE_PERMISSIONS, SystemRole, Permission } from "@C7NTAX/shared";
import jwt from "jsonwebtoken";
import { EmailService } from "@C7NTAX/email";

export const authRouter = Router();
const emailService = new EmailService();

// ── POST /api/auth/login ────────────────────────────────────────────
authRouter.post("/login", async (req, res, next) => {
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

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    // If MFA is enabled, send back a temporary token
    if (user.mfaEnabled) {
      const mfaToken = signMfaToken(user.id);
      res.json({ mfaRequired: true, mfaToken });
      return;
    }

    const token = signToken({
      id: user.id, email: user.email, role: user.role.systemRole as SystemRole,
      companyId: user.companyId, permissions: computePermissions(user.role.systemRole as SystemRole, (user.role.permissions || []) as string[], (user.permissions || []) as string[]),
      firstName: user.firstName, lastName: user.lastName,
      mfaEnabled: false, active: true,
    });

    // Update last login
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    // Fetch default landing page
    const landingConfig = await prisma.systemConfig.findUnique({ where: { key: "default_landing_page" } });
    let landingPage = { path: "/", label: "Dashboard" };
    if (landingConfig) { try { landingPage = JSON.parse(landingConfig.value as string); } catch { /* use default */ } }

    res.json({ token, user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role }, landingPage });
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
authRouter.post("/mfa/verify", async (req, res, next) => {
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
    });

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    res.json({ token, user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role } });
  } catch (e) { next(e); }
});

// ── POST /api/auth/send-mfa-email ───────────────────────────────────
authRouter.post("/send-mfa-email", async (req, res, next) => {
  try {
    const { mfaToken } = req.body;
    if (!mfaToken) { res.status(400).json({ error: "MFA token required" }); return; }

    let payload: { userId: string };
    try { payload = jwt.verify(mfaToken, JWT_SECRET) as { userId: string }; }
    catch { res.status(401).json({ error: "MFA token expired" }); return; }

    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    // Generate 6-digit code
    const code = String(Math.floor(100000 + Math.random() * 900000));
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
authRouter.post("/mfa/verify-email", async (req, res, next) => {
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

    if (user.mfaEmailCode !== code) { res.status(400).json({ error: "Invalid code" }); return; }

    // Clear code
    await prisma.user.update({ where: { id: user.id }, data: { mfaEmailCode: null, mfaEmailCodeExpires: null } });

    const token = signToken({
      id: user.id, email: user.email, role: user.role.systemRole as SystemRole,
      companyId: user.companyId, permissions: computePermissions(user.role.systemRole as SystemRole, (user.role.permissions || []) as string[], (user.permissions || []) as string[]),
      firstName: user.firstName, lastName: user.lastName,
      mfaEnabled: user.mfaEnabled, active: user.isActive,
    });

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    res.json({ token, user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role } });
  } catch (e) { next(e); }
});

// ── GET /api/auth/me ────────────────────────────────────────────────
authRouter.get("/me", authenticate, async (req: AuthRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, companyId: true, mfaEnabled: true, lastLoginAt: true, createdAt: true },
    });
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    res.json(user);
  } catch (e) { next(e); }
});

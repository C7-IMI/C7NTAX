import { Router } from "express";
import { prisma } from "../index";
import { authenticate, signToken, type AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { rateLimiter } from "../middleware/rateLimiter";
import { startSession } from "../services/signIn";
import { newestSessionId, recordSignIn } from "../services/signInAudit";
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { SystemRole } from "@C7NTAX/shared";

// Backlog item 7 — Passkey (WebAuthn). Gated by PASSKEY_ENABLED.
export const webauthnRouter = Router();

const enabled = () => process.env.PASSKEY_ENABLED === "true";
const RP_ID = process.env.WEBAUTHN_RP_ID || "localhost";
const ORIGIN = process.env.WEB_ORIGIN || "http://localhost:3010";

/**
 * PLAN-002 §5.4: the Begin/Complete pair is a credential-guessing surface, so it gets a floor
 * against hammering — 15 ceremonies a minute per address, which is far beyond a human pace but
 * stops a script. As with the password limiter in `auth.ts`, the account lockout is the real
 * control and this is deliberately not tight enough to break an office behind one NAT.
 */
const rateLimitPasskeys = rateLimiter(30, 60_000);

// In-memory challenge store (single-instance dev deployment; swap for a DB table before multi-instance).
const challenges = new Map<string, string>();

function b64(input: Uint8Array): string {
  return Buffer.from(input).toString("base64url");
}

/** What the management UI needs; the key material never leaves the server. */
function passkeySummary(record: {
  id: string; credentialId: string; deviceName: string | null; transports: string;
  createdAt: Date; lastUsedAt: Date | null;
}) {
  let transports: string[] = [];
  try { transports = JSON.parse(record.transports || "[]"); } catch { /* stored as free text */ }
  return {
    id: record.id,
    credentialId: record.credentialId,
    deviceName: record.deviceName,
    transports,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
  };
}

/**
 * A label the user will recognise in the list. An explicit name from the client wins,
 * otherwise the browser's own description of itself is a better default than "Passkey 2".
 */
function labelFrom(req: AuthRequest): string | null {
  const supplied = typeof req.body?.deviceName === "string" ? req.body.deviceName.trim() : "";
  if (supplied) return supplied.slice(0, 60);
  const ua = String(req.headers["user-agent"] || "");
  if (!ua) return null;
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "this device";
  return `${browser} on ${os}`.slice(0, 60);
}

webauthnRouter.use((_req, res, next) => {
  if (!enabled()) return res.status(404).json({ error: "Passkey disabled" });
  next();
});

webauthnRouter.post("/register/options", authenticate, async (req: AuthRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) throw new AppError("User not found", 404);
    const existing = await prisma.webauthnCredential.findMany({ where: { userId: user.id } });
    const options = await generateRegistrationOptions({
      rpName: "C7NTAX", rpID: RP_ID,
      userID: new TextEncoder().encode(user.id),
      userName: user.email,
      userDisplayName: `${user.firstName} ${user.lastName}`.trim(),
      attestationType: "none",
      excludeCredentials: existing.map((c) => ({ id: c.credentialId })),
      authenticatorSelection: { userVerification: "preferred" },
    });
    challenges.set(user.id, options.challenge);
    res.json(options);
  } catch (e) { next(e); }
});

webauthnRouter.post("/register/verify", authenticate, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    const expectedChallenge = challenges.get(userId);
    if (!expectedChallenge) throw new AppError("No pending registration");
    const verification = await verifyRegistrationResponse({
      response: req.body, expectedChallenge, expectedOrigin: ORIGIN, expectedRPID: RP_ID,
    });
    if (!verification.verified || !verification.registrationInfo) throw new AppError("Registration verification failed");
    const { credential } = verification.registrationInfo;
    const record = await prisma.webauthnCredential.create({
      data: {
        userId, credentialId: credential.id,
        publicKey: b64(credential.publicKey),
        counter: credential.counter,
        transports: JSON.stringify(credential.transports || []),
        deviceName: labelFrom(req),
        lastUsedAt: new Date(),
      },
    });
    challenges.delete(userId);
    res.status(201).json(passkeySummary(record));
  } catch (e) { next(e); }
});

webauthnRouter.post("/login/options", rateLimitPasskeys, async (req, res, next) => {
  try {
    // Lower-cased for the lookup, and compared case-insensitively: this asked for the address in
    // lower case and then matched it exactly, so an account stored as `admin@C7NTAX.com` could never
    // sign in with a passkey while its password worked — the passkey path was silently unusable for
    // exactly the accounts most likely to have one.
    const email = String(req.body.email || "").trim();
    const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
    if (!user) throw new AppError("User not found", 404);
    const credentials = await prisma.webauthnCredential.findMany({ where: { userId: user.id } });
    if (credentials.length === 0) throw new AppError("No passkeys registered for this user");
    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      allowCredentials: credentials.map((c) => ({ id: c.credentialId })),
      userVerification: "preferred",
    });
    challenges.set(`login:${user.id}`, options.challenge);
    res.json({ options, userId: user.id });
  } catch (e) { next(e); }
});

webauthnRouter.post("/login/verify", rateLimitPasskeys, async (req, res, next) => {
  try {
    const { userId, response } = req.body as { userId: string; response: Parameters<typeof verifyAuthenticationResponse>[0]["response"] & { id?: string } };
    const expectedChallenge = challenges.get(`login:${userId}`);
    if (!expectedChallenge) throw new AppError("No pending authentication");
    // The credential that signed is the one the browser names in the assertion. Picking the
    // first credential for the user would verify an account's second passkey against the
    // first one's key — and would break outright once a user registers more than one.
    const credential = await prisma.webauthnCredential.findFirst({
      where: { userId, credentialId: response?.id ?? "" },
    }) ?? await prisma.webauthnCredential.findFirst({ where: { userId } });
    if (!credential) throw new AppError("Credential not found", 404);
    const verification = await verifyAuthenticationResponse({
      response, expectedChallenge, expectedOrigin: ORIGIN, expectedRPID: RP_ID,
      credential: {
        id: credential.credentialId,
        publicKey: Buffer.from(credential.publicKey, "base64url"),
        counter: credential.counter,
        transports: JSON.parse(credential.transports || "[]"),
      },
    });
    if (!verification.verified || !verification.authenticationInfo) {
      await recordSignIn(req, { email: userId, userId, result: "mfa_failed", method: "passkey", reason: "Passkey verification failed" });
      throw new AppError("Authentication verification failed");
    }
    await prisma.webauthnCredential.update({
      where: { id: credential.id },
      data: { counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() },
    });
    challenges.delete(`login:${userId}`);
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { role: true } });
    if (!user) throw new AppError("User not found", 404);
    const token = await startSession(req, res, { id: user.id, email: user.email, role: (user.role?.systemRole ?? "admin") as SystemRole, tokenVersion: user.tokenVersion });
    await recordSignIn(req, {
      email: user.email,
      userId: user.id,
      result: "success",
      method: "passkey",
      sessionId: await newestSessionId(user.id),
    });
    res.json({ token });
  } catch (e) { next(e); }
});

/**
 * Management (PLAN-002 §5.3): what the account owner can see and change about their own
 * passkeys. Every handler is scoped to the authenticated user's rows.
 */
webauthnRouter.get("/credentials", authenticate, async (req: AuthRequest, res, next) => {
  try {
    const credentials = await prisma.webauthnCredential.findMany({
      where: { userId: req.user!.userId },
      orderBy: { createdAt: "desc" },
    });
    res.json(credentials.map(passkeySummary));
  } catch (e) { next(e); }
});

webauthnRouter.patch("/credentials/:id", authenticate, async (req: AuthRequest, res, next) => {
  try {
    const name = typeof req.body?.deviceName === "string" ? req.body.deviceName.trim() : "";
    if (!name) throw new AppError("A name is required", 400);
    const existing = await prisma.webauthnCredential.findFirst({ where: { id: req.params.id, userId: req.user!.userId } });
    if (!existing) throw new AppError("Passkey not found", 404);
    const record = await prisma.webauthnCredential.update({ where: { id: existing.id }, data: { deviceName: name.slice(0, 60) } });
    res.json(passkeySummary(record));
  } catch (e) { next(e); }
});

webauthnRouter.delete("/credentials/:id", authenticate, async (req: AuthRequest, res, next) => {
  try {
    const existing = await prisma.webauthnCredential.findFirst({ where: { id: req.params.id, userId: req.user!.userId } });
    if (!existing) throw new AppError("Passkey not found", 404);
    await prisma.webauthnCredential.delete({ where: { id: existing.id } });
    // Passwords are never removed when passkeys are added, so there is always a way back in.
    res.json({ message: "Passkey removed" });
  } catch (e) { next(e); }
});

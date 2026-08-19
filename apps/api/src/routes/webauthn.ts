import { Router } from "express";
import { prisma } from "../index";
import { authenticate, signToken, type AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
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

// In-memory challenge store (single-instance dev deployment; swap for a DB table before multi-instance).
const challenges = new Map<string, string>();

function b64(input: Uint8Array): string {
  return Buffer.from(input).toString("base64url");
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
    await prisma.webauthnCredential.create({
      data: {
        userId, credentialId: credential.id,
        publicKey: b64(credential.publicKey),
        counter: credential.counter,
        transports: JSON.stringify(credential.transports || []),
      },
    });
    challenges.delete(userId);
    res.status(201).json({ message: "Passkey registered" });
  } catch (e) { next(e); }
});

webauthnRouter.post("/login/options", async (req, res, next) => {
  try {
    const email = String(req.body.email || "").toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
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

webauthnRouter.post("/login/verify", async (req, res, next) => {
  try {
    const { userId, response } = req.body as { userId: string; response: Parameters<typeof verifyAuthenticationResponse>[0]["response"] };
    const expectedChallenge = challenges.get(`login:${userId}`);
    if (!expectedChallenge) throw new AppError("No pending authentication");
    const credential = await prisma.webauthnCredential.findFirst({ where: { userId } });
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
    if (!verification.verified || !verification.authenticationInfo) throw new AppError("Authentication verification failed");
    await prisma.webauthnCredential.update({
      where: { id: credential.id },
      data: { counter: verification.authenticationInfo.newCounter },
    });
    challenges.delete(`login:${userId}`);
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { role: true } });
    if (!user) throw new AppError("User not found", 404);
    res.json({ token: signToken({ id: user.id, email: user.email, role: (user.role?.systemRole ?? "admin") as SystemRole }) });
  } catch (e) { next(e); }
});

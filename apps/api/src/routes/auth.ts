import { Router } from "express";
import bcrypt from "bcryptjs";
import speakeasy from "speakeasy";
import QRCode from "qrcode";
import { randomInt, timingSafeEqual } from "node:crypto";
import { prisma } from "../index";
import { authenticate, signToken, signMfaToken, JWT_SECRET, effectivePermissions, PERMISSION_SUBJECT_INCLUDE, type AuthRequest } from "../middleware/auth";
import { ROLE_PERMISSIONS, SystemRole, Permission, validatePassword, LANDING_PAGES, resolveLandingPagePath, MFA_METHODS, isMfaMethodId, type MfaMethodId } from "@C7NTAX/shared";
import jwt from "jsonwebtoken";
import { rateLimiter, isLoopback } from "../middleware/rateLimiter";
import { logger } from "../services/logger";
import { codeEmailContext, sendEmailTemplate } from "../services/emailTemplateSend";
import { isBypassAccount, isBypassLoginAttempt, logBypassSignIn } from "../services/testBypass";
import { startSession, endSessionsForUser } from "../services/signIn";
import { newestSessionId, recordSignIn } from "../services/signInAudit";
import { browserIsTrusted, rememberBrowser } from "../services/mfaTrust";
import { historyAfterChange, passwordReuseMessage, passwordWasUsedRecently } from "../services/passwordHistory";
import { enforcementPossible, mfaPolicyFor, mfaPolicyForUser, mfaRememberDays, offeredMfaMethods, permissionsIncludeInstanceSecurity } from "../services/mfaPolicy";

/**
 * The account record with the one extra fact the policy needs to answer "may the gate shut on this
 * person".
 *
 * It is derived from the **effective** permissions rather than from the account's own override list,
 * because the question is what the caller actually holds: an instance permission granted by a role
 * counts, and one granted to the account but withheld by a role's removals does not.
 */
function withInstanceAwareness<T extends Parameters<typeof mfaPolicyFor>[0]>(user: T): T & { holdsInstanceSecurity: boolean } {
  const record = user as unknown as { role?: unknown; permissions?: string[]; deniedPermissions?: string[] };
  return {
    ...user,
    holdsInstanceSecurity: permissionsIncludeInstanceSecurity(
      effectivePermissions(record as Parameters<typeof effectivePermissions>[0]),
    ),
  };
}
import {
  clearSessionCookies,
  getSessionTimeoutMs,
  invalidateSessionsForUser,
  resolveSession,
  sessionAuthEnabled,
  touchSession,
} from "../middleware/sessionAuth";

export const authRouter = Router();

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
    //
    // **The lookup is case-insensitive, and that is a fix rather than a convenience.** `email` is a
    // unique *text* column, so `findUnique` compared it byte for byte: an address stored as
    // `admin@C7NTAX.com` refused `admin@c7ntax.com` with "Invalid credentials", which reads as a wrong
    // password and sent somebody looking for a password that had never changed. Nobody types the
    // capitals back, and an address is not a password — the same address spelled differently is the
    // same account. The password is still compared exactly, and the sign-in row still records what was
    // typed, so a genuine attempt on the wrong account looks the same as it always did.
    const user = email
      ? await prisma.user.findFirst({ where: { email: { equals: String(email), mode: "insensitive" } }, include: { ...PERMISSION_SUBJECT_INCLUDE } })
      : await prisma.user.findFirst({ where: { username: { equals: String(username), mode: "insensitive" } }, include: { ...PERMISSION_SUBJECT_INCLUDE } });
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
    //
    // Unless this browser has already proved a factor for *this* enrolment. The cookie carries the
    // enrolment's timestamp, so an administrator's reset — which clears it — retires the trust and the
    // next sign-in asks again. `mfaMethod` travels with the challenge so the client shows the right
    // screen rather than always offering an authenticator field to somebody whose method is an email.
    if (user.mfaEnabled) {
      if (!browserIsTrusted(req, user)) {
        const mfaToken = signMfaToken(user.id);
        res.json({
          mfaRequired: true,
          mfaToken,
          mfaMethod: user.mfaMethod ?? "totp",
          rememberDays: mfaRememberDays(),
          mustChangePassword: user.mustChangePassword,
        });
        return;
      }
      await recordSignIn(req, {
        email: user.email,
        userId: user.id,
        result: "success",
        method: isMfaMethodId(user.mfaMethod) ? user.mfaMethod : "totp",
        reason: "Second factor skipped — this browser was already trusted for this enrolment",
      });
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
      mfaPolicy: mfaPolicyFor(withInstanceAwareness(user)),
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

    /*
     * The half of the policy a pure function cannot answer: has this password been used here before?
     *
     * The current hash is passed in with the history, so "not the one you have" and "not one of the last
     * five" are one comparison and one refusal rather than two of each — they are the same rule with the
     * same remedy, and the message says which list it was checked against.
     */
    if (await passwordWasUsedRecently(user.previousPasswordHashes, String(newPassword), user.passwordHash)) {
      res.status(400).json({ error: { message: passwordReuseMessage() } });
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(String(newPassword), 12),
        passwordChangedAt: new Date(),
        mustChangePassword: false,
        // The password being replaced goes into the history — not the new one, which is now the current
        // hash and would otherwise spend one of the five slots on itself.
        previousPasswordHashes: historyAfterChange(user.previousPasswordHashes, user.passwordHash),
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
/**
 * Begin an authenticator enrolment: mint a seed and hand back the QR code.
 *
 * Refused when the deployment does not offer this method. The check is here as well as in the
 * wizard because the wizard is a client and a client is not a control — a method switched off on the
 * configuration screen must not be enrolable by anyone who kept a tab open, or by anyone posting
 * directly.
 */
authRouter.post("/mfa/setup", authenticate, async (req: AuthRequest, res, next) => {
  try {
    if (!offeredMfaMethods().includes("totp")) {
      res.status(403).json({ error: "Authenticator apps are not offered by this deployment" });
      return;
    }

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

/**
 * Ten single-use recovery codes, shown once.
 *
 * They are stored as bcrypt hashes, which is what the schema has always claimed and what nothing
 * ever wrote — so the recovery path below could never have matched anything. Hashed rather than
 * stored plainly because a code that gets somebody past a second factor is a credential, and a
 * database dump that contains one is a database dump that contains the second factor.
 *
 * Ten is a compromise with no arithmetic behind it: enough that losing one is not a problem, few
 * enough that somebody writes them down rather than storing them where the password already is.
 */
const BACKUP_CODE_COUNT = 10;

function generateBackupCodes(): string[] {
  // Base32-free, unambiguous alphabet: no 0/O, no 1/I/L, because these get read off paper.
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const codes: string[] = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i += 1) {
    let code = "";
    for (let c = 0; c < 10; c += 1) code += alphabet[randomInt(alphabet.length)];
    codes.push(`${code.slice(0, 5)}-${code.slice(5)}`);
  }
  return codes;
}

async function storeBackupCodes(userId: string, codes: string[]): Promise<string[]> {
  const hashed = await Promise.all(codes.map(code => bcrypt.hash(code, 10)));
  await prisma.user.update({ where: { id: userId }, data: { mfaBackupCodes: hashed } });
  return codes;
}

// ── POST /api/auth/mfa/verify-setup ─────────────────────────────────
authRouter.post("/mfa/verify-setup", authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { code } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user?.mfaSecret) { res.status(400).json({ error: "MFA not set up" }); return; }

    const verified = speakeasy.totp.verify({ secret: user.mfaSecret, encoding: "base32", token: code, window: 1 });
    if (!verified) { res.status(400).json({ error: "Invalid code" }); return; }

    /*
     * Enrolment is stamped in one write, and the three fields matter separately:
     *
     *   · `mfaMethod` — what the sign-in should ask for from now on;
     *   · `mfaEnrolledAt` — the fact that makes the account "done" for the policy, and the version
     *     every trusted-browser cookie is bound to, so a reset revokes them all;
     *   · `mfaGraceUntil` cleared — the deadline has been met, and leaving it behind would have the
     *     banner count down to a date that no longer applies.
     */
    await prisma.user.update({
      where: { id: user.id },
      data: {
        mfaEnabled: true,
        mfaMethod: "totp",
        mfaEnrolledAt: new Date(),
        mfaGraceUntil: null,
      },
    });

    // Issued at the moment of enrolment, when somebody is already looking at the screen and has a
    // reason to write them down. Regenerating them later is possible by resetting the account.
    const backupCodes = await storeBackupCodes(user.id, generateBackupCodes());

    const policy = await mfaPolicyForUser(user.id);
    res.json({ verified: true, method: "totp", backupCodes, policy });
  } catch (e) { next(e); }
});

// ── GET /api/auth/mfa/policy ────────────────────────────────────────
/**
 * What this account has to do, and what it may choose from.
 *
 * Read by the enrolment wizard, the reminder banner and the Account screen, so all three describe
 * the same deadline. The method list carries `available` and `offered` separately because they are
 * different questions: `available` is "may this be enrolled here", and a method that is not offered
 * is shown greyed with the reason rather than hidden, since "why can I not use my passkey" is the
 * question the screen exists to answer.
 */
authRouter.get("/mfa/policy", authenticate, async (req: AuthRequest, res, next) => {
  try {
    const policy = await mfaPolicyForUser(req.user!.userId);
    const offered = policy.methods;
    res.json({
      ...policy,
      catalogue: MFA_METHODS.map(method => ({
        id: method.id,
        label: method.label,
        summary: method.summary,
        offered: offered.includes(method.id),
        standalone: method.standalone,
        // A passkey is governed by the Sessions & Security switch, so the screen that would change
        // it is not this one. Naming the place keeps the wizard from offering a control it cannot honour.
        governedBy: method.governedBy,
      })),
      enforcementPossible: enforcementPossible(),
    });
  } catch (e) { next(e); }
});

// ── POST /api/auth/mfa/enrol/email/start ────────────────────────────
/**
 * Send a short-lived code to the signed-in account's own address, as an enrolment.
 *
 * Distinct from `/send-mfa-email`, which continues a **sign-in** that has already proved a password
 * and carries an `mfaToken`. This one is for a session that is already open and is choosing a method,
 * so it proves the same thing by a different door — and it is why enrolment can be completed by
 * somebody who cannot install an app.
 */
authRouter.post("/mfa/enrol/email/start", authenticate, async (req: AuthRequest, res, next) => {
  try {
    if (!offeredMfaMethods().includes("email_code")) {
      res.status(403).json({ error: "Emailed codes are not offered by this deployment" });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const code = String(randomInt(100000, 1000000));
    await prisma.user.update({
      where: { id: user.id },
      data: { mfaEmailCode: code, mfaEmailCodeExpires: new Date(Date.now() + 15 * 60 * 1000) },
    });

    const outcome = await sendEmailTemplate({ key: "auth.mfa_code", to: user.email, context: codeEmailContext({ code }) });
    // A code nobody can read is worse than a refused enrolment: the caller is told not to wait for it.
    if (!outcome.ok) {
      logger.warn("auth.mfaEnrol", "Could not email the enrolment code", { userId: user.id, error: outcome.error });
      res.status(502).json({ error: "The code could not be emailed — check the SMTP configuration or choose another method" });
      return;
    }

    res.json({ sent: true, expiresInMinutes: 15, email: user.email });
  } catch (e) { next(e); }
});

// ── POST /api/auth/mfa/enrol/email/verify ───────────────────────────
authRouter.post("/mfa/enrol/email/verify", authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { code } = req.body;
    if (!code) { res.status(400).json({ error: "Code required" }); return; }

    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user?.mfaEmailCode || !user.mfaEmailCodeExpires) {
      res.status(400).json({ error: "Ask for a code first" });
      return;
    }
    if (user.mfaEmailCodeExpires.getTime() < Date.now()) {
      res.status(400).json({ error: "That code has expired — ask for another" });
      return;
    }

    // Compared with the same helper the sign-in path uses, so the two cannot drift: a constant-time
    // compare, because a plain `===` on a six-digit secret leaks how many leading digits were right.
    if (!codesMatch(user.mfaEmailCode, String(code))) {
      res.status(400).json({ error: "Invalid code" });
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        mfaEnabled: true,
        mfaMethod: "email_code",
        mfaEnrolledAt: new Date(),
        mfaGraceUntil: null,
        mfaEmailCode: null,
        mfaEmailCodeExpires: null,
      },
    });

    const policy = await mfaPolicyForUser(user.id);
    res.json({ verified: true, method: "email_code", policy });
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

    /**
     * Which method was actually used, for the sign-in row.
     *
     * A recovery code is recorded as `totp` because the column enumerates methods and a recovery code
     * is a way through the authenticator step rather than a fourth method — but the reason string says
     * it plainly, because "signed in with a recovery code" is the single most interesting thing a
     * sign-in log can tell an administrator.
     */
    let signInMethod: "totp" = "totp";
    let usedRecoveryCode = false;

    const verified = speakeasy.totp.verify({ secret: user.mfaSecret, encoding: "base32", token: code, window: 1 });
    if (!verified) {
      /*
       * A recovery code, compared against the stored hashes.
       *
       * This is the branch that has never worked. The codes were documented as hashed and compared as
       * plain text with `indexOf`, and nothing generated them in the first place — so recovery was
       * unreachable, and an account whose phone was lost needed an administrator. Both halves are now
       * true of the same implementation: enrolment issues them, and this matches them with bcrypt.
       *
       * Every stored code is tried because they are individually salted, so there is no hash to look
       * up by value. Ten comparisons is an acceptable cost on the one path that matters when somebody
       * has lost their second factor, and the endpoint is rate limited.
       */
      const codes = (user.mfaBackupCodes as string[]) ?? [];
      let usedIndex = -1;
      for (let i = 0; i < codes.length; i += 1) {
        const stored = codes[i];
        if (stored && (await bcrypt.compare(String(code).trim().toUpperCase(), stored))) {
          usedIndex = i;
          break;
        }
      }

      if (usedIndex === -1) {
        await recordSignIn(req, { email: user.email, userId: user.id, result: "mfa_failed", method: "totp", reason: "Wrong authenticator code" });
        res.status(400).json({ error: "Invalid MFA code" }); return;
      }

      // Single use, and spent before the session is issued: a recovery code that still works after
      // it was used is a password with a longer life than the person thinks it has.
      const remaining = codes.filter((_, i) => i !== usedIndex);
      await prisma.user.update({ where: { id: user.id }, data: { mfaBackupCodes: remaining } });
      signInMethod = "totp";
      usedRecoveryCode = true;
    }

    const token = await startSession(req, res, {
      id: user.id, email: user.email, role: user.role.systemRole as SystemRole,
      companyId: user.companyId, permissions: effectivePermissions(user),
      firstName: user.firstName, lastName: user.lastName,
      mfaEnabled: user.mfaEnabled, active: user.isActive,
      tokenVersion: user.tokenVersion,
    });

    // Grant the trust *here*, after the factor has been proved — never before, or the cookie would
    // be a credential that skips the very check that issues it. The client clears the box by sending
    // `remember: false`, so the default only applies to a caller that expressed no preference.
    if (req.body?.remember !== false) rememberBrowser(res, user);

    const policy = mfaPolicyFor(withInstanceAwareness(user));
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    // The method, not just the result: this is the row that says a second factor was actually used.
    await recordSignIn(req, {
      email: user.email,
      userId: user.id,
      result: "success",
      method: signInMethod,
      reason: usedRecoveryCode ? "Signed in with a single-use recovery code" : undefined,
      sessionId: await newestSessionId(user.id),
    });

    res.json({ token, user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role }, mustChangePassword: user.mustChangePassword, mfaPolicy: policy });
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

    /*
     * Refused when the deployment does not offer emailed codes.
     *
     * This guard was missing here while the *enrolment* endpoint had it, and the asymmetry was a real
     * hole rather than an inconsistency: an administrator who switched emailed codes off did it because
     * the second factor must not travel on the same channel as a password reset, and this path sent it
     * there anyway. It is the one method a deployment can turn off, so it is the one that has to be
     * refused on both doors.
     */
    if (!offeredMfaMethods().includes("email_code")) {
      res.status(403).json({ error: "Emailed codes are not offered by this deployment" });
      return;
    }

    // Generate 6-digit code — CSPRNG, not Math.random
    const code = String(randomInt(100000, 1000000));
    // Store temporarily (15 min expiry)
    await prisma.user.update({
      where: { id: user.id },
      data: { mfaEmailCode: code, mfaEmailCodeExpires: new Date(Date.now() + 15 * 60_000) },
    });

    const outcome = await sendEmailTemplate({
      key: "auth.mfa_code",
      to: user.email,
      context: codeEmailContext({ code }),
    });
    // A code nobody can read is worse than a refused sign-in: the caller is told not to look for it.
    if (!outcome.ok) {
      logger.warn("auth.mfaEmail", "Could not email the verification code", { userId: user.id, error: outcome.error });
      res.status(502).json({ error: "The verification code could not be emailed — check the SMTP configuration or use another sign-in method" });
      return;
    }

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

    if (req.body?.remember !== false) rememberBrowser(res, user);

    const policy = mfaPolicyFor(withInstanceAwareness(user));
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    await recordSignIn(req, {
      email: user.email,
      userId: user.id,
      result: "success",
      method: "email_code",
      sessionId: await newestSessionId(user.id),
    });

    res.json({ token, user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role }, mustChangePassword: user.mustChangePassword, mfaPolicy: policy });
  } catch (e) { next(e); }
});

// ── GET /api/auth/me ────────────────────────────────────────────────
authRouter.get("/me", authenticate, async (req: AuthRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, companyId: true, mfaEnabled: true, mfaMethod: true, mfaState: true, mfaEnrolledAt: true, mfaGraceUntil: true, mustChangePassword: true, lastLoginAt: true, createdAt: true },
    });
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    /*
     * The policy travels with the account because every screen that has to mention it needs the same
     * answer: the wizard, the countdown banner, and the sign-in redirect. Carrying it here means the
     * client does not have to decide for itself what the settings imply — which is the disagreement
     * that would let a banner say "five days left" while the gate had already closed.
     */
    res.json({ ...user, mfaPolicy: mfaPolicyFor({ ...user, holdsInstanceSecurity: permissionsIncludeInstanceSecurity(req.user!.permissions) }), testBypass: isBypassAccount(user.email) });
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
 * `TRUST_PROXY` decides how far a forwarded header is believed. Unset, the dev default, the value is
 * the socket's, i.e. the address that actually reached us; on a deployment it is the number of proxies
 * in front, so the value is the caller's. It is a hop count and not `true` on purpose — `true` would
 * let a caller name their own address, and this is the route that would show the difference.
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

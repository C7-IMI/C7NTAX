import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, computePermissions, type AuthRequest } from "../middleware/auth";
import { Permission, ROLE_PERMISSIONS, SystemRole, PERMISSION_CATEGORIES, validatePassword } from "@C7NTAX/shared";
import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";
import { EmailService } from "@C7NTAX/email";
import { AppError } from "../middleware/errorHandler";
import { endSessionsForUser } from "../services/signIn";

export const usersRouter = Router();
usersRouter.use(authenticate);
const emailService = new EmailService();

/** Password handed to a user when an administrator does not choose one. */
function generateStrongPassword(length = 20): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%&*_-+=";
  const all = upper + lower + digits + symbols;
  const chars = [
    upper[randomInt(upper.length)],
    lower[randomInt(lower.length)],
    digits[randomInt(digits.length)],
    symbols[randomInt(symbols.length)],
  ];
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  // Shuffle so the four guaranteeing characters are not always in the same place.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/** Mail the credentials a user needs for their first sign-in. */
async function sendWelcomeEmail(
  user: { email: string; firstName: string; lastName: string },
  temporaryPassword: string,
  mustChangePassword: boolean
): Promise<void> {
  const origin = process.env.WEB_ORIGIN || process.env.CORS_ORIGIN || "http://localhost:3010";
  await emailService.send({
    to: user.email,
    subject: "C7NTAX — Your account is ready",
    html: [
      `<p>Hello ${user.firstName},</p>`,
      `<p>An account has been created for you in C7NTAX.</p>`,
      `<p><strong>Sign in:</strong> <a href="${origin}">${origin}</a><br/>`,
      `<strong>Email:</strong> ${user.email}<br/>`,
      `<strong>Temporary password:</strong> ${temporaryPassword}</p>`,
      mustChangePassword
        ? `<p>You will be asked to choose your own password the first time you sign in.</p>`
        : `<p>Please keep this password somewhere safe.</p>`,
    ].join("\n"),
  });
}


// ── List users ───────────────────────────────────────────────────────
usersRouter.get("/", requirePermission(Permission.UserManage), async (req: AuthRequest, res, next) => {
  try {
    const { search, role, status, limit = "50", offset = "0" } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (role) where.role = { systemRole: role };
    if (status === "active") where.isActive = true;
    if (status === "inactive") where.isActive = false;
    if (search) {
      where.OR = [
        { email: { contains: search } },
        { firstName: { contains: search } },
        { lastName: { contains: search } },
      ];
    }
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip: Number(offset),
        take: Number(limit),
        orderBy: { createdAt: "desc" },
        select: {
          id: true, email: true, username: true, firstName: true, lastName: true, title: true,
          department: true, costRate: true,
          role: { select: { id: true, systemRole: true, name: true, permissions: true } },
          permissions: true, isActive: true, isLocked: true, mfaEnabled: true, mustChangePassword: true,
          lastLoginAt: true, createdAt: true, company: { select: { id: true, name: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);
    res.json({ data: users, total, limit: Number(limit), offset: Number(offset) });
  } catch (e) { next(e); }
});

// ── Get current user ─────────────────────────────────────────────────
usersRouter.get("/me", async (req: AuthRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      include: { company: true, role: true },
    });
    if (!user) throw new AppError("User not found", 404);
    const { passwordHash, mfaSecret, ...safe } = user;
    res.json(safe);
  } catch (e) { next(e); }
});

// ── Get single user ──────────────────────────────────────────────────
usersRouter.get("/:id", requirePermission(Permission.UserManage), async (req: AuthRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: {
        company: true,
        role: true,
        reportsTo: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
    if (!user) throw new AppError("User not found", 404);
    const { passwordHash, mfaSecret, ...safe } = user;
    res.json(safe);
  } catch (e) { next(e); }
});

// ── Create user ──────────────────────────────────────────────────────
usersRouter.post("/", requirePermission(Permission.UserManage), async (req: AuthRequest, res, next) => {
  try {
    const {
      email, password, firstName, lastName, username, title, phone, mobile,
      department, timezone, reportsToId, companyId, permissions, role, roleId, isActive,
      credentialMode, requireChange: requireChangeRaw, sendEmail, costRate,
    } = req.body ?? {};

    if (!email) throw new AppError("Email is required", 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) throw new AppError("Enter a valid email address", 400);
    if (!firstName || !String(firstName).trim()) throw new AppError("First name is required", 400);
    if (!lastName || !String(lastName).trim()) throw new AppError("Last name is required", 400);
    if (!roleId && !role) throw new AppError("A role is required", 400);

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedUsername = username ? String(username).trim() : null;
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) throw new AppError("Email already in use", 409);
    if (normalizedUsername) {
      const takenUsername = await prisma.user.findUnique({ where: { username: normalizedUsername } });
      if (takenUsername) throw new AppError("Username already in use", 409);
    }

    const roleRecord = roleId
      ? await prisma.role.findUnique({ where: { id: roleId } })
      : await prisma.role.findFirst({ where: { systemRole: role } });
    if (!roleRecord) throw new AppError(`Role "${roleId ?? role}" not found`, 400);

    // Handing out an administrative role is a privilege change: UserManage is enough
    // to create people, but only RoleManage may create another administrator.
    const administrative = !!roleRecord.permissions?.includes(Permission.RoleManage) ||
      !!roleRecord.permissions?.includes(Permission.SystemConfig);
    if (administrative && !req.user!.permissions.includes(Permission.RoleManage)) {
      throw new AppError("Creating an administrator requires the role:manage permission", 403);
    }

    if (reportsToId) {
      const manager = await prisma.user.findUnique({ where: { id: reportsToId } });
      if (!manager) throw new AppError("The selected manager does not exist", 400);
    }

    // How the first password is decided:
    //   set      — the administrator typed one (policy-checked)
    //   generate — the server makes one and shows it once (default)
    //   invite   — the server makes one, mails it, and never shows it to the administrator
    const mode: "set" | "generate" | "invite" =
      credentialMode === "set" || credentialMode === "invite" ? credentialMode : "generate";

    const person = { email: normalizedEmail, firstName: String(firstName), lastName: String(lastName), username: normalizedUsername, title, phone, mobile };

    let plainPassword: string;
    if (mode === "set") {
      if (!password) throw new AppError("A password is required when you choose to set one", 400);
      plainPassword = String(password);
      const problem = validatePassword(plainPassword, person);
      if (problem) throw new AppError(problem, 400);
    } else {
      plainPassword = generateStrongPassword();
    }

    const mustChangePassword = mode === "invite" ? true : (requireChangeRaw ?? true);

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        username: normalizedUsername,
        passwordHash: await bcrypt.hash(plainPassword, 12),
        firstName: person.firstName,
        lastName: person.lastName,
        title: title || null,
        phone: phone || null,
        mobile: mobile || null,
        department: department || null,
        timezone: timezone || null,
        costRate: costRate === undefined || costRate === null || costRate === "" ? null : Number(costRate),
        reportsToId: reportsToId || null,
        roleId: roleRecord.id,
        companyId: companyId || null,
        permissions: Array.isArray(permissions) ? permissions : [],
        isActive: isActive === undefined ? true : !!isActive,
        mustChangePassword: !!mustChangePassword,
        passwordChangedAt: new Date(),
      },
      include: { role: true, company: { select: { id: true, name: true } } },
    });

    // Only mail it out when asked — and when the administrator cannot see it.
    let emailed = false;
    let emailError: string | undefined;
    const shouldEmail = mode === "invite" || !!sendEmail;
    if (shouldEmail) {
      try {
        await sendWelcomeEmail(user, plainPassword, !!mustChangePassword);
        emailed = true;
      } catch (e) {
        emailError = e instanceof Error ? e.message : "Failed to send the email";
      }
    }

    const { passwordHash: _, mfaSecret: __, ...safe } = user;
    res.status(201).json({
      ...safe,
      // Shown once so the administrator can hand it over; never sent for an invite.
      temporaryPassword: mode === "invite" ? undefined : plainPassword,
      mustChangePassword: !!mustChangePassword,
      emailed,
      ...(emailError ? { emailError } : {}),
    });
  } catch (e) { next(e); }
});

// ── Reset a user's password ──────────────────────────────────────────
// A temporary password is shown once; the user is asked to choose their own
// at the next sign-in, and passwordChangedAt invalidates tokens issued before
// the reset (see middleware/auth.ts).
usersRouter.post("/:id/reset-password", requirePermission(Permission.SecurityManage), async (req: AuthRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) throw new AppError("User not found", 404);

    const { mode = "generate", password, requireChange = true, unlock = true, sendEmail = false } = req.body ?? {};
    const manual = mode === "manual";
    const temporaryPassword = manual ? String(password ?? "") : generateStrongPassword();

    if (manual) {
      const problem = validatePassword(temporaryPassword, user);
      if (problem) throw new AppError(problem, 400);
      if (await bcrypt.compare(temporaryPassword, user.passwordHash)) {
        throw new AppError("The new password must be different from the current one", 400);
      }
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(temporaryPassword, 12),
        passwordChangedAt: new Date(),
        mustChangePassword: !!requireChange,
        // Retires every session that signed in with the old password.
        tokenVersion: { increment: 1 },
        // Clearing the failed-attempt counter is the point of unlocking here.
        ...(unlock ? { isLocked: false, loginAttempts: 0 } : {}),
        mfaEmailCode: null,
        mfaEmailCodeExpires: null,
      },
    });
    // A reset must end live sessions too, not just retire tokens.
    await endSessionsForUser(user.id);

    let emailed = false;
    let emailError: string | undefined;
    if (sendEmail) {
      try {
        await sendWelcomeEmail(user, temporaryPassword, !!requireChange);
        emailed = true;
      } catch (e) {
        emailError = e instanceof Error ? e.message : "Failed to send the email";
      }
    }

    res.json({
      message: "Password reset",
      temporaryPassword,
      mustChangePassword: !!requireChange,
      unlocked: !!unlock,
      emailed,
      ...(emailError ? { emailError } : {}),
    });
  } catch (e) { next(e); }
});

// ── Update user ──────────────────────────────────────────────────────
usersRouter.patch("/:id", requirePermission(Permission.UserManage), async (req: AuthRequest, res, next) => {
  try {
    const target = await prisma.user.findUnique({ where: { id: req.params.id }, include: { role: true } });
    if (!target) throw new AppError("User not found", 404);

    const isSelf = req.user!.userId === target.id;
    const canManageRoles = req.user!.permissions.includes(Permission.RoleManage);

    // Assigning roles or individual permissions is a privilege change, so it needs
    // RoleManage — and never on your own account, which is how escalation happens.
    const touchesPermissions = req.body.role !== undefined || req.body.roleId !== undefined || req.body.permissions !== undefined;
    if (touchesPermissions) {
      if (isSelf) throw new AppError("You cannot change your own role or permissions", 403);
      if (!canManageRoles) throw new AppError("Managing roles and permissions requires the role:manage permission", 403);
    }

    const updates: Record<string, unknown> = {};
    let passwordReset = false;
    const allowed = [
      "firstName", "lastName", "title", "phone", "mobile", "companyId", "isActive", "permissions",
      "username", "department", "timezone", "reportsToId", "costRate",
    ];
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    // An internal cost rate is what the margin reports price labour with, so an empty box clears it
    // rather than storing zero — "not recorded" and "free" are different answers.
    if (updates.costRate !== undefined) {
      updates.costRate = updates.costRate === null || updates.costRate === "" ? null : Number(updates.costRate);
    }

    if (updates.username) {
      const username = String(updates.username).trim();
      const taken = await prisma.user.findUnique({ where: { username } });
      if (taken && taken.id !== target.id) throw new AppError("Username already in use", 409);
      updates.username = username;
    }

    if (updates.reportsToId) {
      if (updates.reportsToId === target.id) throw new AppError("A user cannot report to themselves", 400);
      const manager = await prisma.user.findUnique({ where: { id: String(updates.reportsToId) } });
      if (!manager) throw new AppError("The selected manager does not exist", 400);
    }

    // Deactivating yourself locks you out of the screen you are standing on.
    if (updates.isActive === false && isSelf) {
      throw new AppError("You cannot deactivate your own account", 400);
    }

    if (req.body.password) {
      const problem = validatePassword(String(req.body.password), {
        email: target.email, firstName: target.firstName, lastName: target.lastName,
      });
      if (problem) throw new AppError(problem, 400);
      updates.passwordHash = await bcrypt.hash(String(req.body.password), 12);
      updates.passwordChangedAt = new Date();
      updates.mustChangePassword = req.body.requireChange ?? true;
      updates.tokenVersion = { increment: 1 };
      passwordReset = true;
    }

    // Handle role change — update roleId
    if (req.body.roleId) {
      const roleRecord = await prisma.role.findUnique({ where: { id: String(req.body.roleId) } });
      if (!roleRecord) throw new AppError(`Role "${req.body.roleId}" not found`, 400);
      updates.roleId = roleRecord.id;
    } else if (req.body.role) {
      const roleRecord = await prisma.role.findFirst({ where: { systemRole: req.body.role } });
      if (!roleRecord) throw new AppError(`Role "${req.body.role}" not found`, 400);
      updates.roleId = roleRecord.id;
    }
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: updates as any,
      include: { role: true, company: true },
    });
    // A password change or a deactivation must end live sessions, not just retire tokens:
    // a session cookie would otherwise keep working after either.
    if (passwordReset || req.body.isActive === false) await endSessionsForUser(user.id);
    const { passwordHash, mfaSecret, ...safe } = user;
    res.json(safe);
  } catch (e) { next(e); }
});

// ── Deactivate user (soft delete) ────────────────────────────────────
usersRouter.delete("/:id", requirePermission(Permission.UserManage), async (req: AuthRequest, res, next) => {
  try {
    await prisma.user.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ message: "User deactivated" });
  } catch (e) { next(e); }
});

// ── Lock / unlock user ───────────────────────────────────────────────
usersRouter.post("/:id/lock", requirePermission(Permission.UserManage), async (req: AuthRequest, res, next) => {
  try {
    const { locked } = req.body; // true to lock, false to unlock
    await prisma.user.update({
      where: { id: req.params.id },
      data: { isLocked: !!locked, loginAttempts: locked ? 0 : undefined },
    });
    res.json({ message: locked ? "User locked" : "User unlocked" });
  } catch (e) { next(e); }
});

// ── Reset MFA for user ───────────────────────────────────────────────
usersRouter.post("/:id/reset-mfa", requirePermission(Permission.SecurityManage), async (req: AuthRequest, res, next) => {
  try {
    await prisma.user.update({
      where: { id: req.params.id },
      data: { mfaEnabled: false, mfaSecret: null, mfaBackupCodes: [] },
    });
    res.json({ message: "MFA reset" });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════════
//  ROLES & PERMISSIONS
// ═══════════════════════════════════════════════════════════════════════

export const rolesRouter = Router();
rolesRouter.use(authenticate);

// ── List all roles ───────────────────────────────────────────────────
rolesRouter.get("/", requirePermission(Permission.RoleManage), async (_req: AuthRequest, res, next) => {
  try {
    const roles = await prisma.role.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { users: true } } },
    });
    res.json({ data: roles });
  } catch (e) { next(e); }
});

// ── Roles ────────────────────────────────────────────────────────────
// NOTE: this second roles router is NOT mounted — index.ts imports `rolesRouter` from
// `./routes/roles`, and nothing imports this one, so every route below is unreachable
// (the permissions catalogue it declares is also served to the SPA straight from
// `@C7NTAX/shared`). Kept guarded while it exists; deleting it is a follow-up cleanup.
rolesRouter.get("/permissions/catalog", requirePermission(Permission.RoleManage), async (_req: AuthRequest, res) => {
  res.json({ data: PERMISSION_CATEGORIES });
});

// ── Get single role ──────────────────────────────────────────────────
rolesRouter.get("/:id", requirePermission(Permission.RoleManage), async (req: AuthRequest, res, next) => {
  try {
    const role = await prisma.role.findUnique({
      where: { id: req.params.id },
      include: { users: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });
    if (!role) throw new AppError("Role not found", 404);
    res.json(role);
  } catch (e) { next(e); }
});

// ── Create role ──────────────────────────────────────────────────────
rolesRouter.post("/", requirePermission(Permission.RoleManage), async (req: AuthRequest, res, next) => {
  try {
    const { name, systemRole, permissions } = req.body;
    if (!name || !systemRole) throw new AppError("name and systemRole are required", 400);
    const existing = await prisma.role.findFirst({ where: { OR: [{ name }, { systemRole }] } });
    if (existing) throw new AppError("A role with that name or systemRole already exists", 409);
    const role = await prisma.role.create({
      data: { name, systemRole, permissions: permissions || [] },
    });
    res.status(201).json(role);
  } catch (e) { next(e); }
});

// ── Update role ──────────────────────────────────────────────────────
rolesRouter.patch("/:id", requirePermission(Permission.RoleManage), async (req: AuthRequest, res, next) => {
  try {
    const updates: Record<string, unknown> = {};
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.systemRole !== undefined) updates.systemRole = req.body.systemRole;
    if (req.body.permissions !== undefined) updates.permissions = req.body.permissions;
    if (req.body.isDefault !== undefined) updates.isDefault = req.body.isDefault;
    if (Object.keys(updates).length === 0) throw new AppError("No fields to update", 400);
    const role = await prisma.role.update({ where: { id: req.params.id }, data: updates as any });
    res.json(role);
  } catch (e) { next(e); }
});

// ── Delete role ──────────────────────────────────────────────────────
rolesRouter.delete("/:id", requirePermission(Permission.RoleManage), async (req: AuthRequest, res, next) => {
  try {
    const userCount = await prisma.user.count({ where: { roleId: req.params.id } });
    if (userCount > 0) throw new AppError(`Cannot delete role: ${userCount} users assigned`, 400);
    await prisma.role.delete({ where: { id: req.params.id } });
    res.json({ message: "Role deleted" });
  } catch (e) { next(e); }
});

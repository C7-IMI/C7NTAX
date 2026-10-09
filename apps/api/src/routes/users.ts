import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, computePermissions, type AuthRequest } from "../middleware/auth";
import {
  Permission, ROLE_PERMISSIONS, SystemRole, validatePassword,
  DEVELOPER_ACCOUNT_REFUSAL, developerPermissionsIn, developerRefusalMessage, isDeveloperRole,
  isSuperAdminRole, wearsDeveloperRole, withoutDeveloperPermissions,
} from "@C7NTAX/shared";
import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";
import { sendEmailTemplate } from "../services/emailTemplateSend";
import { AppError } from "../middleware/errorHandler";
import { endSessionsForUser } from "../services/signIn";
import { developerRoleIds } from "../services/developerAccounts";

export const usersRouter = Router();
usersRouter.use(authenticate);

/*
 * ── The Developer Admin rule ──────────────────────────────────────────────────────────────────────
 * Putting a person onto the Developer Admin role, or granting them `developer:view` /
 * `developer:purge` one at a time, is a **Super Admin's** decision and nobody else's. `routes/roles.ts`
 * enforces the same rule for the role itself; `packages/shared/src/developerAccess.ts` holds the rule
 * and the sentence every refusal uses. A Developer Admin is deliberately *not* a Super Admin for this
 * purpose — it holds `role:manage`, and a role that can widen itself is not a role.
 */

/** The one refusal for naming a developer role or permission here. */
function developerRefusal(offending: string[]): AppError {
  return new AppError(developerRefusalMessage(offending), 403);
}

/**
 * The refusal for acting on a person rather than on a role — see `DEVELOPER_ACCOUNT_REFUSAL`.
 *
 * Every route that can change an account calls this before it changes anything: role, activation,
 * password, MFA, permissions. Refused rather than ignored, because an administrator who deactivated,
 * reset or re-roled somebody on the developer surface and was told nothing would believe it had
 * happened.
 */
function developerAccountRefusal(name: string): AppError {
  return new AppError(`Refused: ${name}. ${DEVELOPER_ACCOUNT_REFUSAL}`, 403);
}

/** Only the fields the redaction below touches, so a record keeps everything else the query selected. */
interface DeveloperPermissionsCarrier {
  role?: { permissions?: string[] | null } | null;
  permissions?: string[] | null;
  deniedPermissions?: string[] | null;
}

/**
 * A user record with the developer permissions taken out of its role's list and out of the person's own
 * grants and removals, for a caller who may not be shown them.
 *
 * The account wearing the Developer Admin role is *not* returned at all (see the list and single-fetch
 * routes), so what this covers is the other case: a custom role that was deliberately given one of the
 * two keys. Its name and its people stay; the key does not.
 */
function hideDeveloperPermissions<T extends DeveloperPermissionsCarrier>(user: T): T {
  return {
    ...user,
    ...(user.role ? { role: { ...user.role, permissions: withoutDeveloperPermissions(user.role.permissions) } } : {}),
    ...(user.permissions !== undefined ? { permissions: withoutDeveloperPermissions(user.permissions) } : {}),
    ...(user.deniedPermissions !== undefined ? { deniedPermissions: withoutDeveloperPermissions(user.deniedPermissions) } : {}),
  } as T;
}

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
  // The words are the Studio's (`user.invite`). The sign-in link is the application's own address, as
  // it is today, rather than a /sign-in path this message has no business inventing.
  await sendEmailTemplate({
    key: "user.invite",
    to: user.email,
    context: {
      fields: {
        "contact.firstName": user.firstName,
        "contact.email": user.email,
        "instance.signInUrl": origin,
        "message.credential": temporaryPassword,
        // The instruction the message has to carry, supplied whole so it cannot be half-blanked.
        "message.passwordNote": mustChangePassword
          ? "You will be asked to choose your own password the first time you sign in."
          : "Please keep this password somewhere safe.",
      },
    },
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
    /*
     * The accounts on the developer surface do not exist to this caller.
     *
     * Excluded inside the query rather than filtered out of the page, which is what keeps the promise
     * whole in all three places it could weaken: `total` counts only what the caller can see, `?role=`
     * and `?search=` narrow and cannot reach an account that was never in the set to begin with, and a
     * picker built from this endpoint (assignees, approvers, managers) is built from the same answer.
     * A `search` for the address of one of them returns nothing rather than returning it.
     */
    if (!isSuperAdminRole(req.user!.role)) {
      where.AND = [{ roleId: { notIn: await developerRoleIds() } }];
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
          permissions: true,
          // Read out so the editor can show what has been taken away as well as what was added; without
          // it, a screen that draws the grants alone would look like the removal had not been saved.
          deniedPermissions: true,
          isActive: true, isLocked: true, mfaEnabled: true, mustChangePassword: true,
          lastLoginAt: true, createdAt: true, company: { select: { id: true, name: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);
    /*
     * The developer permissions are stripped from every role's list and from the person's own grants
     * and removals, on top of the exclusion above: a *custom* role may hold one of the keys, and this
     * caller has no business reading which. See `hideDeveloperPermissions`.
     */
    const superAdmin = isSuperAdminRole(req.user!.role);
    res.json({
      data: superAdmin ? users : users.map(hideDeveloperPermissions),
      total, limit: Number(limit), offset: Number(offset),
    });
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
    if (!isSuperAdminRole(req.user!.role)) {
      // "Not found", not "forbidden": to this caller the account does not exist, and saying otherwise
      // would confirm it does. The same answer as the list gives, which is the point — an id learned
      // from somewhere else must not be a way around it.
      if (wearsDeveloperRole(user)) throw new AppError("User not found", 404);
      const { passwordHash, mfaSecret, ...visible } = user;
      // The same redaction as the list, for the same reason: one record must not become the way around it.
      res.json(hideDeveloperPermissions(visible));
      return;
    }
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

    /*
     * A Super Admin is the only caller who may put somebody on the Developer Admin role, or grant them
     * a developer permission directly. Refused by name rather than stripped: a create that quietly
     * dropped `developer:view` would report success and leave the administrator believing they had
     * built a trusted operator when they had built an ordinary one.
     */
    if (!isSuperAdminRole(req.user!.role)) {
      const offending = [
        ...(isDeveloperRole(roleRecord.systemRole) ? [roleRecord.name] : []),
        ...developerPermissionsIn(permissions),
      ];
      if (offending.length) throw developerRefusal(offending);
    }

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
      ...(isSuperAdminRole(req.user!.role) ? safe : hideDeveloperPermissions(safe)),
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
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, include: { role: true } });
    if (!user) throw new AppError("User not found", 404);
    // Resetting the password of somebody on the developer surface is changing their account, so it is
    // a Super Admin's to do — and it is refused *before* the new hash is written, not after.
    if (!isSuperAdminRole(req.user!.role) && wearsDeveloperRole(user)) throw developerAccountRefusal(user.email);

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

    /*
     * A Super Admin is the only person who may change an account on the developer surface — and that
     * covers the whole route, not only the role: activation, deactivation, a password write, a
     * permission override and the placements beside them. It is refused before anything is written,
     * because a partial edit told as a failure is worse than no edit at all.
     */
    if (!isSuperAdminRole(req.user!.role) && wearsDeveloperRole(target)) throw developerAccountRefusal(target.email);

    const isSelf = req.user!.userId === target.id;
    const canManageRoles = req.user!.permissions.includes(Permission.RoleManage);

    // Assigning roles or individual permissions is a privilege change, so it needs
    // RoleManage — and never on your own account, which is how escalation happens.
    const touchesPermissions =
      req.body.role !== undefined || req.body.roleId !== undefined ||
      req.body.permissions !== undefined || req.body.deniedPermissions !== undefined;
    if (touchesPermissions) {
      if (isSelf) throw new AppError("You cannot change your own role or permissions", 403);
      if (!canManageRoles) throw new AppError("Managing roles and permissions requires the role:manage permission", 403);
    }

    /*
     * The developer surface is a Super Admin's, in both directions and on both halves of a user:
     *
     *   · moving somebody **onto** the Developer Admin role, named by `roleId` or by `systemRole`;
     *   · moving somebody already wearing it **off** it, or editing the permissions they hold while
     *     they wear it — the role is not one this caller may change either way;
     *   · naming `developer:view` or `developer:purge` in a grant or a removal list, which the caller
     *     cannot even be shown, so they could not have meant to act on it.
     *
     * Every one of them is refused by name. A Developer Admin asking this of itself is refused too:
     * it holds `role:manage`, and a role that can widen itself is not a role.
     */
    if (!isSuperAdminRole(req.user!.role)) {
      const namedRoleId = typeof req.body.roleId === "string" && req.body.roleId ? req.body.roleId : null;
      const namedSystemRole = typeof req.body.role === "string" && req.body.role ? req.body.role : null;
      const namedRole = namedRoleId
        ? await prisma.role.findUnique({ where: { id: namedRoleId } })
        : namedSystemRole
          ? await prisma.role.findFirst({ where: { systemRole: namedSystemRole } })
          : null;
      const offending = [
        ...(namedRole && isDeveloperRole(namedRole.systemRole) ? [namedRole.name] : []),
        ...(namedSystemRole && isDeveloperRole(namedSystemRole) && !namedRole ? [namedSystemRole] : []),
        ...(touchesPermissions && isDeveloperRole(target.role.systemRole) ? [target.role.name] : []),
        ...developerPermissionsIn(req.body.permissions),
        ...developerPermissionsIn(req.body.deniedPermissions),
      ];
      if (offending.length) throw developerRefusal(offending);
    }

    const updates: Record<string, unknown> = {};
    let passwordReset = false;
    const allowed = [
      "firstName", "lastName", "title", "phone", "mobile", "companyId", "isActive", "permissions",
      "deniedPermissions", "username", "department", "timezone", "reportsToId", "costRate",
    ];
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    /*
     * A removal list that removed something needed to put it back would be a trap: an administrator who
     * denied themselves `user:manage` could not undo it from the interface, and the recovery is a
     * database edit. The escalation rules above already refuse self-edits, so this is the same boundary
     * stated for the subtractive direction — and the message says what to do instead.
     */
    if (updates.deniedPermissions !== undefined) {
      if (!Array.isArray(updates.deniedPermissions)) {
        throw new AppError("deniedPermissions must be an array of permission names", 400);
      }
      const invalid = (updates.deniedPermissions as string[]).filter(
        // Compared against the enum's **values**, not its keys: `"console:use" in Permission` is false for
        // a string enum, because `in` looks at member names. That mistake rejected every valid permission.
        (name) => !(Object.values(Permission) as string[]).includes(name),
      );
      if (invalid.length > 0) {
        throw new AppError(`Not a permission: ${invalid.join(", ")}`, 400);
      }
      if (isSelf && (updates.deniedPermissions as string[]).includes(Permission.UserManage)) {
        throw new AppError("You cannot remove user:manage from your own account — ask another administrator", 400);
      }
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
    res.json(isSuperAdminRole(req.user!.role) ? safe : hideDeveloperPermissions(safe));
  } catch (e) { next(e); }
});

// ── Deactivate user (soft delete) ────────────────────────────────────
usersRouter.delete("/:id", requirePermission(Permission.UserManage), async (req: AuthRequest, res, next) => {
  try {
    const target = await prisma.user.findUnique({ where: { id: req.params.id }, include: { role: true } });
    if (!target) throw new AppError("User not found", 404);
    if (!isSuperAdminRole(req.user!.role) && wearsDeveloperRole(target)) throw developerAccountRefusal(target.email);
    await prisma.user.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ message: "User deactivated" });
  } catch (e) { next(e); }
});

// ── Lock / unlock user ───────────────────────────────────────────────
usersRouter.post("/:id/lock", requirePermission(Permission.UserManage), async (req: AuthRequest, res, next) => {
  try {
    const target = await prisma.user.findUnique({ where: { id: req.params.id }, include: { role: true } });
    if (!target) throw new AppError("User not found", 404);
    if (!isSuperAdminRole(req.user!.role) && wearsDeveloperRole(target)) throw developerAccountRefusal(target.email);
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
    const target = await prisma.user.findUnique({ where: { id: req.params.id }, include: { role: true } });
    if (!target) throw new AppError("User not found", 404);
    if (!isSuperAdminRole(req.user!.role) && wearsDeveloperRole(target)) throw developerAccountRefusal(target.email);
    await prisma.user.update({
      where: { id: req.params.id },
      data: { mfaEnabled: false, mfaSecret: null, mfaBackupCodes: [] },
    });
    res.json({ message: "MFA reset" });
  } catch (e) { next(e); }
});

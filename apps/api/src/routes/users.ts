import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, computePermissions, type AuthRequest } from "../middleware/auth";
import { Permission, ROLE_PERMISSIONS, SystemRole, PERMISSION_CATEGORIES } from "@C7NTAX/shared";
import bcrypt from "bcryptjs";
import { AppError } from "../middleware/errorHandler";

export const usersRouter = Router();
usersRouter.use(authenticate);

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
          role: { select: { id: true, systemRole: true, name: true, permissions: true } },
          permissions: true, isActive: true, isLocked: true, mfaEnabled: true, lastLoginAt: true,
          createdAt: true, company: { select: { id: true, name: true } },
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
      include: { company: true, role: true },
    });
    if (!user) throw new AppError("User not found", 404);
    const { passwordHash, mfaSecret, ...safe } = user;
    res.json(safe);
  } catch (e) { next(e); }
});

// ── Create user ──────────────────────────────────────────────────────
usersRouter.post("/", requirePermission(Permission.UserManage), async (req: AuthRequest, res, next) => {
  try {
    const { email, password, firstName, lastName, role: roleName, companyId, permissions } = req.body;
    if (!email || !password || !roleName) throw new AppError("email, password, and role are required");
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new AppError("Email already in use", 409);

    const roleRecord = await prisma.role.findFirst({ where: { systemRole: roleName } });
    if (!roleRecord) throw new AppError(`Role "${roleName}" not found`, 400);

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        email, passwordHash,
        firstName: firstName || null, lastName: lastName || null,
        roleId: roleRecord.id, companyId: companyId || null,
        permissions: permissions || [],
      },
      include: { role: true },
    });
    const { passwordHash: _, mfaSecret: __, ...safe } = user;
    res.status(201).json(safe);
  } catch (e) { next(e); }
});

// ── Update user ──────────────────────────────────────────────────────
usersRouter.patch("/:id", requirePermission(Permission.UserManage), async (req: AuthRequest, res, next) => {
  try {
    const updates: Record<string, unknown> = {};
    const allowed = ["firstName", "lastName", "title", "phone", "mobile", "companyId", "isActive", "permissions"];
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (req.body.password) {
      updates.passwordHash = await bcrypt.hash(req.body.password, 12);
    }
    // Handle role change — update roleId
    if (req.body.role) {
      const roleRecord = await prisma.role.findFirst({ where: { systemRole: req.body.role } });
      if (!roleRecord) throw new AppError(`Role "${req.body.role}" not found`, 400);
      updates.roleId = roleRecord.id;
    }
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: updates as any,
      include: { role: true, company: true },
    });
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

// ── Get permissions catalog (grouped) ────────────────────────────────
rolesRouter.get("/permissions/catalog", async (_req: AuthRequest, res) => {
  res.json({ data: PERMISSION_CATEGORIES });
});

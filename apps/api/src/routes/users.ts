import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission, ROLE_PERMISSIONS, SystemRole } from "@C7NTAX/shared";
import bcrypt from "bcryptjs";
import { AppError } from "../middleware/errorHandler";

export const usersRouter = Router();
usersRouter.use(authenticate);

// ── List users ──
usersRouter.get("/", requirePermission(Permission.UserManage), async (req: AuthRequest, res, next) => {
  try {
    const { search, role, status, limit = "50", offset = "0" } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (role) where.role = role;
    if (status) where.status = status;
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
        select: { id: true, email: true, firstName: true, lastName: true, role: true, status: true, companyId: true, mfaEnabled: true, lastLoginAt: true, createdAt: true },
      }),
      prisma.user.count({ where }),
    ]);
    res.json({ data: users, total, limit: Number(limit), offset: Number(offset) });
  } catch (e) { next(e); }
});

// ── Get current user ──
usersRouter.get("/me", async (req: AuthRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      include: { company: true },
    });
    if (!user) throw new AppError("User not found", 404);
    const { passwordHash, mfaSecret, ...safe } = user;
    res.json(safe);
  } catch (e) { next(e); }
});

// ── Get single user ──
usersRouter.get("/:id", requirePermission(Permission.UserManage), async (req: AuthRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, include: { company: true } });
    if (!user) throw new AppError("User not found", 404);
    const { passwordHash, mfaSecret, ...safe } = user;
    res.json(safe);
  } catch (e) { next(e); }
});

// ── Create user ──
usersRouter.post("/", requirePermission(Permission.UserManage), async (req: AuthRequest, res, next) => {
  try {
    const { email, password, firstName, lastName, role, companyId } = req.body;
    if (!email || !password || !role) throw new AppError("email, password, and role are required");
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new AppError("Email already in use", 409);
    const passwordHash = await bcrypt.hash(password, 12);
    const permissions = ROLE_PERMISSIONS[role as SystemRole] || [];
    const user = await prisma.user.create({
      data: { email, passwordHash, firstName, lastName, role, companyId, permissions },
    });
    const { passwordHash: _, mfaSecret: __, ...safe } = user;
    res.status(201).json(safe);
  } catch (e) { next(e); }
});

// ── Update user ──
usersRouter.patch("/:id", requirePermission(Permission.UserManage), async (req: AuthRequest, res, next) => {
  try {
    const updates: Record<string, unknown> = {};
    const allowed = ["firstName", "lastName", "role", "status", "companyId", "permissions"];
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (req.body.password) {
      updates.passwordHash = await bcrypt.hash(req.body.password, 12);
    }
    if (updates.role && !updates.permissions) {
      updates.permissions = ROLE_PERMISSIONS[updates.role as SystemRole] || [];
    }
    const user = await prisma.user.update({ where: { id: req.params.id }, data: updates });
    const { passwordHash, mfaSecret, ...safe } = user;
    res.json(safe);
  } catch (e) { next(e); }
});

// ── Delete user ──
usersRouter.delete("/:id", requirePermission(Permission.UserManage), async (req: AuthRequest, res, next) => {
  try {
    await prisma.user.update({ where: { id: req.params.id }, data: { status: "inactive" } });
    res.json({ message: "User deactivated" });
  } catch (e) { next(e); }
});

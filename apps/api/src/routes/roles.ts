import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission, ROLE_PERMISSIONS, SystemRole } from "@C7NTAX/shared";
import { AppError } from "../middleware/errorHandler";

export const rolesRouter = Router();
rolesRouter.use(authenticate);

// ── List all roles ──
rolesRouter.get("/", requirePermission(Permission.RoleManage), async (_req: AuthRequest, res, next) => {
  try {
    const roles = await prisma.role.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { users: true } } },
    });
    res.json({ data: roles });
  } catch (e) { next(e); }
});

// ── Get single role ──
rolesRouter.get("/:id", requirePermission(Permission.RoleManage), async (req: AuthRequest, res, next) => {
  try {
    const role = await prisma.role.findUnique({
      where: { id: req.params.id },
      include: { users: { select: { id: true, email: true, firstName: true, lastName: true } } },
    });
    if (!role) throw new AppError("Role not found", 404);
    res.json(role);
  } catch (e) { next(e); }
});

// ── Create role ──
rolesRouter.post("/", requirePermission(Permission.RoleManage), async (req: AuthRequest, res, next) => {
  try {
    const { name, systemRole, permissions } = req.body;
    if (!name || !systemRole) throw new AppError("name and systemRole are required", 400);
    if (!Object.values(SystemRole).includes(systemRole)) throw new AppError(`Invalid systemRole: ${systemRole}`, 400);

    const existing = await prisma.role.findUnique({ where: { name } });
    if (existing) throw new AppError("Role name already exists", 409);

    const perms = permissions?.length ? permissions : (ROLE_PERMISSIONS[systemRole as SystemRole] || []);
    const role = await prisma.role.create({
      data: { name, systemRole, permissions: perms },
      include: { _count: { select: { users: true } } },
    });
    res.status(201).json(role);
  } catch (e) { next(e); }
});

// ── Update role ──
rolesRouter.patch("/:id", requirePermission(Permission.RoleManage), async (req: AuthRequest, res, next) => {
  try {
    const data: Record<string, unknown> = {};
    const allowed = ["name", "systemRole", "permissions", "isDefault"];
    for (const key of allowed) {
      if (req.body[key] !== undefined) data[key] = req.body[key];
    }
    if (Object.keys(data).length === 0) throw new AppError("No fields to update", 400);
    if (data.systemRole && !Object.values(SystemRole).includes(data.systemRole as string)) {
      throw new AppError(`Invalid systemRole: ${data.systemRole}`, 400);
    }
    const role = await prisma.role.update({
      where: { id: req.params.id },
      data: data as any,
      include: { _count: { select: { users: true } } },
    });
    res.json(role);
  } catch (e) { next(e); }
});

// ── Delete role ──
rolesRouter.delete("/:id", requirePermission(Permission.RoleManage), async (req: AuthRequest, res, next) => {
  try {
    const role = await prisma.role.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { users: true } } },
    });
    if (!role) throw new AppError("Role not found", 404);
    if (role._count.users > 0) throw new AppError("Cannot delete role with assigned users. Reassign users first.", 400);

    await prisma.role.delete({ where: { id: req.params.id } });
    res.json({ message: "Role deleted" });
  } catch (e) { next(e); }
});

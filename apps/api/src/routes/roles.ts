import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import {
  Permission, ROLE_PERMISSIONS, SystemRole,
  developerPermissionsIn, developerRefusalMessage, isDeveloperRole, isSuperAdminRole, withoutDeveloperPermissions,
  instancePermissionsIn, instanceRefusalMessage, withoutInstancePermissions,
} from "@C7NTAX/shared";
import { AppError } from "../middleware/errorHandler";

export const rolesRouter = Router();
rolesRouter.use(authenticate);

/*
 * ── The Developer Admin rule, in one place ─────────────────────────────────────────────────────────
 * `developer:view` and `developer:purge` are the only permissions whose worst case is removing the
 * instance's contents, and `Developer Admin` is the only role that holds them. Every handler below
 * asks `isSuperAdminRole(req.user.role)` and, when the answer is no, hides the role from a read and
 * refuses a write *by name* rather than stripping the key out — silently dropping it would leave an
 * administrator believing they had granted something they had not. The whole rule, and the sentence
 * every refusal uses, live in `packages/shared/src/developerAccess.ts`.
 *
 * Note deliberately: **a Developer Admin is not a Super Admin here.** It holds every permission,
 * `role:manage` among them, so the ordinary guard would let it administer its own role — and a role
 * that can widen itself is not a role. Role administration stays with Super Admin, even for the
 * person wearing the developer hat.
 */

/** The one refusal for a role edit that would touch the developer permissions. */
function developerRefusal(offending: string[]): AppError {
  return new AppError(developerRefusalMessage(offending), 403);
}

/**
 * The refusal for a role edit that would touch the **instance tier**.
 *
 * A separate sentence from the developer one because it is a different rule with a different audience:
 * the developer surface is refused to everybody but a Super Admin, and the instance tier is refused to
 * everybody but a Super Admin **including** Developer Admin's ordinary neighbours — and, unlike the
 * developer rule, it is about a permission an administrator can otherwise see plenty of. Saying which
 * one was refused, by name, is what makes the answer diagnosable.
 */
function instanceRefusal(offending: string[]): AppError {
  return new AppError(instanceRefusalMessage(offending), 403);
}

/** Both strips, for a caller who may not see either restricted surface. */
function visiblePermissions(permissions: string[]): string[] {
  return withoutInstancePermissions(withoutDeveloperPermissions(permissions));
}

// ── List all roles ──
rolesRouter.get("/", requirePermission(Permission.RoleManage), async (req: AuthRequest, res, next) => {
  try {
    const roles = await prisma.role.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { users: true } } },
    });
    if (isSuperAdminRole(req.user!.role)) return res.json({ data: roles });
    /*
     * The Developer Admin row is omitted rather than returned blank: "Developer Admin · 0 permissions"
     * would be a lie about the one role that holds everything, and the name on its own is still the
     * name of a role this caller may not have. Any *other* role that happens to hold a developer
     * permission keeps its row with that key removed, so the list cannot be read for the shape of the
     * developer surface either.
     */
    res.json({
      data: roles
        .filter((role) => !isDeveloperRole(role.systemRole))
        .map((role) => ({ ...role, permissions: visiblePermissions(role.permissions) })),
    });
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
    if (!isSuperAdminRole(req.user!.role)) {
      // "Not found" rather than "forbidden", so fetching one role by id is not a way around the list:
      // to a caller who may not see the Developer Admin role, it is a role that does not exist. The
      // developer permissions of any other role are removed for the same reason the list removes them.
      if (isDeveloperRole(role.systemRole)) throw new AppError("Role not found", 404);
      return res.json({ ...role, permissions: visiblePermissions(role.permissions) });
    }
    res.json(role);
  } catch (e) { next(e); }
});

// ── Create role ──
rolesRouter.post("/", requirePermission(Permission.RoleManage), async (req: AuthRequest, res, next) => {
  try {
    const { name, systemRole, permissions } = req.body;
    if (!name || !systemRole) throw new AppError("name and systemRole are required", 400);
    if (!Object.values(SystemRole).includes(systemRole)) throw new AppError(`Invalid systemRole: ${systemRole}`, 400);

    if (!isSuperAdminRole(req.user!.role)) {
      // Both halves are refusals that *name* what was refused. The systemRole branch also covers the
      // case where no permission list was sent, because the defaults for `developer_admin` are the two
      // developer permissions themselves.
      const offending = [
        ...(isDeveloperRole(systemRole) ? [String(systemRole)] : []),
        ...developerPermissionsIn(permissions),
        // The instance tier is refused to *everybody* but a Super Admin, so it is checked here rather
        // than inside the `isDeveloperRole` halves above — the caller may not be a developer anything.
        ...instancePermissionsIn(permissions),
      ];
      if (offending.length) {
        if (instancePermissionsIn(permissions).length) throw instanceRefusal(offending);
        throw developerRefusal(offending);
      }
    }

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
    // The value is `unknown` off the request body, so the check is what narrows it — and the
    // comparison is against the enum's own values rather than a cast to a role type.
    if (typeof data.systemRole === "string" && !(Object.values(SystemRole) as string[]).includes(data.systemRole)) {
      throw new AppError(`Invalid systemRole: ${data.systemRole}`, 400);
    }

    if (!isSuperAdminRole(req.user!.role)) {
      const target = await prisma.role.findUnique({ where: { id: req.params.id } });
      if (!target) throw new AppError("Role not found", 404);
      /*
       * Four ways a non-Super-Admin could reach the developer surface through an edit, and every one
       * is refused by name:
       *   · the role being edited *is* Developer Admin;
       *   · the edit would move a role onto `developer_admin`;
       *   · the submitted permission list contains a developer permission;
       *   · the role already holds one, which this caller was never shown — so their permission list
       *     would leave it out, and honouring the edit would withdraw a permission they cannot see.
       * The last is why a rename of a role that holds `developer:view` is refused rather than quietly
       * accepted: the silent alternative is exactly the stripping this rule exists to prevent.
       */
      const offending = [
        ...(isDeveloperRole(target.systemRole) ? [target.systemRole] : []),
        ...(typeof data.systemRole === "string" && isDeveloperRole(data.systemRole) ? [data.systemRole] : []),
        ...developerPermissionsIn(data.permissions),
        ...developerPermissionsIn(target.permissions),
        ...instancePermissionsIn(data.permissions),
        // A role that already holds a tier permission is refused even for an edit that does not mention
        // it, because the caller was never shown the key — so their submitted list would silently
        // withdraw it, exactly the stripping this rule exists to prevent.
        ...instancePermissionsIn(target.permissions),
      ];
      if (offending.length) {
        const instanceKeys = [
          ...instancePermissionsIn(data.permissions),
          ...instancePermissionsIn(target.permissions),
        ];
        if (instanceKeys.length) throw instanceRefusal(offending);
        throw developerRefusal(offending);
      }
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
    // Deleting the developer role is administering it, so it is not offered either.
    if (isDeveloperRole(role.systemRole) && !isSuperAdminRole(req.user!.role)) {
      throw developerRefusal([role.systemRole]);
    }
    if (role._count.users > 0) throw new AppError("Cannot delete role with assigned users. Reassign users first.", 400);

    await prisma.role.delete({ where: { id: req.params.id } });
    res.json({ message: "Role deleted" });
  } catch (e) { next(e); }
});

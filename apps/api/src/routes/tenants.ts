import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission } from "@C7NTAX/shared";

export const tenantRouter = Router();
tenantRouter.use(authenticate);

// List all tenants
tenantRouter.get("/", async (_req: AuthRequest, res, next) => {
  try {
    const tenants = await prisma.tenant.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, include: { _count: { select: { companies: true } } } });
    res.json({ data: tenants });
  } catch (e) { next(e); }
});

// Get current tenant
tenantRouter.get("/current", async (req: AuthRequest, res, next) => {
  try {
    const tenantId = req.headers["x-tenant-id"] as string || null;
    if (!tenantId) return res.json({ tenant: null });
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    res.json({ tenant });
  } catch (e) { next(e); }
});

// Create tenant
tenantRouter.post("/", requirePermission(Permission.SystemConfig), async (req: AuthRequest, res, next) => {
  try {
    const { name, domain, settings } = req.body;
    if (!name) return res.status(400).json({ error: "name required" });
    const tenant = await prisma.tenant.create({ data: { name, domain, settings: settings || {} } });
    res.status(201).json(tenant);
  } catch (e) { next(e); }
});

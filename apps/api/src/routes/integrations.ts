import { Router } from "express";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission } from "@c7-overwatch/shared";
import { AppError } from "../middleware/errorHandler";
import { IntegrationHub, type IntegrationConfig } from "@c7-overwatch/integrations";
import { prisma } from "../index";

export const integrationsRouter = Router();
integrationsRouter.use(authenticate);

const hub = new IntegrationHub();

// ── List available integration types ──
integrationsRouter.get("/types", requirePermission(Permission.IntegrationView), async (_req: AuthRequest, res, next) => {
  try {
    res.json(hub.listAvailableIntegrations());
  } catch (e) { next(e); }
});

// ── List configured integrations ──
integrationsRouter.get("/", requirePermission(Permission.IntegrationView), async (_req: AuthRequest, res, next) => {
  try {
    // Sync from DB to hub
    const dbConfigs = await prisma.integrationConfig.findMany();
    for (const cfg of dbConfigs) {
      hub.upsertConfig({
        id: cfg.id,
        kind: cfg.kind as IntegrationConfig["kind"],
        name: cfg.name,
        enabled: cfg.enabled,
        credentials: cfg.credentials as Record<string, string>,
        settings: cfg.settings as Record<string, unknown>,
        lastSyncAt: cfg.lastSyncAt,
        status: cfg.status as IntegrationConfig["status"],
        errorMessage: cfg.errorMessage || undefined,
      });
    }
    res.json(hub.listConfigs());
  } catch (e) { next(e); }
});

// ── Save a new integration config ──
integrationsRouter.post("/", requirePermission(Permission.IntegrationManage), async (req: AuthRequest, res, next) => {
  try {
    const { kind, name, credentials, settings } = req.body;
    if (!kind || !name || !credentials) throw new AppError("kind, name, and credentials required");
    if (!hub.getAdapter(kind)) throw new AppError(`Unknown integration kind: ${kind}`);

    const created = await prisma.integrationConfig.create({
      data: { kind, name, credentials: credentials as Record<string, string>, settings: settings || {} },
    });
    const { credentials: _, ...safe } = created;
    res.status(201).json(safe);
  } catch (e) { next(e); }
});

// ── Update integration config ──
integrationsRouter.patch("/:id", requirePermission(Permission.IntegrationManage), async (req: AuthRequest, res, next) => {
  try {
    const allowed = ["name", "credentials", "settings", "enabled"];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) if (req.body[key] !== undefined) updates[key] = req.body[key];
    const cfg = await prisma.integrationConfig.update({ where: { id: req.params.id }, data: updates });
    const { credentials: _, ...safe } = cfg;
    res.json(safe);
  } catch (e) { next(e); }
});

// ── Test connection ──
integrationsRouter.post("/:id/test", requirePermission(Permission.IntegrationView), async (req: AuthRequest, res, next) => {
  try {
    const cfg = await prisma.integrationConfig.findUnique({ where: { id: req.params.id } });
    if (!cfg) throw new AppError("Integration not found", 404);
    hub.upsertConfig({
      id: cfg.id, kind: cfg.kind as IntegrationConfig["kind"], name: cfg.name, enabled: cfg.enabled,
      credentials: cfg.credentials as Record<string, string>, settings: cfg.settings as Record<string, unknown>,
      lastSyncAt: cfg.lastSyncAt, status: cfg.status as IntegrationConfig["status"], errorMessage: cfg.errorMessage || undefined,
    });
    const ok = await hub.testConnection(req.params.id);
    res.json({ success: ok });
  } catch (e) { next(e); }
});

// ── Sync ──
integrationsRouter.post("/:id/sync", requirePermission(Permission.IntegrationView), async (req: AuthRequest, res, next) => {
  try {
    const cfg = await prisma.integrationConfig.findUnique({ where: { id: req.params.id } });
    if (!cfg) throw new AppError("Integration not found", 404);
    hub.upsertConfig({
      id: cfg.id, kind: cfg.kind as IntegrationConfig["kind"], name: cfg.name, enabled: cfg.enabled,
      credentials: cfg.credentials as Record<string, string>, settings: cfg.settings as Record<string, unknown>,
      lastSyncAt: cfg.lastSyncAt, status: cfg.status as IntegrationConfig["status"], errorMessage: cfg.errorMessage || undefined,
    });
    const result = await hub.sync(req.params.id);
    // Persist lastSyncAt
    if (result.success) {
      await prisma.integrationConfig.update({ where: { id: req.params.id }, data: { lastSyncAt: new Date(), status: "connected" } });
    }
    res.json(result);
  } catch (e) { next(e); }
});

// ── Delete ──
integrationsRouter.delete("/:id", requirePermission(Permission.IntegrationManage), async (req: AuthRequest, res, next) => {
  try {
    await prisma.integrationConfig.delete({ where: { id: req.params.id } });
    res.json({ message: "Integration removed" });
  } catch (e) { next(e); }
});

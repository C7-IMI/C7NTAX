/**
 * FI-060 — Service Alerts API
 *
 * - GET    /service-alerts            active alerts (with service)
 * - GET    /service-alerts/status     banner payload (count + first alert)
 * - GET    /service-alerts/services   configured services w/ active alert counts
 * - POST   /service-alerts/services   create service            (manage)
 * - PATCH  /service-alerts/services/:id  update service         (manage)
 * - DELETE /service-alerts/services/:id  delete service         (manage)
 * - POST   /service-alerts            create manual alert       (manage)
 * - POST   /service-alerts/:id/resolve  manually resolve alert  (manage)
 * - POST   /service-alerts/refresh    run monitor check now     (manage)
 * - GET    /service-alerts/monitor-status  monitor state        (manage)
 */
import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission } from "@C7NTAX/shared";
import { AppError } from "../middleware/errorHandler";
import { getMonitorStatus, runAlertCheck } from "../services/alertMonitor";

export const serviceAlertsRouter = Router();
serviceAlertsRouter.use(authenticate);

const SERVICE_FIELDS = ["name", "category", "description", "statusPageUrl", "downDetectorUrl", "rssUrl", "monitorEnabled", "enabled", "sortOrder"] as const;

// ── Read: active alerts ──
serviceAlertsRouter.get("/", requirePermission(Permission.ServiceAlertView), async (_req: AuthRequest, res, next) => {
  try {
    const alerts = await prisma.serviceAlert.findMany({
      where: { status: "active" },
      include: { service: true },
      orderBy: { detectedAt: "desc" },
      take: 100,
    });
    const resolved = await prisma.serviceAlert.findMany({
      where: { status: "resolved" },
      include: { service: true },
      orderBy: { resolvedAt: "desc" },
      take: 25,
    });
    res.json({ data: alerts, resolved });
  } catch (e) { next(e); }
});

// ── Read: banner payload ──
serviceAlertsRouter.get("/status", requirePermission(Permission.ServiceAlertView), async (_req: AuthRequest, res, next) => {
  try {
    const alerts = await prisma.serviceAlert.findMany({
      where: { status: "active" },
      include: { service: true },
      orderBy: { detectedAt: "desc" },
    });
    const top = alerts[0] || null;
    res.json({
      activeCount: alerts.length,
      top: top
        ? {
            id: top.id,
            serviceName: top.service.name,
            title: top.title,
            severity: top.severity,
            detectedAt: top.detectedAt,
            sourceUrl: top.sourceUrl,
          }
        : null,
    });
  } catch (e) { next(e); }
});

// ── Read: configured services ──
serviceAlertsRouter.get("/services", requirePermission(Permission.ServiceAlertView), async (_req: AuthRequest, res, next) => {
  try {
    const services = await prisma.serviceAlertService.findMany({
      include: {
        alerts: {
          where: { status: "active" },
          orderBy: { detectedAt: "desc" },
          take: 3,
        },
      },
      orderBy: [{ enabled: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
    });
    res.json({ data: services });
  } catch (e) { next(e); }
});

// ── Manage: create service ──
serviceAlertsRouter.post("/services", requirePermission(Permission.ServiceAlertManage), async (req: AuthRequest, res, next) => {
  try {
    const body = req.body || {};
    if (!body.name || typeof body.name !== "string") throw new AppError("name is required", 400);
    const data: Record<string, unknown> = { name: body.name.trim() };
    for (const f of SERVICE_FIELDS) {
      if (f === "name") continue;
      if (body[f] !== undefined) data[f] = body[f];
    }
    const existing = await prisma.serviceAlertService.findUnique({ where: { name: data.name as string } });
    if (existing) throw new AppError(`A service named "${data.name}" already exists`, 409);
    const service = await prisma.serviceAlertService.create({ data: data as any });
    res.status(201).json(service);
  } catch (e) { next(e); }
});

// ── Manage: update service ──
serviceAlertsRouter.patch("/services/:id", requirePermission(Permission.ServiceAlertManage), async (req: AuthRequest, res, next) => {
  try {
    const body = req.body || {};
    const data: Record<string, unknown> = {};
    for (const f of SERVICE_FIELDS) {
      if (body[f] !== undefined) data[f] = body[f];
    }
    if (data.name && typeof data.name === "string") data.name = (data.name as string).trim();
    const service = await prisma.serviceAlertService.update({ where: { id: req.params.id }, data: data as any });
    res.json(service);
  } catch (e) { next(e); }
});

// ── Manage: delete service ──
serviceAlertsRouter.delete("/services/:id", requirePermission(Permission.ServiceAlertManage), async (req: AuthRequest, res, next) => {
  try {
    await prisma.serviceAlertService.delete({ where: { id: req.params.id } });
    res.json({ message: "Deleted" });
  } catch (e) { next(e); }
});

// ── Manage: create manual alert ──
serviceAlertsRouter.post("/", requirePermission(Permission.ServiceAlertManage), async (req: AuthRequest, res, next) => {
  try {
    const { serviceId, title, description, severity } = req.body || {};
    if (!serviceId || !title) throw new AppError("serviceId and title are required", 400);
    const service = await prisma.serviceAlertService.findUnique({ where: { id: serviceId } });
    if (!service) throw new AppError("Service not found", 404);
    const alert = await prisma.serviceAlert.create({
      data: {
        serviceId,
        title: String(title).slice(0, 300),
        description: description ? String(description).slice(0, 2000) : null,
        severity: ["outage", "degraded", "informational"].includes(severity) ? severity : "degraded",
        status: "active",
        source: "manual",
      },
    });
    res.status(201).json(alert);
  } catch (e) { next(e); }
});

// ── Manage: resolve alert ──
serviceAlertsRouter.post("/:id/resolve", requirePermission(Permission.ServiceAlertManage), async (req: AuthRequest, res, next) => {
  try {
    const alert = await prisma.serviceAlert.update({
      where: { id: req.params.id },
      data: { status: "resolved", resolvedAt: new Date() },
    });
    res.json(alert);
  } catch (e) { next(e); }
});

// ── Manage: force a monitor run ──
serviceAlertsRouter.post("/refresh", requirePermission(Permission.ServiceAlertManage), async (_req: AuthRequest, res, next) => {
  try {
    const status = await runAlertCheck();
    res.json(status);
  } catch (e) { next(e); }
});

// ── Manage: monitor state ──
serviceAlertsRouter.get("/monitor-status", requirePermission(Permission.ServiceAlertManage), (_req: AuthRequest, res) => {
  res.json(getMonitorStatus());
});

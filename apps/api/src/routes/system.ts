import { Router } from "express";
import { authenticate, type AuthRequest } from "../middleware/auth";
import { prisma } from "../index";

export const systemRouter = Router();
systemRouter.use(authenticate);

// I18N / translations
systemRouter.get("/locales", async (_req: AuthRequest, res, next) => {
  try { res.json(await prisma.locale.findMany({ include: { _count: { select: { translations: true } } } })); }
  catch (e) { next(e); }
});

systemRouter.post("/locales", async (req: AuthRequest, res, next) => {
  try { res.status(201).json(await prisma.locale.create({ data: { code: req.body.code, name: req.body.name, direction: req.body.direction || "ltr" } })); }
  catch (e) { next(e); }
});

systemRouter.get("/translations/:localeCode", async (req: AuthRequest, res, next) => {
  try { const ns = req.query.namespace as string || "common";
    const translations = await prisma.translation.findMany({ where: { localeCode: req.params.localeCode, namespace: ns } });
    const map: Record<string, string> = {};
    for (const t of translations) map[t.key] = t.value;
    res.json(map); }
  catch (e) { next(e); }
});

systemRouter.post("/translations", async (req: AuthRequest, res, next) => {
  try { res.status(201).json(await prisma.translation.create({ data: { localeCode: req.body.localeCode, key: req.body.key, value: req.body.value, namespace: req.body.namespace || "common" } })); }
  catch (e) { next(e); }
});

// Currency
systemRouter.get("/currencies", async (_req: AuthRequest, res, next) => {
  try { res.json(await prisma.currency.findMany()); }
  catch (e) { next(e); }
});

systemRouter.get("/exchange-rates", async (_req: AuthRequest, res, next) => {
  try { res.json(await prisma.exchangeRate.findMany({ include: { from: true, to: true } })); }
  catch (e) { next(e); }
});

systemRouter.post("/exchange-rates", async (req: AuthRequest, res, next) => {
  try { res.status(201).json(await prisma.exchangeRate.create({ data: { fromCurrency: req.body.fromCurrency, toCurrency: req.body.toCurrency, rate: req.body.rate } })); }
  catch (e) { next(e); }
});

// Retention policies
systemRouter.get("/retention-policies", async (_req: AuthRequest, res, next) => {
  try { res.json(await prisma.retentionPolicy.findMany()); }
  catch (e) { next(e); }
});

systemRouter.post("/retention-policies", async (req: AuthRequest, res, next) => {
  try { res.status(201).json(await prisma.retentionPolicy.create({ data: { entity: req.body.entity, retentionDays: req.body.retentionDays, archiveAction: req.body.archiveAction || "archive", condition: req.body.condition || {} } })); }
  catch (e) { next(e); }
});

// Field permissions
systemRouter.get("/field-permissions", async (_req: AuthRequest, res, next) => {
  try { res.json(await prisma.fieldPermission.findMany()); }
  catch (e) { next(e); }
});

systemRouter.post("/field-permissions", async (req: AuthRequest, res, next) => {
  try { res.status(201).json(await prisma.fieldPermission.create({ data: { entity: req.body.entity, field: req.body.field, roleName: req.body.roleName, canRead: req.body.canRead ?? true, canWrite: req.body.canWrite ?? false } })); }
  catch (e) { next(e); }
});

// Calendar sync configs
systemRouter.get("/calendar-sync", async (req: AuthRequest, res, next) => {
  try { res.json(await prisma.calendarSyncConfig.findMany({ where: { userId: req.user!.userId } })); }
  catch (e) { next(e); }
});

systemRouter.post("/calendar-sync", async (req: AuthRequest, res, next) => {
  try { res.status(201).json(await prisma.calendarSyncConfig.create({ data: { userId: req.user!.userId, provider: req.body.provider, syncScheduleEntries: req.body.syncScheduleEntries ?? true, syncPto: req.body.syncPto ?? true } })); }
  catch (e) { next(e); }
});
